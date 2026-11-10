import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { applyOpMut, uid } from '../shared/ops';
import { buildTemplate, TEMPLATES } from '../shared/templates';
import type { BoardMeta, CommentThread, ItemMap, Op, VersionMeta } from '../shared/types';
import { sanitizeItem } from '../shared/validate';
import { type BoardSession, detachThreads, emptySession, loadComments, loadSession } from './session';
import { VersionStore } from './versions';

export interface StoredBoard {
  meta: BoardMeta;
  items: ItemMap;
  comments: Record<string, CommentThread>;
  session: BoardSession;
}

export interface RepoOptions {
  /** Задержка отложенной записи на диск. */
  saveDelayMs?: number;
  /** Интервал автоматических снимков версий. */
  autoSnapshotMs?: number;
  /** Источник времени (подменяется в тестах). */
  now?: () => number;
}

export const AUTO_SNAPSHOT_MS = 10 * 60 * 1000;

/**
 * Хранилище досок: все доски держатся в памяти, на диск пишутся
 * отложенно (debounce) и атомарно — через временный файл и rename.
 */
export class BoardRepository {
  readonly versions: VersionStore;
  private boards = new Map<string, StoredBoard>();
  private timers = new Map<string, NodeJS.Timeout>();
  private writing = new Map<string, Promise<void>>();
  /** Когда делался последний снимок и менялась ли доска с тех пор. */
  private snapshots = new Map<string, { lastAt: number; dirty: boolean }>();
  private readonly dir: string;
  private readonly saveDelayMs: number;
  private readonly autoSnapshotMs: number;
  readonly now: () => number;

  constructor(dataDir: string, opts: RepoOptions = {}) {
    this.dir = path.join(dataDir, 'boards');
    this.saveDelayMs = opts.saveDelayMs ?? 300;
    this.autoSnapshotMs = opts.autoSnapshotMs ?? AUTO_SNAPSHOT_MS;
    this.now = opts.now ?? Date.now;
    fs.mkdirSync(this.dir, { recursive: true });
    this.versions = new VersionStore(dataDir);
    this.loadAll();
  }

  private loadAll() {
    for (const file of fs.readdirSync(this.dir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(this.dir, file), 'utf8'));
        if (!raw?.meta?.id || typeof raw.items !== 'object') throw new Error('bad format');
        const items: ItemMap = {};
        for (const it of Object.values(raw.items)) {
          const clean = sanitizeItem(it);
          if (clean) items[clean.id] = clean;
        }
        // файлы версии 0.1 не содержат comments/session — подставляются значения по умолчанию
        this.boards.set(raw.meta.id, {
          meta: raw.meta,
          items,
          comments: loadComments(raw.comments),
          session: loadSession(raw.session),
        });
      } catch (err) {
        console.warn(`[repo] пропускаю повреждённый файл ${file}:`, (err as Error).message);
      }
    }
  }

  private fileOf(id: string) {
    return path.join(this.dir, `${id}.json`);
  }

  list(): BoardMeta[] {
    return [...this.boards.values()]
      .map((b) => ({ ...b.meta, itemCount: Object.keys(b.items).length }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id: string): StoredBoard | undefined {
    return this.boards.get(id);
  }

  metaOf(id: string): BoardMeta | undefined {
    const b = this.boards.get(id);
    return b && { ...b.meta, itemCount: Object.keys(b.items).length };
  }

  create(name: string, templateId = 'blank'): BoardMeta {
    const id = uid(12);
    const now = this.now();
    const items: ItemMap = {};
    if (TEMPLATES.some((t) => t.id === templateId)) {
      for (const it of buildTemplate(templateId, () => uid(12))) items[it.id] = it;
    }
    this.boards.set(id, { meta: { id, name, createdAt: now, updatedAt: now }, items, comments: {}, session: emptySession() });
    this.snapshots.set(id, { lastAt: 0, dirty: true });
    this.scheduleSave(id, 0);
    return this.metaOf(id)!;
  }

  duplicate(id: string, name: string): BoardMeta | undefined {
    const src = this.boards.get(id);
    if (!src) return undefined;
    const meta = this.create(name, 'blank');
    this.boards.get(meta.id)!.items = structuredClone(src.items);
    this.scheduleSave(meta.id, 0);
    return this.metaOf(meta.id);
  }

  rename(id: string, name: string): BoardMeta | undefined {
    const b = this.boards.get(id);
    if (!b) return undefined;
    b.meta.name = name;
    b.meta.updatedAt = this.now();
    this.scheduleSave(id);
    return this.metaOf(id);
  }

  async remove(id: string): Promise<boolean> {
    if (!this.boards.delete(id)) return false;
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    this.snapshots.delete(id);
    await this.writing.get(id);
    await fsp.rm(this.fileOf(id), { force: true });
    this.versions.removeAll(id);
    return true;
  }

  /**
   * Применяет операции. Перед первой правкой после паузы делает автоснимок.
   * Треды, привязанные к удаляемым объектам, становятся свободными — они возвращаются для рассылки.
   */
  applyOps(id: string, ops: Op[]): { ok: boolean; threads: CommentThread[] } {
    const b = this.boards.get(id);
    if (!b) return { ok: false, threads: [] };
    const now = this.now();
    this.maybeAutoSnapshot(id, b, now);
    const gone = new Set<string>();
    for (const op of ops) if (op.t === 'delete' && b.items[op.id]) gone.add(op.id);
    const threads = gone.size ? detachThreads(b.comments, b.items, gone, now) : [];
    for (const op of ops) applyOpMut(b.items, op);
    b.meta.updatedAt = now;
    this.snapshotState(id).dirty = true;
    this.scheduleSave(id);
    return { ok: true, threads };
  }

  /** Отметить изменение сессионных данных (комментарии, таймер, голосование) для записи на диск. */
  touch(id: string) {
    if (this.boards.has(id)) this.scheduleSave(id);
  }

  // ------------------------------------------------------------------ версии

  private snapshotState(id: string) {
    let s = this.snapshots.get(id);
    if (!s) {
      s = { lastAt: this.versions.latestAt(id), dirty: true };
      this.snapshots.set(id, s);
    }
    return s;
  }

  private maybeAutoSnapshot(id: string, b: StoredBoard, now: number) {
    const s = this.snapshotState(id);
    if (!s.dirty || now - s.lastAt < this.autoSnapshotMs) return;
    try {
      this.versions.create(id, b.items, 'Автосохранение', true, now);
      s.lastAt = now;
      s.dirty = false;
    } catch (err) {
      console.error(`[repo] не удалось сохранить версию доски ${id}:`, err);
    }
  }

  snapshot(id: string, name: string): VersionMeta | undefined {
    const b = this.boards.get(id);
    if (!b) return undefined;
    const now = this.now();
    const meta = this.versions.create(id, b.items, name, false, now);
    const s = this.snapshotState(id);
    s.lastAt = now;
    s.dirty = false;
    return meta;
  }

  /**
   * Восстановление версии: текущее состояние сохраняется отдельной версией,
   * объекты заменяются, треды исчезнувших объектов становятся свободными.
   */
  restore(id: string, versionId: string): { items: ItemMap; threads: CommentThread[]; version: VersionMeta } | undefined {
    const b = this.boards.get(id);
    const v = b && this.versions.get(id, versionId);
    if (!b || !v) return undefined;
    const now = this.now();
    this.versions.create(id, b.items, `Перед восстановлением «${v.name}»`, false, now);
    const gone = new Set(Object.keys(b.items).filter((iid) => !v.items[iid]));
    const threads = detachThreads(b.comments, b.items, gone, now);
    b.items = v.items;
    b.meta.updatedAt = now;
    const s = this.snapshotState(id);
    s.lastAt = now;
    s.dirty = false;
    this.scheduleSave(id);
    const { items: _items, ...version } = v;
    return { items: b.items, threads, version };
  }

  // ------------------------------------------------------------------ запись на диск

  private scheduleSave(id: string, delay = this.saveDelayMs) {
    if (this.timers.has(id)) return;
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id);
        void this.save(id);
      }, delay),
    );
  }

  private save(id: string): Promise<void> {
    const prev = this.writing.get(id) ?? Promise.resolve();
    const next = prev.then(async () => {
      const b = this.boards.get(id);
      if (!b) return;
      const file = this.fileOf(id);
      const tmp = `${file}.${process.pid}.tmp`;
      try {
        await fsp.writeFile(tmp, JSON.stringify({ meta: b.meta, items: b.items, comments: b.comments, session: b.session }));
        await fsp.rename(tmp, file);
      } catch (err) {
        console.error(`[repo] ошибка записи доски ${id}:`, err);
      }
    });
    this.writing.set(id, next);
    return next;
  }

  /** Немедленно записать все несохранённые доски (при остановке сервера). */
  async flush(): Promise<void> {
    const pending = [...this.timers.keys()];
    for (const id of pending) {
      clearTimeout(this.timers.get(id));
      this.timers.delete(id);
      void this.save(id);
    }
    await Promise.all([...this.writing.values()]);
  }
}
