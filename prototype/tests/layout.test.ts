import { describe, expect, it } from 'vitest';
import { makeConnector, makeFrame, makeShape, makeSticky, makeText } from '../src/shared/defaults';
import { alignDeltas, distributeDeltas, frameOrder, readingOrder, searchItems } from '../src/shared/layout';
import { renderThumbnailSvg } from '../src/shared/thumbnail';
import type { ItemMap } from '../src/shared/types';

describe('поиск по доске', () => {
  const items: ItemMap = {
    a: makeSticky('a', 500, 0, 1, '#fff', 'Ёжик в тумане'),
    b: makeSticky('b', 0, 0, 2, '#fff', 'ежевика'),
    c: makeShape('c', 'rect', 0, 400, 100, 100, 3, { text: 'Нет совпадений' }),
    d: makeFrame('d', 0, 800, 300, 300, 4, 'Ежедневные задачи'),
    e: makeConnector('e', { x: 0, y: 0 }, { x: 10, y: 10 }, 5, { label: 'ЕЖ' }),
    f: makeText('f', 900, 900, 6, 'Текст'),
  };

  it('без учёта регистра и с ё = е, в порядке чтения', () => {
    expect(searchItems(items, 'еж')).toEqual(['e', 'b', 'a', 'd']);
    expect(searchItems(items, 'ЁЖИК')).toEqual(['a']);
    expect(searchItems(items, '  ')).toEqual([]);
    expect(searchItems(items, 'нечто')).toEqual([]);
  });
});

describe('порядок чтения и фреймов', () => {
  it('строки сверху вниз, внутри строки — слева направо (с небольшим разбросом по высоте)', () => {
    const r = (x: number, y: number) => ({ x, y, w: 100, h: 100 });
    expect(
      readingOrder([
        { id: 'row2-left', r: r(0, 300) },
        { id: 'row1-right', r: r(400, 10) },
        { id: 'row1-left', r: r(0, 0) },
        { id: 'row2-right', r: r(400, 290) },
      ]),
    ).toEqual(['row1-left', 'row1-right', 'row2-left', 'row2-right']);
  });

  it('frameOrder учитывает только фреймы', () => {
    const items: ItemMap = {
      f2: makeFrame('f2', 800, 0, 700, 900, 1, 'Второй'),
      f1: makeFrame('f1', 0, 0, 700, 900, 2, 'Первый'),
      f3: makeFrame('f3', 0, 1000, 700, 900, 3, 'Третий'),
      s: makeSticky('s', -500, -500, 4, '#fff'),
    };
    expect(frameOrder(items)).toEqual(['f1', 'f2', 'f3']);
  });
});

describe('выравнивание и распределение', () => {
  const items: ItemMap = {
    a: makeSticky('a', 0, 0, 1, '#fff'),
    b: makeShape('b', 'rect', 300, 50, 100, 300, 2),
    c: { ...makeSticky('c', 900, 500, 3, '#fff'), locked: true },
    d: makeSticky('d', 1000, 20, 4, '#fff'),
    k: makeConnector('k', { x: 0, y: 0 }, { x: 10, y: 10 }, 5),
  };

  it('по левому краю, по центру, по низу; заблокированные и коннекторы не участвуют', () => {
    expect(Object.fromEntries(alignDeltas(items, ['a', 'b', 'c', 'k'], 'left'))).toEqual({ b: { dx: -300, dy: 0 } });
    expect(Object.fromEntries(alignDeltas(items, ['a', 'b'], 'hcenter'))).toEqual({ a: { dx: 100, dy: 0 }, b: { dx: -150, dy: 0 } }); // центр общей рамки 0..400 — 200
    expect(Object.fromEntries(alignDeltas(items, ['a', 'b'], 'bottom'))).toEqual({ a: { dx: 0, dy: 150 } });
    expect(alignDeltas(items, ['a'], 'left').size).toBe(0);
  });

  it('распределение: крайние на месте, промежутки равны', () => {
    // a: 0..200, b: 300..400, d: 1000..1200 → свободно 1200 − 500 = 700, промежуток 350
    const d = distributeDeltas(items, ['d', 'a', 'b'], 'x');
    expect(Object.fromEntries(d)).toEqual({ b: { dx: 250, dy: 0 } });
    expect(distributeDeltas(items, ['a', 'b'], 'x').size).toBe(0);
  });
});

describe('миниатюра', () => {
  it('пустая доска и экранирование значений', () => {
    expect(renderThumbnailSvg({})).toContain('<svg');
    const evil = { ...makeSticky('s', 0, 0, 1, '#fff', 'x'), color: '"/><script>alert(1)</script>' };
    const svg = renderThumbnailSvg({ s: evil });
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&quot;/&gt;&lt;script&gt;');
  });
});
