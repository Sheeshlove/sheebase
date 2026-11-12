import { beforeEach, describe, expect, it } from 'vitest';
import {
  alignSelection,
  cloneItems,
  computeMoveSet,
  createAndEdit,
  createSticky,
  createText,
  insertTemplate,
  nudgeSelection,
  quickCreate,
  setLink,
  startEditing,
  stopEditing,
  updateItems,
} from '../src/client/board/actions';
import { board } from '../src/client/board/controller';
import { snapMove } from '../src/client/board/interactions';
import { getState, initialBoardState, useBoard } from '../src/client/board/store';
import { makeConnector, makeFrame, makeShape, makeSticky, makeText } from '../src/shared/defaults';
import type { ConnectorItem, ItemMap, StickyItem } from '../src/shared/types';

beforeEach(() => {
  useBoard.setState(initialBoardState(), true);
  board.resetLocal();
});

const load = (items: ItemMap) => useBoard.setState({ items });

describe('контроллер: транзакции и история', () => {
  it('add → undo → redo', () => {
    board.apply([{ t: 'add', item: makeSticky('a', 0, 0, 1, '#fff', 'x') }]);
    expect(getState().items.a).toBeDefined();
    expect(getState().canUndo).toBe(true);
    board.undo();
    expect(getState().items.a).toBeUndefined();
    expect(getState().canRedo).toBe(true);
    board.redo();
    expect(getState().items.a).toMatchObject({ text: 'x' });
  });

  it('перетаскивание (много update в транзакции) — один шаг отмены', () => {
    board.apply([{ t: 'add', item: makeSticky('a', 0, 0, 1, '#fff') }]);
    board.begin();
    for (let i = 1; i <= 20; i++) board.apply([{ t: 'update', id: 'a', patch: { x: i * 10, y: i } }]);
    board.commit();
    expect(getState().items.a).toMatchObject({ x: 200, y: 20 });
    board.undo();
    expect(getState().items.a).toMatchObject({ x: 0, y: 0 });
    board.redo();
    expect(getState().items.a).toMatchObject({ x: 200, y: 20 });
  });

  it('rollback откатывает незавершённую транзакцию без записи в историю', () => {
    board.apply([{ t: 'add', item: makeSticky('a', 0, 0, 1, '#fff') }]);
    board.begin();
    board.apply([{ t: 'update', id: 'a', patch: { x: 500 } }]);
    board.apply([{ t: 'add', item: makeSticky('b', 0, 0, 2, '#fff') }]);
    board.rollback();
    expect(getState().items.a.x).toBe(0);
    expect(getState().items.b).toBeUndefined();
    board.undo(); // отменяет только создание «a»
    expect(getState().items.a).toBeUndefined();
  });

  it('создание и удаление внутри одной транзакции не попадает в историю', () => {
    board.begin();
    board.apply([{ t: 'add', item: makeSticky('tmp', 0, 0, 1, '#fff') }]);
    board.apply([{ t: 'delete', id: 'tmp' }]);
    board.commit();
    expect(getState().canUndo).toBe(false);
  });

  it('удаление выделенного объекта убирает его из выделения', () => {
    board.apply([{ t: 'add', item: makeSticky('a', 0, 0, 1, '#fff') }]);
    useBoard.setState({ selection: ['a'] });
    board.apply([{ t: 'delete', id: 'a' }]);
    expect(getState().selection).toEqual([]);
  });
});

describe('клонирование', () => {
  it('коннектор между копируемыми объектами переподключается к копиям', () => {
    const a = makeShape('a', 'rect', 0, 0, 100, 100, 1);
    const b = makeShape('b', 'rect', 300, 0, 100, 100, 2, { groupId: 'g1' });
    const c = makeConnector('c', { itemId: 'a', side: 'auto', x: 0, y: 0 }, { itemId: 'b', side: 'auto', x: 0, y: 0 }, 3);
    const copies = cloneItems([a, b, c], 10, 20);
    const [ca, cb, cc] = copies as [typeof a, typeof b, ConnectorItem];
    expect(new Set(copies.map((i) => i.id)).size).toBe(3);
    expect(copies.every((i) => !['a', 'b', 'c'].includes(i.id))).toBe(true);
    expect(ca).toMatchObject({ x: 10, y: 20 });
    expect(cc.from.itemId).toBe(ca.id);
    expect(cc.to.itemId).toBe(cb.id);
    expect(cb.groupId).not.toBe('g1');
    expect(cb.groupId).toBeTruthy();
  });

  it('конец, привязанный к объекту вне копии, становится свободным', () => {
    const c = makeConnector('c', { itemId: 'outside', side: 'auto', x: 5, y: 5 }, { x: 50, y: 50 }, 3);
    const [cc] = cloneItems([c], 10, 10) as [ConnectorItem];
    expect(cc.from).toEqual({ x: 15, y: 15, itemId: null, side: null });
    expect(cc.to).toMatchObject({ x: 60, y: 60, itemId: null });
  });
});

describe('умные направляющие', () => {
  it('притягивает к краю соседнего объекта и строит линию', () => {
    const box = { x: 0, y: 0, w: 100, h: 100 };
    const other = { x: 200, y: 300, w: 100, h: 100 };
    const r = snapMove(box, 97, 50, [other], 6);
    expect(r.dx).toBe(100); // правый край 197 притягивается к левому краю соседа 200
    expect(r.guides.some((g) => g.axis === 'x')).toBe(true);
  });

  it('не притягивает за пределами порога', () => {
    const r = snapMove({ x: 0, y: 0, w: 100, h: 100 }, 80, 37, [{ x: 200, y: 300, w: 100, h: 100 }], 6);
    expect(r).toEqual({ dx: 80, dy: 37, guides: [] });
  });
});

describe('регрессии: создание и ввод текста', () => {
  it('брошенный пустой текст не оставляет «фантома» в истории', () => {
    createAndEdit(() => createText({ x: 0, y: 0 }));
    expect(getState().editingId).not.toBeNull();
    stopEditing();
    expect(Object.keys(getState().items)).toEqual([]);
    expect(getState().canUndo).toBe(false);
  });

  it('создание стикера и ввод текста — один шаг отмены', () => {
    const id = createAndEdit(() => createSticky({ x: 0, y: 0 }));
    updateItems([{ id, patch: { text: 'а' } }]);
    updateItems([{ id, patch: { text: 'абв' } }]);
    stopEditing();
    expect((getState().items[id] as StickyItem).text).toBe('абв');
    board.undo();
    expect(getState().items[id]).toBeUndefined();
    expect(getState().canUndo).toBe(false);
  });

  it('быстрое создание у текста без ввода — копия и коннектор исчезают', () => {
    load({ t1: makeText('t1', 0, 0, 1, 'Исходный') });
    quickCreate('t1', 'right');
    expect(Object.values(getState().items).some((i) => i.type === 'connector')).toBe(true);
    stopEditing();
    const items = Object.values(getState().items);
    expect(items.map((i) => i.id)).toEqual(['t1']);
    expect(getState().canUndo).toBe(false);
  });

  it('очищенный текст удаляется вместе с привязанными коннекторами (и восстанавливается одним undo)', () => {
    load({
      t1: makeText('t1', 0, 0, 1, 'Текст'),
      s1: makeSticky('s1', 400, 0, 2, '#fff'),
      c1: makeConnector('c1', { itemId: 't1', side: 'auto', x: 0, y: 0 }, { itemId: 's1', side: 'auto', x: 0, y: 0 }, 3),
    });
    board.begin();
    useBoard.setState({ editingId: 't1' });
    updateItems([{ id: 't1', patch: { text: '   ' } }]);
    stopEditing();
    expect(Object.keys(getState().items).sort()).toEqual(['s1']);
    board.undo();
    expect(Object.keys(getState().items).sort()).toEqual(['c1', 's1', 't1']);
  });
});

describe('регрессии: перемещение содержимого фрейма', () => {
  const items = (): ItemMap => ({
    f: makeFrame('f', 0, 0, 1000, 1000, 1, 'Фрейм'),
    a: makeSticky('a', 100, 100, 2, '#fff'),
    l: { ...makeSticky('l', 400, 100, 3, '#fff'), locked: true },
    c: makeConnector('c', { x: 50, y: 50 }, { x: 300, y: 50 }, 4, { lineStyle: 'straight' }),
    out: makeSticky('out', 2000, 0, 5, '#fff'),
  });

  it('computeMoveSet: фрейм переносит всё содержимое, включая коннекторы и заблокированные объекты', () => {
    const set = computeMoveSet(['f'], items());
    expect([...set.items].sort()).toEqual(['a', 'f', 'l']);
    expect([...set.conns]).toEqual(['c']);
  });

  it('computeMoveSet: выделенный заблокированный объект не двигается', () => {
    const set = computeMoveSet(['l', 'out'], items());
    expect([...set.items]).toEqual(['out']);
  });

  it('стрелки двигают фрейм вместе с содержимым (как перетаскивание)', () => {
    load(items());
    useBoard.setState({ selection: ['f'] });
    nudgeSelection(10, 0);
    const it = getState().items;
    expect(it.f.x).toBe(10);
    expect(it.a.x).toBe(110);
    expect(it.l.x).toBe(410);
    expect((it.c as ConnectorItem).from.x).toBe(60);
    expect(it.out.x).toBe(2000);
  });
});

describe('регрессии: переименование без связи', () => {
  it('отправляется после переподключения и не затирается снимком сервера', () => {
    useBoard.setState({ meta: { id: 'b', name: 'Старое', createdAt: 0, updatedAt: 0 } });
    board.rename('Новое');
    expect(getState().meta?.name).toBe('Новое');
    (board as unknown as { onMessage(m: unknown): void }).onMessage({
      t: 'init',
      meta: { id: 'b', name: 'Старое', createdAt: 0, updatedAt: 0 },
      items: {},
      peers: [],
      clientId: 'c1',
    });
    expect(getState().meta?.name).toBe('Новое');
  });
});

const onMessage = (m: unknown) => (board as unknown as { onMessage(m: unknown): void }).onMessage(m);

describe('итерация 2: клиент', () => {
  it('reset: свежий снимок + неподтверждённые правки, история очищается', () => {
    load({ a: makeSticky('a', 0, 0, 1, '#fff', 'старое') });
    board.apply([{ t: 'update', id: 'a', patch: { x: 500 } }]); // ещё не подтверждено сервером
    expect(getState().canUndo).toBe(true);
    onMessage({ t: 'reset', reason: 'Восстановлено', items: { a: makeSticky('a', 0, 0, 1, '#fff', 'из версии'), b: makeSticky('b', 9, 9, 2, '#fff') } });
    const it = getState().items;
    expect((it.a as StickyItem).text).toBe('из версии');
    expect(it.a.x).toBe(500); // наша правка в пути — сервер применит её после сброса
    expect(it.b).toBeDefined();
    expect(getState().canUndo).toBe(false);
    expect(getState().toast?.text).toBe('Восстановлено');
  });

  it('нельзя начать ввод в объекте, который редактирует другой участник', () => {
    load({ s1: makeSticky('s1', 0, 0, 1, '#fff') });
    useBoard.setState({
      peers: { c2: { clientId: 'c2', id: 'u2', name: 'Борис', color: '#000', cursor: null, selection: [], editing: 's1', view: null } },
    });
    startEditing('s1');
    expect(getState().editingId).toBeNull();
    expect(getState().toast?.text).toBe('Сейчас редактирует Борис');
  });

  it('во время голосования ввод недоступен; завершение открывает итоги', () => {
    load({ s1: makeSticky('s1', 0, 0, 1, '#fff') });
    const voting = { id: 'v', status: 'active', votesPerUser: 3, startedBy: 'A', startedAt: 0, endedAt: null, myVotes: {}, voters: 0, results: null };
    onMessage({ t: 'session', now: Date.now(), session: { timer: null, voting } });
    startEditing('s1');
    expect(getState().editingId).toBeNull();
    onMessage({ t: 'session', now: Date.now(), session: { timer: null, voting: { ...voting, status: 'ended', results: { s1: 2 } } } });
    expect(getState().panel).toBe('results');
  });

  it('выравнивание переносит содержимое фрейма вместе с ним — одним шагом', () => {
    load({
      f: makeFrame('f', 100, 0, 300, 300, 1, 'F'),
      inner: makeSticky('inner', 150, 50, 2, '#fff'),
      s: makeSticky('s', 0, 400, 3, '#fff'),
    });
    useBoard.setState({ selection: ['f', 's'] });
    alignSelection('left');
    const it = getState().items;
    expect(it.f.x).toBe(0);
    expect(it.inner.x).toBe(50);
    expect(it.s.x).toBe(0);
    board.undo();
    expect(getState().items.f.x).toBe(100);
    expect(getState().items.inner.x).toBe(150);
  });

  it('вставка шаблона — новые объекты одним шагом отмены', () => {
    insertTemplate('kanban');
    const n = Object.keys(getState().items).length;
    expect(n).toBeGreaterThan(10);
    board.undo();
    expect(Object.keys(getState().items)).toHaveLength(0);
  });

  it('ссылки: адрес без схемы дополняется https://, опасные отклоняются', () => {
    load({ s1: makeSticky('s1', 0, 0, 1, '#fff') });
    expect(setLink('s1', 'example.com/a')).toBe(true);
    expect(getState().items.s1.link).toBe('https://example.com/a');
    expect(setLink('s1', 'javascript:alert(1)')).toBe(false);
    expect(setLink('s1', 'mailto:a@b.c')).toBe(false);
    expect(setLink('s1', 'localhost:3000/board')).toBe(true); // порт — не схема
    expect(getState().items.s1.link).toBe('https://localhost:3000/board');
    expect(setLink('s1', null)).toBe(true);
    expect(getState().items.s1.link).toBeNull();
  });
});
