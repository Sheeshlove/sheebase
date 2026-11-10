import { create } from 'zustand';
import { STICKY_COLORS } from '../../shared/defaults';
import type { Pt, Rect } from '../../shared/geometry';
import type {
  BoardMeta,
  CommentThread,
  ItemMap,
  LineStyle,
  Peer,
  SessionView,
  ShapeKind,
  ViewRect,
} from '../../shared/types';

export type Tool = 'select' | 'hand' | 'sticky' | 'text' | 'shape' | 'connector' | 'pen' | 'eraser' | 'frame' | 'comment';

/** Боковая панель справа (одна за раз). */
export type Panel = 'comments' | 'frames' | 'versions' | 'results' | null;

export interface Camera {
  /** Сдвиг (экранные px) и масштаб: screen = world * zoom + (x, y). */
  x: number;
  y: number;
  zoom: number;
}

export interface PeerState extends Peer {
  cursor: Pt | null;
  selection: string[];
  /** Объект, который участник сейчас редактирует. */
  editing: string | null;
  /** Видимая область участника (для следования). */
  view: ViewRect | null;
}

export interface Guide {
  axis: 'x' | 'y';
  /** Координата линии и её протяжённость (мировые координаты). */
  at: number;
  from: number;
  to: number;
}

export type ConnectionStatus = 'connecting' | 'online' | 'offline' | 'error';

export interface BoardState {
  boardId: string | null;
  meta: BoardMeta | null;
  status: ConnectionStatus;
  error: string | null;
  loaded: boolean;
  clientId: string | null;

  items: ItemMap;
  selection: string[];
  editingId: string | null;

  tool: Tool;
  shapeKind: ShapeKind;
  stickyColor: string;
  penColor: string;
  penWidth: number;
  connectorStyle: LineStyle;

  camera: Camera;
  viewport: { w: number; h: number };
  peers: Record<string, PeerState>;

  marquee: Rect | null;
  guides: Guide[];
  draft: { points: number[]; color: string; width: number } | null;
  eraser: Pt | null;
  spacePan: boolean;
  panning: boolean;
  /** Текущее действие с объектами (перемещение, ресайз…) — скрывает контекстную панель. */
  interaction: string | null;
  /** Объект, к которому будет привязан коннектор. */
  hoverTarget: string | null;

  canUndo: boolean;
  canRedo: boolean;
  showMinimap: boolean;
  showHelp: boolean;
  toast: { id: number; text: string } | null;

  // ---- итерация 2 ----
  /** Комментарии (сервер-авторитетные). */
  comments: Record<string, CommentThread>;
  /** Таймер и голосование глазами этого участника. */
  session: SessionView;
  /** Смещение часов: время сервера − время клиента, мс. */
  serverOffset: number;
  /** clientId участника, за видом которого мы следуем. */
  following: string | null;
  search: { open: boolean; query: string; index: number; hits: string[] };
  /** Режим презентации: индекс текущего фрейма. */
  presenting: { index: number } | null;
  panel: Panel;
  openThreadId: string | null;
  commentDraft: { x: number; y: number; itemId: string | null } | null;
  contextMenu: { x: number; y: number; world: Pt; onItem: boolean } | null;
  /** Время последнего просмотра тредов (для «непрочитано»). */
  seen: Record<string, number>;
  showAuthors: boolean;
  showResolved: boolean;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;

export function initialBoardState(): BoardState {
  return {
    boardId: null,
    meta: null,
    status: 'connecting',
    error: null,
    loaded: false,
    clientId: null,
    items: {},
    selection: [],
    editingId: null,
    tool: 'select',
    shapeKind: 'rect',
    stickyColor: STICKY_COLORS[0].value,
    penColor: '#1e1e1e',
    penWidth: 4,
    connectorStyle: 'curved',
    camera: { x: 0, y: 0, zoom: 1 },
    viewport: { w: 1, h: 1 },
    peers: {},
    marquee: null,
    guides: [],
    draft: null,
    eraser: null,
    spacePan: false,
    panning: false,
    interaction: null,
    hoverTarget: null,
    canUndo: false,
    canRedo: false,
    showMinimap: true,
    showHelp: false,
    toast: null,
    comments: {},
    session: { timer: null, voting: null },
    serverOffset: 0,
    following: null,
    search: { open: false, query: '', index: 0, hits: [] },
    presenting: null,
    panel: null,
    openThreadId: null,
    commentDraft: null,
    contextMenu: null,
    seen: {},
    showAuthors: readPref('showAuthors', false),
    showResolved: false,
  };
}

/** Настройки вида, которые помнит браузер. */
export function readPref(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(`sheebase:pref:${key}`);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: boolean) {
  try {
    localStorage.setItem(`sheebase:pref:${key}`, value ? '1' : '0');
  } catch {
    /* без сохранения */
  }
}

/** Голосование идёт — доска в режиме голосования. */
export const votingActive = (s: BoardState = useBoard.getState()) => s.session.voting?.status === 'active';

/** Текущее время по часам сервера. */
export const serverNow = (s: BoardState = useBoard.getState()) => Date.now() + s.serverOffset;

export const useBoard = create<BoardState>(() => initialBoardState());

export const getState = useBoard.getState;
export const setState = useBoard.setState;

export const screenToWorld = (cam: Camera, p: Pt): Pt => ({ x: (p.x - cam.x) / cam.zoom, y: (p.y - cam.y) / cam.zoom });
export const worldToScreen = (cam: Camera, p: Pt): Pt => ({ x: p.x * cam.zoom + cam.x, y: p.y * cam.zoom + cam.y });
export const worldRectToScreen = (cam: Camera, r: Rect): Rect => ({
  x: r.x * cam.zoom + cam.x,
  y: r.y * cam.zoom + cam.y,
  w: r.w * cam.zoom,
  h: r.h * cam.zoom,
});

let toastId = 0;
export function showToast(text: string) {
  const id = ++toastId;
  setState({ toast: { id, text } });
  setTimeout(() => {
    if (getState().toast?.id === id) setState({ toast: null });
  }, 2200);
}
