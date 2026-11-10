import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { applyOpMut, uid } from '../shared/ops';
import { buildTemplate, TEMPLATES } from '../shared/templates';
import { sanitizeItem } from '../shared/validate';
import type { BoardMeta, ItemMap, Op } from '../shared/types';

export interface StoredBoard {
  meta: BoardMeta;
  items: ItemMap;
}

/**
 * Хранилище досок: все доски держатся в памяти, на диск пишутся
 * отложенно (debounce) и атомарно — через временный файл и rename.
 */
export class BoardRepository {
  private boards = new Map<string, StoredBoard>();
  private timers = new Map<string, NodeJS.Timeout>();
  private writing = new Map<string, Promise<void>>();
  private readonly dir: string;

  constructor(
    dataDir: string,
    private readonly saveDelayMs = 300,
  ) {
    this.dir = path.join(dataDir, 'boards');
    fs.mkdirSync(this.dir, { recursive: true });
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
        this.boards.set(raw.meta.id, { meta: raw.meta, items });
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
    const now = Date.now();
    const items: ItemMap = {};
    if (TEMPLATES.some((t) => t.id === templateId)) {
      for (const it of buildTemplate(templateId, () => uid(12))) items[it.id] = it;
    }
    this.boards.set(id, { meta: { id, name, createdAt: now, updatedAt: now }, items });
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
    b.meta.updatedAt = Date.now();
    this.scheduleSave(id);
    return this.metaOf(id);
  }

  async remove(id: string): Promise<boolean> {
    if (!this.boards.delete(id)) return false;
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    await this.writing.get(id);
    await fsp.rm(this.fileOf(id), { force: true });
    return true;
  }

  applyOps(id: string, ops: Op[]): boolean {
    const b = this.boards.get(id);
    if (!b) return false;
    for (const op of ops) applyOpMut(b.items, op);
    b.meta.updatedAt = Date.now();
    this.scheduleSave(id);
    return true;
  }

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
        await fsp.writeFile(tmp, JSON.stringify(b));
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
