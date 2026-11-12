import { type ReactNode, useEffect, useRef, useState } from 'react';

interface PopoverProps {
  trigger: (open: boolean, toggle: () => void) => ReactNode;
  children: (close: () => void) => ReactNode;
  placement?: 'bottom' | 'right' | 'top';
  className?: string;
}

/** Простой выпадающий блок: закрывается по клику вне и по Esc. */
export function Popover({ trigger, children, placement = 'bottom', className }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className={`popover-wrap ${className ?? ''}`} ref={ref}>
      {trigger(open, () => setOpen((o) => !o))}
      {open && <div className={`popover deep popover-${placement}`}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

type NamedColor = { name?: string; value: string };

/** Образцы цвета. Название цвета — в подсказке и для экранного диктора. */
export function Swatches({
  colors,
  value,
  onPick,
  columns = 5,
}: {
  colors: NamedColor[] | string[];
  value?: string | null;
  onPick: (c: string) => void;
  columns?: number;
}) {
  const list = colors.map((c) => (typeof c === 'string' ? { value: c, name: c } : c));
  return (
    <div className="swatches" style={{ gridTemplateColumns: `repeat(${columns}, 32px)` }}>
      {list.map((c) => {
        const name = c.value === 'transparent' ? 'Без заливки' : (c.name ?? c.value);
        return (
          <button
            key={c.value}
            type="button"
            className={`swatch ${c.value === 'transparent' ? 'transparent' : ''} ${value?.toLowerCase() === c.value ? 'active' : ''}`}
            style={{ background: c.value === 'transparent' ? undefined : c.value }}
            title={name}
            aria-label={name}
            aria-pressed={value?.toLowerCase() === c.value}
            onClick={() => onPick(c.value)}
          />
        );
      })}
    </div>
  );
}

/**
 * Тона со словом на заливке (стикеры: «Идея», «Готово», «Заблокировано», «Нейтрально»).
 * По правилам системы смысл несёт слово, а не один цвет.
 */
export function ToneChips({ tones, value, onPick }: { tones: NamedColor[]; value?: string | null; onPick: (c: string) => void }) {
  return (
    <div className="tone-chips">
      {tones.map((t) => (
        <button
          key={t.value}
          type="button"
          className={`tone-chip ${value?.toLowerCase() === t.value ? 'active' : ''}`}
          style={{ background: t.value }}
          aria-pressed={value?.toLowerCase() === t.value}
          onClick={() => onPick(t.value)}
        >
          {t.name}
        </button>
      ))}
    </div>
  );
}
