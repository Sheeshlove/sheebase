import { boundsOf, type Pt, type Rect } from '../../shared/geometry';
import { applyOps, diffItems, opTargetId } from '../../shared/ops';
import type {
  ClientMessage,
  CommentAction,
  Item,
  ItemMap,
  Op,
  Peer,
  PeerPresence,
  ServerMessage,
  TimerAction,
  UserInfo,
  ViewRect,
  VotingAction,
} from '../../shared/types';
import { getUser, subscribeUser } from '../user';
import {
  type Camera,
  getState,
  initialBoardState,
  MAX_ZOOM,
  MIN_ZOOM,
  type PeerState,
  screenToWorld,
  setState,
  showToast,
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
const VIEW_MS = 150;

const peerState = (p: Peer & Partial<Pick<PeerPresence, 'view' | 'selection' | 'editing'>>): PeerState => ({
  clientId: p.clientId,
  id: p.id,
  name: p.name,
  color: p.color,
  cursor: null,
  selection: p.selection ?? [],
  editing: p.editing ?? null,
  view: p.view ?? null,
});

export type CameraSource = 'user' | 'follow';

/**
 * Контроллер открытой доски: локальные изменения (транзакции + история),
 * синхронизация через WebSocket, присутствие участников, сессионные данные.
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
  private viewTimer: ReturnType<typeof setTimeout> | null = null;
  private lastView = '';
  private unsubscribe: (() => void) | null = null;
  private unsubscribeUser: (() => void) | null = null;
  /** Переименование, сделанное без связи, — отправляется после переподключения. */
  private pendingRename: string | null = null;
  /** Ждём свой только что созданный тред, чтобы сразу открыть его. */
  private expectOwnThread = false;
  /** При закрытии вкладки досылаем пакет, ещё не ушедший по таймеру (до 30 мс правок). */
  private readonly onPageHide = () => this.flush();

  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private tx: { before: Map<string, Item | undefined>; selBefore: string[] } | null = null;
  private txDepth = 0;

  /** Последняя позиция указателя над холстом (мировые координаты) — для вставки. */
  pointer: Pt | null = null;
  /** Подписчики на сброс доски (восстановление версии) — например, прервать текущий жест. */
  private resetListeners = new Set<() => void>();

  onReset(fn: () => void): () => void {
    this.resetListeners.add(fn);
    return () => this.resetListeners.delete(fn);
  }

  // ------------------------------------------------------------------ жизненный цикл

  /** Сброс локального состояния (история, транзакции, синхронизация) — при открытии доски и в тестах. */
  resetLocal() {
    this.fatal = false;
    this.hadInit = false;
    this.ready = false;
    this.engine = new SyncEngine();
    this.undoStack = [];
    this.redoStack = [];
    this.tx = null;
    this.txDepth = 0;
    this.pendingRename = null;
    this.expectOwnThread = false;
    this.lastView = '';
    setState({ canUndo: false, canRedo: false });
  }

  open(boardId: string) {
    this.close();
    this.disposed = false;
    this.resetLocal();
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
        seen: this.loadSeen(boardId),
      },
      true,
    );
    this.unsubscribe = useBoard.subscribe((s, prev) => {
      if (s.selection !== prev.selection || s.editingId !== prev.editingId) this.scheduleSelection();
      if (s.camera !== prev.camera) this.scheduleCameraSave();
      if (s.camera !== prev.camera || s.viewport !== prev.viewport) this.scheduleView();
    });
    // смена имени или цвета видна коллегам сразу
    this.unsubscribeUser = subscribeUser(() => {
      const u = getUser();
      this.send({ t: 'user', user: { name: u.name, color: u.color } });
    });
    window.addEventListener('pagehide', this.onPageHide);
    this.connect();
  }

  close() {
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.unsubscribeUser?.();
    this.unsubscribeUser = null;
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', this.onPageHide);
    for (const t of [this.reconnectTimer, this.flushTimer, this.cursorTimer, this.selectionTimer, this.cameraTimer, this.viewTimer]) {
      if (t) clearTimeout(t);
    }
    this.reconnectTimer = this.flushTimer = this.cursorTimer = this.selectionTimer = this.cameraTimer = this.viewTimer = null;
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
      setState({ status: 'offline', peers: {}, following: null });
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

  private send(msg: ClientMessage) {
    if (this.ws && this.ready && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Сервер-авторитетное действие: без связи его некуда отправить — сообщаем об этом. */
  private sendAction(msg: ClientMessage): boolean {
    if (!this.ready) {
      showToast('Нет связи с сервером — действие не выполнено');
      return false;
    }
    this.send(msg);
    return true;
  }

  private updatePeer(clientId: string, patch: Partial<PeerState>) {
    const peers = getState().peers;
    const p = peers[clientId];
    if (p) setState({ peers: { ...peers, [clientId]: { ...p, ...patch } } });
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
          comments: msg.comments,
          session: msg.session,
          serverOffset: msg.now - Date.now(),
          following: st.following && peers[st.following] ? st.following : null,
        });
        if (st.editingId && !items[st.editingId]) this.commit();
        this.ready = true;
        this.reconnectDelay = 500;
        for (const b of resend) this.send({ t: 'ops', seq: b.seq, ops: b.ops });
        if (this.pendingRename !== null) {
          const name = this.pendingRename;
          this.pendingRename = null;
          setState({ meta: { ...msg.meta, name } });
          this.send({ t: 'rename', name });
        }
        this.send({ t: 'selection', ids: getState().selection, editing: getState().editingId });
        if (!this.hadInit) {
          this.hadInit = true;
          this.restoreCamera();
        }
        this.lastView = '';
        this.sendView();
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
      case 'reset': {
        // Восстановление версии: свежий снимок + наши ещё не подтверждённые правки
        // (сервер применит их после восстановления). История ссылается на прежнее состояние — очищается.
        let items = msg.items;
        for (const ops of this.engine.outstanding()) items = applyOps(items, ops);
        this.tx = null;
        this.txDepth = 0;
        this.undoStack = [];
        this.redoStack = [];
        const st = getState();
        setState({
          items,
          selection: st.selection.filter((id) => items[id]),
          editingId: null,
          canUndo: false,
          canRedo: false,
        });
        showToast(msg.reason);
        for (const fn of this.resetListeners) fn();
        break;
      }
      case 'join':
        setState({ peers: { ...getState().peers, [msg.peer.clientId]: peerState(msg.peer) } });
        break;
      case 'leave': {
        const st = getState();
        const peers = { ...st.peers };
        const gone = peers[msg.clientId];
        delete peers[msg.clientId];
        setState({ peers });
        if (st.following === msg.clientId) {
          setState({ following: null });
          if (gone) showToast(`${gone.name} покидает доску — следование остановлено`);
        }
        break;
      }
      case 'peer':
        this.updatePeer(msg.peer.clientId, { name: msg.peer.name, color: msg.peer.color });
        break;
      case 'cursor':
        this.updatePeer(msg.from, { cursor: msg.x === null || msg.y === null ? null : { x: msg.x, y: msg.y } });
        break;
      case 'selection':
        this.updatePeer(msg.from, { selection: msg.ids, editing: msg.editing ?? null });
        break;
      case 'view':
        this.updatePeer(msg.from, { view: msg.rect });
        if (getState().following === msg.from) this.applyFollow(msg.rect);
        break;
      case 'summon': {
        const p = getState().peers[msg.from];
        if (!p || getState().presenting) break;
        this.follow(msg.from);
        showToast(`Вы следуете за участником ${p.name}. Esc — перестать`);
        break;
      }
      case 'meta':
        setState({ meta: msg.meta });
        break;
      case 'session': {
        const st = getState();
        const was = st.session.voting?.status;
        const now = msg.session.voting?.status;
        const patch: Partial<typeof st> = { session: msg.session, serverOffset: msg.now - Date.now() };
        if (now === 'active' && was !== 'active') {
          // на время голосования доска «замораживается»
          patch.tool = 'select';
          showToast(`Голосование началось: ${msg.session.voting!.votesPerUser} голос(а) на участника`);
        }
        if (now === 'ended' && was === 'active') {
          patch.panel = 'results';
          showToast('Голосование завершено — итоги на панели справа');
        }
        if (!msg.session.voting && st.panel === 'results') patch.panel = null;
        setState(patch);
        break;
      }
      case 'thread': {
        const st = getState();
        const isNew = !st.comments[msg.thread.id];
        const patch: Partial<typeof st> = { comments: { ...st.comments, [msg.thread.id]: msg.thread } };
        if (isNew && this.expectOwnThread && msg.thread.messages[0]?.authorId === getUser().id) {
          this.expectOwnThread = false;
          patch.openThreadId = msg.thread.id;
        }
        setState(patch);
        if (getState().openThreadId === msg.thread.id) this.markSeen(msg.thread.id);
        break;
      }
      case 'thread-delete': {
        const st = getState();
        const comments = { ...st.comments };
        delete comments[msg.id];
        setState({ comments, openThreadId: st.openThreadId === msg.id ? null : st.openThreadId });
        break;
      }
      case 'notice':
        showToast(msg.message);
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
      const st = getState();
      this.send({ t: 'selection', ids: st.selection, editing: st.editingId });
    }, 60);
  }

  /** Видимая область в мировых координатах (для следования за участником). */
  private currentView(): ViewRect | null {
    const { camera, viewport } = getState();
    if (viewport.w <= 1 || viewport.h <= 1) return null;
    const tl = screenToWorld(camera, { x: 0, y: 0 });
    const r = (v: number) => Math.round(v * 10) / 10;
    return { x: r(tl.x), y: r(tl.y), w: r(viewport.w / camera.zoom), h: r(viewport.h / camera.zoom) };
  }

  private sendView() {
    const rect = this.currentView();
    if (!rect || !this.ready) return;
    const key = JSON.stringify(rect);
    if (key === this.lastView) return;
    this.lastView = key;
    this.send({ t: 'view', rect });
  }

  private scheduleView() {
    if (this.viewTimer) return;
    this.viewTimer = setTimeout(() => {
      this.viewTimer = null;
      this.sendView();
    }, VIEW_MS);
  }

  rename(name: string) {
    const meta = getState().meta;
    if (meta) setState({ meta: { ...meta, name } });
    if (this.ready) this.send({ t: 'rename', name });
    else this.pendingRename = name;
  }

  // ------------------------------------------------------------------ сессионные действия

  timer(action: TimerAction) {
    this.sendAction({ t: 'timer', ...action });
  }

  voting(action: VotingAction) {
    this.sendAction({ t: 'voting', ...action });
  }

  vote(itemId: string, delta: 1 | -1) {
    this.sendAction({ t: 'vote', itemId, delta });
  }

  comment(action: CommentAction) {
    if (action.action === 'create') this.expectOwnThread = true;
    this.sendAction({ t: 'comment', ...action });
  }

  summon() {
    if (this.sendAction({ t: 'summon' })) showToast('Участники следуют за вашим видом');
  }

  // ------------------------------------------------------------------ следование

  follow(clientId: string) {
    const p = getState().peers[clientId];
    if (!p) return;
    setState({ following: clientId });
    if (p.view) this.applyFollow(p.view);
  }

  stopFollowing() {
    if (getState().following) setState({ following: null });
  }

  /** Вписать область ведущего: центр совпадает, масштаб — по меньшей стороне. */
  private applyFollow(rect: ViewRect) {
    const { viewport } = getState();
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(viewport.w / rect.w, viewport.h / rect.h)));
    this.setCamera(
      { x: viewport.w / 2 - (rect.x + rect.w / 2) * zoom, y: viewport.h / 2 - (rect.y + rect.h / 2) * zoom, zoom },
      'follow',
    );
  }

  // ------------------------------------------------------------------ комментарии: прочитанные

  private seenKey(boardId: string) {
    return `sheebase:seen:${boardId}`;
  }

  private loadSeen(boardId: string): Record<string, number> {
    try {
      const raw = JSON.parse(localStorage.getItem(this.seenKey(boardId)) ?? '{}');
      return raw && typeof raw === 'object' ? raw : {};
    } catch {
      return {};
    }
  }

  markSeen(threadId: string) {
    const st = getState();
    const t = st.comments[threadId];
    if (!t || (st.seen[threadId] ?? 0) >= t.updatedAt) return;
    const seen = { ...st.seen, [threadId]: t.updatedAt };
    setState({ seen });
    try {
      if (st.boardId) localStorage.setItem(this.seenKey(st.boardId), JSON.stringify(seen));
    } catch {
      /* без сохранения */
    }
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

  /** `source = 'follow'` — программное движение при следовании; любое другое движение следование отключает. */
  setCamera(cam: Camera, source: CameraSource = 'user') {
    if (source === 'user' && getState().following) setState({ following: null });
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
  fitRect(r: Rect | null, maxZoom = 1, pad = 80) {
    const { viewport } = getState();
    if (!r) {
      this.setCamera({ x: viewport.w / 2, y: viewport.h / 2, zoom: 1 });
      return;
    }
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
