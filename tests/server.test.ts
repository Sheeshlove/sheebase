import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startServer, type RunningServer } from '../src/server/app';
import { makeSticky } from '../src/shared/defaults';
import type { BoardMeta, ServerMessage } from '../src/shared/types';

let dataDir: string;
let server: RunningServer;
let base: string;

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-test-'));
  server = await startServer({ port: 0, dataDir, saveDelayMs: 20, quiet: true });
  base = `http://localhost:${server.port}`;
});

afterAll(async () => {
  await server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

class TestClient {
  ws: WebSocket;
  messages: ServerMessage[] = [];
  private waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];
  constructor(port: number) {
    this.ws = new WebSocket(`ws://localhost:${port}/ws`);
    this.ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as ServerMessage;
      this.messages.push(m);
      this.waiters = this.waiters.filter((w) => {
        if (w.pred(m)) {
          w.resolve(m);
          return false;
        }
        return true;
      });
    });
  }
  open() {
    return new Promise<void>((res, rej) => {
      this.ws.once('open', () => res());
      this.ws.once('error', rej);
    });
  }
  send(m: unknown) {
    this.ws.send(typeof m === 'string' ? m : JSON.stringify(m));
  }
  wait<T extends ServerMessage['t']>(t: T, timeout = 2000): Promise<Extract<ServerMessage, { t: T }>> {
    const found = this.messages.find((m) => m.t === t);
    if (found) {
      this.messages.splice(this.messages.indexOf(found), 1);
      return Promise.resolve(found as Extract<ServerMessage, { t: T }>);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${t}`)), timeout);
      this.waiters.push({
        pred: (m) => m.t === t,
        resolve: (m) => {
          clearTimeout(timer);
          this.messages.splice(this.messages.indexOf(m), 1);
          resolve(m as Extract<ServerMessage, { t: T }>);
        },
      });
    });
  }
  close() {
    this.ws.close();
  }
}

async function json<T>(res: Response): Promise<T> {
  expect(res.ok).toBe(true);
  return (await res.json()) as T;
}

describe('REST API', () => {
  it('создаёт, переименовывает, дублирует и удаляет доски', async () => {
    const meta = await json<BoardMeta>(
      await fetch(`${base}/api/boards`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ template: 'kanban' }),
      }),
    );
    expect(meta.name).toBe('Канбан');
    expect(meta.itemCount).toBeGreaterThan(4);

    const renamed = await json<BoardMeta>(
      await fetch(`${base}/api/boards/${meta.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Спринт 42' }),
      }),
    );
    expect(renamed.name).toBe('Спринт 42');

    const copy = await json<BoardMeta>(await fetch(`${base}/api/boards/${meta.id}/duplicate`, { method: 'POST' }));
    expect(copy.name).toBe('Спринт 42 (копия)');
    expect(copy.itemCount).toBe(meta.itemCount);

    const list = await json<BoardMeta[]>(await fetch(`${base}/api/boards`));
    expect(list.map((b) => b.id)).toEqual(expect.arrayContaining([meta.id, copy.id]));

    expect((await fetch(`${base}/api/boards/${copy.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await fetch(`${base}/api/boards/${copy.id}`)).status).toBe(404);
  });
});

describe('WebSocket-комнаты', () => {
  it('рассылает операции, курсоры, присутствие; подтверждает пакеты; сохраняет на диск', async () => {
    const meta = await json<BoardMeta>(
      await fetch(`${base}/api/boards`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }),
    );
    const a = new TestClient(server.port);
    const b = new TestClient(server.port);
    await Promise.all([a.open(), b.open()]);

    a.send({ t: 'hello', boardId: meta.id, user: { id: 'ua', name: 'Анна', color: '#e03131' } });
    const initA = await a.wait('init');
    expect(initA.peers).toEqual([]);

    b.send({ t: 'hello', boardId: meta.id, user: { id: 'ub', name: 'Борис', color: '#1971c2' } });
    const initB = await b.wait('init');
    expect(initB.peers.map((p) => p.name)).toEqual(['Анна']);
    const join = await a.wait('join');
    expect(join.peer.name).toBe('Борис');

    // Некорректные данные не роняют сервер
    a.send('{oops');
    expect((await a.wait('error')).code).toBe('bad_request');

    const sticky = makeSticky('st1', 10, 20, 1, '#fef3a6', 'Привет');
    a.send({ t: 'ops', seq: 1, ops: [{ t: 'add', item: sticky }, { t: 'add', item: { id: 'bad', type: 'evil' } }] });
    expect(await a.wait('ack')).toEqual({ t: 'ack', seq: 1 });
    const got = await b.wait('ops');
    expect(got.from).toBe(initA.clientId);
    expect(got.ops).toEqual([{ t: 'add', item: sticky }]);

    a.send({ t: 'cursor', x: 5, y: 6 });
    expect(await b.wait('cursor')).toEqual({ t: 'cursor', from: initA.clientId, x: 5, y: 6 });

    b.send({ t: 'rename', name: 'Новое имя' });
    expect((await a.wait('meta')).meta.name).toBe('Новое имя');

    b.close();
    expect((await a.wait('leave')).clientId).toBe(initB.clientId);
    a.close();

    // запись на диск
    await new Promise((r) => setTimeout(r, 100));
    const file = path.join(dataDir, 'boards', `${meta.id}.json`);
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(saved.items.st1.text).toBe('Привет');
    expect(saved.meta.name).toBe('Новое имя');
  });

  it('данные, не прошедшие валидацию, исправляются у отправителя', async () => {
    const meta = await json<BoardMeta>(
      await fetch(`${base}/api/boards`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }),
    );
    const a = new TestClient(server.port);
    const b = new TestClient(server.port);
    await Promise.all([a.open(), b.open()]);
    a.send({ t: 'hello', boardId: meta.id, user: { id: 'ua', name: 'A', color: '#e03131' } });
    await a.wait('init');
    b.send({ t: 'hello', boardId: meta.id, user: { id: 'ub', name: 'B', color: '#1971c2' } });
    await b.wait('init');
    const st = makeSticky('fix1', 0, 0, 1, '#fff', 'ok');
    a.send({ t: 'ops', seq: 1, ops: [{ t: 'add', item: st }] });
    await a.wait('ack');
    await b.wait('ops');
    // слишком длинный текст — поле отбрасывается, x применяется
    a.send({ t: 'ops', seq: 2, ops: [{ t: 'update', id: 'fix1', patch: { x: 50, text: 'т'.repeat(30_000) } }] });
    expect(await a.wait('ack')).toEqual({ t: 'ack', seq: 2 });
    const fix = await a.wait('ops');
    expect(fix.from).toBe('server');
    expect(fix.ops).toEqual([{ t: 'add', item: { ...st, x: 50 } }]);
    const relayed = await b.wait('ops');
    expect(relayed.ops).toEqual([{ t: 'update', id: 'fix1', patch: { x: 50 } }]);
    a.close();
    b.close();
  });

  it('несуществующая доска → ошибка not_found', async () => {
    const c = new TestClient(server.port);
    await c.open();
    c.send({ t: 'hello', boardId: 'nope', user: { id: 'u', name: 'X', color: '#000000' } });
    expect((await c.wait('error')).code).toBe('not_found');
    c.close();
  });

  it('удаление доски отключает участников', async () => {
    const meta = await json<BoardMeta>(
      await fetch(`${base}/api/boards`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }),
    );
    const c = new TestClient(server.port);
    await c.open();
    c.send({ t: 'hello', boardId: meta.id, user: { id: 'u', name: 'X', color: '#000000' } });
    await c.wait('init');
    await fetch(`${base}/api/boards/${meta.id}`, { method: 'DELETE' });
    expect((await c.wait('error')).code).toBe('deleted');
  });

  it('данные переживают перезапуск сервера', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-restart-'));
    const s1 = await startServer({ port: 0, dataDir: dir, saveDelayMs: 1000, quiet: true });
    const meta = await json<BoardMeta>(
      await fetch(`http://localhost:${s1.port}/api/boards`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Persist', template: 'retro' }),
      }),
    );
    s1.repo.applyOps(meta.id, [{ t: 'add', item: makeSticky('zz', 0, 0, 99, '#fff', 'после') }]);
    await s1.close(); // flush до истечения debounce
    const s2 = await startServer({ port: 0, dataDir: dir, quiet: true });
    const board = s2.repo.get(meta.id)!;
    expect(board.meta.name).toBe('Persist');
    expect(board.items.zz).toMatchObject({ text: 'после' });
    await s2.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
