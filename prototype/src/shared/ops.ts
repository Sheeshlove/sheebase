import type { Item, ItemMap, ItemPatch, Op } from './types';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Случайный идентификатор (base62). 12 символов ≈ 71 бит энтропии. */
export function uid(length = 12): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] % 62];
  return out;
}

/** Применяет операцию к изменяемой карте объектов. */
export function applyOpMut(items: ItemMap, op: Op): void {
  switch (op.t) {
    case 'add':
      items[op.item.id] = op.item;
      break;
    case 'update': {
      const cur = items[op.id];
      if (cur) items[op.id] = { ...cur, ...op.patch } as Item;
      break;
    }
    case 'delete':
      delete items[op.id];
      break;
  }
}

/** Чистое применение операций: возвращает новую карту (или ту же, если операций нет). */
export function applyOps(items: ItemMap, ops: readonly Op[]): ItemMap {
  if (ops.length === 0) return items;
  const next = { ...items };
  for (const op of ops) applyOpMut(next, op);
  return next;
}

export function opTargetId(op: Op): string {
  return op.t === 'add' ? op.item.id : op.id;
}

/**
 * Ключи, которые затрагивает операция: `id` — объект целиком (add/delete),
 * `id.field` — отдельное поле (update).
 */
export function opKeys(op: Op): string[] {
  if (op.t === 'update') return Object.keys(op.patch).map((f) => `${op.id}.${f}`);
  return [opTargetId(op)];
}

/**
 * Сжимает последовательность операций: подряд идущие изменения одного объекта
 * объединяются. Операции над разными объектами независимы, поэтому порядок
 * между ними не важен.
 */
export function compactOps(ops: readonly Op[]): Op[] {
  const out: (Op | null)[] = [];
  const lastIndex = new Map<string, number>();
  for (const op of ops) {
    const id = opTargetId(op);
    const li = lastIndex.get(id);
    const last = li !== undefined ? out[li] : null;
    if (op.t === 'update' && last) {
      if (last.t === 'add') {
        out[li!] = { t: 'add', item: { ...last.item, ...op.patch } as Item };
        continue;
      }
      if (last.t === 'update') {
        out[li!] = { t: 'update', id, patch: { ...last.patch, ...op.patch } };
        continue;
      }
    }
    if (op.t === 'delete' && last && last.t !== 'delete') {
      // add/update + delete → достаточно delete
      out[li!] = null;
    }
    lastIndex.set(id, out.length);
    out.push(op);
  }
  return out.filter((o): o is Op => o !== null);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Глубокое сравнение JSON-совместимых значений. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!jsonEqual(a[i], b[i])) return false;
    return true;
  }
  if (isObj(a) && isObj(b) && !Array.isArray(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (const k of ka) if (!jsonEqual(a[k], b[k])) return false;
    return true;
  }
  // undefined и null считаем равными (отсутствующее поле)
  return a == null && b == null;
}

/** Разница двух версий объекта: прямой и обратный патчи (undefined → null, чтобы пережить JSON). */
export function diffItems(before: Item, after: Item): { forward: ItemPatch; backward: ItemPatch } | null {
  const forward: Record<string, unknown> = {};
  const backward: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  let changed = false;
  for (const k of keys) {
    if (k === 'id' || k === 'type') continue;
    const a = (before as unknown as Record<string, unknown>)[k];
    const b = (after as unknown as Record<string, unknown>)[k];
    if (!jsonEqual(a, b)) {
      forward[k] = b === undefined ? null : b;
      backward[k] = a === undefined ? null : a;
      changed = true;
    }
  }
  return changed ? { forward: forward as ItemPatch, backward: backward as ItemPatch } : null;
}
