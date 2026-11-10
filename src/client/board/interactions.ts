import { makeConnector, makePath } from '../../shared/defaults';
import {
  boundsOf,
  distToPath,
  itemBounds,
  normalizeRect,
  type Pt,
  pointInRect,
  type Rect,
  rectContains,
  rectsIntersect,
  simplifyPoints,
} from '../../shared/geometry';
import { uid } from '../../shared/ops';
import type { ConnectorItem, Endpoint, Item, ItemMap, ItemPatch, Op, Side } from '../../shared/types';
import {
  canEditText,
  computeMoveSet,
  createAndEdit,
  createFrame,
  createShape,
  createSticky,
  createText,
  expandGroups,
  insertImageFile,
  type MoveSet,
  moveOps,
  nextZ,
  quickCreate,
  setSelection,
  setTool,
  startComment,
  startEditing,
  stopEditing,
  VOTABLE_TYPES,
} from './actions';
import { board } from './controller';
import { type Camera, getState, type Guide, screenToWorld, setState, votingActive } from './store';
import { textBlockHeight } from './text';

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

type Mode =
  | { kind: 'none' }
  | { kind: 'pan'; sx: number; sy: number; cam: Camera }
  | { kind: 'pinch'; dist: number; mid: Pt; cam: Camera }
  | { kind: 'marquee'; start: Pt; sx: number; sy: number; additive: boolean; base: string[]; frameId: string | null; moved: boolean }
  | {
      kind: 'move';
      start: Pt;
      sx: number;
      sy: number;
      pressedId: string;
      wasSelected: boolean;
      shift: boolean;
      started: boolean;
      /** Что сдвигается и исходное состояние доски на момент начала перетаскивания. */
      set: MoveSet | null;
      base: ItemMap | null;
      box: Rect | null;
      candidates: Rect[];
    }
  | { kind: 'resize'; handle: Handle; start: Pt; box: Rect; orig: Item[]; keepAspect: boolean; single: boolean; textWidthOnly: boolean }
  | { kind: 'create'; type: 'shape' | 'frame'; start: Pt; sx: number; sy: number; id: string | null }
  | { kind: 'connect'; source: Endpoint; sourceId: string | null; dotSide: Side | null; sx: number; sy: number; id: string | null }
  | { kind: 'endpoint'; id: string; end: 'from' | 'to' }
  | { kind: 'draw'; points: number[] }
  | { kind: 'erase'; erased: Set<string> };

const DRAG_THRESHOLD = 4;
const SNAP_PX = 6;

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Обработка указателя на холсте — конечный автомат режимов взаимодействия. */
export class Interactions {
  mode: Mode = { kind: 'none' };
  private pointers = new Map<number, Pt>();

  constructor(private readonly el: HTMLElement) {}

  private local(e: { clientX: number; clientY: number }): Pt {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private world(e: { clientX: number; clientY: number }): Pt {
    return screenToWorld(getState().camera, this.local(e));
  }

  get active() {
    return this.mode.kind !== 'none';
  }

  // ------------------------------------------------------------------ pointerdown

  pointerDown(e: PointerEvent) {
    if (e.button === 2) return;
    const target = e.target as Element;
    if (target.closest('[data-editor]')) return;
    // в режиме презентации холст не редактируется
    if (getState().presenting) return;
    if (getState().contextMenu) setState({ contextMenu: null });
    // поля ввода вне холста (имя доски и т. п.) теряют фокус, т.к. mousedown по холсту отменён
    const ae = document.activeElement as HTMLElement | null;
    if (ae && ae !== document.body && !ae.closest('[data-editor]')) ae.blur();
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      /* указатель уже отпущен */
    }

    if (this.pointers.size === 2) {
      this.cancel();
      const [a, b] = [...this.pointers.values()];
      this.mode = {
        kind: 'pinch',
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        mid: this.local({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 }),
        cam: getState().camera,
      };
      return;
    }
    if (this.pointers.size > 2 || this.active) return;

    const st = getState();
    if (st.editingId) stopEditing();
    const p = this.local(e);
    const w = screenToWorld(st.camera, p);

    if (e.button === 1 || st.tool === 'hand' || st.spacePan) {
      this.mode = { kind: 'pan', sx: e.clientX, sy: e.clientY, cam: st.camera };
      setState({ panning: true });
      return;
    }

    // Режим голосования: клик по объекту — голос (Alt — снять), перетаскивание — сдвиг вида
    if (votingActive(st)) {
      const el = target.closest<HTMLElement>('[data-id]');
      const item = el && !el.dataset.frameBody ? st.items[el.dataset.id!] : undefined;
      if (item && VOTABLE_TYPES.has(item.type)) {
        board.vote(item.id, e.altKey ? -1 : 1);
        return;
      }
      this.mode = { kind: 'pan', sx: e.clientX, sy: e.clientY, cam: st.camera };
      setState({ panning: true });
      return;
    }

    const handleEl = target.closest<HTMLElement>('[data-handle]');
    if (handleEl) {
      this.startHandle(handleEl.dataset.handle!, handleEl.dataset.target ?? '', w, e);
      return;
    }

    switch (st.tool) {
      case 'select': {
        const el = target.closest<HTMLElement>('[data-id]');
        const id = el?.dataset.id;
        const item = id ? st.items[id] : undefined;
        if (item && !el!.dataset.frameBody) {
          const group = expandGroups([item.id]);
          const wasSelected = st.selection.includes(item.id);
          if (e.shiftKey && wasSelected) {
            setSelection(st.selection.filter((x) => !group.includes(x)));
            return;
          }
          if (e.shiftKey) setSelection([...st.selection, ...group]);
          else if (!wasSelected) setSelection(group);
          this.mode = {
            kind: 'move',
            start: w,
            sx: e.clientX,
            sy: e.clientY,
            pressedId: item.id,
            wasSelected,
            shift: e.shiftKey,
            started: false,
            set: null,
            base: null,
            box: null,
            candidates: [],
          };
        } else {
          this.mode = {
            kind: 'marquee',
            start: w,
            sx: e.clientX,
            sy: e.clientY,
            additive: e.shiftKey,
            base: e.shiftKey ? st.selection : [],
            frameId: item ? item.id : null,
            moved: false,
          };
        }
        return;
      }
      case 'sticky':
        setState({ tool: 'select' });
        createAndEdit(() => createSticky(w));
        return;
      case 'text':
        setState({ tool: 'select' });
        createAndEdit(() => createText(w));
        return;
      case 'shape':
      case 'frame':
        this.mode = { kind: 'create', type: st.tool, start: w, sx: e.clientX, sy: e.clientY, id: null };
        return;
      case 'connector': {
        const hit = this.hitTarget(w, new Set());
        this.mode = {
          kind: 'connect',
          source: hit ? { itemId: hit.id, side: 'auto', x: w.x, y: w.y } : { x: r2(w.x), y: r2(w.y), itemId: null, side: null },
          sourceId: hit?.id ?? null,
          dotSide: null,
          sx: e.clientX,
          sy: e.clientY,
          id: null,
        };
        return;
      }
      case 'comment': {
        // у инструментов, кроме «Выбора», объекты не получают событий — ищем объект геометрически
        startComment(w, this.itemAt(w)?.id ?? null);
        setState({ tool: 'select' });
        return;
      }
      case 'pen':
        this.mode = { kind: 'draw', points: [r2(w.x), r2(w.y)] };
        setState({ draft: { points: [w.x, w.y], color: st.penColor, width: st.penWidth } });
        return;
      case 'eraser':
        board.begin();
        this.mode = { kind: 'erase', erased: new Set() };
        this.eraseAt(w);
        return;
      default:
        return;
    }
  }

  private startHandle(handle: string, targetId: string, w: Pt, e: PointerEvent) {
    const st = getState();
    if (handle === 'ep-from' || handle === 'ep-to') {
      board.begin();
      this.mode = { kind: 'endpoint', id: targetId, end: handle === 'ep-from' ? 'from' : 'to' };
      setState({ interaction: 'endpoint' });
      return;
    }
    if (handle.startsWith('dot-')) {
      const src = st.items[targetId];
      if (!src) return;
      this.mode = {
        kind: 'connect',
        source: { itemId: src.id, side: 'auto', x: src.x, y: src.y },
        sourceId: src.id,
        dotSide: handle.slice(4) as Side,
        sx: e.clientX,
        sy: e.clientY,
        id: null,
      };
      return;
    }
    // маркер изменения размера
    const sel = st.selection.map((id) => st.items[id]).filter((x): x is Item => !!x && !x.locked);
    if (!sel.length) return;
    const box = boundsOf(
      sel.filter((i) => i.type !== 'connector').map((i) => i.id),
      st.items,
    ) ?? boundsOf(sel.map((i) => i.id), st.items);
    if (!box) return;
    const single = sel.length === 1;
    const only = sel[0];
    const corner = handle.length === 2;
    const keepAspect =
      !single || (corner && (only.type === 'sticky' || only.type === 'image' || only.type === 'text'));
    board.begin();
    this.mode = {
      kind: 'resize',
      handle: handle as Handle,
      start: w,
      box: { x: box.x, y: box.y, w: Math.max(box.w, 1), h: Math.max(box.h, 1) },
      orig: sel.map((i) => structuredClone(i)),
      keepAspect,
      single,
      textWidthOnly: single && only.type === 'text' && !corner,
    };
    setState({ interaction: 'resize' });
  }

  // ------------------------------------------------------------------ pointermove

  pointerMove(e: PointerEvent) {
    const st = getState();
    const p = this.local(e);
    const w = screenToWorld(st.camera, p);
    board.pointer = w;
    board.sendCursor(w);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const m = this.mode;
    const far = (sx: number, sy: number) => Math.hypot(e.clientX - sx, e.clientY - sy) >= DRAG_THRESHOLD;

    switch (m.kind) {
      case 'none':
        if (st.tool === 'eraser') setState({ eraser: w });
        return;
      case 'pan':
        board.setCamera({ ...m.cam, x: m.cam.x + e.clientX - m.sx, y: m.cam.y + e.clientY - m.sy });
        return;
      case 'pinch': {
        if (this.pointers.size < 2) return;
        const [a, b] = [...this.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = this.local({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
        const zoom = Math.min(4, Math.max(0.1, m.cam.zoom * (dist / Math.max(1, m.dist))));
        const k = zoom / m.cam.zoom;
        board.setCamera({ x: mid.x - (m.mid.x - m.cam.x) * k, y: mid.y - (m.mid.y - m.cam.y) * k, zoom });
        return;
      }
      case 'marquee': {
        if (!m.moved && !far(m.sx, m.sy)) return;
        m.moved = true;
        const rect = normalizeRect(m.start, w);
        const hits = this.itemsInRect(rect, st.items);
        setState({ marquee: rect, selection: [...new Set([...m.base, ...expandGroups(hits)])] });
        return;
      }
      case 'move':
        if (!m.started) {
          if (!far(m.sx, m.sy)) return;
          this.beginMove(m);
        }
        this.doMove(m, w, e.altKey);
        return;
      case 'resize':
        this.doResize(m, w, e.shiftKey);
        return;
      case 'create': {
        if (!m.id && !far(m.sx, m.sy)) return;
        let r = normalizeRect(m.start, w);
        if (e.shiftKey) {
          const s = Math.max(r.w, r.h);
          r = { x: w.x < m.start.x ? m.start.x - s : m.start.x, y: w.y < m.start.y ? m.start.y - s : m.start.y, w: s, h: s };
        }
        r = { x: r2(r.x), y: r2(r.y), w: Math.max(8, r2(r.w)), h: Math.max(8, r2(r.h)) };
        if (!m.id) {
          board.begin();
          m.id = m.type === 'shape' ? createShape(st.shapeKind, r.x, r.y, r.w, r.h) : createFrame(r.x, r.y, r.w, r.h);
          setState({ interaction: 'create' });
        } else {
          board.apply([{ t: 'update', id: m.id, patch: r }]);
        }
        return;
      }
      case 'connect': {
        if (!m.id) {
          if (!far(m.sx, m.sy)) return;
          board.begin();
          const id = uid();
          const conn = makeConnector(id, m.source, { x: r2(w.x), y: r2(w.y), itemId: null, side: null }, nextZ(), {
            lineStyle: st.connectorStyle,
          });
          board.apply([{ t: 'add', item: conn }]);
          m.id = id;
          setState({ interaction: 'connect', selection: [] });
        }
        const exclude = new Set([m.id]);
        const target = this.hitTarget(w, exclude);
        const to: Endpoint = target
          ? { itemId: target.id, side: 'auto', x: r2(w.x), y: r2(w.y) }
          : { x: r2(w.x), y: r2(w.y), itemId: null, side: null };
        board.apply([{ t: 'update', id: m.id, patch: { to } }]);
        setState({ hoverTarget: target?.id ?? null });
        return;
      }
      case 'endpoint': {
        const conn = st.items[m.id];
        if (!conn || conn.type !== 'connector') return;
        const target = this.hitTarget(w, new Set([m.id]));
        const ep: Endpoint = target
          ? { itemId: target.id, side: 'auto', x: r2(w.x), y: r2(w.y) }
          : { x: r2(w.x), y: r2(w.y), itemId: null, side: null };
        board.apply([{ t: 'update', id: m.id, patch: { [m.end]: ep } }]);
        setState({ hoverTarget: target?.id ?? null });
        return;
      }
      case 'draw': {
        const n = m.points.length;
        const lx = m.points[n - 2];
        const ly = m.points[n - 1];
        if (Math.hypot(w.x - lx, w.y - ly) * st.camera.zoom < 1.5) return;
        m.points.push(r2(w.x), r2(w.y));
        setState({ draft: { points: m.points.slice(), color: st.penColor, width: st.penWidth } });
        return;
      }
      case 'erase':
        setState({ eraser: w });
        this.eraseAt(w);
        return;
    }
  }

  // ------------------------------------------------------------------ pointerup

  pointerUp(e: PointerEvent) {
    this.pointers.delete(e.pointerId);
    try {
      this.el.releasePointerCapture(e.pointerId);
    } catch {
      /* уже отпущен */
    }
    const m = this.mode;
    if (m.kind === 'pinch') {
      if (this.pointers.size < 2) this.mode = { kind: 'none' };
      return;
    }
    const st = getState();
    this.mode = { kind: 'none' };
    switch (m.kind) {
      case 'pan':
        setState({ panning: false });
        break;
      case 'marquee':
        if (!m.moved) {
          if (m.frameId) setSelection(expandGroups([m.frameId]));
          else if (!m.additive) setSelection([]);
        }
        setState({ marquee: null });
        break;
      case 'move':
        if (m.started) {
          board.commit();
          setState({ guides: [], interaction: null });
        } else if (!m.shift && m.wasSelected) {
          const group = expandGroups([m.pressedId]);
          if (st.selection.length > group.length) setSelection(group);
        }
        break;
      case 'resize':
        board.commit();
        setState({ interaction: null });
        break;
      case 'create': {
        setState({ tool: 'select', interaction: null });
        if (!m.id) {
          if (m.type === 'shape') {
            createAndEdit(() => createShape(st.shapeKind, r2(m.start.x - 100), r2(m.start.y - 100), 200, 200));
          } else {
            createFrame(r2(m.start.x - 400), r2(m.start.y - 300), 800, 600);
          }
        } else {
          // создание протягиванием и ввод текста — один шаг истории
          setSelection([m.id]);
          if (m.type === 'shape') startEditing(m.id);
          board.commit();
        }
        break;
      }
      case 'connect': {
        if (!m.id) {
          if (m.dotSide && m.sourceId) quickCreate(m.sourceId, m.dotSide);
          break;
        }
        const conn = getState().items[m.id] as ConnectorItem | undefined;
        if (conn && !conn.to.itemId) {
          const len = Math.hypot(conn.to.x - m.source.x, conn.to.y - m.source.y);
          if (!m.sourceId && len < 10) board.apply([{ t: 'delete', id: m.id }]);
        }
        board.commit();
        setState({ hoverTarget: null, interaction: null, tool: 'select' });
        if (getState().items[m.id]) setSelection([m.id]);
        break;
      }
      case 'endpoint':
        board.commit();
        setState({ hoverTarget: null, interaction: null });
        break;
      case 'draw': {
        setState({ draft: null });
        if (m.points.length < 2) break;
        const pts = m.points.length >= 4 ? simplifyPoints(m.points, 0.6 / st.camera.zoom) : [...m.points, m.points[0] + 0.01, m.points[1]];
        let x1 = Infinity;
        let y1 = Infinity;
        let x2 = -Infinity;
        let y2 = -Infinity;
        for (let i = 0; i < pts.length; i += 2) {
          x1 = Math.min(x1, pts[i]);
          x2 = Math.max(x2, pts[i]);
          y1 = Math.min(y1, pts[i + 1]);
          y2 = Math.max(y2, pts[i + 1]);
        }
        const rel = pts.map((v, i) => r2(i % 2 === 0 ? v - x1 : v - y1));
        board.apply([
          { t: 'add', item: makePath(uid(), r2(x1), r2(y1), r2(x2 - x1), r2(y2 - y1), nextZ(), rel, st.penColor, st.penWidth) },
        ]);
        break;
      }
      case 'erase':
        board.commit();
        break;
      default:
        break;
    }
  }

  /**
   * Браузер прервал жест (pointercancel: перехват прокрутки, системный жест, отказ от касания ладонью) —
   * незавершённое действие откатывается, а не фиксируется.
   */
  pointerCancel(e: PointerEvent) {
    this.pointers.delete(e.pointerId);
    try {
      this.el.releasePointerCapture(e.pointerId);
    } catch {
      /* уже отпущен */
    }
    if (this.mode.kind === 'pinch' && this.pointers.size >= 2) return;
    this.cancel();
  }

  /** Прервать текущее действие и откатить его изменения (Esc). */
  cancel() {
    const m = this.mode;
    this.mode = { kind: 'none' };
    if (['move', 'resize', 'create', 'connect', 'endpoint', 'erase'].includes(m.kind) && board.inTransaction) board.rollback();
    setState({ marquee: null, guides: [], draft: null, hoverTarget: null, interaction: null, panning: false });
  }

  // ------------------------------------------------------------------ перемещение

  private beginMove(m: Extract<Mode, { kind: 'move' }>) {
    const st = getState();
    const items = st.items;
    const set = computeMoveSet(st.selection, items);
    // нечего двигать (например, всё выделенное заблокировано)
    if (moveOps(set, items, 0, 0).length === 0) {
      this.mode = { kind: 'none' };
      return;
    }
    m.started = true;
    m.set = set;
    m.base = items;
    m.box = boundsOf([...set.items], items);
    // кандидаты для привязки — видимые неподвижные объекты
    const vp = this.viewRect();
    m.candidates = [];
    for (const id in items) {
      const it = items[id];
      if (set.items.has(id) || set.conns.has(id) || it.type === 'connector') continue;
      const b = itemBounds(it, items);
      if (rectsIntersect(b, vp)) m.candidates.push(b);
      if (m.candidates.length > 400) break;
    }
    board.begin();
    setState({ interaction: 'move' });
  }

  private viewRect(): Rect {
    const { camera, viewport } = getState();
    const a = screenToWorld(camera, { x: 0, y: 0 });
    return { x: a.x, y: a.y, w: viewport.w / camera.zoom, h: viewport.h / camera.zoom };
  }

  private doMove(m: Extract<Mode, { kind: 'move' }>, w: Pt, noSnap: boolean) {
    if (this.mode.kind !== 'move' || !m.started) return;
    let dx = w.x - m.start.x;
    let dy = w.y - m.start.y;
    let guides: Guide[] = [];
    if (m.box && !noSnap) {
      const snapped = snapMove(m.box, dx, dy, m.candidates, SNAP_PX / getState().camera.zoom);
      dx = snapped.dx;
      dy = snapped.dy;
      guides = snapped.guides;
    }
    board.apply(moveOps(m.set!, m.base!, dx, dy));
    setState({ guides });
  }

  // ------------------------------------------------------------------ изменение размера

  private doResize(m: Extract<Mode, { kind: 'resize' }>, w: Pt, shift: boolean) {
    const { box, handle } = m;
    const dx = w.x - m.start.x;
    const dy = w.y - m.start.y;
    let x1 = box.x;
    let y1 = box.y;
    let x2 = box.x + box.w;
    let y2 = box.y + box.h;
    if (handle.includes('w')) x1 += dx;
    if (handle.includes('e')) x2 += dx;
    if (handle.includes('n')) y1 += dy;
    if (handle.includes('s')) y2 += dy;
    const MIN = 12;
    if (x2 - x1 < MIN) {
      if (handle.includes('w')) x1 = x2 - MIN;
      else x2 = x1 + MIN;
    }
    if (y2 - y1 < MIN) {
      if (handle.includes('n')) y1 = y2 - MIN;
      else y2 = y1 + MIN;
    }
    const corner = handle.length === 2;
    if (corner && (m.keepAspect || shift)) {
      const s = Math.max((x2 - x1) / box.w, (y2 - y1) / box.h);
      const nw = box.w * s;
      const nh = box.h * s;
      if (handle.includes('w')) x1 = x2 - nw;
      else x2 = x1 + nw;
      if (handle.includes('n')) y1 = y2 - nh;
      else y2 = y1 + nh;
    }
    const sx = (x2 - x1) / box.w;
    const sy = (y2 - y1) / box.h;
    const map = (px: number, py: number): Pt => ({ x: r2(x1 + (px - box.x) * sx), y: r2(y1 + (py - box.y) * sy) });
    const ops: Op[] = [];
    for (const o of m.orig) {
      if (o.type === 'connector') {
        const patch: ItemPatch = {};
        if (!o.from.itemId) patch.from = { ...o.from, ...map(o.from.x, o.from.y) };
        if (!o.to.itemId) patch.to = { ...o.to, ...map(o.to.x, o.to.y) };
        if (Object.keys(patch).length) ops.push({ t: 'update', id: o.id, patch });
        continue;
      }
      const pos = map(o.x, o.y);
      const nw = r2(Math.max(1, o.w * sx));
      const nh = r2(Math.max(1, o.h * sy));
      if (o.type === 'path') {
        const points = o.points.map((v, i) => r2(i % 2 === 0 ? v * sx : v * sy));
        ops.push({ t: 'update', id: o.id, patch: { ...pos, w: r2(o.w * sx), h: r2(o.h * sy), points } });
      } else if (o.type === 'text') {
        if (m.textWidthOnly) {
          ops.push({ t: 'update', id: o.id, patch: { x: pos.x, w: nw, h: textBlockHeight(o.text, o.fontSize, nw, o.bold) } });
        } else {
          const fontSize = Math.max(4, r2(o.fontSize * sx));
          ops.push({ t: 'update', id: o.id, patch: { ...pos, w: nw, fontSize, h: textBlockHeight(o.text, fontSize, nw, o.bold) } });
        }
      } else {
        ops.push({ t: 'update', id: o.id, patch: { ...pos, w: nw, h: nh } });
      }
    }
    board.apply(ops);
  }

  // ------------------------------------------------------------------ вспомогательное

  /** Объект под точкой для привязки коннектора (без коннекторов, штрихов и фреймов). */
  private hitTarget(w: Pt, exclude: Set<string>): Item | null {
    const { items, camera } = getState();
    let best: Item | null = null;
    for (const id in items) {
      const it = items[id];
      if (exclude.has(id) || it.type === 'connector' || it.type === 'path' || it.type === 'frame') continue;
      if (!pointInRect(w, it, 6 / camera.zoom)) continue;
      if (!best || it.z > best.z) best = it;
    }
    return best;
  }

  /** Верхний объект под точкой для привязки комментария: фреймы — только если больше ничего нет. */
  private itemAt(w: Pt): Item | null {
    const { items } = getState();
    let best: Item | null = null;
    const rank = (it: Item) => (it.type === 'frame' ? 0 : 1);
    for (const id in items) {
      const it = items[id];
      if (it.type === 'connector' || it.type === 'path' || !pointInRect(w, it)) continue;
      if (!best || rank(it) > rank(best) || (rank(it) === rank(best) && it.z > best.z)) best = it;
    }
    return best;
  }

  private itemsInRect(rect: Rect, items: ItemMap): string[] {
    const out: string[] = [];
    for (const id in items) {
      const it = items[id];
      const b = itemBounds(it, items);
      if (it.type === 'frame' ? rectContains(rect, b) : rectsIntersect(rect, b)) out.push(id);
    }
    return out;
  }

  private eraseAt(w: Pt) {
    if (this.mode.kind !== 'erase') return;
    const { items, camera } = getState();
    const ops: Op[] = [];
    for (const id in items) {
      const it = items[id];
      if (it.type !== 'path' || it.locked || this.mode.erased.has(id)) continue;
      if (!pointInRect(w, it, it.strokeWidth + 12 / camera.zoom)) continue;
      if (distToPath(w, it) <= it.strokeWidth / 2 + 10 / camera.zoom) {
        this.mode.erased.add(id);
        ops.push({ t: 'delete', id });
      }
    }
    board.apply(ops);
  }

  doubleClick(e: MouseEvent) {
    // Из-за захвата указателя (setPointerCapture) click/dblclick адресуются самому холсту,
    // поэтому объект под курсором ищем по координатам, а не по e.target.
    const target = document.elementFromPoint(e.clientX, e.clientY) ?? (e.target as Element);
    if (target.closest('[data-editor]') || target.closest('[data-handle]') || target.closest('[data-ui]')) return;
    const st = getState();
    if (st.tool !== 'select' || st.presenting || votingActive(st)) return;
    const el = target.closest<HTMLElement>('[data-id]');
    const id = el?.dataset.id;
    const item = id ? st.items[id] : undefined;
    if (item && !el!.dataset.frameBody && canEditText(item)) {
      startEditing(item.id);
      return;
    }
    if (!item || el!.dataset.frameBody) {
      // двойной клик по пустому месту — новый стикер
      const w = this.world(e);
      createAndEdit(() => createSticky(w));
    }
  }

  wheel(e: WheelEvent) {
    e.preventDefault();
    const st = getState();
    if (st.presenting) return;
    if (st.contextMenu) setState({ contextMenu: null });
    if (e.ctrlKey || e.metaKey) {
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025));
      board.zoomAt(st.camera.zoom * factor, this.local(e));
      return;
    }
    let dx = e.deltaX;
    let dy = e.deltaY;
    if (e.deltaMode === 1) {
      dx *= 30;
      dy *= 30;
    }
    if (e.shiftKey && dx === 0) {
      dx = dy;
      dy = 0;
    }
    board.setCamera({ ...st.camera, x: st.camera.x - dx, y: st.camera.y - dy });
  }

  drop(e: DragEvent) {
    e.preventDefault();
    const files = [...(e.dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    const w = this.world(e);
    files.slice(0, 10).forEach((f, i) => void insertImageFile(f, { x: w.x + i * 40, y: w.y + i * 40 }));
  }

  leave() {
    board.sendCursor(null);
    setState({ eraser: null });
  }

  /** Правый клик или долгое нажатие: выделить объект под курсором и открыть меню. */
  contextMenu(e: MouseEvent) {
    e.preventDefault();
    const st = getState();
    if (st.presenting || votingActive(st) || this.active) return;
    if (st.editingId) stopEditing();
    const target = e.target as Element;
    if (target.closest('[data-ui]')) return;
    const el = target.closest<HTMLElement>('[data-id]');
    const item = el && !el.dataset.frameBody ? st.items[el.dataset.id!] : undefined;
    // по объекту — меню выделения, по пустому месту — меню холста
    if (item && !st.selection.includes(item.id)) setSelection(expandGroups([item.id]));
    if (!item) setSelection([]);
    const p = this.local(e);
    setState({ contextMenu: { x: p.x, y: p.y, world: screenToWorld(st.camera, p), onItem: !!item }, tool: 'select' });
  }

  resetTool() {
    setTool('select');
  }
}

/** Привязка перемещаемой рамки к краям и центрам соседних объектов. */
export function snapMove(box: Rect, dx: number, dy: number, candidates: Rect[], threshold: number) {
  const xsOf = (r: Rect) => [r.x, r.x + r.w / 2, r.x + r.w];
  const ysOf = (r: Rect) => [r.y, r.y + r.h / 2, r.y + r.h];
  const moved = { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h };
  let bestX: number | null = null;
  let bestY: number | null = null;
  for (const c of candidates) {
    for (const mx of xsOf(moved)) for (const cx of xsOf(c)) {
      const d = cx - mx;
      if (Math.abs(d) < threshold && (bestX === null || Math.abs(d) < Math.abs(bestX))) bestX = d;
    }
    for (const my of ysOf(moved)) for (const cy of ysOf(c)) {
      const d = cy - my;
      if (Math.abs(d) < threshold && (bestY === null || Math.abs(d) < Math.abs(bestY))) bestY = d;
    }
  }
  if (bestX !== null) dx += bestX;
  if (bestY !== null) dy += bestY;
  const fin = { x: box.x + dx, y: box.y + dy, w: box.w, h: box.h };
  const guides: Guide[] = [];
  if (bestX !== null || bestY !== null) {
    for (const c of candidates) {
      if (bestX !== null) {
        for (const mx of xsOf(fin)) for (const cx of xsOf(c)) {
          if (Math.abs(mx - cx) < 0.01) guides.push({ axis: 'x', at: cx, from: Math.min(fin.y, c.y), to: Math.max(fin.y + fin.h, c.y + c.h) });
        }
      }
      if (bestY !== null) {
        for (const my of ysOf(fin)) for (const cy of ysOf(c)) {
          if (Math.abs(my - cy) < 0.01) guides.push({ axis: 'y', at: cy, from: Math.min(fin.x, c.x), to: Math.max(fin.x + fin.w, c.x + c.w) });
        }
      }
      if (guides.length > 40) break;
    }
  }
  return { dx, dy, guides };
}
