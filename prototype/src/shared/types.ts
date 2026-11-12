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
  /** Ссылка (http/https), открывается значком на объекте. */
  link?: string | null;
  /** Имя автора (для стикеров, созданных на доске). */
  author?: string | null;
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

/** Видимая область участника в мировых координатах. */
export interface ViewRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Участник вместе с его последним присутствием (для init). */
export interface PeerPresence extends Peer {
  view: ViewRect | null;
  selection: string[];
  editing: string | null;
}

// ---- Сессионные данные (сервер-авторитетные) ----

export interface TimerState {
  /** Длительность последнего запуска, мс. */
  durationMs: number;
  /** Момент окончания по часам сервера, если таймер идёт. */
  endsAt: number | null;
  /** Остаток, мс (актуален на паузе). */
  remainingMs: number;
  running: boolean;
  /** Кто запустил. */
  by: string;
}

/** Голосование так, как его видит конкретный участник. */
export interface VotingView {
  id: string;
  status: 'active' | 'ended';
  votesPerUser: number;
  startedBy: string;
  startedAt: number;
  endedAt: number | null;
  /** Свои голоса: itemId → количество. */
  myVotes: Record<string, number>;
  /** Сколько участников уже голосовало. */
  voters: number;
  /** Итоги (только после завершения). */
  results: Record<string, number> | null;
}

export interface SessionView {
  timer: TimerState | null;
  voting: VotingView | null;
}

export interface CommentMessage {
  id: string;
  authorId: string;
  authorName: string;
  authorColor: string;
  text: string;
  createdAt: number;
}

export interface CommentThread {
  id: string;
  /** Абсолютная позиция (для свободного треда или если объект удалён). */
  x: number;
  y: number;
  /** Объект, к которому привязан тред, и смещение от его левого верхнего угла. */
  itemId: string | null;
  dx: number;
  dy: number;
  resolved: boolean;
  createdAt: number;
  updatedAt: number;
  messages: CommentMessage[];
}

export type CommentAction =
  | { action: 'create'; x: number; y: number; itemId?: string | null; text: string }
  | { action: 'reply'; threadId: string; text: string }
  | { action: 'resolve'; threadId: string; resolved: boolean }
  | { action: 'deleteMessage'; threadId: string; messageId: string }
  | { action: 'delete'; threadId: string };

export type TimerAction =
  | { action: 'start'; durationMs: number }
  | { action: 'pause' }
  | { action: 'resume' }
  | { action: 'add'; deltaMs: number }
  | { action: 'reset' };

export type VotingAction = { action: 'start'; votesPerUser: number } | { action: 'end' } | { action: 'clear' };

export interface VersionMeta {
  id: string;
  name: string;
  createdAt: number;
  auto: boolean;
  itemCount: number;
}

// ---- Протокол WebSocket ----

export type ClientMessage =
  | { t: 'hello'; boardId: string; user: UserInfo }
  | { t: 'ops'; seq: number; ops: Op[] }
  | { t: 'cursor'; x: number | null; y: number | null }
  | { t: 'selection'; ids: string[]; editing?: string | null }
  | { t: 'rename'; name: string }
  | { t: 'user'; user: { name: string; color: string } }
  | { t: 'view'; rect: ViewRect }
  | { t: 'summon' }
  | ({ t: 'timer' } & TimerAction)
  | ({ t: 'voting' } & VotingAction)
  | { t: 'vote'; itemId: string; delta: 1 | -1 }
  | ({ t: 'comment' } & CommentAction);

export type ServerMessage =
  | {
      t: 'init';
      meta: BoardMeta;
      items: ItemMap;
      peers: PeerPresence[];
      clientId: string;
      comments: Record<string, CommentThread>;
      session: SessionView;
      /** Время сервера — для синхронизации часов (таймер). */
      now: number;
    }
  | { t: 'ack'; seq: number }
  | { t: 'ops'; from: string; ops: Op[] }
  | { t: 'join'; peer: PeerPresence }
  | { t: 'leave'; clientId: string }
  | { t: 'peer'; peer: Peer }
  | { t: 'cursor'; from: string; x: number | null; y: number | null }
  | { t: 'selection'; from: string; ids: string[]; editing: string | null }
  | { t: 'view'; from: string; rect: ViewRect }
  | { t: 'summon'; from: string }
  | { t: 'meta'; meta: BoardMeta }
  | { t: 'session'; session: SessionView; now: number }
  | { t: 'thread'; thread: CommentThread }
  | { t: 'thread-delete'; id: string }
  | { t: 'reset'; items: ItemMap; reason: string }
  | { t: 'notice'; message: string }
  | { t: 'error'; code: 'not_found' | 'deleted' | 'bad_request'; message: string };

export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
}
