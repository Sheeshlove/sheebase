import { describe, expect, it } from 'vitest';
import { makeShape, makeSticky } from '../src/shared/defaults';
import { applyOps, compactOps, diffItems, opKeys, uid } from '../src/shared/ops';
import type { ItemMap, Op } from '../src/shared/types';

describe('applyOps', () => {
  it('добавляет, изменяет и удаляет объекты, не мутируя исходную карту', () => {
    const a = makeSticky('a', 0, 0, 1, '#fff');
    const start: ItemMap = {};
    const s1 = applyOps(start, [{ t: 'add', item: a }]);
    expect(start).toEqual({});
    expect(s1.a).toEqual(a);
    const s2 = applyOps(s1, [{ t: 'update', id: 'a', patch: { x: 10, text: 'hi' } }]);
    expect(s2.a).toMatchObject({ x: 10, text: 'hi', color: '#fff' });
    expect(s1.a.x).toBe(0);
    const s3 = applyOps(s2, [{ t: 'delete', id: 'a' }]);
    expect(s3.a).toBeUndefined();
  });

  it('игнорирует update несуществующего объекта', () => {
    expect(applyOps({}, [{ t: 'update', id: 'nope', patch: { x: 1 } }])).toEqual({});
  });
});

describe('compactOps', () => {
  it('сливает подряд идущие update одного объекта', () => {
    const ops: Op[] = [
      { t: 'update', id: 'a', patch: { x: 1 } },
      { t: 'update', id: 'b', patch: { x: 5 } },
      { t: 'update', id: 'a', patch: { x: 2, y: 3 } },
    ];
    expect(compactOps(ops)).toEqual([
      { t: 'update', id: 'a', patch: { x: 2, y: 3 } },
      { t: 'update', id: 'b', patch: { x: 5 } },
    ]);
  });

  it('вливает update в предшествующий add', () => {
    const item = makeSticky('a', 0, 0, 1, '#fff');
    const out = compactOps([
      { t: 'add', item },
      { t: 'update', id: 'a', patch: { text: 'x' } },
    ]);
    expect(out).toEqual([{ t: 'add', item: { ...item, text: 'x' } }]);
  });

  it('add/update + delete → только delete', () => {
    const item = makeSticky('a', 0, 0, 1, '#fff');
    const out = compactOps([
      { t: 'add', item },
      { t: 'update', id: 'a', patch: { text: 'x' } },
      { t: 'delete', id: 'a' },
    ]);
    expect(out).toEqual([{ t: 'delete', id: 'a' }]);
  });

  it('результат применения совпадает с исходной последовательностью', () => {
    const base: ItemMap = { s: makeShape('s', 'rect', 0, 0, 10, 10, 1) };
    const ops: Op[] = [
      { t: 'update', id: 's', patch: { x: 1 } },
      { t: 'add', item: makeSticky('n', 0, 0, 2, '#000') },
      { t: 'update', id: 'n', patch: { text: 'q' } },
      { t: 'update', id: 's', patch: { fill: 'red' } },
      { t: 'delete', id: 's' },
      { t: 'add', item: makeShape('s', 'ellipse', 5, 5, 10, 10, 3) },
      { t: 'update', id: 's', patch: { text: 'again' } },
    ];
    expect(applyOps(base, compactOps(ops))).toEqual(applyOps(base, ops));
  });
});

describe('diffItems / opKeys / uid', () => {
  it('строит прямой и обратный патч, undefined → null', () => {
    const a = { ...makeSticky('a', 0, 0, 1, '#fff'), groupId: 'g1' };
    const b = { ...makeSticky('a', 5, 0, 1, '#fff') };
    const d = diffItems(a, b)!;
    expect(d.forward).toEqual({ x: 5, groupId: null });
    expect(d.backward).toEqual({ x: 0, groupId: 'g1' });
    expect(diffItems(b, { ...b })).toBeNull();
  });

  it('ключи операций', () => {
    expect(opKeys({ t: 'update', id: 'a', patch: { x: 1, y: 2 } })).toEqual(['a.x', 'a.y']);
    expect(opKeys({ t: 'delete', id: 'a' })).toEqual(['a']);
  });

  it('uid уникален и состоит из base62', () => {
    const ids = new Set(Array.from({ length: 2000 }, () => uid()));
    expect(ids.size).toBe(2000);
    for (const id of ids) expect(id).toMatch(/^[0-9A-Za-z]{12}$/);
  });
});
