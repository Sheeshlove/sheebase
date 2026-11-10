import {
  makeConnector,
  makeFrame,
  makeImage,
  makeShape,
  makeSticky,
  makeText,
  STICKY_SIZE,
} from '../../shared/defaults';
import {
  boundsOf,
  frameChildren,
  type Pt,
  rectCenter,
  rectsIntersect,
  resolveEnds,
  SIDE_NORMAL,
} from '../../shared/geometry';
import { uid } from '../../shared/ops';
import type { Item, ItemMap, ItemPatch, Op, ShapeKind, Side } from '../../shared/types';
import { sanitizeItem } from '../../shared/validate';
import { board } from './controller';
import { getState, screenToWorld, setState, showToast, type Tool } from './store';
import { textBlockHeight } from './text';

// ------------------------------------------------------------------ выборки

export function nextZ(items: ItemMap = getState().items): number {
  let max = 0;
  for (const id in items) max = Math.max(max, items[id].z);
  return Math.floor(max) + 1;
}

/** Дополнить набор объектов участниками их групп. */
export function expandGroups(ids: readonly string[], items: ItemMap = getState().items): string[] {
  const groups = new Set<string>();
  for (const id of ids) {
    const g = items[id]?.groupId;
    if (g) groups.add(g);
  }
  const out = new Set(ids);
  if (groups.size) for (const id in items) if (items[id].groupId && groups.has(items[id].groupId!)) out.add(id);
  return [...out];
}

export function setSelection(ids: string[]) {
  setState({ selection: [...new Set(ids)] });
}

export function selectedItems(): Item[] {
  const { selection, items } = getState();
  return selection.map((id) => items[id]).filter((x): x is Item => !!x);
}

export function setTool(tool: Tool) {
  const st = getState();
  if (st.editingId) stopEditing();
  setState({ tool, eraser: null, selection: tool === 'select' || tool === 'hand' ? st.selection : [] });
}

export function viewportCenterWorld(): Pt {
  const { camera, viewport } = getState();
  return screenToWorld(camera, { x: viewport.w / 2, y: viewport.h / 2 });
}

/** Пересчёт высоты текстового блока при изменении текста/шрифта/ширины. */
export function withTextHeight(item: Item, patch: ItemPatch): ItemPatch {
  if (item.type !== 'text') return patch;
  if (!('text' in patch || 'fontSize' in patch || 'w' in patch || 'bold' in patch)) return patch;
  const next = { ...item, ...patch } as typeof item;
  return { ...patch, h: textBlockHeight(next.text, next.fontSize, next.w, next.bold) };
}

export function updateItems(updates: { id: string; patch: ItemPatch }[]) {
  const items = getState().items;
  const ops: Op[] = [];
  for (const { id, patch } of updates) {
    const it = items[id];
    if (it) ops.push({ t: 'update', id, patch: withTextHeight(it, patch) });
  }
  board.apply(ops);
}

/** Применить изменение к каждому выделенному (незаблокированному) объекту. */
export function updateSelected(fn: (it: Item) => ItemPatch | null) {
  const updates: { id: string; patch: ItemPatch }[] = [];
  for (const it of selectedItems()) {
    if (it.locked) continue;
    const patch = fn(it);
    if (patch && Object.keys(patch).length) updates.push({ id: it.id, patch });
  }
  updateItems(updates);
}

/** «Основной цвет» объекта — для общей палитры в контекстной панели. */
export function colorPatch(it: Item, color: string): ItemPatch | null {
  switch (it.type) {
    case 'sticky':
      return color === 'transparent' ? null : { color };
    case 'shape':
      return { fill: color };
    case 'text':
      return color === 'transparent' ? null : { color };
    case 'frame':
      return { fill: color === 'transparent' ? '#ffffff' : color };
    case 'path':
    case 'connector':
      return color === 'transparent' ? null : { stroke: color };
    default:
      return null;
  }
}

export function primaryColor(it: Item): string | null {
  switch (it.type) {
    case 'sticky':
    case 'text':
      return it.color;
    case 'shape':
    case 'frame':
      return it.fill;
    case 'path':
    case 'connector':
      return it.stroke;
    default:
      return null;
  }
}

// ------------------------------------------------------------------ создание

export function addItems(items: Item[], select = true) {
  board.apply(items.map((item) => ({ t: 'add', item })));
  if (select) setSelection(items.map((i) => i.id));
}

export function createSticky(center: Pt, text = ''): string {
  const st = getState();
  const id = uid();
  addItems([makeSticky(id, Math.round(center.x - STICKY_SIZE / 2), Math.round(center.y - STICKY_SIZE / 2), nextZ(), st.stickyColor, text)]);
  return id;
}

export function createText(at: Pt, text = ''): string {
  const id = uid();
  const it = makeText(id, Math.round(at.x), Math.round(at.y - 16), nextZ(), text);
  it.h = textBlockHeight(text, it.fontSize, it.w, it.bold);
  addItems([it]);
  return id;
}

export function createShape(kind: ShapeKind, x: number, y: number, w: number, h: number): string {
  const id = uid();
  addItems([makeShape(id, kind, x, y, w, h, nextZ())]);
  return id;
}

export function createFrame(x: number, y: number, w: number, h: number): string {
  const id = uid();
  const n = Object.values(getState().items).filter((i) => i.type === 'frame').length + 1;
  addItems([makeFrame(id, x, y, w, h, nextZ(), `Фрейм ${n}`)]);
  return id;
}

// ------------------------------------------------------------------ редактирование текста

export function canEditText(it: Item | undefined): boolean {
  return !!it && !it.locked && ['sticky', 'shape', 'text', 'frame', 'connector'].includes(it.type);
}

export function startEditing(id: string) {
  const st = getState();
  const it = st.items[id];
  if (!canEditText(it)) return;
  if (st.editingId === id) return;
  if (st.editingId) stopEditing();
  board.begin();
  setState({ editingId: id, selection: [id] });
}

export function stopEditing() {
  const st = getState();
  const id = st.editingId;
  if (!id) return;
  const it = st.items[id];
  setState({ editingId: null });
  if (it && it.type === 'text' && it.text.trim() === '') {
    // пустой текстовый блок удаляется вместе с привязанными к нему коннекторами
    const gone = [id, ...attachedConnectors(new Set([id]), st.items)];
    board.apply(gone.map((gid) => ({ t: 'delete', id: gid })));
    setState({ selection: [] });
  }
  board.commit();
}

/**
 * Создать объект и сразу открыть ввод текста — одним шагом истории:
 * Ctrl+Z удаляет объект целиком, а брошенный пустой текст не оставляет «фантома».
 */
export function createAndEdit(create: () => string): string {
  board.begin();
  const id = create();
  startEditing(id);
  board.commit();
  return id;
}

/** Отмена/повтор из интерфейса: сначала завершаем ввод текста, иначе транзакция редактирования блокирует историю. */
export function undo() {
  if (getState().editingId) stopEditing();
  board.undo();
}

export function redo() {
  if (getState().editingId) stopEditing();
  board.redo();
}

// ------------------------------------------------------------------ удаление, дублирование, буфер

/** Коннекторы, привязанные к любому из объектов. */
function attachedConnectors(ids: Set<string>, items: ItemMap): string[] {
  const out: string[] = [];
  for (const id in items) {
    const it = items[id];
    if (it.type !== 'connector' || ids.has(id)) continue;
    if ((it.from.itemId && ids.has(it.from.itemId)) || (it.to.itemId && ids.has(it.to.itemId))) out.push(id);
  }
  return out;
}

export function deleteSelection() {
  const st = getState();
  const ids = new Set(st.selection.filter((id) => st.items[id] && !st.items[id].locked));
  if (ids.size === 0) {
    if (st.selection.length) showToast('Заблокированные объекты нельзя удалить');
    return;
  }
  const all = [...ids, ...attachedConnectors(ids, st.items)];
  board.apply(all.map((id) => ({ t: 'delete', id })));
  setSelection([]);
}

/** Объекты для копирования: выделение + содержимое выделенных фреймов. */
function collectForCopy(): Item[] {
  const st = getState();
  const ids = new Set(st.selection.filter((id) => st.items[id]));
  for (const id of st.selection) {
    const f = st.items[id];
    if (f?.type === 'frame') for (const cid of frameChildren(f, st.items)) ids.add(cid);
  }
  // коннекторы между копируемыми объектами
  for (const cid in st.items) {
    const c = st.items[cid];
    if (c.type === 'connector' && c.from.itemId && c.to.itemId && ids.has(c.from.itemId) && ids.has(c.to.itemId)) ids.add(cid);
  }
  const items = [...ids].map((id) => st.items[id]).filter((x): x is Item => !!x);
  // концы, привязанные к объектам вне копии, делаем свободными
  return items.map((it) => {
    if (it.type !== 'connector') return structuredClone(it);
    const [a, b] = resolveEnds(it, st.items);
    const c = structuredClone(it);
    if (!c.from.itemId || !ids.has(c.from.itemId)) c.from = { x: a.pt.x, y: a.pt.y, itemId: null, side: null };
    if (!c.to.itemId || !ids.has(c.to.itemId)) c.to = { x: b.pt.x, y: b.pt.y, itemId: null, side: null };
    return c;
  });
}

/** Клонирует объекты с новыми id, сдвигом и переподключением коннекторов. */
export function cloneItems(src: Item[], dx: number, dy: number): Item[] {
  const idMap = new Map(src.map((it) => [it.id, uid()]));
  const groupMap = new Map<string, string>();
  let z = nextZ();
  return [...src]
    .sort((a, b) => a.z - b.z)
    .map((orig) => {
      const it = structuredClone(orig) as Item;
      it.id = idMap.get(orig.id)!;
      it.z = z++;
      it.locked = false;
      if (it.groupId) {
        if (!groupMap.has(it.groupId)) groupMap.set(it.groupId, uid());
        it.groupId = groupMap.get(it.groupId)!;
      }
      if (it.type === 'connector') {
        for (const key of ['from', 'to'] as const) {
          const ep = it[key];
          const mapped = ep.itemId ? idMap.get(ep.itemId) : undefined;
          it[key] = mapped
            ? { ...ep, itemId: mapped, x: ep.x + dx, y: ep.y + dy }
            : { x: ep.x + dx, y: ep.y + dy, itemId: null, side: null };
        }
      } else {
        it.x += dx;
        it.y += dy;
      }
      return it;
    });
}

export function duplicateSelection() {
  const src = collectForCopy();
  if (!src.length) return;
  addItems(cloneItems(src, 30, 30));
}

const CLIP_KIND = 'sheebase/items';

export function serializeSelection(): string | null {
  const items = collectForCopy();
  if (!items.length) return null;
  return JSON.stringify({ kind: CLIP_KIND, version: 1, items });
}

/** Вставка из буфера: объекты доски, изображение или текст. Возвращает true, если что-то вставлено. */
export function pasteText(text: string): boolean {
  const at = board.pointer ?? viewportCenterWorld();
  try {
    const data = JSON.parse(text);
    if (data && (data.kind === CLIP_KIND || data.kind === 'sheebase/board') && Array.isArray(data.items)) {
      const items = (data.items as unknown[]).map(sanitizeItem).filter((x): x is Item => !!x);
      if (!items.length) return false;
      const temp: ItemMap = Object.fromEntries(items.map((i) => [i.id, i]));
      const b = boundsOf(Object.keys(temp), temp)!;
      const c = rectCenter(b);
      const copies = cloneItems(items, Math.round(at.x - c.x), Math.round(at.y - c.y));
      addItems(copies);
      return true;
    }
  } catch {
    /* не JSON — вставляем как текст */
  }
  const trimmed = text.trim();
  if (!trimmed) return false;
  createSticky(at, trimmed.slice(0, 5000));
  return true;
}

// ------------------------------------------------------------------ слои, блокировка, группы

export function bringToFront() {
  const sel = selectedItems().sort((a, b) => a.z - b.z);
  if (!sel.length) return;
  let z = nextZ();
  board.apply(sel.map((it) => ({ t: 'update', id: it.id, patch: { z: z++ } })));
}

export function sendToBack() {
  const sel = selectedItems().sort((a, b) => a.z - b.z);
  if (!sel.length) return;
  let min = Infinity;
  const items = getState().items;
  for (const id in items) min = Math.min(min, items[id].z);
  let z = Math.floor(min) - sel.length;
  board.apply(sel.map((it) => ({ t: 'update', id: it.id, patch: { z: z++ } })));
}

export function toggleLock() {
  const sel = selectedItems();
  if (!sel.length) return;
  const lock = sel.some((it) => !it.locked);
  board.apply(sel.map((it) => ({ t: 'update', id: it.id, patch: { locked: lock } })));
  showToast(lock ? 'Заблокировано' : 'Разблокировано');
}

export function groupSelection() {
  const sel = selectedItems();
  if (sel.length < 2) return;
  const g = uid();
  board.apply(sel.map((it) => ({ t: 'update', id: it.id, patch: { groupId: g } })));
  showToast('Объекты сгруппированы');
}

export function ungroupSelection() {
  const sel = selectedItems().filter((it) => it.groupId);
  if (!sel.length) return;
  board.apply(sel.map((it) => ({ t: 'update', id: it.id, patch: { groupId: null } })));
  showToast('Группа расформирована');
}

export function selectAll() {
  setSelection(Object.keys(getState().items));
}

/** Что сдвигается вместе с выделением. */
export interface MoveSet {
  /** Объекты (кроме коннекторов), которые смещаются целиком. */
  items: Set<string>;
  /** Коннекторы, у которых смещаются свободные концы (привязанные следуют за объектами сами). */
  conns: Set<string>;
}

/**
 * Единое правило для перетаскивания и стрелок: незаблокированные выделенные объекты
 * и всё содержимое выделенных фреймов (фрейм переносит своё содержимое целиком).
 */
export function computeMoveSet(selection: readonly string[], items: ItemMap): MoveSet {
  const set: MoveSet = { items: new Set(), conns: new Set() };
  const add = (id: string) => {
    const it = items[id];
    if (!it) return;
    if (it.type === 'connector') set.conns.add(id);
    else set.items.add(id);
  };
  for (const id of selection) {
    const it = items[id];
    if (!it || it.locked) continue;
    add(id);
    if (it.type === 'frame') for (const cid of frameChildren(it, items)) add(cid);
  }
  return set;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Операции сдвига набора на (dx, dy) от исходного состояния `base`. */
export function moveOps(set: MoveSet, base: ItemMap, dx: number, dy: number): Op[] {
  const ops: Op[] = [];
  for (const id of set.items) {
    const it = base[id];
    if (it) ops.push({ t: 'update', id, patch: { x: r2(it.x + dx), y: r2(it.y + dy) } });
  }
  for (const id of set.conns) {
    const c = base[id];
    if (!c || c.type !== 'connector') continue;
    const patch: ItemPatch = {};
    if (!c.from.itemId || !base[c.from.itemId]) patch.from = { ...c.from, x: r2(c.from.x + dx), y: r2(c.from.y + dy) };
    if (!c.to.itemId || !base[c.to.itemId]) patch.to = { ...c.to, x: r2(c.to.x + dx), y: r2(c.to.y + dy) };
    if (patch.from || patch.to) ops.push({ t: 'update', id, patch });
  }
  return ops;
}

export function nudgeSelection(dx: number, dy: number) {
  const st = getState();
  board.apply(moveOps(computeMoveSet(st.selection, st.items), st.items, dx, dy));
}

export function zoomToSelection() {
  const { selection, items } = getState();
  if (!selection.length) return;
  board.fitRect(boundsOf(selection, items), 2);
}

// ------------------------------------------------------------------ быстрое создание (кнопки «+»)

/**
 * Как в Miro: клик по «+» у стороны объекта создаёт такой же объект
 * в этом направлении и соединяет их коннектором.
 */
export function quickCreate(srcId: string, side: Side) {
  const st = getState();
  const src = st.items[srcId];
  if (!src || src.type === 'connector' || src.type === 'path' || src.type === 'frame') return;
  const n = SIDE_NORMAL[side];
  const gap = 100;
  const w = src.type === 'image' ? STICKY_SIZE : src.w;
  const h = src.type === 'image' ? STICKY_SIZE : src.h;
  let x = n.x > 0 ? src.x + src.w + gap : n.x < 0 ? src.x - gap - w : src.x + (src.w - w) / 2;
  let y = n.y > 0 ? src.y + src.h + gap : n.y < 0 ? src.y - gap - h : src.y + (src.h - h) / 2;
  // избегаем наложения: сдвигаем перпендикулярно направлению
  const others = Object.values(st.items).filter((i) => i.type !== 'connector' && i.type !== 'frame');
  for (let i = 0; i < 12; i++) {
    const r = { x, y, w, h };
    if (!others.some((o) => rectsIntersect(r, o))) break;
    if (n.x !== 0) y += h + 40;
    else x += w + 40;
  }
  const id = uid();
  const z = nextZ();
  let copy: Item;
  if (src.type === 'image') {
    copy = makeSticky(id, x, y, z, st.stickyColor);
  } else {
    copy = { ...structuredClone(src), id, x, y, z, locked: false, groupId: null } as Item;
    if ('text' in copy) copy.text = '';
  }
  const conn = makeConnector(
    uid(),
    { itemId: src.id, side: 'auto', x: src.x, y: src.y },
    { itemId: id, side: 'auto', x, y },
    z + 1,
  );
  board.begin();
  board.apply([
    { t: 'add', item: copy },
    { t: 'add', item: conn },
  ]);
  setSelection([id]);
  if (copy.type !== 'image') startEditing(id);
  board.commit();
}

// ------------------------------------------------------------------ изображения

const MAX_IMAGE_PX = 1600;

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Не удалось прочитать изображение'));
    img.src = src;
  });
}

/** Читает файл, при необходимости уменьшает и добавляет на доску. */
export async function insertImageFile(file: File, at?: Pt) {
  if (!/^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(file.type)) {
    showToast('Поддерживаются PNG, JPEG, GIF, WebP и SVG');
    return;
  }
  try {
    let src = await readAsDataUrl(file);
    const img = await loadImage(src);
    let w = img.naturalWidth || 400;
    let h = img.naturalHeight || 300;
    if (file.type !== 'image/svg+xml' && file.type !== 'image/gif' && Math.max(w, h) > MAX_IMAGE_PX) {
      const k = MAX_IMAGE_PX / Math.max(w, h);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * k);
      canvas.height = Math.round(h * k);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      src = canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.88);
      w = canvas.width;
      h = canvas.height;
    }
    if (src.length > 11 * 1024 * 1024) {
      showToast('Изображение слишком большое');
      return;
    }
    const k = Math.min(1, 480 / Math.max(w, h));
    const dw = Math.round(w * k);
    const dh = Math.round(h * k);
    const c = at ?? viewportCenterWorld();
    addItems([makeImage(uid(), Math.round(c.x - dw / 2), Math.round(c.y - dh / 2), dw, dh, nextZ(), src)]);
    setState({ tool: 'select' });
  } catch (err) {
    showToast((err as Error).message);
  }
}
