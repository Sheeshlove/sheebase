import type { Item, ItemPatch, ItemType, Op } from './types';

// Валидация входящих данных на сервере: всё, что пришло по сети, считается недоверенным.

export const LIMITS = {
  idLength: 64,
  text: 20_000,
  shortText: 500,
  color: 64,
  imageSrc: 12 * 1024 * 1024,
  points: 40_000,
  opsPerMessage: 5_000,
  coordinate: 1e7,
  link: 2_000,
  author: 60,
  comment: 2_000,
  threadMessages: 500,
};

const ITEM_TYPES: ReadonlySet<ItemType> = new Set(['sticky', 'shape', 'text', 'frame', 'connector', 'path', 'image']);
const SHAPES = new Set(['rect', 'roundrect', 'ellipse', 'triangle', 'diamond', 'parallelogram', 'hexagon', 'star']);
const SIDES = new Set(['auto', 'top', 'right', 'bottom', 'left']);
const LINE_STYLES = new Set(['straight', 'elbow', 'curved']);
const ARROWS = new Set(['none', 'arrow']);
const ALIGNS = new Set(['left', 'center', 'right']);

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= LIMITS.coordinate;
const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const isId = (v: unknown): v is string => isStr(v, LIMITS.idLength) && /^[A-Za-z0-9_-]+$/.test(v as string);

/**
 * Цвет: `#rgb[a]`, `#rrggbb[aa]`, `transparent`, имя цвета или `rgb()/rgba()`.
 * Строгий шаблон — защита в глубину: значения попадают в атрибуты SVG (миниатюры, экспорт).
 */
const COLOR_RE =
  /^(#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|transparent|[a-zA-Z]{1,30}|rgba?\(\s*\d{1,3}(?:\.\d+)?%?\s*,\s*\d{1,3}(?:\.\d+)?%?\s*,\s*\d{1,3}(?:\.\d+)?%?\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\))$/;
export const isColor = (v: unknown): v is string => isStr(v, LIMITS.color) && COLOR_RE.test(v as string);

/** Ссылка на объекте: только http(s), без пробелов, кавычек и управляющих символов. */
const LINK_RE = /^https?:\/\/[^\s"<>\u0000-\u001f\u007f]+$/i;
export const isLink = (v: unknown): v is string => isStr(v, LIMITS.link) && LINK_RE.test(v as string);

function validEndpoint(v: unknown): boolean {
  if (!isObj(v)) return false;
  if (!isNum(v.x) || !isNum(v.y)) return false;
  if (v.itemId != null && !isId(v.itemId)) return false;
  if (v.side != null && !SIDES.has(v.side as string)) return false;
  return true;
}

type Check = (v: unknown) => boolean;

/** Правила для каждого поля (кроме id/type). Неизвестные поля отбрасываются. */
const FIELD_RULES: Record<string, Check> = {
  x: isNum,
  y: isNum,
  w: (v) => isNum(v) && v >= 0,
  h: (v) => isNum(v) && v >= 0,
  z: isNum,
  locked: (v) => v === null || typeof v === 'boolean',
  groupId: (v) => v === null || isId(v),
  text: (v) => isStr(v, LIMITS.text),
  color: isColor,
  fill: isColor,
  stroke: isColor,
  textColor: isColor,
  link: (v) => v === null || isLink(v),
  author: (v) => v === null || (isStr(v, LIMITS.author) && !/[\u0000-\u001f]/.test(v as string)),
  strokeWidth: (v) => isNum(v) && v >= 0 && v <= 100,
  fontSize: (v) => isNum(v) && v > 0 && v <= 1000,
  shape: (v) => SHAPES.has(v as string),
  bold: (v) => typeof v === 'boolean',
  align: (v) => ALIGNS.has(v as string),
  title: (v) => isStr(v, LIMITS.shortText),
  label: (v) => isStr(v, LIMITS.shortText),
  src: (v) => isStr(v, LIMITS.imageSrc) && /^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,/.test(v as string),
  points: (v) => Array.isArray(v) && v.length <= LIMITS.points && v.length % 2 === 0 && v.every(isNum),
  from: validEndpoint,
  to: validEndpoint,
  lineStyle: (v) => LINE_STYLES.has(v as string),
  startArrow: (v) => ARROWS.has(v as string),
  endArrow: (v) => ARROWS.has(v as string),
};

/** Обязательные поля по типам. */
const REQUIRED: Record<ItemType, string[]> = {
  sticky: ['text', 'color'],
  shape: ['shape', 'fill', 'stroke', 'strokeWidth', 'text', 'fontSize', 'textColor'],
  text: ['text', 'fontSize', 'color', 'bold', 'align'],
  frame: ['title', 'fill'],
  image: ['src'],
  path: ['points', 'stroke', 'strokeWidth'],
  connector: ['from', 'to', 'lineStyle', 'startArrow', 'endArrow', 'stroke', 'strokeWidth', 'label'],
};

export function sanitizePatch(raw: unknown): ItemPatch | null {
  if (!isObj(raw)) return null;
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const [k, v] of Object.entries(raw)) {
    const rule = FIELD_RULES[k];
    if (!rule || !rule(v)) continue;
    out[k] = v;
    n++;
  }
  return n > 0 ? (out as ItemPatch) : null;
}

export function sanitizeItem(raw: unknown): Item | null {
  if (!isObj(raw)) return null;
  if (!isId(raw.id) || !ITEM_TYPES.has(raw.type as ItemType)) return null;
  const type = raw.type as ItemType;
  for (const k of ['x', 'y', 'w', 'h', 'z']) if (!FIELD_RULES[k](raw[k])) return null;
  for (const k of REQUIRED[type]) if (!(k in raw) || !FIELD_RULES[k](raw[k])) return null;
  const patch = sanitizePatch(raw) ?? {};
  return { ...patch, id: raw.id, type } as Item;
}

export interface SanitizeReport {
  ops: Op[];
  /**
   * Объекты, операции над которыми были отброшены или урезаны валидацией.
   * Отправителю нужно прислать их актуальное состояние, иначе его копия разойдётся с сервером.
   */
  rejected: string[];
}

export function sanitizeOpsReport(raw: unknown): SanitizeReport {
  const report: SanitizeReport = { ops: [], rejected: [] };
  if (!Array.isArray(raw)) return report;
  const reject = (id: unknown) => {
    if (isId(id) && !report.rejected.includes(id)) report.rejected.push(id);
  };
  for (const op of raw.slice(0, LIMITS.opsPerMessage)) {
    if (!isObj(op)) continue;
    if (op.t === 'add') {
      const item = sanitizeItem(op.item);
      if (!item) {
        reject(isObj(op.item) ? op.item.id : undefined);
        continue;
      }
      // поля проверяются без преобразования, поэтому «урезан» = потерял часть ключей
      if (Object.keys(item).length !== Object.keys(op.item as object).length) reject(item.id);
      report.ops.push({ t: 'add', item });
    } else if (op.t === 'update') {
      if (!isId(op.id)) continue;
      const patch = sanitizePatch(op.patch);
      const rawKeys = isObj(op.patch) ? Object.keys(op.patch).length : 0;
      if (!patch || Object.keys(patch).length !== rawKeys) reject(op.id);
      if (patch) report.ops.push({ t: 'update', id: op.id, patch });
    } else if (op.t === 'delete') {
      if (isId(op.id)) report.ops.push({ t: 'delete', id: op.id });
    }
  }
  return report;
}

export function sanitizeOps(raw: unknown): Op[] {
  return sanitizeOpsReport(raw).ops;
}

export function sanitizeName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const s = raw.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 120);
  return s || fallback;
}

/** Текст комментария: обрезка пробелов, без управляющих символов (кроме переноса строки), 1–2000 символов. */
export function sanitizeCommentText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim();
  if (!text || text.length > LIMITS.comment) return null;
  return text;
}

export const isValidId = isId;
export const isFiniteCoord = isNum;
