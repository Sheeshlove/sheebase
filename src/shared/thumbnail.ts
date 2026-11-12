import { BRAND, CONNECTOR_DASH, RADIUS_LG, RADIUS_SM, SURFACE } from './brand';
import { arrowChevronPath, boundsOf, connectorGeometry, geometryPath, shapePath, smoothPath } from './geometry';
import type { Item, ItemMap } from './types';

// Упрощённая SVG-миниатюра доски для дашборда в оформлении ШИБЕЙС: синий холст,
// белые фреймы, стикеры тонов, белый пунктир. Работает без измерения текста
// (на сервере): строки текста рисуются полосками.

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const n = (v: number) => Math.round(v * 100) / 100;
const paint = (c: string) => (c === 'transparent' ? 'none' : esc(c));
const isBlue = (c: string) => c.toLowerCase() === BRAND.blue500 || c.toLowerCase() === BRAND.blue700;

/** Полоски, изображающие строки текста в блоке. */
function textBars(text: string, x: number, y: number, w: number, h: number, size: number, color: string, center: boolean): string {
  if (!text.trim() || w <= 0 || h <= 0) return '';
  const lineH = size * 1.3;
  const charW = size * 0.55;
  const perLine = Math.max(1, Math.floor(w / charW));
  const widths: number[] = [];
  for (const para of text.split('\n')) {
    let rest = para.trim().length;
    if (rest === 0) {
      widths.push(0);
      continue;
    }
    while (rest > 0) {
      const take = Math.min(rest, perLine);
      widths.push(Math.min(w, take * charW));
      rest -= take;
    }
  }
  const maxLines = Math.max(1, Math.floor(h / lineH));
  const lines = widths.slice(0, maxLines);
  const top = center ? y + (h - lines.length * lineH) / 2 : y;
  return lines
    .map((lw, i) => {
      if (lw <= 0) return '';
      const lx = center ? x + (w - lw) / 2 : x;
      return `<rect x="${n(lx)}" y="${n(top + i * lineH + lineH * 0.25)}" width="${n(lw)}" height="${n(size * 0.55)}" rx="${n(size * 0.27)}" fill="${paint(color)}" fill-opacity="0.6"/>`;
    })
    .join('');
}

function itemSvg(it: Item, items: ItemMap): string {
  switch (it.type) {
    case 'frame': {
      const fill = it.fill === 'transparent' ? BRAND.white : it.fill;
      const r = Math.min(RADIUS_LG, it.w / 2, it.h / 2);
      // тёмно-синий фрейм на синем холсте получает белую рамку — иначе край не читается
      const edge = isBlue(fill) ? ` stroke="${BRAND.white}" stroke-width="2" vector-effect="non-scaling-stroke"` : '';
      return `<rect x="${n(it.x)}" y="${n(it.y)}" width="${n(it.w)}" height="${n(it.h)}" rx="${n(r)}" fill="${esc(fill)}"${edge}/>`;
    }
    case 'sticky': {
      const pad = it.w * 0.12;
      return (
        `<rect x="${n(it.x)}" y="${n(it.y)}" width="${n(it.w)}" height="${n(it.h)}" rx="${RADIUS_SM}" fill="${paint(it.color)}"/>` +
        textBars(it.text, it.x + pad, it.y + pad, it.w - pad * 2, it.h - pad * 2, Math.max(8, it.h * 0.11), BRAND.ink, true)
      );
    }
    case 'shape':
      return (
        `<path transform="translate(${n(it.x)} ${n(it.y)})" d="${shapePath(it.shape, it.w, it.h)}" fill="${paint(it.fill)}" stroke="${
          it.strokeWidth > 0 ? paint(it.stroke) : 'none'
        }" stroke-width="${n(it.strokeWidth)}" stroke-linejoin="round"/>` +
        textBars(it.text, it.x + it.w * 0.15, it.y + it.h * 0.2, it.w * 0.7, it.h * 0.6, it.fontSize, it.textColor, true)
      );
    case 'text':
      return textBars(it.text, it.x + 4, it.y + 4, it.w - 8, it.h, it.fontSize, it.color, false);
    case 'image':
      return `<rect x="${n(it.x)}" y="${n(it.y)}" width="${n(it.w)}" height="${n(it.h)}" fill="${BRAND.white}"/><path transform="translate(${n(
        it.x,
      )} ${n(it.y)})" d="M${n(it.w * 0.15)},${n(it.h * 0.8)}L${n(it.w * 0.4)},${n(it.h * 0.45)}L${n(it.w * 0.6)},${n(it.h * 0.65)}L${n(
        it.w * 0.72,
      )},${n(it.h * 0.55)}L${n(it.w * 0.85)},${n(it.h * 0.8)}Z" fill="${BRAND.blue700}"/>`;
    case 'path':
      return `<path transform="translate(${n(it.x)} ${n(it.y)})" d="${smoothPath(it.points)}" fill="none" stroke="${paint(
        it.stroke,
      )}" stroke-width="${n(it.strokeWidth)}" stroke-linecap="round" stroke-linejoin="round"/>`;
    case 'connector': {
      const g = connectorGeometry(it, items);
      const line = `fill="none" stroke="${paint(it.stroke)}" stroke-width="${n(it.strokeWidth)}" stroke-linecap="round" stroke-linejoin="round"`;
      let out = `<path d="${geometryPath(g)}" ${line} stroke-dasharray="${CONNECTOR_DASH}"/>`;
      if (it.endArrow === 'arrow') out += `<path d="${arrowChevronPath(g.end, g.endDir, it.strokeWidth)}" ${line}/>`;
      if (it.startArrow === 'arrow') out += `<path d="${arrowChevronPath(g.start, g.startDir, it.strokeWidth)}" ${line}/>`;
      return out;
    }
  }
}

/** SVG-миниатюра: всё содержимое доски, вписанное в width×height, на синем холсте. */
export function renderThumbnailSvg(items: ItemMap, width = 320, height = 200): string {
  const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"`;
  const b = boundsOf(Object.keys(items), items);
  if (!b) return `${head} viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${SURFACE}"/></svg>`;
  const pad = Math.max(b.w, b.h) * 0.06 + 10;
  const vx = b.x - pad;
  const vy = b.y - pad;
  const vw = b.w + pad * 2;
  const vh = b.h + pad * 2;
  const layer = (t: string) => (t === 'frame' ? 0 : t === 'connector' ? 2 : 1);
  const sorted = Object.values(items).sort((a, c) => layer(a.type) - layer(c.type) || a.z - c.z);
  const body = sorted.map((it) => itemSvg(it, items)).join('');
  return (
    `${head} viewBox="${n(vx)} ${n(vy)} ${n(vw)} ${n(vh)}" preserveAspectRatio="xMidYMid meet">` +
    `<rect x="${n(vx - vw)}" y="${n(vy - vh)}" width="${n(vw * 3)}" height="${n(vh * 3)}" fill="${SURFACE}"/>${body}</svg>`
  );
}
