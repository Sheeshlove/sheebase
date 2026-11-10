import { itemBounds, type Rect } from './geometry';
import type { Item, ItemMap } from './types';

// Чистые функции раскладки: поиск, порядок фреймов, выравнивание и распределение.

export type Delta = { dx: number; dy: number };

/** Нормализация для поиска: регистр и «ё» = «е». */
export const normalizeText = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

/** Текст объекта, по которому идёт поиск. */
export function itemText(it: Item): string {
  switch (it.type) {
    case 'sticky':
    case 'shape':
    case 'text':
      return it.text;
    case 'frame':
      return it.title;
    case 'connector':
      return it.label;
    default:
      return '';
  }
}

/**
 * Порядок «как читают»: объекты группируются в строки (пересекающиеся по вертикали),
 * строки — сверху вниз, внутри строки — слева направо.
 */
export function readingOrder(list: { id: string; r: Rect }[]): string[] {
  const sorted = [...list].sort((a, b) => a.r.y - b.r.y || a.r.x - b.r.x);
  const rows: { y1: number; y2: number; members: { id: string; r: Rect }[] }[] = [];
  for (const it of sorted) {
    const row = rows[rows.length - 1];
    // объект в той же строке, если его верх выше середины строки
    if (row && it.r.y < (row.y1 + row.y2) / 2) {
      row.members.push(it);
      row.y2 = Math.max(row.y2, it.r.y + it.r.h);
    } else {
      rows.push({ y1: it.r.y, y2: it.r.y + it.r.h, members: [it] });
    }
  }
  return rows.flatMap((row) => row.members.sort((a, b) => a.r.x - b.r.x || a.r.y - b.r.y).map((m) => m.id));
}

/** Объекты, в тексте которых встречается запрос (в порядке чтения). */
export function searchItems(items: ItemMap, query: string): string[] {
  const q = normalizeText(query.trim());
  if (!q) return [];
  const hits: { id: string; r: Rect }[] = [];
  for (const id in items) {
    const it = items[id];
    if (normalizeText(itemText(it)).includes(q)) hits.push({ id, r: itemBounds(it, items) });
  }
  return readingOrder(hits);
}

/** Фреймы в порядке показа (для панели фреймов и презентации). */
export function frameOrder(items: ItemMap): string[] {
  const frames: { id: string; r: Rect }[] = [];
  for (const id in items) {
    const it = items[id];
    if (it.type === 'frame') frames.push({ id, r: { x: it.x, y: it.y, w: it.w, h: it.h } });
  }
  return readingOrder(frames);
}

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vmiddle' | 'bottom';

/** Участники выравнивания: незаблокированные объекты, кроме коннекторов (они следуют за объектами). */
function alignable(items: ItemMap, ids: readonly string[]) {
  return ids
    .map((id) => items[id])
    .filter((it): it is Item => !!it && it.type !== 'connector' && !it.locked)
    .map((it) => ({ id: it.id, r: itemBounds(it, items) }));
}

/** Сдвиги для выравнивания по общей рамке выделения. */
export function alignDeltas(items: ItemMap, ids: readonly string[], mode: AlignMode): Map<string, Delta> {
  const list = alignable(items, ids);
  const out = new Map<string, Delta>();
  if (list.length < 2) return out;
  const minX = Math.min(...list.map((l) => l.r.x));
  const maxX = Math.max(...list.map((l) => l.r.x + l.r.w));
  const minY = Math.min(...list.map((l) => l.r.y));
  const maxY = Math.max(...list.map((l) => l.r.y + l.r.h));
  for (const { id, r } of list) {
    let dx = 0;
    let dy = 0;
    if (mode === 'left') dx = minX - r.x;
    if (mode === 'right') dx = maxX - (r.x + r.w);
    if (mode === 'hcenter') dx = (minX + maxX) / 2 - (r.x + r.w / 2);
    if (mode === 'top') dy = minY - r.y;
    if (mode === 'bottom') dy = maxY - (r.y + r.h);
    if (mode === 'vmiddle') dy = (minY + maxY) / 2 - (r.y + r.h / 2);
    if (Math.abs(dx) > 1e-6 || Math.abs(dy) > 1e-6) out.set(id, { dx, dy });
  }
  return out;
}

/** Сдвиги для равных промежутков по оси (крайние объекты остаются на месте). */
export function distributeDeltas(items: ItemMap, ids: readonly string[], axis: 'x' | 'y'): Map<string, Delta> {
  const list = alignable(items, ids);
  const out = new Map<string, Delta>();
  if (list.length < 3) return out;
  const pos = (r: Rect) => (axis === 'x' ? r.x : r.y);
  const size = (r: Rect) => (axis === 'x' ? r.w : r.h);
  list.sort((a, b) => pos(a.r) + size(a.r) / 2 - (pos(b.r) + size(b.r) / 2));
  const start = pos(list[0].r);
  const end = pos(list[list.length - 1].r) + size(list[list.length - 1].r);
  const total = list.reduce((s, l) => s + size(l.r), 0);
  const gap = (end - start - total) / (list.length - 1);
  let cursor = start;
  for (const { id, r } of list) {
    const d = cursor - pos(r);
    if (Math.abs(d) > 1e-6) out.set(id, axis === 'x' ? { dx: d, dy: 0 } : { dx: 0, dy: d });
    cursor += size(r) + gap;
  }
  return out;
}
