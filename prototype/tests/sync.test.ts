import { describe, expect, it } from 'vitest';
import { SyncEngine } from '../src/client/board/syncEngine';
import { makeSticky } from '../src/shared/defaults';
import { applyOps } from '../src/shared/ops';
import type { Item, ItemMap, Op } from '../src/shared/types';

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type ToServer = { seq: number; ops: Op[] };
type ToClient = { t: 'ack'; seq: number } | { t: 'ops'; ops: Op[] };

class SimClient {
  engine = new SyncEngine();
  toServer: ToServer[] = [];
  inbox: ToClient[] = [];
  graveyard: Item[] = [];
  constructor(
    public name: string,
    public items: ItemMap,
  ) {}

  local(ops: Op[]) {
    for (const op of ops) if (op.t === 'delete' && this.items[op.id]) this.graveyard.push(this.items[op.id]);
    this.items = applyOps(this.items, ops);
    this.engine.local(ops);
  }

  flush() {
    const b = this.engine.takeBatch();
    if (b) this.toServer.push(b);
  }

  deliver() {
    const msg = this.inbox.shift();
    if (!msg) return;
    if (msg.t === 'ack') this.engine.ack(msg.seq);
    else this.items = applyOps(this.items, this.engine.filterRemote(msg.ops));
  }
}

function simulate(seed: number, clientCount: number, steps: number) {
  const r = rng(seed);
  const pick = <T,>(arr: T[]): T => arr[Math.floor(r() * arr.length)];
  let serverItems: ItemMap = {};
  for (let i = 0; i < 4; i++) {
    const it = makeSticky(`s${i}`, i * 10, 0, i, '#fff', `t${i}`);
    serverItems[it.id] = it;
  }
  const clients = Array.from({ length: clientCount }, (_, i) => new SimClient(`c${i}`, { ...serverItems }));
  let counter = 0;

  const serverReceive = (from: SimClient) => {
    const batch = from.toServer.shift();
    if (!batch) return;
    serverItems = applyOps(serverItems, batch.ops);
    for (const c of clients) {
      if (c === from) c.inbox.push({ t: 'ack', seq: batch.seq });
      else c.inbox.push({ t: 'ops', ops: batch.ops });
    }
  };

  const randomLocalOp = (c: SimClient): Op[] => {
    const ids = Object.keys(c.items);
    const roll = r();
    if (roll < 0.1 || ids.length === 0) {
      const id = `n${counter++}`;
      return [{ t: 'add', item: makeSticky(id, r() * 100, r() * 100, counter, '#ff0') }];
    }
    if (roll < 0.17) return [{ t: 'delete', id: pick(ids) }];
    if (roll < 0.22 && c.graveyard.length) {
      // «Отмена удаления» — повторное добавление того же объекта
      const it = c.graveyard.pop()!;
      return [{ t: 'add', item: it }];
    }
    const id = pick(ids);
    const field = pick(['x', 'y', 'color', 'text']);
    const value = field === 'x' || field === 'y' ? Math.round(r() * 1000) : `${c.name}-${counter++}`;
    return [{ t: 'update', id, patch: { [field]: value } }];
  };

  for (let s = 0; s < steps; s++) {
    const c = pick(clients);
    const roll = r();
    if (roll < 0.35) c.local(randomLocalOp(c));
    else if (roll < 0.55) c.flush();
    else if (roll < 0.78) serverReceive(c);
    else c.deliver();
  }
  // Досылаем всё
  for (const c of clients) c.flush();
  let busy = true;
  while (busy) {
    busy = false;
    for (const c of clients) {
      if (c.toServer.length) {
        serverReceive(c);
        busy = true;
      }
    }
    for (const c of clients) {
      if (c.inbox.length) {
        c.deliver();
        busy = true;
      }
    }
  }
  return { serverItems, clients };
}

describe('SyncEngine: сходимость при конкурентных изменениях', () => {
  it('все клиенты приходят к состоянию сервера (300 случайных сценариев)', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const { serverItems, clients } = simulate(seed, 2 + (seed % 3), 400);
      for (const c of clients) {
        expect(c.items, `seed ${seed}, ${c.name}`).toEqual(serverItems);
        expect(c.engine.pendingCount, `seed ${seed}, ${c.name} pending`).toBe(0);
      }
    }
  });

  it('изменения разных полей одного объекта не теряются', () => {
    const base: ItemMap = { a: makeSticky('a', 0, 0, 1, '#fff') };
    const A = new SimClient('A', { ...base });
    const B = new SimClient('B', { ...base });
    A.local([{ t: 'update', id: 'a', patch: { color: '#f00' } }]);
    B.local([{ t: 'update', id: 'a', patch: { x: 500 } }]);
    A.flush();
    B.flush();
    // сервер получает B, затем A
    let server = base;
    const b = B.toServer.shift()!;
    server = applyOps(server, b.ops);
    const a = A.toServer.shift()!;
    server = applyOps(server, a.ops);
    A.inbox.push({ t: 'ops', ops: b.ops }, { t: 'ack', seq: a.seq });
    B.inbox.push({ t: 'ack', seq: b.seq }, { t: 'ops', ops: a.ops });
    while (A.inbox.length) A.deliver();
    while (B.inbox.length) B.deliver();
    expect(server.a).toMatchObject({ color: '#f00', x: 500 });
    expect(A.items).toEqual(server);
    expect(B.items).toEqual(server);
  });

  it('чужое изменение того же поля до нашего ack игнорируется, после — применяется', () => {
    const e = new SyncEngine();
    e.local([{ t: 'update', id: 'a', patch: { x: 1 } }]);
    const b = e.takeBatch()!;
    expect(e.filterRemote([{ t: 'update', id: 'a', patch: { x: 2, y: 3 } }])).toEqual([
      { t: 'update', id: 'a', patch: { y: 3 } },
    ]);
    e.ack(b.seq);
    expect(e.filterRemote([{ t: 'update', id: 'a', patch: { x: 2 } }])).toEqual([{ t: 'update', id: 'a', patch: { x: 2 } }]);
  });

  it('resync возвращает все неподтверждённые пакеты по порядку', () => {
    const e = new SyncEngine();
    e.local([{ t: 'update', id: 'a', patch: { x: 1 } }]);
    e.takeBatch();
    e.local([{ t: 'update', id: 'a', patch: { x: 2 } }]);
    const all = e.resync();
    expect(all.map((b) => b.ops)).toEqual([
      [{ t: 'update', id: 'a', patch: { x: 1 } }],
      [{ t: 'update', id: 'a', patch: { x: 2 } }],
    ]);
    for (const b of all) e.ack(b.seq);
    expect(e.pendingCount).toBe(0);
    expect(e.unackedCount).toBe(0);
  });
});
