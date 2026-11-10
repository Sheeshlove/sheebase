import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
} from 'lucide-react';
import { type ReactNode, useEffect } from 'react';
import type { AlignMode } from '../../shared/layout';
import {
  alignSelection,
  bringToFront,
  copySelectionToClipboard,
  createAndEdit,
  createSticky,
  deleteSelection,
  distributeSelection,
  duplicateSelection,
  groupSelection,
  pasteFromClipboard,
  selectAll,
  sendToBack,
  startComment,
  toggleLock,
  ungroupSelection,
} from './actions';
import { board } from './controller';
import { exportPng } from './exporter';
import { getState, setState, useBoard } from './store';

export const ALIGN_BUTTONS: { mode: AlignMode; title: string; icon: ReactNode }[] = [
  { mode: 'left', title: 'По левому краю (Alt+A)', icon: <AlignStartVertical size={16} /> },
  { mode: 'hcenter', title: 'По центру по горизонтали (Alt+H)', icon: <AlignCenterVertical size={16} /> },
  { mode: 'right', title: 'По правому краю (Alt+D)', icon: <AlignEndVertical size={16} /> },
  { mode: 'top', title: 'По верхнему краю (Alt+W)', icon: <AlignStartHorizontal size={16} /> },
  { mode: 'vmiddle', title: 'По середине по вертикали (Alt+V)', icon: <AlignCenterHorizontal size={16} /> },
  { mode: 'bottom', title: 'По нижнему краю (Alt+S)', icon: <AlignEndHorizontal size={16} /> },
];

/** Кнопки выравнивания и распределения (контекстное меню и контекстная панель). */
export function AlignButtons({ count, onDone }: { count: number; onDone?: () => void }) {
  return (
    <div className="align-grid">
      {ALIGN_BUTTONS.map((b) => (
        <button
          key={b.mode}
          type="button"
          className="icon-btn small"
          title={b.title}
          aria-label={b.title}
          data-testid={`align-${b.mode}`}
          onClick={() => {
            alignSelection(b.mode);
            onDone?.();
          }}
        >
          {b.icon}
        </button>
      ))}
      <button
        type="button"
        className="icon-btn small"
        disabled={count < 3}
        title="Распределить по горизонтали (Alt+Shift+H)"
        onClick={() => {
          distributeSelection('x');
          onDone?.();
        }}
      >
        <AlignHorizontalDistributeCenter size={16} />
      </button>
      <button
        type="button"
        className="icon-btn small"
        disabled={count < 3}
        title="Распределить по вертикали (Alt+Shift+V)"
        onClick={() => {
          distributeSelection('y');
          onDone?.();
        }}
      >
        <AlignVerticalDistributeCenter size={16} />
      </button>
    </div>
  );
}

function Item({ label, hint, onClick, danger, disabled }: { label: string; hint?: string; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button type="button" className={`menu-item ${danger ? 'danger' : ''}`} onClick={onClick} disabled={disabled}>
      <span>{label}</span>
      {hint && <kbd>{hint}</kbd>}
    </button>
  );
}

export function ContextMenu() {
  const menu = useBoard((s) => s.contextMenu);
  const selection = useBoard((s) => s.selection);
  const items = useBoard((s) => s.items);
  const viewport = useBoard((s) => s.viewport);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target as Element).closest?.('.context-menu')) setState({ contextMenu: null });
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setState({ contextMenu: null });
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [menu]);

  if (!menu) return null;
  const close = () => setState({ contextMenu: null });
  const act = (fn: () => void) => () => {
    close();
    fn();
  };
  const sel = selection.map((id) => items[id]).filter(Boolean);
  const onSelection = menu.onItem && sel.length > 0;
  const allLocked = sel.length > 0 && sel.every((i) => i.locked);
  const grouped = sel.some((i) => i.groupId);
  const unlocked = sel.filter((i) => !i.locked && i.type !== 'connector').length;
  const style = { left: Math.min(menu.x, viewport.w - 250), top: Math.min(menu.y, Math.max(70, viewport.h - (onSelection ? 470 : 230))) };

  return (
    <div className="context-menu panel" style={style} data-ui data-testid="context-menu" onContextMenu={(e) => e.preventDefault()}>
      {onSelection ? (
        <>
          <Item label="Копировать" hint="Ctrl+C" onClick={act(() => copySelectionToClipboard())} />
          <Item label="Вырезать" hint="Ctrl+X" onClick={act(() => copySelectionToClipboard(true))} disabled={allLocked} />
          <Item label="Вставить" hint="Ctrl+V" onClick={act(() => void pasteFromClipboard(menu.world))} />
          <Item label="Дублировать" hint="Ctrl+D" onClick={act(duplicateSelection)} />
          <div className="menu-sep" />
          <Item label="На передний план" hint="PgUp" onClick={act(bringToFront)} />
          <Item label="На задний план" hint="PgDn" onClick={act(sendToBack)} />
          {sel.length > 1 && !grouped && <Item label="Сгруппировать" hint="Ctrl+G" onClick={act(groupSelection)} />}
          {grouped && <Item label="Разгруппировать" hint="Ctrl+Shift+G" onClick={act(ungroupSelection)} />}
          <Item label={allLocked ? 'Разблокировать' : 'Заблокировать'} hint="Ctrl+Shift+L" onClick={act(toggleLock)} />
          {unlocked > 1 && (
            <>
              <div className="menu-sep" />
              <div className="menu-label">Выровнять и распределить</div>
              <AlignButtons count={unlocked} onDone={close} />
            </>
          )}
          <div className="menu-sep" />
          <Item
            label="Добавить комментарий"
            hint="C"
            onClick={act(() => startComment(menu.world, sel.length === 1 && sel[0].type !== 'connector' && sel[0].type !== 'path' ? sel[0].id : null))}
          />
          <Item label="Экспорт выделения в PNG" onClick={act(() => void exportPng())} />
          <div className="menu-sep" />
          <Item label="Удалить" hint="Del" danger onClick={act(deleteSelection)} disabled={allLocked} />
        </>
      ) : (
        <>
          <Item label="Вставить" hint="Ctrl+V" onClick={act(() => void pasteFromClipboard(menu.world))} />
          <Item label="Добавить стикер здесь" onClick={act(() => createAndEdit(() => createSticky(menu.world)))} />
          <Item label="Добавить комментарий здесь" hint="C" onClick={act(() => startComment(menu.world, null))} />
          <div className="menu-sep" />
          <Item label="Выделить всё" hint="Ctrl+A" onClick={act(selectAll)} />
          <Item label="Вписать всё" hint="Shift+1" onClick={act(() => board.zoomToFit())} />
          <Item label="Найти на доске" hint="Ctrl+F" onClick={act(() => setState({ search: { ...getState().search, open: true } }))} />
        </>
      )}
    </div>
  );
}
