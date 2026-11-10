import type { WebSocket, WebSocketServer } from 'ws';
import { uid } from '../shared/ops';
import type { BoardMeta, ClientMessage, Peer, ServerMessage } from '../shared/types';
import { sanitizeName, sanitizeOps } from '../shared/validate';
import type { BoardRepository } from './repository';

interface Client {
  ws: WebSocket;
  peer: Peer;
  boardId: string;
  alive: boolean;
}

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * Комнаты совместного редактирования. Сервер — единственный источник порядка:
 * пакеты операций применяются в порядке поступления и рассылаются остальным,
 * отправитель получает ack.
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
        if (!c.alive) {
          c.ws.terminate();
          continue;
        }
        c.alive = false;
        c.ws.ping();
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
      id: typeof u.id === 'string' ? u.id.slice(0, 64) : uid(10),
      name: sanitizeName(u.name, 'Гость'),
      color: typeof u.color === 'string' && COLOR_RE.test(u.color) ? u.color : '#1971c2',
    };
    const client: Client = { ws, peer, boardId: msg.boardId, alive: true };
    let room = this.rooms.get(msg.boardId);
    if (!room) {
      room = new Map();
      this.rooms.set(msg.boardId, room);
    }
    this.send(ws, {
      t: 'init',
      meta: this.repo.metaOf(msg.boardId)!,
      items: board.items,
      peers: [...room.values()].map((c) => c.peer),
      clientId: peer.clientId,
    });
    room.set(peer.clientId, client);
    this.broadcast(msg.boardId, { t: 'join', peer }, peer.clientId);
    return client;
  }

  private handleMessage(client: Client, msg: ClientMessage) {
    const { boardId, peer } = client;
    switch (msg.t) {
      case 'ops': {
        if (typeof msg.seq !== 'number') return;
        const ops = sanitizeOps(msg.ops);
        if (ops.length && this.repo.applyOps(boardId, ops)) {
          this.broadcast(boardId, { t: 'ops', from: peer.clientId, ops }, peer.clientId);
        }
        this.send(client.ws, { t: 'ack', seq: msg.seq });
        break;
      }
      case 'cursor': {
        const ok = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v));
        if (!ok(msg.x) || !ok(msg.y)) return;
        this.broadcast(boardId, { t: 'cursor', from: peer.clientId, x: msg.x, y: msg.y }, peer.clientId);
        break;
      }
      case 'selection': {
        if (!Array.isArray(msg.ids)) return;
        const ids = msg.ids.filter((i) => typeof i === 'string').slice(0, 2000);
        this.broadcast(boardId, { t: 'selection', from: peer.clientId, ids }, peer.clientId);
        break;
      }
      case 'rename': {
        const meta = this.repo.rename(boardId, sanitizeName(msg.name, 'Без названия'));
        if (meta) this.notifyMeta(meta);
        break;
      }
      default:
        break;
    }
  }
}
