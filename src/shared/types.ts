// Общая модель данных клиента и сервера.

export type ItemType = 'sticky' | 'shape' | 'text' | 'frame' | 'connector' | 'path' | 'image';

export type ShapeKind =
  | 'rect'
  | 'roundrect'
  | 'ellipse'
  | 'triangle'
  | 'diamond'
  | 'parallelogram'
  | 'hexagon'
  | 'star';

export type Side = 'top' | 'right' | 'bottom' | 'left';
export type TextAlign = 'left' | 'center' | 'right';
export type LineStyle = 'straight' | 'elbow' | 'curved';
export type ArrowHead = 'none' | 'arrow';

export interface BaseItem {
  id: string;
  type: ItemType;
  /** Рамка объекта в мировых координатах. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Порядок слоя (больше — выше). */
  z: number;
  locked?: boolean | null;
  groupId?: string | null;
}

export interface StickyItem extends BaseItem {
  type: 'sticky';
  text: string;
  color: string;
}

export interface ShapeItem extends BaseItem {
  type: 'shape';
  shape: ShapeKind;
  fill: string;
  stroke: string;
  strokeWidth: number;
  text: string;
  fontSize: number;
  textColor: string;
}

export interface TextItem extends BaseItem {
  type: 'text';
  text: string;
  fontSize: number;
  color: string;
  bold: boolean;
  align: TextAlign;
}

export interface FrameItem extends BaseItem {
  type: 'frame';
  title: string;
  fill: string;
}

export interface ImageItem extends BaseItem {
  type: 'image';
  src: string;
}

export interface PathItem extends BaseItem {
  type: 'path';
  /** Плоский массив [x0, y0, x1, y1, ...] относительно (x, y). */
  points: number[];
  stroke: string;
  strokeWidth: number;
}

export interface Endpoint {
  /** Объект, к которому привязан конец (если есть). */
  itemId?: string | null;
  /** Сторона привязки; 'auto' — выбирается по направлению к другому концу. */
  side?: Side | 'auto' | null;
  /** Абсолютные координаты свободного конца (и запасные — для привязанного). */
  x: number;
  y: number;
}

export interface ConnectorItem extends BaseItem {
  type: 'connector';
  from: Endpoint;
  to: Endpoint;
  lineStyle: LineStyle;
  startArrow: ArrowHead;
  endArrow: ArrowHead;
  stroke: string;
  strokeWidth: number;
  label: string;
}

export type Item = StickyItem | ShapeItem | TextItem | FrameItem | ImageItem | PathItem | ConnectorItem;

type Fields<T> = Partial<Omit<T, 'id' | 'type'>>;

/** Частичное изменение полей объекта любого типа. */
export type ItemPatch = Fields<StickyItem> &
  Fields<ShapeItem> &
  Fields<TextItem> &
  Fields<FrameItem> &
  Fields<ImageItem> &
  Fields<PathItem> &
  Fields<ConnectorItem>;

export type ItemMap = Record<string, Item>;

export type Op =
  | { t: 'add'; item: Item }
  | { t: 'update'; id: string; patch: ItemPatch }
  | { t: 'delete'; id: string };

export interface BoardMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  itemCount?: number;
}

export interface UserInfo {
  id: string;
  name: string;
  color: string;
}

export interface Peer extends UserInfo {
  clientId: string;
}

// ---- Протокол WebSocket ----

export type ClientMessage =
  | { t: 'hello'; boardId: string; user: UserInfo }
  | { t: 'ops'; seq: number; ops: Op[] }
  | { t: 'cursor'; x: number | null; y: number | null }
  | { t: 'selection'; ids: string[] }
  | { t: 'rename'; name: string };

export type ServerMessage =
  | { t: 'init'; meta: BoardMeta; items: ItemMap; peers: Peer[]; clientId: string }
  | { t: 'ack'; seq: number }
  | { t: 'ops'; from: string; ops: Op[] }
  | { t: 'join'; peer: Peer }
  | { t: 'leave'; clientId: string }
  | { t: 'cursor'; from: string; x: number | null; y: number | null }
  | { t: 'selection'; from: string; ids: string[] }
  | { t: 'meta'; meta: BoardMeta }
  | { t: 'error'; code: 'not_found' | 'deleted' | 'bad_request'; message: string };

export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
}
