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

describe('итерация 2: присутствие, сессия, комментарии', () => {
  async function joinBoard(boardId: string, user: { id: string; name: string; color: string }) {
    const c = new TestClient(server.port);
    await c.open();
    c.send({ t: 'hello', boardId, user });
    const init = await c.wait('init');
    return { c, init };
  }

  it('init содержит присутствие; view, summon, user и editing рассылаются', async () => {
    const meta = await json<BoardMeta>(
      await fetch(`${base}/api/boards`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }),
    );
    const { c: a, init: initA } = await joinBoard(meta.id, { id: 'ua', name: 'Анна', color: '#e03131' });
    expect(initA.comments).toEqual({});
    expect(initA.session).toEqual({ timer: null, voting: null });
    expect(typeof initA.now).toBe('number');
    a.send({ t: 'view', rect: { x: 10, y: 20, w: 800, h: 600 } });
    a.send({ t: 'selection', ids: ['x1'], editing: 'x1' });
    await new Promise((r) => setTimeout(r, 50));

    const { c: b, init: initB } = await joinBoard(meta.id, { id: 'ub', name: 'Борис', color: '#1971c2' });
    expect(initB.peers[0]).toMatchObject({ name: 'Анна', view: { x: 10, y: 20, w: 800, h: 600 }, selection: ['x1'], editing: 'x1' });

    a.send({ t: 'view', rect: { x: 0, y: 0, w: -5, h: 1 } }); // некорректный — игнорируется
    a.send({ t: 'view', rect: { x: 1, y: 2, w: 3, h: 4 } });
    expect((await b.wait('view')).rect).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    a.send({ t: 'summon' });
    expect((await b.wait('summon')).from).toBe(initA.clientId);
    a.send({ t: 'user', user: { name: 'Анна К.', color: '#2f9e44' } });
    expect((await b.wait('peer')).peer).toMatchObject({ clientId: initA.clientId, name: 'Анна К.', color: '#2f9e44' });
    a.close();
    b.close();
  });

  it('голосование: свои голоса приходят только своему участнику, итоги — всем после завершения', async () => {
    const meta = await json<BoardMeta>(
      await fetch(`${base}/api/boards`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ template: 'retro' }) }),
    );
    const { c: a, init } = await joinBoard(meta.id, { id: 'ua', name: 'Анна', color: '#e03131' });
    const { c: b } = await joinBoard(meta.id, { id: 'ub', name: 'Борис', color: '#1971c2' });
    const sticky = Object.values(init.items).find((i) => i.type === 'sticky')!;
    a.send({ t: 'voting', action: 'start', votesPerUser: 2 });
    expect((await a.wait('session')).session.voting).toMatchObject({ status: 'active', votesPerUser: 2, myVotes: {} });
    await b.wait('session');
    a.send({ t: 'vote', itemId: sticky.id, delta: 1 });
    expect((await a.wait('session')).session.voting!.myVotes).toEqual({ [sticky.id]: 1 });
    const bView = (await b.wait('session')).session.voting!;
    expect(bView.myVotes).toEqual({});
    expect(bView.voters).toBe(1);
    expect(bView.results).toBeNull();
    b.send({ t: 'voting', action: 'end' });
    expect((await a.wait('session')).session.voting!.results).toEqual({ [sticky.id]: 1 });
    a.close();
    b.close();
  });

  it('таймер общий для всех участников и сохраняется на диск', async () => {
    const meta = await json<BoardMeta>(
      await fetch(`${base}/api/boards`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }),
    );
    const { c: a } = await joinBoard(meta.id, { id: 'ua', name: 'Анна', color: '#e03131' });
    const { c: b } = await joinBoard(meta.id, { id: 'ub', name: 'Борис', color: '#1971c2' });
    a.send({ t: 'timer', action: 'start', durationMs: 300_000 });
    const s = await b.wait('session');
    expect(s.session.timer).toMatchObject({ running: true, durationMs: 300_000, by: 'Анна' });
    expect(s.session.timer!.endsAt! - s.now).toBeGreaterThan(299_000);
    await a.wait('session');
    await new Promise((r) => setTimeout(r, 100));
    const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'boards', `${meta.id}.json`), 'utf8'));
    expect(saved.session.timer.durationMs).toBe(300_000);
    a.close();
    b.close();
  });

  it('комментарии: тред, ответ, освобождение при удалении объекта', async () => {
    const meta = await json<BoardMeta>(
      await fetch(`${base}/api/boards`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }),
    );
    const { c: a } = await joinBoard(meta.id, { id: 'ua', name: 'Анна', color: '#e03131' });
    const { c: b } = await joinBoard(meta.id, { id: 'ub', name: 'Борис', color: '#1971c2' });
    const st = makeSticky('cm1', 100, 100, 1, '#fff', 'тема');
    a.send({ t: 'ops', seq: 1, ops: [{ t: 'add', item: st }] });
    await a.wait('ack');
    await b.wait('ops');
    a.send({ t: 'comment', action: 'create', x: 120, y: 110, itemId: 'cm1', text: 'Обсудим?' });
    const created = (await b.wait('thread')).thread;
    expect(created).toMatchObject({ itemId: 'cm1', dx: 20, dy: 10 });
    expect(created.messages[0]).toMatchObject({ authorName: 'Анна', text: 'Обсудим?' });
    await a.wait('thread');
    b.send({ t: 'comment', action: 'reply', threadId: created.id, text: 'Да' });
    expect((await a.wait('thread')).thread.messages).toHaveLength(2);
    await b.wait('thread');
    b.send({ t: 'comment', action: 'create', x: 0, y: 0, text: '' });
    expect((await b.wait('notice')).message).toContain('Комментарий не сохранён');
    // удаление объекта освобождает тред
    a.send({ t: 'ops', seq: 2, ops: [{ t: 'delete', id: 'cm1' }] });
    const detached = (await b.wait('thread')).thread;
    expect(detached).toMatchObject({ id: created.id, itemId: null, x: 120, y: 110 });
    a.close();
    b.close();
  });
});

describe('итерация 2: версии и миниатюры', () => {
  it('ручная версия, восстановление с рассылкой reset и снимком «перед восстановлением»', async () => {
    const meta = await json<BoardMeta>(
      await fetch(`${base}/api/boards`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ template: 'kanban' }) }),
    );
    const v1 = await json<{ id: string; itemCount: number; auto: boolean }>(
      await fetch(`${base}/api/boards/${meta.id}/versions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'До чистки' }),
      }),
    );
    expect(v1).toMatchObject({ itemCount: meta.itemCount, auto: false });

    const c = new TestClient(server.port);
    await c.open();
    c.send({ t: 'hello', boardId: meta.id, user: { id: 'u', name: 'X', color: '#000000' } });
    const init = await c.wait('init');
    c.send({ t: 'ops', seq: 1, ops: Object.keys(init.items).map((id) => ({ t: 'delete', id })) });
    await c.wait('ack');
    expect(server.repo.get(meta.id)!.items).toEqual({});

    const r = await json<{ ok: boolean; itemCount: number }>(
      await fetch(`${base}/api/boards/${meta.id}/versions/${v1.id}/restore`, { method: 'POST' }),
    );
    expect(r).toMatchObject({ ok: true, itemCount: meta.itemCount });
    const reset = await c.wait('reset');
    expect(Object.keys(reset.items)).toHaveLength(meta.itemCount!);
    expect(reset.reason).toContain('До чистки');

    const list = await json<{ name: string }[]>(await fetch(`${base}/api/boards/${meta.id}/versions`));
    expect(list[0].name).toBe('Перед восстановлением «До чистки»');
    const full = await json<{ items: Record<string, unknown> }>(await fetch(`${base}/api/boards/${meta.id}/versions/${v1.id}`));
    expect(Object.keys(full.items)).toHaveLength(meta.itemCount!);
    expect((await fetch(`${base}/api/boards/${meta.id}/versions/${v1.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await fetch(`${base}/api/boards/${meta.id}/versions/${v1.id}`)).status).toBe(404);
    expect((await fetch(`${base}/api/boards/${meta.id}/versions/../../x/restore`, { method: 'POST' })).status).toBe(404);
    c.close();
  });

  it('автоснимок перед первой правкой после паузы; версии удаляются вместе с доской', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-versions-'));
    let clock = 1_000_000;
    const s = await startServer({ port: 0, dataDir: dir, quiet: true, autoSnapshotMs: 60_000, now: () => clock });
    const meta = s.repo.create('V', 'retro');
    const add = (id: string) => s.repo.applyOps(meta.id, [{ t: 'add', item: makeSticky(id, 0, 0, 50, '#fff') }]);
    add('a1'); // первый снимок — исходное состояние шаблона
    expect(s.repo.versions.list(meta.id)).toHaveLength(1);
    clock += 10_000;
    add('a2'); // меньше интервала — без снимка
    expect(s.repo.versions.list(meta.id)).toHaveLength(1);
    clock += 60_000;
    add('a3'); // интервал прошёл — снимок состояния до правки
    const list = s.repo.versions.list(meta.id);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ auto: true, itemCount: meta.itemCount! + 2 });
    expect(fs.existsSync(path.join(dir, 'versions', meta.id))).toBe(true);
    await s.repo.remove(meta.id);
    expect(fs.existsSync(path.join(dir, 'versions', meta.id))).toBe(false);
    await s.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('миниатюра: SVG с ETag и 304, CSP-заголовок', async () => {
    const meta = await json<BoardMeta>(
      await fetch(`${base}/api/boards`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ template: 'mindmap' }) }),
    );
    const res = await fetch(`${base}/api/boards/${meta.id}/thumbnail.svg`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/svg+xml');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    const svg = await res.text();
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('<path');
    const etag = res.headers.get('etag')!;
    const again = await fetch(`${base}/api/boards/${meta.id}/thumbnail.svg`, { headers: { 'if-none-match': etag } });
    expect(again.status).toBe(304);
    expect((await fetch(`${base}/api/boards/nope/thumbnail.svg`)).status).toBe(404);
  });
});
