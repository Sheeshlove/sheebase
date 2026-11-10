// Раскладка текста по строкам через canvas.measureText.
// Одна и та же раскладка используется при отрисовке, расчёте высоты и экспорте,
// поэтому текст выглядит одинаково везде.

export const FONT_FAMILY = '"Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif';
export const LINE_HEIGHT = 1.3;

let ctx: CanvasRenderingContext2D | null = null;
const widthCache = new Map<string, number>();

function context(): CanvasRenderingContext2D | null {
  if (ctx) return ctx;
  if (typeof document === 'undefined') return null;
  ctx = document.createElement('canvas').getContext('2d');
  return ctx;
}

export function fontString(size: number, bold = false): string {
  return `${bold ? 700 : 400} ${size}px ${FONT_FAMILY}`;
}

export function measure(text: string, size: number, bold = false): number {
  const key = `${bold ? 'b' : 'n'}${size}|${text}`;
  let w = widthCache.get(key);
  if (w !== undefined) return w;
  const c = context();
  if (c) {
    c.font = fontString(size, bold);
    w = c.measureText(text).width;
  } else {
    w = text.length * size * 0.55;
  }
  if (widthCache.size > 20000) widthCache.clear();
  widthCache.set(key, w);
  return w;
}

/** Разбивает текст на строки по ширине. Слишком длинные слова переносятся посимвольно. */
export function layoutText(text: string, size: number, maxWidth: number, bold = false): string[] {
  const lines: string[] = [];
  const width = Math.max(maxWidth, size);
  for (const para of text.split('\n')) {
    if (para === '') {
      lines.push('');
      continue;
    }
    const tokens = para.split(/(\s+)/).filter((t) => t !== '');
    let line = '';
    for (const token of tokens) {
      const candidate = line + token;
      if (measure(candidate, size, bold) <= width) {
        line = candidate;
        continue;
      }
      if (/^\s+$/.test(token)) {
        // пробел на переносе отбрасываем
        lines.push(line);
        line = '';
        continue;
      }
      if (line !== '') {
        lines.push(line.trimEnd());
        line = '';
      }
      if (measure(token, size, bold) <= width) {
        line = token;
        continue;
      }
      // посимвольный перенос длинного слова
      for (const ch of token) {
        if (line !== '' && measure(line + ch, size, bold) > width) {
          lines.push(line);
          line = '';
        }
        line += ch;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

const fitCache = new Map<string, { size: number; lines: string[] }>();

/**
 * Подбирает максимальный размер шрифта, при котором текст помещается в блок w×h
 * (как у стикеров Miro: чем больше текста, тем мельче шрифт).
 */
export function fitText(
  text: string,
  w: number,
  h: number,
  maxSize: number,
  minSize = 6,
  bold = false,
): { size: number; lines: string[] } {
  const key = `${w}|${h}|${maxSize}|${minSize}|${bold}|${text}`;
  const cached = fitCache.get(key);
  if (cached) return cached;
  // Сначала ищем размер, при котором ни одно слово не разрывается посередине,
  // и только если такого нет — разрешаем посимвольный перенос.
  const words = text.split(/\s+/).filter(Boolean);
  const search = (wholeWords: boolean) => {
    let lo = Math.max(1, Math.floor(minSize));
    let hi = Math.max(lo, Math.floor(maxSize));
    let found: { size: number; lines: string[] } | null = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const lines = layoutText(text, mid, w, bold);
      const ok =
        lines.length * mid * LINE_HEIGHT <= h && (!wholeWords || words.every((word) => measure(word, mid, bold) <= w));
      if (ok) {
        found = { size: mid, lines };
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found;
  };
  const best = search(true) ?? search(false);
  const result = best ?? { size: minSize, lines: layoutText(text, minSize, w, bold) };
  if (fitCache.size > 5000) fitCache.clear();
  fitCache.set(key, result);
  return result;
}

export const TEXT_PAD = 4;

/** Высота текстового блока заданной ширины. */
export function textBlockHeight(text: string, fontSize: number, width: number, bold: boolean): number {
  const lines = layoutText(text || ' ', fontSize, Math.max(1, width - TEXT_PAD * 2), bold);
  return Math.ceil(lines.length * fontSize * LINE_HEIGHT + TEXT_PAD * 2);
}

/** Параметры текста стикера. `footer` — место снизу под подпись автора. */
export function stickyText(text: string, w: number, h: number, footer = 0) {
  const pad = Math.max(8, w * 0.08);
  return { pad, ...fitText(text, w - pad * 2, h - pad * 2 - footer, Math.max(10, Math.round(h * 0.16)), 4) };
}

/** Высота подписи автора стикера. */
export const authorFooter = (h: number) => Math.max(12, Math.round(h * 0.1));
