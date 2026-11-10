import { describe, expect, it } from 'vitest';
import { makeConnector, makeShape } from '../src/shared/defaults';
import {
  boundsOf,
  connectorGeometry,
  distToPath,
  normalizeRect,
  rectContains,
  rectsIntersect,
  rectUnion,
  sideTowards,
  simplifyPoints,
} from '../src/shared/geometry';
import type { ItemMap } from '../src/shared/types';

describe('прямоугольники', () => {
  it('normalize / union / intersect / contains', () => {
    expect(normalizeRect({ x: 10, y: 10 }, { x: 0, y: 5 })).toEqual({ x: 0, y: 5, w: 10, h: 5 });
    expect(rectUnion([{ x: 0, y: 0, w: 1, h: 1 }, { x: 5, y: -2, w: 1, h: 1 }])).toEqual({ x: 0, y: -2, w: 6, h: 3 });
    expect(rectUnion([])).toBeNull();
    expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
    expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 11, y: 0, w: 10, h: 10 })).toBe(false);
    expect(rectContains({ x: 0, y: 0, w: 10, h: 10 }, { x: 1, y: 1, w: 2, h: 2 })).toBe(true);
    expect(rectContains({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 1, w: 2, h: 2 })).toBe(false);
  });

  it('sideTowards выбирает сторону по направлению', () => {
    const r = { x: 0, y: 0, w: 100, h: 50 };
    expect(sideTowards(r, { x: 500, y: 25 })).toBe('right');
    expect(sideTowards(r, { x: -500, y: 25 })).toBe('left');
    expect(sideTowards(r, { x: 50, y: 400 })).toBe('bottom');
    expect(sideTowards(r, { x: 50, y: -400 })).toBe('top');
  });
});

describe('коннекторы', () => {
  const a = makeShape('a', 'rect', 0, 0, 100, 100, 1);
  const b = makeShape('b', 'rect', 300, 0, 100, 100, 2);
  const items: ItemMap = { a, b };

  it('привязанные концы встают на стороны объектов, обращённые друг к другу', () => {
    const c = makeConnector('c', { itemId: 'a', side: 'auto', x: 0, y: 0 }, { itemId: 'b', side: 'auto', x: 0, y: 0 }, 3, {
      lineStyle: 'straight',
    });
    const g = connectorGeometry(c, items);
    expect(g.start).toEqual({ x: 100, y: 50 });
    expect(g.end).toEqual({ x: 300, y: 50 });
    expect(g.endDir.x).toBeCloseTo(1);
    expect(g.mid).toEqual({ x: 200, y: 50 });
  });

  it('коннектор следует за перемещённым объектом', () => {
    const c = makeConnector('c', { itemId: 'a', side: 'auto', x: 0, y: 0 }, { itemId: 'b', side: 'auto', x: 0, y: 0 }, 3, {
      lineStyle: 'straight',
    });
    const moved: ItemMap = { ...items, b: { ...b, x: 0, y: 400 } };
    const g = connectorGeometry(c, moved);
    expect(g.start).toEqual({ x: 50, y: 100 });
    expect(g.end).toEqual({ x: 50, y: 400 });
  });

  it('ломаная состоит из ортогональных отрезков', () => {
    const c = makeConnector('c', { itemId: 'a', side: 'auto', x: 0, y: 0 }, { x: 600, y: 300 }, 3, { lineStyle: 'elbow' });
    const g = connectorGeometry(c, items);
    for (let i = 1; i < g.points.length; i++) {
      const p = g.points[i - 1];
      const q = g.points[i];
      expect(p.x === q.x || p.y === q.y).toBe(true);
    }
    expect(g.points[0]).toEqual(g.start);
    expect(g.points[g.points.length - 1]).toEqual({ x: 600, y: 300 });
  });

  it('удалённый объект — конец остаётся на запасных координатах', () => {
    const c = makeConnector('c', { itemId: 'gone', side: 'auto', x: 7, y: 8 }, { x: 100, y: 8 }, 3, { lineStyle: 'straight' });
    expect(connectorGeometry(c, items).start).toEqual({ x: 7, y: 8 });
  });

  it('рамка коннектора считается по геометрии', () => {
    const c = makeConnector('c', { x: 0, y: 0 }, { x: 100, y: 50 }, 3, { lineStyle: 'straight', strokeWidth: 2 });
    expect(boundsOf(['c'], { c })).toEqual({ x: -1, y: -1, w: 102, h: 52 });
  });
});

describe('штрихи', () => {
  it('упрощение сохраняет концы и убирает точки на прямой', () => {
    const flat = [0, 0, 1, 0.01, 2, 0, 3, 0.01, 4, 0, 4, 10];
    const out = simplifyPoints(flat, 0.5);
    expect(out.slice(0, 2)).toEqual([0, 0]);
    expect(out.slice(-2)).toEqual([4, 10]);
    expect(out.length).toBe(6);
  });

  it('расстояние до штриха', () => {
    const p = { x: 10, y: 10, points: [0, 0, 100, 0] };
    expect(distToPath({ x: 60, y: 15 }, p)).toBeCloseTo(5);
  });
});
