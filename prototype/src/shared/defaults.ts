import { BRAND, CONNECTOR_WIDTH, PALETTE as BRAND_PALETTE, STICKY_TONES } from './brand';
import type {
  ConnectorItem,
  Endpoint,
  FrameItem,
  ImageItem,
  PathItem,
  ShapeItem,
  ShapeKind,
  StickyItem,
  TextItem,
} from './types';

// Значения по умолчанию для объектов доски — по дизайн-системе ШИБЕЙС (см. shared/brand.ts).

export const STICKY_SIZE = 200;

/** Тона стикеров: «Идея», «Готово», «Заблокировано», «Нейтрально». */
export const STICKY_COLORS: { name: string; value: string }[] = STICKY_TONES.map(({ name, value }) => ({ name, value }));

/** Палитра для фигур, текста, линий, пера. */
export const PALETTE: string[] = BRAND_PALETTE.map((c) => c.value);

export const SHAPE_KINDS: { kind: ShapeKind; name: string }[] = [
  { kind: 'rect', name: 'Прямоугольник' },
  { kind: 'roundrect', name: 'Скруглённый прямоугольник' },
  { kind: 'ellipse', name: 'Эллипс' },
  { kind: 'triangle', name: 'Треугольник' },
  { kind: 'diamond', name: 'Ромб' },
  { kind: 'parallelogram', name: 'Параллелограмм' },
  { kind: 'hexagon', name: 'Шестиугольник' },
  { kind: 'star', name: 'Звезда' },
];

/** Текст на белых карточках и заливках. */
export const DEFAULT_TEXT_COLOR = BRAND.ink;
/** Линии и текст на синем холсте. */
export const DEFAULT_LINE_COLOR = BRAND.white;

export function makeSticky(id: string, x: number, y: number, z: number, color: string, text = ''): StickyItem {
  return { id, type: 'sticky', x, y, w: STICKY_SIZE, h: STICKY_SIZE, z, text, color };
}

/** Фигура по умолчанию — белая карточка без обводки с чёрным текстом. */
export function makeShape(
  id: string,
  shape: ShapeKind,
  x: number,
  y: number,
  w: number,
  h: number,
  z: number,
  extra: Partial<ShapeItem> = {},
): ShapeItem {
  return {
    id,
    type: 'shape',
    shape,
    x,
    y,
    w,
    h,
    z,
    fill: BRAND.white,
    stroke: BRAND.white,
    strokeWidth: 0,
    text: '',
    fontSize: 20,
    textColor: DEFAULT_TEXT_COLOR,
    ...extra,
  };
}

/** Текст на синем холсте — белый, жирный, не меньше 24px (иначе не хватает контраста). */
export function makeText(
  id: string,
  x: number,
  y: number,
  z: number,
  text = '',
  extra: Partial<TextItem> = {},
): TextItem {
  const fontSize = extra.fontSize ?? 24;
  return {
    id,
    type: 'text',
    x,
    y,
    w: 320,
    h: Math.round(fontSize * 1.3),
    z,
    text,
    fontSize,
    color: BRAND.white,
    bold: true,
    align: 'left',
    ...extra,
  };
}

/** Фрейм — белая карточка со скруглением `radius-lg`. */
export function makeFrame(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  z: number,
  title: string,
  fill: string = BRAND.white,
): FrameItem {
  return { id, type: 'frame', x, y, w, h, z, title, fill };
}

/** Коннектор — белый пунктир бренда (6px). */
export function makeConnector(
  id: string,
  from: Endpoint,
  to: Endpoint,
  z: number,
  extra: Partial<ConnectorItem> = {},
): ConnectorItem {
  return {
    id,
    type: 'connector',
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    z,
    from,
    to,
    lineStyle: 'curved',
    startArrow: 'none',
    endArrow: 'arrow',
    stroke: DEFAULT_LINE_COLOR,
    strokeWidth: CONNECTOR_WIDTH,
    label: '',
    ...extra,
  };
}

export function makePath(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  z: number,
  points: number[],
  stroke: string,
  strokeWidth: number,
): PathItem {
  return { id, type: 'path', x, y, w, h, z, points, stroke, strokeWidth };
}

export function makeImage(id: string, x: number, y: number, w: number, h: number, z: number, src: string): ImageItem {
  return { id, type: 'image', x, y, w, h, z, src };
}
