import fs from 'node:fs';
import path from 'node:path';
import { migrateLegacyItem } from '../shared/brand';
import { uid } from '../shared/ops';
import type { ItemMap, VersionMeta } from '../shared/types';
import { isValidId, sanitizeItem } from '../shared/validate';

export const MAX_AUTO_VERSIONS = 50;
export const MAX_MANUAL_VERSIONS = 100;

/**
 * Снимки досок: `DATA_DIR/versions/<boardId>/index.json` (метаданные) и
 * `<versionId>.json` (объекты). Снимки редкие (раз в ≥10 минут на доску или
 * вручную), поэтому запись синхронная и атомарная (временный файл + rename).
 */
export class VersionStore {
  private readonly dir: string;
  private index = new Map<string, VersionMeta[]>();

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'versions');
    fs.mkdirSync(this.dir, { recursive: true });
  }

  private boardDir(boardId: string) {
    return path.join(this.dir, boardId);
  }

  private writeAtomic(file: string, data: string) {
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
  }

  private load(boardId: string): VersionMeta[] {
    let list = this.index.get(boardId);
    if (list) return list;
    list = [];
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(this.boardDir(boardId), 'index.json'), 'utf8'));
      if (Array.isArray(raw)) list = raw.filter((v) => v && isValidId(v.id) && typeof v.createdAt === 'number');
    } catch {
      /* версий ещё нет */
    }
    this.index.set(boardId, list);
    return list;
  }

  private saveIndex(boardId: string, list: VersionMeta[]) {
    fs.mkdirSync(this.boardDir(boardId), { recursive: true });
    this.writeAtomic(path.join(this.boardDir(boardId), 'index.json'), JSON.stringify(list));
  }

  /** Версии доски, новые сверху. */
  list(boardId: string): VersionMeta[] {
    return [...this.load(boardId)].sort((a, b) => b.createdAt - a.createdAt);
  }

  latestAt(boardId: string): number {
    return this.load(boardId).reduce((m, v) => Math.max(m, v.createdAt), 0);
  }

  create(boardId: string, items: ItemMap, name: string, auto: boolean, now = Date.now()): VersionMeta {
    const meta: VersionMeta = { id: uid(10), name, createdAt: now, auto, itemCount: Object.keys(items).length };
    fs.mkdirSync(this.boardDir(boardId), { recursive: true });
    this.writeAtomic(path.join(this.boardDir(boardId), `${meta.id}.json`), JSON.stringify({ ...meta, items }));
    const list = [...this.load(boardId), meta];
    this.index.set(boardId, list);
    this.prune(boardId);
    this.saveIndex(boardId, this.index.get(boardId)!);
    return meta;
  }

  /** Версия с объектами (объекты повторно проходят валидацию). */
  get(boardId: string, versionId: string): (VersionMeta & { items: ItemMap }) | null {
    if (!isValidId(versionId)) return null;
    const meta = this.load(boardId).find((v) => v.id === versionId);
    if (!meta) return null;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(this.boardDir(boardId), `${versionId}.json`), 'utf8'));
      const items: ItemMap = {};
      for (const it of Object.values(raw.items ?? {})) {
        const clean = sanitizeItem(it);
        if (clean) items[clean.id] = migrateLegacyItem(clean);
      }
      return { ...meta, items };
    } catch {
      return null;
    }
  }

  remove(boardId: string, versionId: string): boolean {
    const list = this.load(boardId);
    if (!list.some((v) => v.id === versionId)) return false;
    const next = list.filter((v) => v.id !== versionId);
    this.index.set(boardId, next);
    fs.rmSync(path.join(this.boardDir(boardId), `${versionId}.json`), { force: true });
    this.saveIndex(boardId, next);
    return true;
  }

  removeAll(boardId: string) {
    this.index.delete(boardId);
    fs.rmSync(this.boardDir(boardId), { recursive: true, force: true });
  }

  /** Ограничение числа версий: старые автоматические и ручные удаляются. */
  private prune(boardId: string) {
    const list = this.load(boardId);
    const drop = new Set<string>();
    for (const [auto, max] of [
      [true, MAX_AUTO_VERSIONS],
      [false, MAX_MANUAL_VERSIONS],
    ] as const) {
      const group = list.filter((v) => v.auto === auto).sort((a, b) => a.createdAt - b.createdAt);
      for (const v of group.slice(0, Math.max(0, group.length - max))) drop.add(v.id);
    }
    if (!drop.size) return;
    for (const id of drop) fs.rmSync(path.join(this.boardDir(boardId), `${id}.json`), { force: true });
    this.index.set(
      boardId,
      list.filter((v) => !drop.has(v.id)),
    );
  }
}
