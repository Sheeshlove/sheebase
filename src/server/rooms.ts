import type { WebSocket, WebSocketServer } from 'ws';
import { uid } from '../shared/ops';
import type {
  BoardMeta,
  ClientMessage,
  CommentThread,
  ItemMap,
  Op,
  Peer,
  PeerPresence,
  ServerMessage,
  ViewRect,
} from '../shared/types';
import { isValidId, sanitizeName, sanitizeOpsReport } from '../shared/validate';
import type { BoardRepository } from './repository';
import { applyComment, applyTimer, applyVoting, castVote, sessionView } from './session';

interface Client {
  ws: WebSocket;
  peer: Peer;
  boardId: string;
  alive: boolean;
  /** Последнее присутствие — отдаётся новым участникам в init. */
  view: ViewRect | null;
  selection: string[];
  editing: string | null;
}

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e7;

function sanitizeView(raw: unknown): ViewRect | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!isNum(r.x) || !isNum(r.y) || !isNum(r.w) || !isNum(r.h) || r.w <= 0 || r.h <= 0) return null;
  return { x: r.x, y: r.y, w: r.w, h: r.h };
}

const presence = (c: Client): PeerPresence => ({ ...c.peer, view: c.view, selection: c.selection, editing: c.editing });

/**
 * Комнаты совместного редактирования. Сервер — единственный источник порядка:
 * пакеты операций применяются в порядке поступления и рассылаются остальным,
 * отправитель получает ack. Сессионные данные (таймер, голосование, комментарии)
 * сервер применяет сам и рассылает результат.
 */
export class Rooms {
  private rooms = new Map<string, Map<string, Client>>();
  private heartbeat: NodeJS.Timeout;

  constructor(
    private readonly repo: BoardRepository,
    wss: WebSocketServer,
  ) {
    wss.on('connection', (ws) => this.onConnection(ws));
    this.heartbeat = setInterval(() => this.ping(), 30_000);
    this.heartbeat.unref();
  }

  close() {
    clearInterval(this.heartbeat);
  }

  private ping() {
    for (const room of this.rooms.values()) {
      for (const c of room.values()) {
        // ping() на закрывающемся сокете бросает исключение — в таймере это уронило бы процесс
        if (c.ws.readyState !== c.ws.OPEN) continue;
        if (!c.alive) {
          c.ws.terminate();
          continue;
        }
        c.alive = false;
        try {
          c.ws.ping();
        } catch {
          c.ws.terminate();
        }
      }
    }
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  broadcast(boardId: string, msg: ServerMessage, exceptClientId?: string) {
    const room = this.rooms.get(boardId);
    if (!room) return;
    const data = JSON.stringify(msg);
    for (const c of room.values()) {
      if (c.peer.clientId !== exceptClientId && c.ws.readyState === c.ws.OPEN) c.ws.send(data);
    }
  }

  notifyMeta(meta: BoardMeta) {
    this.broadcast(meta.id, { t: 'meta', meta });
  }

  /** Сессия формируется для каждого участника отдельно: в ней только его голоса. */
  private broadcastSession(boardId: string) {
    const board = this.repo.get(boardId);
    const room = this.rooms.get(boardId);
    if (!board || !room) return;
    const now = this.repo.now();
    for (const c of room.values()) this.send(c.ws, { t: 'session', session: sessionView(board.session, c.peer.id), now });
  }

  private broadcastThreads(boardId: string, threads: CommentThread[]) {
    for (const thread of threads) this.broadcast(boardId, { t: 'thread', thread });
  }

  /** Доска восстановлена из версии — все участники получают новый снимок. */
  resetBoard(boardId: string, items: ItemMap, reason: string, threads: CommentThread[]) {
    this.broadcast(boardId, { t: 'reset', items, reason });
    this.broadcastThreads(boardId, threads);
    this.broadcastSession(boardId);
  }

  /** Доска удалена — уведомить и отключить всех участников. */
  closeBoard(boardId: string) {
    const room = this.rooms.get(boardId);
    if (!room) return;
    for (const c of room.values()) {
      this.send(c.ws, { t: 'error', code: 'deleted', message: 'Доска удалена' });
      c.ws.close(4004, 'deleted');
    }
    this.rooms.delete(boardId);
  }

  peersOf(boardId: string): Peer[] {
    return [...(this.rooms.get(boardId)?.values() ?? [])].map((c) => c.peer);
  }

  private onConnection(ws: WebSocket) {
    let client: Client | null = null;

    ws.on('pong', () => {
      if (client) client.alive = true;
    });

    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let msg: ClientMessage;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        this.send(ws, { t: 'error', code: 'bad_request', message: 'Некорректный JSON' });
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      try {
        if (!client) {
          client = this.handleHello(ws, msg);
          return;
        }
        this.handleMessage(client, msg);
      } catch (err) {
        console.error('[rooms] ошибка обработки сообщения:', err);
      }
    });

    ws.on('close', () => {
      if (!client) return;
      const room = this.rooms.get(client.boardId);
      if (!room) return;
      room.delete(client.peer.clientId);
      if (room.size === 0) this.rooms.delete(client.boardId);
      this.broadcast(client.boardId, { t: 'leave', clientId: client.peer.clientId });
    });

    ws.on('error', () => ws.terminate());
  }

  private handleHello(ws: WebSocket, msg: ClientMessage): Client | null {
    if (msg.t !== 'hello' || typeof msg.boardId !== 'string') {
      this.send(ws, { t: 'error', code: 'bad_request', message: 'Ожидалось сообщение hello' });
      return null;
    }
    const board = this.repo.get(msg.boardId);
    if (!board) {
      this.send(ws, { t: 'error', code: 'not_found', message: 'Доска не найдена' });
      ws.close(4004, 'not_found');
      return null;
    }
    const u = (msg.user ?? {}) as Partial<Peer>;
    const peer: Peer = {
      clientId: uid(10),
      id: typeof u.id === 'string' && u.id ? u.id.slice(0, 64) : uid(10),
      name: sanitizeName(u.name, 'Гость').slice(0, 40),
      color: typeof u.color === 'string' && COLOR_RE.test(u.color) ? u.color : '#1971c2',
    };
    const client: Client = { ws, peer, boardId: msg.boardId, alive: true, view: null, selection: [], editing: null };
    let room = this.rooms.get(msg.boardId);
    if (!room) {
      room = new Map();
      this.rooms.set(msg.boardId, room);
    }
    this.send(ws, {
      t: 'init',
      meta: this.repo.metaOf(msg.boardId)!,
      items: board.items,
      peers: [...room.values()].map(presence),
      clientId: peer.clientId,
      comments: board.comments,
      session: sessionView(board.session, peer.id),
      now: this.repo.now(),
    });
    room.set(peer.clientId, client);
    this.broadcast(msg.boardId, { t: 'join', peer: presence(client) }, peer.clientId);
    return client;
  }

  private handleMessage(client: Client, msg: ClientMessage) {
    const { boardId, peer } = client;
    const board = this.repo.get(boardId);
    if (!board) return;
    switch (msg.t) {
      case 'ops': {
        if (typeof msg.seq !== 'number') return;
        const { ops, rejected } = sanitizeOpsReport(msg.ops);
        if (ops.length) {
          const res = this.repo.applyOps(boardId, ops);
          if (res.ok) {
            this.broadcast(boardId, { t: 'ops', from: peer.clientId, ops }, peer.clientId);
            this.broadcastThreads(boardId, res.threads);
          }
        }
        this.send(client.ws, { t: 'ack', seq: msg.seq });
        // Часть данных не прошла валидацию: присылаем отправителю актуальное состояние
        // затронутых объектов (после ack — его отметки pending уже сняты, коррекция применится).
        if (rejected.length) {
          const items = board.items;
          const fix: Op[] = rejected.map((id) => (items[id] ? { t: 'add', item: items[id] } : { t: 'delete', id }));
          this.send(client.ws, { t: 'ops', from: 'server', ops: fix });
        }
        break;
      }
      case 'cursor': {
        const ok = (v: unknown) => v === null || isNum(v);
        if (!ok(msg.x) || !ok(msg.y)) return;
        this.broadcast(boardId, { t: 'cursor', from: peer.clientId, x: msg.x, y: msg.y }, peer.clientId);
        break;
      }
      case 'selection': {
        if (!Array.isArray(msg.ids)) return;
        client.selection = msg.ids.filter((i): i is string => isValidId(i)).slice(0, 2000);
        client.editing = isValidId(msg.editing) ? msg.editing : null;
        this.broadcast(boardId, { t: 'selection', from: peer.clientId, ids: client.selection, editing: client.editing }, peer.clientId);
        break;
      }
      case 'view': {
        const rect = sanitizeView(msg.rect);
        if (!rect) return;
        client.view = rect;
        this.broadcast(boardId, { t: 'view', from: peer.clientId, rect }, peer.clientId);
        break;
      }
      case 'summon':
        this.broadcast(boardId, { t: 'summon', from: peer.clientId }, peer.clientId);
        break;
      case 'user': {
        const u = (msg.user ?? {}) as Partial<Peer>;
        peer.name = sanitizeName(u.name, peer.name).slice(0, 40);
        if (typeof u.color === 'string' && COLOR_RE.test(u.color)) peer.color = u.color;
        this.broadcast(boardId, { t: 'peer', peer }, peer.clientId);
        break;
      }
      case 'rename': {
        const meta = this.repo.rename(boardId, sanitizeName(msg.name, 'Без названия'));
        if (meta) this.notifyMeta(meta);
        break;
      }
      case 'timer':
        if (applyTimer(board.session, msg, peer.name, this.repo.now())) {
          this.repo.touch(boardId);
          this.broadcastSession(boardId);
        }
        break;
      case 'voting':
        if (applyVoting(board.session, msg, peer.name, this.repo.now())) {
          this.repo.touch(boardId);
          this.broadcastSession(boardId);
        }
        break;
      case 'vote':
        if (castVote(board.session, board.items, peer.id, msg.itemId, msg.delta)) {
          this.repo.touch(boardId);
          this.broadcastSession(boardId);
        } else {
          // отказ (лимит, объект удалён) — отправителю актуальное состояние, чтобы снять ожидание
          this.send(client.ws, { t: 'session', session: sessionView(board.session, peer.id), now: this.repo.now() });
        }
        break;
      case 'comment': {
        const res = applyComment(board.comments, board.items, msg, peer, this.repo.now());
        if (!res) {
          if (msg.action === 'create' || msg.action === 'reply') {
            this.send(client.ws, { t: 'notice', message: 'Комментарий не сохранён: проверьте текст (1–2000 символов)' });
          }
          return;
        }
        this.repo.touch(boardId);
        if ('thread' in res) this.broadcast(boardId, { t: 'thread', thread: res.thread });
        else this.broadcast(boardId, { t: 'thread-delete', id: res.deleted });
        break;
      }
      default:
        break;
    }
  }
}
