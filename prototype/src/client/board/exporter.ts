import { BRAND, CONNECTOR_DASH, migrateLegacyItem, RADIUS_LG, RADIUS_SM, SURFACE } from '../../shared/brand';
import {
  arrowChevronPath,
  boundsOf,
  connectorGeometry,
  frameChildren,
  geometryPath,
  shapePath,
  shapeTextBox,
  smoothPath,
} from '../../shared/geometry';
import type { Item, ItemMap } from '../../shared/types';
import { sanitizeItem } from '../../shared/validate';
import acariBoldUrl from '../design/fonts/AcariSans-Bold.ttf?url';
import acariRegularUrl from '../design/fonts/AcariSans-Regular.ttf?url';
import { addItems, cloneItems, viewportCenterWorld } from './actions';
import { board } from './controller';
import { getState, showToast } from './store';
import { authorFooter, FONT_FAMILY, fitText, layoutText, LINE_HEIGHT, measure, STICKY_BOLD, stickyText, TEXT_PAD } from './text';

// Экспорт рисует доску так же, как она выглядит в приложении, по правилам ШИБЕЙС:
// синий холст, белые фреймы со скруглением, белый пунктир-коннектор, шрифт Acari Sans.

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const n = (v: number) => Math.round(v * 100) / 100;
const isBlue = (c: string) => c.toLowerCase() === BRAND.blue500 || c.toLowerCase() === BRAND.blue700;

/** Размер заголовка фрейма в экспорте (в приложении он постоянного экранного размера). */
const FRAME_TITLE = 20;

async function toDataUrl(url: string): Promise<string> {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:font/ttf;base64,${btoa(bin)}`;
}

let fontCss: Promise<string> | null = null;

/**
 * @font-face со встроенными шрифтами. SVG, открытый как картинка (растеризация в PNG,
 * предпросмотр версии) или вне приложения, не может загрузить внешние шрифты,
 * поэтому Acari Sans встраивается в сам файл.
 */
export function exportFontCss(): Promise<string> {
  fontCss ??= Promise.all([toDataUrl(acariRegularUrl), toDataUrl(acariBoldUrl)])
    .then(
      ([regular, bold]) =>
        `@font-face{font-family:"Acari Sans";font-weight:400;src:url(${regular}) format("truetype")}` +
        `@font-face{font-family:"Acari Sans";font-weight:700;src:url(${bold}) format("truetype")}`,
    )
    .catch(() => '');
  return fontCss;
}

function textLines(
  lines: string[],
  size: number,
  box: { x: number; y: number; w: number; h: number },
  opts: { color: string; align: 'left' | 'center' | 'right'; valign: 'top' | 'middle'; bold?: boolean },
): string {
  const lh = size * LINE_HEIGHT;
  const total = lines.length * lh;
  const top = opts.valign === 'middle' ? box.y + (box.h - total) / 2 : box.y;
  const anchor = opts.align === 'left' ? 'start' : opts.align === 'right' ? 'end' : 'middle';
  const x = opts.align === 'left' ? box.x : opts.align === 'right' ? box.x + box.w : box.x + box.w / 2;
  return lines
    .map(
      (l, i) =>
        `<text x="${n(x)}" y="${n(top + i * lh + lh / 2)}" font-size="${n(size)}" font-weight="${opts.bold ? 700 : 400}" fill="${esc(
          opts.color,
        )}" text-anchor="${anchor}" dominant-baseline="central" xml:space="preserve">${esc(l)}</text>`,
    )
    .join('');
}

function itemSvg(it: Item, items: ItemMap, showAuthors: boolean): string {
  switch (it.type) {
    case 'frame': {
      const fill = it.fill === 'transparent' ? BRAND.white : it.fill;
      const r = Math.min(RADIUS_LG, it.w / 2, it.h / 2);
      // синий фрейм на синем холсте — с белой рамкой 2px, иначе край не читается
      const edge = isBlue(fill) ? ` stroke="${BRAND.white}" stroke-width="2"` : '';
      return (
        `<rect x="${n(it.x)}" y="${n(it.y)}" width="${n(it.w)}" height="${n(it.h)}" rx="${n(r)}" fill="${esc(fill)}"${edge}/>` +
        `<text x="${n(it.x)}" y="${n(it.y - 12)}" font-size="${FRAME_TITLE}" font-weight="700" fill="${BRAND.white}">${esc(it.title)}</text>`
      );
    }
    case 'sticky': {
      const footer = showAuthors && it.author ? authorFooter(it.h) : 0;
      const t = stickyText(it.text, it.w, it.h, footer);
      const author = footer
        ? `<text x="${n(it.x + t.pad)}" y="${n(it.y + it.h - t.pad * 0.6 - footer * 0.4)}" font-size="${n(footer * 0.75)}" fill="${BRAND.ink}" dominant-baseline="central">${esc(it.author!)}</text>`
        : '';
      return (
        `<rect x="${n(it.x)}" y="${n(it.y)}" width="${n(it.w)}" height="${n(it.h)}" rx="${RADIUS_SM}" fill="${esc(it.color)}"/>` +
        textLines(t.lines, t.size, { x: it.x + t.pad, y: it.y + t.pad, w: it.w - t.pad * 2, h: it.h - t.pad * 2 - footer }, {
          color: BRAND.ink,
          align: 'center',
          valign: 'middle',
          bold: STICKY_BOLD,
        }) +
        author
      );
    }
    case 'shape': {
      const box = shapeTextBox(it.shape, it.w, it.h);
      const t = fitText(it.text, box.w, box.h, it.fontSize, 6);
      return (
        `<path transform="translate(${n(it.x)} ${n(it.y)})" d="${shapePath(it.shape, it.w, it.h)}" fill="${
          it.fill === 'transparent' ? 'none' : esc(it.fill)
        }" stroke="${it.strokeWidth > 0 ? esc(it.stroke) : 'none'}" stroke-width="${it.strokeWidth}" stroke-linejoin="round"/>` +
        textLines(t.lines, t.size, { x: it.x + box.x, y: it.y + box.y, w: box.w, h: box.h }, {
          color: it.textColor,
          align: 'center',
          valign: 'middle',
        })
      );
    }
    case 'text': {
      const lines = layoutText(it.text, it.fontSize, Math.max(1, it.w - TEXT_PAD * 2), it.bold);
      return textLines(lines, it.fontSize, { x: it.x + TEXT_PAD, y: it.y + TEXT_PAD, w: it.w - TEXT_PAD * 2, h: it.h }, {
        color: it.color,
        align: it.align,
        valign: 'top',
        bold: it.bold,
      });
    }
    case 'image':
      return `<image href="${esc(it.src)}" x="${n(it.x)}" y="${n(it.y)}" width="${n(it.w)}" height="${n(it.h)}" preserveAspectRatio="none"/>`;
    case 'path':
      return `<path transform="translate(${n(it.x)} ${n(it.y)})" d="${smoothPath(it.points)}" fill="none" stroke="${esc(
        it.stroke,
      )}" stroke-width="${it.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;
    case 'connector': {
      const g = connectorGeometry(it, items);
      // линия бренда: пунктир 14 12 со скруглёнными концами, стрелка — «галочка» той же толщины
      const line = `fill="none" stroke="${esc(it.stroke)}" stroke-width="${it.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"`;
      let out = `<path d="${geometryPath(g)}" ${line} stroke-dasharray="${CONNECTOR_DASH}"/>`;
      if (it.endArrow === 'arrow') out += `<path d="${arrowChevronPath(g.end, g.endDir, it.strokeWidth)}" ${line}/>`;
      if (it.startArrow === 'arrow') out += `<path d="${arrowChevronPath(g.start, g.startDir, it.strokeWidth)}" ${line}/>`;
      if (it.label) {
        // подпись — мелкий текст, поэтому на белой «таблетке»
        const size = 13;
        const lines = layoutText(it.label, size, 220, true);
        const w = Math.max(...lines.map((l) => measure(l, size, true)), 12) + 24;
        const h = lines.length * size * LINE_HEIGHT + 8;
        out += `<rect x="${n(g.mid.x - w / 2)}" y="${n(g.mid.y - h / 2)}" width="${n(w)}" height="${n(h)}" rx="${n(Math.min(h / 2, 14))}" fill="${BRAND.white}"/>`;
        out += textLines(lines, size, { x: g.mid.x - w / 2, y: g.mid.y - h / 2, w, h }, { color: BRAND.blue700, align: 'center', valign: 'middle', bold: true });
      }
      return out;
    }
  }
}

/** Объекты для экспорта: выделение (вместе с содержимым фреймов) или вся доска. */
function exportSet(): Item[] {
  const { items, selection } = getState();
  if (!selection.length) return Object.values(items);
  const ids = new Set(selection);
  for (const id of selection) {
    const f = items[id];
    if (f?.type === 'frame') for (const cid of frameChildren(f, items)) ids.add(cid);
  }
  return [...ids].map((id) => items[id]).filter((x): x is Item => !!x);
}

/**
 * SVG доски на синем холсте. `fontCss` — встроенные шрифты (см. exportFontCss);
 * без них текст отрисуется запасной гарнитурой там, где Acari Sans не установлен.
 */
export function buildSvg(
  list: Item[] = exportSet(),
  items: ItemMap = getState().items,
  fontCss = '',
): { svg: string; width: number; height: number } | null {
  const showAuthors = getState().showAuthors;
  if (!list.length) return null;
  const ids = list.map((i) => i.id);
  const b = boundsOf(ids, items)!;
  const pad = 48;
  const titles = list.some((i) => i.type === 'frame') ? FRAME_TITLE + 16 : 0;
  const x = b.x - pad;
  const y = b.y - pad - titles;
  const width = Math.ceil(b.w + pad * 2);
  const height = Math.ceil(b.h + pad * 2 + titles);
  const layer = (t: string) => (t === 'frame' ? 0 : t === 'connector' ? 2 : 1);
  const sorted = [...list].sort((a, c) => layer(a.type) - layer(c.type) || a.z - c.z);
  const body = sorted.map((it) => itemSvg(it, items, showAuthors)).join('\n');
  const style = fontCss ? `<defs><style><![CDATA[${fontCss}]]></style></defs>\n` : '';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${n(x)} ${n(y)} ${width} ${height}" font-family="${esc(
      FONT_FAMILY,
    )}">\n${style}<rect x="${n(x)}" y="${n(y)}" width="${width}" height="${height}" fill="${SURFACE}"/>\n${body}\n</svg>`;
  return { svg, width, height };
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function fileBase(): string {
  const name = getState().meta?.name ?? 'board';
  return name.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) || 'board';
}

export async function exportSvg() {
  const r = buildSvg(undefined, undefined, await exportFontCss());
  if (!r) return showToast('Здесь пока пусто. Добавьте объекты, чтобы экспортировать доску');
  download(new Blob([r.svg], { type: 'image/svg+xml' }), `${fileBase()}.svg`);
}

export async function renderPng(): Promise<Blob | null> {
  const r = buildSvg(undefined, undefined, await exportFontCss());
  if (!r) return null;
  // ограничиваем размер холста браузера
  const scale = Math.min(2, Math.sqrt(120_000_000 / (r.width * r.height)), 16_000 / Math.max(r.width, r.height));
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(r.svg);
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(r.width * scale));
  canvas.height = Math.max(1, Math.round(r.height * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = SURFACE;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}

export async function exportPng() {
  try {
    const blob = await renderPng();
    if (!blob) return showToast('Здесь пока пусто. Добавьте объекты, чтобы экспортировать доску');
    download(blob, `${fileBase()}.png`);
  } catch (err) {
    console.error(err);
    showToast('Не удалось экспортировать в PNG');
  }
}

export function exportJson() {
  const { meta, items } = getState();
  const data = { kind: 'sheebase/board', version: 1, name: meta?.name ?? '', exportedAt: new Date().toISOString(), items: Object.values(items) };
  download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `${fileBase()}.json`);
}

/** Импорт JSON-бэкапа на текущую доску: новые id, центр — в середине экрана, один шаг Undo. */
export async function importJsonFile(file: File) {
  try {
    const data = JSON.parse(await file.text());
    const raw: unknown[] = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : Object.values(data?.items ?? {});
    const items = raw
      .map(sanitizeItem)
      .filter((x): x is Item => !!x)
      .map(migrateLegacyItem);
    if (!items.length) return showToast('В файле нет объектов доски');
    const temp: ItemMap = Object.fromEntries(items.map((i) => [i.id, i]));
    const b = boundsOf(Object.keys(temp), temp)!;
    const c = viewportCenterWorld();
    const copies = cloneItems(items, Math.round(c.x - (b.x + b.w / 2)), Math.round(c.y - (b.y + b.h / 2)));
    board.begin();
    addItems(copies);
    board.commit();
    showToast(`Добавлено объектов: ${copies.length}`);
  } catch {
    showToast('Не удалось прочитать JSON');
  }
}
