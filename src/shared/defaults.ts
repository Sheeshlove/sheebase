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

export const STICKY_SIZE = 200;

export const STICKY_COLORS: { name: string; value: string }[] = [
  { name: 'Жёлтый', value: '#fef3a6' },
  { name: 'Оранжевый', value: '#ffd8a8' },
  { name: 'Красный', value: '#ffc9c9' },
  { name: 'Розовый', value: '#fcc2d7' },
  { name: 'Фиолетовый', value: '#e5dbff' },
  { name: 'Синий', value: '#c5dcff' },
  { name: 'Голубой', value: '#c3f0f7' },
  { name: 'Зелёный', value: '#c8f2c2' },
  { name: 'Салатовый', value: '#e9f5b5' },
  { name: 'Серый', value: '#e9ecef' },
];

/** Общая палитра для фигур, текста, линий, фреймов. */
export const PALETTE: string[] = [
  'transparent',
  '#ffffff',
  '#f1f3f5',
  '#868e96',
  '#1e1e1e',
  '#ffc9c9',
  '#ffd8a8',
  '#ffec99',
  '#b2f2bb',
  '#a5d8ff',
  '#d0bfff',
  '#e03131',
  '#f08c00',
  '#2f9e44',
  '#1971c2',
  '#7048e8',
];

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

export const DEFAULT_TEXT_COLOR = '#1e1e1e';
export const DEFAULT_LINE_COLOR = '#1e1e1e';

export function makeSticky(id: string, x: number, y: number, z: number, color: string, text = ''): StickyItem {
  return { id, type: 'sticky', x, y, w: STICKY_SIZE, h: STICKY_SIZE, z, text, color };
}

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
    fill: '#ffffff',
    stroke: '#1e1e1e',
    strokeWidth: 2,
    text: '',
    fontSize: 20,
    textColor: DEFAULT_TEXT_COLOR,
    ...extra,
  };
}

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
    color: DEFAULT_TEXT_COLOR,
    bold: false,
    align: 'left',
    ...extra,
  };
}

export function makeFrame(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  z: number,
  title: string,
  fill = '#ffffff',
): FrameItem {
  return { id, type: 'frame', x, y, w, h, z, title, fill };
}

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
    strokeWidth: 2,
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
