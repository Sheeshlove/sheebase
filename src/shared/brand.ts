import type { FrameItem, Item, ItemMap } from './types';

// Палитра дизайн-системы ШИБЕЙС для содержимого досок.
// Значения совпадают с токенами в src/client/design/tokens.css (источник — дизайн-система);
// здесь они продублированы, потому что нужны и серверу (миниатюры), и экспорту.

export const BRAND = {
  blue500: '#5c7da6',
  blue700: '#35546c',
  white: '#ffffff',
  ink: '#000000',
  gray600: '#737373',
  sun400: '#ffdd00',
  alertRed: '#f90000',
  riskHigh: '#ff8a8a',
  riskLow: '#b3ffa7',
} as const;

/** Фон приложения и каждой доски (токен `surface`). */
export const SURFACE = BRAND.blue500;

/** Линия-коннектор бренда: белый пунктир 6px, круглые концы, штрих 14 12. */
export const CONNECTOR_DASH = '14 12';
export const CONNECTOR_WIDTH = 6;

/** Радиусы (мировые единицы): `radius-lg` — фреймы, `radius-sm` — стикеры. */
export const RADIUS_LG = 32;
export const RADIUS_SM = 4;

/** Тона стикеров (компонент StickyNote): значение несёт слово, а не только цвет. */
export const STICKY_TONES: { id: 'sun' | 'low' | 'high' | 'white'; name: string; value: string }[] = [
  { id: 'sun', name: 'Идея', value: BRAND.sun400 },
  { id: 'low', name: 'Готово', value: BRAND.riskLow },
  { id: 'high', name: 'Заблокировано', value: BRAND.riskHigh },
  { id: 'white', name: 'Нейтрально', value: BRAND.white },
];

/** Палитра для фигур, текста, линий и пера: только цвета системы. */
export const PALETTE: { name: string; value: string }[] = [
  { name: 'Без заливки', value: 'transparent' },
  { name: 'Белый', value: BRAND.white },
  { name: 'Жёлтый', value: BRAND.sun400 },
  { name: 'Зелёный', value: BRAND.riskLow },
  { name: 'Розовый', value: BRAND.riskHigh },
  { name: 'Красный', value: BRAND.alertRed },
  { name: 'Синий', value: BRAND.blue500 },
  { name: 'Тёмно-синий', value: BRAND.blue700 },
  { name: 'Серый', value: BRAND.gray600 },
  { name: 'Чёрный', value: BRAND.ink },
];

export const PALETTE_SOLID = PALETTE.filter((c) => c.value !== 'transparent');

/** Фреймы — белая карточка или тёмно-синий блок. */
export const FRAME_FILLS: { name: string; value: string }[] = [
  { name: 'Белый', value: BRAND.white },
  { name: 'Тёмно-синий', value: BRAND.blue700 },
];

// ------------------------------------------------------------------ контраст

function parseHex(color: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3,8})$/i.exec(color.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
  if (h.length !== 6 && h.length !== 8) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Относительная яркость по WCAG (0 — чёрный, 1 — белый). Для нераспознанных цветов — 1. */
export function luminance(color: string): number {
  const rgb = parseHex(color);
  if (!rgb) return 1;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Что лежит под объектом: синий холст, белая карточка фрейма или тёмно-синий фрейм. */
export type Ground = 'surface' | 'card' | 'deep';

export const groundColor = (g: Ground): string => (g === 'card' ? BRAND.white : g === 'deep' ? BRAND.blue700 : BRAND.blue500);

/** Основание в точке: верхний фрейм под ней (если есть), иначе холст. */
export function groundAt(items: ItemMap, x: number, y: number, ignoreId?: string): Ground {
  let top: FrameItem | null = null;
  for (const id in items) {
    const it = items[id];
    if (it.type !== 'frame' || id === ignoreId) continue;
    if (x < it.x || y < it.y || x > it.x + it.w || y > it.y + it.h) continue;
    if (!top || it.z > top.z) top = it;
  }
  if (!top) return 'surface';
  return luminance(top.fill === 'transparent' ? BRAND.white : top.fill) > 0.5 ? 'card' : 'deep';
}

/** Цвет текста на заливке: чёрный или белый — что контрастнее (правила токенов `ink` и `white`). */
export function textOn(fill: string, ground: Ground = 'surface'): string {
  const base = fill === 'transparent' ? groundColor(ground) : fill;
  // на белой карточке текст чёрный, на синем холсте без заливки — белый (крупный или жирный)
  if (fill === 'transparent') return ground === 'card' ? BRAND.ink : BRAND.white;
  return contrast(base, BRAND.ink) >= contrast(base, BRAND.white) ? BRAND.ink : BRAND.white;
}

const isBlue = (c: string) => c === BRAND.blue500 || c === BRAND.blue700;

/**
 * Оформление фигуры под заливку и основание. Обводки по умолчанию нет («без контуров»);
 * она появляется, только когда край иначе не читается: фигура без заливки, в цвет основания
 * или синяя на синем (правило системы: синий элемент на синем получает белую рамку 2px).
 */
export function shapeStyle(fill: string, ground: Ground): { fill: string; stroke: string; strokeWidth: number; textColor: string } {
  const f = fill.toLowerCase();
  const g = groundColor(ground);
  const needsEdge = f === 'transparent' || f === g || (isBlue(f) && isBlue(g));
  return {
    fill: f,
    stroke: ground === 'card' ? BRAND.blue700 : BRAND.white,
    strokeWidth: needsEdge ? 2 : 0,
    textColor: textOn(f, ground),
  };
}

/** Фигура по умолчанию: белая карточка на синем, тёмно-синяя — на белом фрейме. */
export const defaultShapeFill = (ground: Ground): string => (ground === 'card' ? BRAND.blue700 : BRAND.white);

/** Цвет линий и текста, положенных прямо на основание. */
export const inkOn = (ground: Ground): string => (ground === 'card' ? BRAND.blue700 : BRAND.white);

// ------------------------------------------------------------------ перенос старых досок

/** Цвета стикеров прототипа v0.1–0.2 → тона ШИБЕЙС. */
const LEGACY_STICKY: Record<string, string> = {
  '#fef3a6': BRAND.sun400, // жёлтый
  '#ffd8a8': BRAND.sun400, // оранжевый
  '#e9f5b5': BRAND.sun400, // салатовый
  '#ffc9c9': BRAND.riskHigh, // красный
  '#fcc2d7': BRAND.riskHigh, // розовый
  '#c8f2c2': BRAND.riskLow, // зелёный
  '#c3f0f7': BRAND.riskLow, // голубой
  '#e5dbff': BRAND.white, // фиолетовый
  '#c5dcff': BRAND.white, // синий
  '#e9ecef': BRAND.white, // серый
};

/** Пастельные заливки фреймов из старых шаблонов → белая карточка. */
const LEGACY_FRAME = new Set(['#ebfbee', '#fff5f5', '#e7f5ff', '#f8f9fa', 'transparent']);

/**
 * Приводит объект, сохранённый до перехода на дизайн-систему, к её палитре:
 * стикеры получают ближайший тон, фреймы — белую заливку. Остальное не трогаем.
 */
export function migrateLegacyItem<T extends Item>(item: T): T {
  if (item.type === 'sticky') {
    const tone = LEGACY_STICKY[item.color.toLowerCase()];
    return tone ? { ...item, color: tone } : item;
  }
  if (item.type === 'frame' && LEGACY_FRAME.has(item.fill.toLowerCase())) return { ...item, fill: BRAND.white };
  return item;
}
