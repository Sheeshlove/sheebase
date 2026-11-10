import { beforeEach, describe, expect, it } from 'vitest';
import { cloneItems } from '../src/client/board/actions';
import { board } from '../src/client/board/controller';
import { snapMove } from '../src/client/board/interactions';
import { getState, initialBoardState, useBoard } from '../src/client/board/store';
import { makeConnector, makeShape, makeSticky } from '../src/shared/defaults';
import type { ConnectorItem } from '../src/shared/types';

beforeEach(() => {
  useBoard.setState(initialBoardState(), true);
  // сбрасываем историю контроллера (без сетевого подключения)
  while (getState().canUndo) board.undo();
  useBoard.setState(initialBoardState(), true);
});

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
