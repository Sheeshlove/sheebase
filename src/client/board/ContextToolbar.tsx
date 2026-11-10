import {
  ArrowLeft,
  ArrowRight,
  BringToFront,
  Copy,
  Group,
  Lock,
  LockOpen,
  SendToBack,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignStart,
  Trash,
  Ungroup,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { PALETTE, SHAPE_KINDS, STICKY_COLORS } from '../../shared/defaults';
import { boundsOf } from '../../shared/geometry';
import type { Item, ItemPatch, LineStyle, ShapeKind } from '../../shared/types';
import { Popover, Swatches } from '../ui/Popover';
import {
  bringToFront,
  colorPatch,
  deleteSelection,
  duplicateSelection,
  groupSelection,
  primaryColor,
  sendToBack,
  toggleLock,
  ungroupSelection,
  updateSelected,
} from './actions';
import { useBoard, worldRectToScreen } from './store';
import { LineStyleIcon, ShapeIcon } from './Toolbar';

const FONT_SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 64, 80, 96, 120];
const STROKE_WIDTHS = [1, 2, 3, 4, 6, 8];

function Btn({
  title,
  onClick,
  active,
  children,
  testId,
}: {
  title: string;
  onClick: () => void;
  active?: boolean;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <button type="button" className={`ctx-btn ${active ? 'active' : ''}`} title={title} aria-label={title} onClick={onClick} data-testid={testId}>
      {children}
    </button>
  );
}

function ColorButton({ value, title, colors, onPick, testId }: { value: string | null; title: string; colors: { name?: string; value: string }[] | string[]; onPick: (c: string) => void; testId?: string }) {
  return (
    <Popover
      trigger={(_open, toggle) => (
        <button type="button" className="ctx-btn" title={title} aria-label={title} onClick={toggle} data-testid={testId}>
          <span className={`color-dot ${value === 'transparent' ? 'transparent' : ''}`} style={{ background: value && value !== 'transparent' ? value : undefined }} />
        </button>
      )}
    >
      {(close) => (
        <Swatches
          colors={colors}
          value={value}
          columns={colors.length > 10 ? 8 : 5}
          onPick={(c) => {
            onPick(c);
            close();
          }}
        />
      )}
    </Popover>
  );
}

function FontSize({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const step = (dir: 1 | -1) => {
    const list = dir > 0 ? FONT_SIZES : [...FONT_SIZES].reverse();
    const next = list.find((s) => (dir > 0 ? s > value : s < value)) ?? value;
    onChange(next);
  };
  return (
    <div className="font-size" title="Размер шрифта">
      <button type="button" className="ctx-btn small" onClick={() => step(-1)} aria-label="Уменьшить шрифт">
        −
      </button>
      <span>{Math.round(value)}</span>
      <button type="button" className="ctx-btn small" onClick={() => step(1)} aria-label="Увеличить шрифт">
        +
      </button>
    </div>
  );
}

function StrokeWidth({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <Popover
      trigger={(_o, toggle) => (
        <button type="button" className="ctx-btn" title="Толщина линии" onClick={toggle}>
          <span className="stroke-preview" style={{ height: Math.max(1, Math.min(value, 8)) }} />
        </button>
      )}
    >
      {(close) => (
        <div className="list">
          {STROKE_WIDTHS.map((w) => (
            <button
              key={w}
              type="button"
              className={`list-item ${w === value ? 'active' : ''}`}
              onClick={() => {
                onChange(w);
                close();
              }}
            >
              <span className="stroke-preview" style={{ height: w }} /> {w}px
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

const sep = <div className="ctx-sep" />;

export function ContextToolbar() {
  const sel = useBoard(useShallow((s) => s.selection.map((id) => s.items[id]).filter(Boolean) as Item[]));
  const items = useBoard((s) => s.items);
  const cam = useBoard((s) => s.camera);
  const interaction = useBoard((s) => s.interaction);
  const tool = useBoard((s) => s.tool);
  const viewport = useBoard((s) => s.viewport);

  if (!sel.length || interaction || tool !== 'select') return null;
  const b = boundsOf(
    sel.map((i) => i.id),
    items,
  );
  if (!b) return null;
  const r = worldRectToScreen(cam, b);
  const center = Math.min(Math.max(r.x + r.w / 2, 200), viewport.w - 200);
  // над рамкой выделения, с учётом кнопок «+» сверху
  let top = r.y - 88;
  if (top < 70) top = r.y + r.h + 44;
  if (top > viewport.h - 60) top = Math.max(70, viewport.h / 2);

  const types = [...new Set(sel.map((i) => i.type))];
  const one = types.length === 1 ? types[0] : null;
  const first = sel[0];
  const allLocked = sel.every((i) => i.locked);
  const set = (patch: ItemPatch) => updateSelected(() => patch);
  const colors = one === 'sticky' ? STICKY_COLORS : one === 'shape' || one === 'frame' ? PALETTE : PALETTE.filter((c) => c !== 'transparent');
  const hasColor = sel.some((i) => primaryColor(i) !== null);
  const grouped = sel.some((i) => i.groupId);

  return (
    <div
      className="context-toolbar panel"
      style={{ left: center, top }}
      data-ui
      data-testid="context-toolbar"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => {
        // сохраняем фокус в редакторе текста
        if (!(e.target as HTMLElement).closest('input')) e.preventDefault();
      }}
    >
      {allLocked ? (
        <Btn title="Разблокировать (Ctrl+Shift+L)" onClick={toggleLock}>
          <LockOpen size={18} /> <span className="ctx-label">Разблокировать</span>
        </Btn>
      ) : (
        <>
          {one === 'shape' && first.type === 'shape' && (
            <>
              <Popover
                trigger={(_o, toggle) => (
                  <button type="button" className="ctx-btn" title="Тип фигуры" onClick={toggle}>
                    <ShapeIcon kind={first.shape} />
                  </button>
                )}
              >
                {(close) => (
                  <div className="icon-grid">
                    {SHAPE_KINDS.map((s) => (
                      <button
                        key={s.kind}
                        type="button"
                        className={`icon-btn ${first.shape === s.kind ? 'active' : ''}`}
                        title={s.name}
                        onClick={() => {
                          set({ shape: s.kind as ShapeKind });
                          close();
                        }}
                      >
                        <ShapeIcon kind={s.kind} />
                      </button>
                    ))}
                  </div>
                )}
              </Popover>
              {sep}
            </>
          )}

          {hasColor && (
            <ColorButton
              title={one === 'shape' ? 'Заливка' : 'Цвет'}
              value={primaryColor(first)}
              colors={colors}
              onPick={(c) => updateSelected((it) => colorPatch(it, c))}
              testId="ctx-color"
            />
          )}

          {one === 'shape' && first.type === 'shape' && (
            <>
              <ColorButton title="Цвет обводки" value={first.stroke} colors={PALETTE.filter((c) => c !== 'transparent')} onPick={(c) => set({ stroke: c })} />
              <StrokeWidth value={first.strokeWidth} onChange={(v) => set({ strokeWidth: v })} />
              {sep}
              <FontSize value={first.fontSize} onChange={(v) => set({ fontSize: v })} />
              <ColorButton title="Цвет текста" value={first.textColor} colors={PALETTE.filter((c) => c !== 'transparent')} onPick={(c) => set({ textColor: c })} />
            </>
          )}

          {one === 'text' && first.type === 'text' && (
            <>
              {sep}
              <FontSize value={first.fontSize} onChange={(v) => set({ fontSize: v })} />
              <Btn title="Жирный" active={first.bold} onClick={() => set({ bold: !first.bold })}>
                <b>B</b>
              </Btn>
              <Btn title="По левому краю" active={first.align === 'left'} onClick={() => set({ align: 'left' })}>
                <TextAlignStart size={18} />
              </Btn>
              <Btn title="По центру" active={first.align === 'center'} onClick={() => set({ align: 'center' })}>
                <TextAlignCenter size={18} />
              </Btn>
              <Btn title="По правому краю" active={first.align === 'right'} onClick={() => set({ align: 'right' })}>
                <TextAlignEnd size={18} />
              </Btn>
            </>
          )}

          {one === 'connector' && first.type === 'connector' && (
            <>
              <StrokeWidth value={first.strokeWidth} onChange={(v) => set({ strokeWidth: v })} />
              {sep}
              {(['straight', 'elbow', 'curved'] as LineStyle[]).map((ls) => (
                <Btn key={ls} title={{ straight: 'Прямая', elbow: 'Ломаная', curved: 'Кривая' }[ls]} active={first.lineStyle === ls} onClick={() => set({ lineStyle: ls })}>
                  <LineStyleIcon style={ls} />
                </Btn>
              ))}
              {sep}
              <Btn title="Стрелка в начале" active={first.startArrow === 'arrow'} onClick={() => set({ startArrow: first.startArrow === 'arrow' ? 'none' : 'arrow' })}>
                <ArrowLeft size={18} />
              </Btn>
              <Btn title="Стрелка в конце" active={first.endArrow === 'arrow'} onClick={() => set({ endArrow: first.endArrow === 'arrow' ? 'none' : 'arrow' })}>
                <ArrowRight size={18} />
              </Btn>
            </>
          )}

          {one === 'path' && first.type === 'path' && <StrokeWidth value={first.strokeWidth} onChange={(v) => set({ strokeWidth: v })} />}

          {sep}
          <Btn title="Дублировать (Ctrl+D)" onClick={duplicateSelection}>
            <Copy size={18} />
          </Btn>
          <Btn title="На передний план (PageUp)" onClick={bringToFront}>
            <BringToFront size={18} />
          </Btn>
          <Btn title="На задний план (PageDown)" onClick={sendToBack}>
            <SendToBack size={18} />
          </Btn>
          {sel.length > 1 && !grouped && (
            <Btn title="Сгруппировать (Ctrl+G)" onClick={groupSelection}>
              <Group size={18} />
            </Btn>
          )}
          {grouped && (
            <Btn title="Разгруппировать (Ctrl+Shift+G)" onClick={ungroupSelection}>
              <Ungroup size={18} />
            </Btn>
          )}
          <Btn title="Заблокировать (Ctrl+Shift+L)" onClick={toggleLock}>
            <Lock size={18} />
          </Btn>
          <Btn title="Удалить (Delete)" onClick={deleteSelection} testId="ctx-delete">
            <Trash size={18} />
          </Btn>
        </>
      )}
    </div>
  );
}
