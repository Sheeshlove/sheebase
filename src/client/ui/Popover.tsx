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
      {open && <div className={`popover popover-${placement}`}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

export function Swatches({
  colors,
  value,
  onPick,
  columns = 8,
}: {
  colors: { name?: string; value: string }[] | string[];
  value?: string | null;
  onPick: (c: string) => void;
  columns?: number;
}) {
  const list = colors.map((c) => (typeof c === 'string' ? { value: c, name: c } : c));
  return (
    <div className="swatches" style={{ gridTemplateColumns: `repeat(${columns}, 24px)` }}>
      {list.map((c) => (
        <button
          key={c.value}
          type="button"
          className={`swatch ${c.value === 'transparent' ? 'transparent' : ''} ${value === c.value ? 'active' : ''}`}
          style={{ background: c.value === 'transparent' ? undefined : c.value }}
          title={c.name === 'transparent' ? 'Без заливки' : c.name}
          aria-label={c.name}
          onClick={() => onPick(c.value)}
        />
      ))}
    </div>
  );
}
