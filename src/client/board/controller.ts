import { boundsOf, type Pt, type Rect } from '../../shared/geometry';
import { applyOps, diffItems, opTargetId } from '../../shared/ops';
import type { Item, ItemMap, Op, Peer, ServerMessage, UserInfo } from '../../shared/types';
import { getUser } from '../user';
import {
  type Camera,
  getState,
  initialBoardState,
  MAX_ZOOM,
  MIN_ZOOM,
  type PeerState,
  setState,
  useBoard,
} from './store';
import { SyncEngine } from './syncEngine';

interface HistoryEntry {
  undo: Op[];
  redo: Op[];
  selBefore: string[];
  selAfter: string[];
}

const HISTORY_LIMIT = 300;
const FLUSH_MS = 30;
const CURSOR_MS = 40;

const peerState = (p: Peer): PeerState => ({ ...p, cursor: null, selection: [] });

/**
 * Контроллер открытой доски: локальные изменения (транзакции + история),
 * синхронизация через WebSocket, присутствие участников.
 */
class BoardController {
  private engine = new SyncEngine();
  private ws: WebSocket | null = null;
  private ready = false;
  private fatal = false;
  private disposed = true;
  private hadInit = false;
  private reconnectDelay = 500;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private cursorTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingCursor: Pt | null | undefined = undefined;
  private selectionTimer: ReturnType<typeof setTimeout> | null = null;
  private cameraTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;

  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private tx: { before: Map<string, Item | undefined>; selBefore: string[] } | null = null;
  private txDepth = 0;

  /** Последняя позиция указателя над холстом (мировые координаты) — для вставки. */
  pointer: Pt | null = null;

  // ------------------------------------------------------------------ жизненный цикл

  open(boardId: string) {
    this.close();
    this.disposed = false;
    this.fatal = false;
    this.hadInit = false;
    this.engine = new SyncEngine();
    this.undoStack = [];
    this.redoStack = [];
    this.tx = null;
    this.txDepth = 0;
    const keep = getState();
    useBoard.setState(
      {
        ...initialBoardState(),
        boardId,
        showMinimap: keep.showMinimap,
        stickyColor: keep.stickyColor,
        penColor: keep.penColor,
        penWidth: keep.penWidth,
        shapeKind: keep.shapeKind,
        connectorStyle: keep.connectorStyle,
      },
      true,
    );
    this.unsubscribe = useBoard.subscribe((s, prev) => {
      if (s.selection !== prev.selection) this.scheduleSelection();
      if (s.camera !== prev.camera) this.scheduleCameraSave();
    });
    this.connect();
  }

  close() {
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const t of [this.reconnectTimer, this.flushTimer, this.cursorTimer, this.selectionTimer, this.cameraTimer]) {
      if (t) clearTimeout(t);
    }
    this.reconnectTimer = this.flushTimer = this.cursorTimer = this.selectionTimer = this.cameraTimer = null;
    if (this.ws) {
      this.flush();
      const ws = this.ws;
      this.ws = null;
      // закрытие ещё не открытого сокета даёт в консоли предупреждение — закрываем после открытия
      if (ws.readyState === WebSocket.CONNECTING) ws.onopen = () => ws.close();
      else ws.close();
    }
    this.ready = false;
  }

  private connect() {
    if (this.disposed) return;
    const boardId = getState().boardId;
    if (!boardId) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    this.ready = false;
    setState({ status: this.hadInit ? 'offline' : 'connecting' });

    ws.onopen = () => {
      const user: UserInfo = getUser();
      ws.send(JSON.stringify({ t: 'hello', boardId, user }));
    };
    ws.onmessage = (e) => {
      if (this.ws !== ws) return;
      try {
        this.onMessage(JSON.parse(e.data as string) as ServerMessage);
      } catch (err) {
        console.error('Ошибка обработки сообщения', err);
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.ready = false;
      if (this.disposed || this.fatal) return;
      setState({ status: 'offline', peers: {} });
      this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 10_000);
    };
  }

  /** Принудительно переподключиться (кнопка в интерфейсе). */
  reconnectNow() {
    if (this.ws || this.disposed || this.fatal) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectDelay = 500;
    this.connect();
  }

  private send(msg: unknown) {
    if (this.ws && this.ready && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private onMessage(msg: ServerMessage) {
    switch (msg.t) {
      case 'init': {
        let items = msg.items;
        const resend = this.engine.resync();
        for (const b of resend) items = applyOps(items, b.ops);
        const peers: Record<string, PeerState> = {};
        for (const p of msg.peers) peers[p.clientId] = peerState(p);
        const st = getState();
        setState({
          items,
          meta: msg.meta,
          clientId: msg.clientId,
          peers,
          status: 'online',
          loaded: true,
          error: null,
          selection: st.selection.filter((id) => items[id]),
          editingId: st.editingId && items[st.editingId] ? st.editingId : null,
        });
        if (st.editingId && !items[st.editingId]) this.commit();
        this.ready = true;
        this.reconnectDelay = 500;
        for (const b of resend) this.send({ t: 'ops', seq: b.seq, ops: b.ops });
        this.send({ t: 'selection', ids: getState().selection });
        if (!this.hadInit) {
          this.hadInit = true;
          this.restoreCamera();
        }
        break;
      }
      case 'ack':
        this.engine.ack(msg.seq);
        break;
      case 'ops': {
        const ops = this.engine.filterRemote(msg.ops);
        if (!ops.length) break;
        const st = getState();
        const items = applyOps(st.items, ops);
        const patch: Partial<typeof st> = { items };
        if (st.selection.some((id) => !items[id])) patch.selection = st.selection.filter((id) => items[id]);
        const editedGone = !!st.editingId && !items[st.editingId];
        if (editedGone) patch.editingId = null;
        setState(patch);
        // объект, который мы редактировали, удалил другой участник — закрываем сессию редактирования
        if (editedGone) this.commit();
        break;
      }
      case 'join':
        setState({ peers: { ...getState().peers, [msg.peer.clientId]: peerState(msg.peer) } });
        break;
      case 'leave': {
        const peers = { ...getState().peers };
        delete peers[msg.clientId];
        setState({ peers });
        break;
      }
      case 'cursor': {
        const peers = getState().peers;
        const p = peers[msg.from];
        if (!p) break;
        const cursor = msg.x === null || msg.y === null ? null : { x: msg.x, y: msg.y };
        setState({ peers: { ...peers, [msg.from]: { ...p, cursor } } });
        break;
      }
      case 'selection': {
        const peers = getState().peers;
        const p = peers[msg.from];
        if (p) setState({ peers: { ...peers, [msg.from]: { ...p, selection: msg.ids } } });
        break;
      }
      case 'meta':
        setState({ meta: msg.meta });
        break;
      case 'error':
        if (msg.code === 'not_found' || msg.code === 'deleted') {
          this.fatal = true;
          setState({ status: 'error', error: msg.message });
        } else {
          console.warn('Сервер:', msg.message);
        }
        break;
    }
  }

  // ------------------------------------------------------------------ отправка

  private scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, FLUSH_MS);
  }

  private flush() {
    if (!this.engine.hasBatch()) return;
    // Без соединения пакет остаётся неподтверждённым и уйдёт после переподключения.
    const b = this.engine.takeBatch();
    if (b) this.send({ t: 'ops', seq: b.seq, ops: b.ops });
  }

  sendCursor(p: Pt | null) {
    this.pendingCursor = p;
    if (this.cursorTimer) return;
    const tick = () => {
      if (this.pendingCursor === undefined) {
        this.cursorTimer = null;
        return;
      }
      const c = this.pendingCursor;
      this.pendingCursor = undefined;
      this.send({ t: 'cursor', x: c ? Math.round(c.x) : null, y: c ? Math.round(c.y) : null });
      this.cursorTimer = setTimeout(tick, CURSOR_MS);
    };
    tick();
  }

  private scheduleSelection() {
    if (this.selectionTimer) return;
    this.selectionTimer = setTimeout(() => {
      this.selectionTimer = null;
      this.send({ t: 'selection', ids: getState().selection });
    }, 60);
  }

  rename(name: string) {
    const meta = getState().meta;
    if (meta) setState({ meta: { ...meta, name } });
    this.send({ t: 'rename', name });
  }

  // ------------------------------------------------------------------ изменения и история

  /** Начать транзакцию: все изменения до commit() — один шаг истории. */
  begin() {
    if (this.txDepth++ === 0) this.tx = { before: new Map(), selBefore: getState().selection };
  }

  get inTransaction() {
    return this.tx !== null;
  }

  /** Применить локальные операции (оптимистично) и отправить на сервер. */
  apply(ops: Op[]) {
    if (ops.length === 0) return;
    const auto = this.tx === null;
    if (auto) this.begin();
    const items = getState().items;
    for (const op of ops) {
      const id = opTargetId(op);
      if (!this.tx!.before.has(id)) this.tx!.before.set(id, items[id]);
    }
    this.applyRaw(ops);
    if (auto) this.commit();
  }

  private applyRaw(ops: Op[]) {
    const st = getState();
    const items = applyOps(st.items, ops);
    const patch: Partial<typeof st> = { items };
    if (st.selection.some((id) => !items[id])) patch.selection = st.selection.filter((id) => items[id]);
    setState(patch);
    this.engine.local(ops);
    this.scheduleFlush();
  }

  private txDiff(before: Map<string, Item | undefined>, items: ItemMap) {
    const undo: Op[] = [];
    const redo: Op[] = [];
    for (const [id, prev] of before) {
      const next = items[id];
      if (!prev && !next) continue;
      if (!prev) {
        redo.push({ t: 'add', item: next! });
        undo.push({ t: 'delete', id });
      } else if (!next) {
        redo.push({ t: 'delete', id });
        undo.push({ t: 'add', item: prev });
      } else {
        const d = diffItems(prev, next);
        if (d) {
          redo.push({ t: 'update', id, patch: d.forward });
          undo.push({ t: 'update', id, patch: d.backward });
        }
      }
    }
    return { undo, redo };
  }

  commit() {
    if (!this.tx) return;
    if (--this.txDepth > 0) return;
    const tx = this.tx;
    this.tx = null;
    this.txDepth = 0;
    const { undo, redo } = this.txDiff(tx.before, getState().items);
    if (redo.length === 0) return;
    this.undoStack.push({ undo, redo, selBefore: tx.selBefore, selAfter: getState().selection });
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.updateHistoryFlags();
  }

  /** Отменить текущую транзакцию (Esc во время перетаскивания). */
  rollback() {
    if (!this.tx) return;
    const tx = this.tx;
    this.tx = null;
    this.txDepth = 0;
    const { undo } = this.txDiff(tx.before, getState().items);
    if (undo.length) this.applyRaw(undo);
    setState({ selection: tx.selBefore.filter((id) => getState().items[id]) });
  }

  undo() {
    if (this.tx) return;
    const e = this.undoStack.pop();
    if (!e) return;
    this.applyRaw(e.undo);
    this.redoStack.push(e);
    const items = getState().items;
    setState({ selection: e.selBefore.filter((id) => items[id]), editingId: null });
    this.updateHistoryFlags();
  }

  redo() {
    if (this.tx) return;
    const e = this.redoStack.pop();
    if (!e) return;
    this.applyRaw(e.redo);
    this.undoStack.push(e);
    const items = getState().items;
    setState({ selection: e.selAfter.filter((id) => items[id]), editingId: null });
    this.updateHistoryFlags();
  }

  private updateHistoryFlags() {
    setState({ canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0 });
  }

  // ------------------------------------------------------------------ камера

  setCamera(cam: Camera) {
    setState({ camera: { x: cam.x, y: cam.y, zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.zoom)) } });
  }

  /** Масштабировать относительно экранной точки. */
  zoomAt(zoom: number, at?: Pt) {
    const { camera, viewport } = getState();
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    const p = at ?? { x: viewport.w / 2, y: viewport.h / 2 };
    const k = z / camera.zoom;
    this.setCamera({ x: p.x - (p.x - camera.x) * k, y: p.y - (p.y - camera.y) * k, zoom: z });
  }

  /** Показать прямоугольник мира в видимой области. */
  fitRect(r: Rect | null, maxZoom = 1) {
    const { viewport } = getState();
    if (!r) {
      this.setCamera({ x: viewport.w / 2, y: viewport.h / 2, zoom: 1 });
      return;
    }
    const pad = 80;
    const zoom = Math.min(
      maxZoom,
      Math.max(MIN_ZOOM, Math.min((viewport.w - pad * 2) / Math.max(r.w, 1), (viewport.h - pad * 2) / Math.max(r.h, 1))),
    );
    this.setCamera({
      x: viewport.w / 2 - (r.x + r.w / 2) * zoom,
      y: viewport.h / 2 - (r.y + r.h / 2) * zoom,
      zoom,
    });
  }

  zoomToFit() {
    const { items } = getState();
    this.fitRect(boundsOf(Object.keys(items), items), 1);
  }

  centerOn(p: Pt) {
    const { camera, viewport } = getState();
    this.setCamera({ ...camera, x: viewport.w / 2 - p.x * camera.zoom, y: viewport.h / 2 - p.y * camera.zoom });
  }

  private cameraKey() {
    return `sheebase:camera:${getState().boardId}`;
  }

  private restoreCamera() {
    try {
      const raw = JSON.parse(localStorage.getItem(this.cameraKey()) ?? 'null');
      if (raw && Number.isFinite(raw.x) && Number.isFinite(raw.y) && Number.isFinite(raw.zoom)) {
        this.setCamera(raw);
        return;
      }
    } catch {
      /* нет сохранённого вида */
    }
    this.zoomToFit();
  }

  private scheduleCameraSave() {
    if (this.cameraTimer) clearTimeout(this.cameraTimer);
    this.cameraTimer = setTimeout(() => {
      this.cameraTimer = null;
      try {
        if (this.hadInit) localStorage.setItem(this.cameraKey(), JSON.stringify(getState().camera));
      } catch {
        /* без сохранения */
      }
    }, 400);
  }
}

export const board = new BoardController();
