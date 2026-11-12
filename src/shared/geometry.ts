import type { ConnectorItem, Endpoint, Item, ItemMap, ShapeKind, Side } from './types';

export interface Pt {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function normalizeRect(a: Pt, b: Pt): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

export function rectUnion(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const r of rects) {
    x1 = Math.min(x1, r.x);
    y1 = Math.min(y1, r.y);
    x2 = Math.max(x2, r.x + r.w);
    y2 = Math.max(y2, r.y + r.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

/** Целиком ли `inner` внутри `outer`. */
export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

export function pointInRect(p: Pt, r: Rect, pad = 0): boolean {
  return p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;
}

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = clamp(t, 0, 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export const rectCenter = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

// ---------------- Фигуры ----------------

/** SVG-путь фигуры в локальных координатах (0..w, 0..h). */
export function shapePath(kind: ShapeKind, w: number, h: number): string {
  const f = (n: number) => Math.round(n * 100) / 100;
  const poly = (pts: [number, number][]) => 'M' + pts.map(([x, y]) => `${f(x)},${f(y)}`).join('L') + 'Z';
  switch (kind) {
    case 'rect':
      return poly([[0, 0], [w, 0], [w, h], [0, h]]);
    case 'roundrect': {
      const r = Math.min(w, h) * 0.15;
      return (
        `M${f(r)},0H${f(w - r)}A${f(r)},${f(r)} 0 0 1 ${f(w)},${f(r)}V${f(h - r)}` +
        `A${f(r)},${f(r)} 0 0 1 ${f(w - r)},${f(h)}H${f(r)}A${f(r)},${f(r)} 0 0 1 0,${f(h - r)}` +
        `V${f(r)}A${f(r)},${f(r)} 0 0 1 ${f(r)},0Z`
      );
    }
    case 'ellipse': {
      const rx = w / 2;
      const ry = h / 2;
      return `M0,${f(ry)}A${f(rx)},${f(ry)} 0 1 1 ${f(w)},${f(ry)}A${f(rx)},${f(ry)} 0 1 1 0,${f(ry)}Z`;
    }
    case 'triangle':
      return poly([[w / 2, 0], [w, h], [0, h]]);
    case 'diamond':
      return poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]);
    case 'parallelogram': {
      const o = w * 0.2;
      return poly([[o, 0], [w, 0], [w - o, h], [0, h]]);
    }
    case 'hexagon': {
      const o = w * 0.22;
      return poly([[o, 0], [w - o, 0], [w, h / 2], [w - o, h], [o, h], [0, h / 2]]);
    }
    case 'star': {
      const pts: [number, number][] = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 === 0 ? 0.5 : 0.21;
        pts.push([w / 2 + Math.cos(a) * r * w, h * 0.53 + Math.sin(a) * r * h * 1.05]);
      }
      return poly(pts);
    }
  }
}

/** Область для текста внутри фигуры (локальные координаты). */
export function shapeTextBox(kind: ShapeKind, w: number, h: number): Rect {
  switch (kind) {
    case 'ellipse':
      return { x: w * 0.15, y: h * 0.15, w: w * 0.7, h: h * 0.7 };
    case 'triangle':
      return { x: w * 0.25, y: h * 0.45, w: w * 0.5, h: h * 0.5 };
    case 'diamond':
      return { x: w * 0.25, y: h * 0.25, w: w * 0.5, h: h * 0.5 };
    case 'parallelogram':
      return { x: w * 0.2, y: h * 0.08, w: w * 0.6, h: h * 0.84 };
    case 'hexagon':
      return { x: w * 0.2, y: h * 0.08, w: w * 0.6, h: h * 0.84 };
    case 'star':
      return { x: w * 0.3, y: h * 0.38, w: w * 0.4, h: h * 0.38 };
    default:
      return { x: w * 0.06, y: h * 0.06, w: w * 0.88, h: h * 0.88 };
  }
}

// ---------------- Коннекторы ----------------

export const SIDE_NORMAL: Record<Side, Pt> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

const isHorizontal = (s: Side) => s === 'left' || s === 'right';

/** Точка привязки коннектора на стороне объекта. */
export function anchorPoint(item: Item, side: Side): Pt {
  const { x, y, w, h } = item;
  if (item.type === 'shape' && item.shape === 'triangle') {
    switch (side) {
      case 'top':
        return { x: x + w / 2, y };
      case 'bottom':
        return { x: x + w / 2, y: y + h };
      case 'left':
        return { x: x + w / 4, y: y + h / 2 };
      case 'right':
        return { x: x + (3 * w) / 4, y: y + h / 2 };
    }
  }
  switch (side) {
    case 'top':
      return { x: x + w / 2, y };
    case 'bottom':
      return { x: x + w / 2, y: y + h };
    case 'left':
      return { x, y: y + h / 2 };
    case 'right':
      return { x: x + w, y: y + h / 2 };
  }
}

/** Сторона прямоугольника, обращённая к точке. */
export function sideTowards(r: Rect, p: Pt): Side {
  const c = rectCenter(r);
  const dx = (p.x - c.x) / Math.max(r.w, 1);
  const dy = (p.y - c.y) / Math.max(r.h, 1);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

/** Направление «наружу» для свободного конца — в сторону другого конца. */
function freeSide(p: Pt, other: Pt): Side {
  const dx = other.x - p.x;
  const dy = other.y - p.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

function attachedItem(ep: Endpoint, items: ItemMap): Item | undefined {
  if (!ep.itemId) return undefined;
  const it = items[ep.itemId];
  if (!it || it.type === 'connector') return undefined;
  return it;
}

export interface ResolvedEnd {
  pt: Pt;
  side: Side;
  attached: boolean;
}

export function resolveEnds(conn: Pick<ConnectorItem, 'from' | 'to'>, items: ItemMap): [ResolvedEnd, ResolvedEnd] {
  const a = attachedItem(conn.from, items);
  const b = attachedItem(conn.to, items);
  const refA = a ? rectCenter(a) : { x: conn.from.x, y: conn.from.y };
  const refB = b ? rectCenter(b) : { x: conn.to.x, y: conn.to.y };
  const resolve = (ep: Endpoint, it: Item | undefined, other: Pt, ref: Pt): ResolvedEnd => {
    if (!it) return { pt: ref, side: freeSide(ref, other), attached: false };
    const side = ep.side && ep.side !== 'auto' ? ep.side : sideTowards(it, other);
    return { pt: anchorPoint(it, side), side, attached: true };
  };
  return [resolve(conn.from, a, refB, refA), resolve(conn.to, b, refA, refB)];
}

export type ConnectorGeometry =
  | { kind: 'poly'; points: Pt[]; start: Pt; end: Pt; startDir: Pt; endDir: Pt; mid: Pt }
  | { kind: 'bezier'; points: Pt[]; start: Pt; end: Pt; startDir: Pt; endDir: Pt; mid: Pt };

function unit(dx: number, dy: number): Pt {
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

function simplifyPolyline(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
    out.push(p);
  }
  // убираем точки на одной прямой
  for (let i = out.length - 2; i >= 1; i--) {
    const a = out[i - 1];
    const b = out[i];
    const c = out[i + 1];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 0.01) out.splice(i, 1);
  }
  return out;
}

function elbowPoints(s: Pt, ss: Side, e: Pt, es: Side): Pt[] {
  const G = 24;
  const ns = SIDE_NORMAL[ss];
  const ne = SIDE_NORMAL[es];
  const a = { x: s.x + ns.x * G, y: s.y + ns.y * G };
  const b = { x: e.x + ne.x * G, y: e.y + ne.y * G };
  let mid: Pt[];
  if (isHorizontal(ss) && isHorizontal(es)) {
    const forward = (b.x - a.x) * ns.x >= 0;
    if (forward) {
      const mx = (a.x + b.x) / 2;
      mid = [{ x: mx, y: a.y }, { x: mx, y: b.y }];
    } else {
      const my = (a.y + b.y) / 2;
      mid = [{ x: a.x, y: my }, { x: b.x, y: my }];
    }
  } else if (!isHorizontal(ss) && !isHorizontal(es)) {
    const forward = (b.y - a.y) * ns.y >= 0;
    if (forward) {
      const my = (a.y + b.y) / 2;
      mid = [{ x: a.x, y: my }, { x: b.x, y: my }];
    } else {
      const mx = (a.x + b.x) / 2;
      mid = [{ x: mx, y: a.y }, { x: mx, y: b.y }];
    }
  } else if (isHorizontal(ss)) {
    mid = [{ x: b.x, y: a.y }];
  } else {
    mid = [{ x: a.x, y: b.y }];
  }
  return simplifyPolyline([s, a, ...mid, b, e]);
}

function polylineMid(pts: Pt[]): Pt {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  let half = total / 2;
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (half <= seg && seg > 0) {
      const t = half / seg;
      return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t };
    }
    half -= seg;
  }
  return pts[0];
}

/** Полная геометрия коннектора: линия, направления стрелок, середина для подписи. */
export function connectorGeometry(conn: ConnectorItem, items: ItemMap): ConnectorGeometry {
  const [A, B] = resolveEnds(conn, items);
  const s = A.pt;
  const e = B.pt;
  if (conn.lineStyle === 'curved') {
    const dist = Math.hypot(e.x - s.x, e.y - s.y);
    const k = clamp(dist * 0.4, 30, 220);
    const ns = SIDE_NORMAL[A.side];
    const ne = SIDE_NORMAL[B.side];
    const c1 = { x: s.x + ns.x * k, y: s.y + ns.y * k };
    const c2 = { x: e.x + ne.x * k, y: e.y + ne.y * k };
    const mid = {
      x: 0.125 * s.x + 0.375 * c1.x + 0.375 * c2.x + 0.125 * e.x,
      y: 0.125 * s.y + 0.375 * c1.y + 0.375 * c2.y + 0.125 * e.y,
    };
    return {
      kind: 'bezier',
      points: [s, c1, c2, e],
      start: s,
      end: e,
      startDir: unit(s.x - c1.x, s.y - c1.y),
      endDir: unit(e.x - c2.x, e.y - c2.y),
      mid,
    };
  }
  const points = conn.lineStyle === 'elbow' ? elbowPoints(s, A.side, e, B.side) : [s, e];
  const n = points.length;
  const p1 = points[1] ?? e;
  const pn = points[n - 2] ?? s;
  return {
    kind: 'poly',
    points,
    start: s,
    end: e,
    startDir: unit(s.x - p1.x, s.y - p1.y),
    endDir: unit(e.x - pn.x, e.y - pn.y),
    mid: polylineMid(points),
  };
}

export function geometryPath(g: ConnectorGeometry): string {
  const f = (n: number) => Math.round(n * 100) / 100;
  if (g.kind === 'bezier') {
    const [s, c1, c2, e] = g.points;
    return `M${f(s.x)},${f(s.y)}C${f(c1.x)},${f(c1.y)} ${f(c2.x)},${f(c2.y)} ${f(e.x)},${f(e.y)}`;
  }
  return 'M' + g.points.map((p) => `${f(p.x)},${f(p.y)}`).join('L');
}

/** Треугольник стрелки на конце `tip`, направленный по `dir`. */
export function arrowHeadPath(tip: Pt, dir: Pt, strokeWidth: number): string {
  const len = 8 + strokeWidth * 2.5;
  const half = len * 0.5;
  const bx = tip.x - dir.x * len;
  const by = tip.y - dir.y * len;
  const px = -dir.y;
  const py = dir.x;
  const f = (n: number) => Math.round(n * 100) / 100;
  return `M${f(tip.x)},${f(tip.y)}L${f(bx + px * half)},${f(by + py * half)}L${f(bx - px * half)},${f(by - py * half)}Z`;
}

/**
 * Стрелка-«галочка» на конце `tip`: два штриха под 40° к линии, как стрелки в иконках ШИБЕЙС.
 * Рисуется обводкой той же толщины со скруглёнными концами, без заливки.
 */
export function arrowChevronPath(tip: Pt, dir: Pt, strokeWidth: number): string {
  const len = 5 + strokeWidth * 2.2;
  const a = (40 * Math.PI) / 180;
  const bx = -dir.x;
  const by = -dir.y;
  const rot = (sign: number): Pt => ({
    x: tip.x + (bx * Math.cos(a) - sign * by * Math.sin(a)) * len,
    y: tip.y + (sign * bx * Math.sin(a) + by * Math.cos(a)) * len,
  });
  const p1 = rot(1);
  const p2 = rot(-1);
  const f = (n: number) => Math.round(n * 100) / 100;
  return `M${f(p1.x)},${f(p1.y)}L${f(tip.x)},${f(tip.y)}L${f(p2.x)},${f(p2.y)}`;
}

/** Рамка объекта (для коннектора — вычисляется по геометрии). */
export function itemBounds(item: Item, items: ItemMap): Rect {
  if (item.type === 'connector') {
    const g = connectorGeometry(item, items);
    const pad = item.strokeWidth / 2;
    const xs = g.points.map((p) => p.x);
    const ys = g.points.map((p) => p.y);
    const x = Math.min(...xs) - pad;
    const y = Math.min(...ys) - pad;
    return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y };
  }
  return { x: item.x, y: item.y, w: item.w, h: item.h };
}

/**
 * Содержимое фрейма: все объекты (кроме самого фрейма), рамка которых целиком
 * лежит внутри него, — включая вложенные фреймы, их содержимое и коннекторы.
 * Единое правило для перемещения, копирования и экспорта.
 */
export function frameChildren(frame: Item, items: ItemMap): string[] {
  const out: string[] = [];
  for (const id in items) {
    if (id === frame.id) continue;
    if (rectContains(frame, itemBounds(items[id], items))) out.push(id);
  }
  return out;
}

export function boundsOf(ids: readonly string[], items: ItemMap): Rect | null {
  const rects: Rect[] = [];
  for (const id of ids) {
    const it = items[id];
    if (it) rects.push(itemBounds(it, items));
  }
  return rectUnion(rects);
}

/** Расстояние от точки до штриха пера. */
export function distToPath(p: Pt, item: { x: number; y: number; points: number[] }): number {
  const pts = item.points;
  if (pts.length < 2) return Infinity;
  if (pts.length < 4) return Math.hypot(p.x - item.x - pts[0], p.y - item.y - pts[1]);
  let best = Infinity;
  for (let i = 2; i < pts.length; i += 2) {
    const a = { x: item.x + pts[i - 2], y: item.y + pts[i - 1] };
    const b = { x: item.x + pts[i], y: item.y + pts[i + 1] };
    best = Math.min(best, distToSegment(p, a, b));
  }
  return best;
}

/** Упрощение ломаной (алгоритм Рамера — Дугласа — Пекера). Вход и выход — плоские массивы. */
export function simplifyPoints(flat: number[], epsilon: number): number[] {
  const n = flat.length / 2;
  if (n <= 2) return flat.slice();
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    const a = { x: flat[s * 2], y: flat[s * 2 + 1] };
    const b = { x: flat[e * 2], y: flat[e * 2 + 1] };
    for (let i = s + 1; i < e; i++) {
      const d = distToSegment({ x: flat[i * 2], y: flat[i * 2 + 1] }, a, b);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > epsilon) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(flat[i * 2], flat[i * 2 + 1]);
  return out;
}

/** Сглаженный SVG-путь через точки (квадратичные кривые через середины отрезков). */
export function smoothPath(flat: number[]): string {
  const f = (n: number) => Math.round(n * 100) / 100;
  const n = flat.length / 2;
  if (n === 0) return '';
  if (n === 1) return `M${f(flat[0])},${f(flat[1])}l0.01,0`;
  if (n === 2) return `M${f(flat[0])},${f(flat[1])}L${f(flat[2])},${f(flat[3])}`;
  let d = `M${f(flat[0])},${f(flat[1])}`;
  for (let i = 1; i < n - 1; i++) {
    const x = flat[i * 2];
    const y = flat[i * 2 + 1];
    const mx = (x + flat[i * 2 + 2]) / 2;
    const my = (y + flat[i * 2 + 3]) / 2;
    d += `Q${f(x)},${f(y)} ${f(mx)},${f(my)}`;
  }
  d += `L${f(flat[(n - 1) * 2])},${f(flat[(n - 1) * 2 + 1])}`;
  return d;
}
