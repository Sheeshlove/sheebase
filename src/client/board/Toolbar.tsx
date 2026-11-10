import {
  Eraser,
  Frame,
  Hand,
  ImagePlus,
  LayoutTemplate,
  ListOrdered,
  MessageSquarePlus,
  MousePointer2,
  PenLine,
  Redo2,
  Shapes,
  Spline,
  StickyNote,
  Type,
  Undo2,
} from 'lucide-react';
import { type ReactNode, useRef } from 'react';
import { PALETTE, SHAPE_KINDS, STICKY_COLORS } from '../../shared/defaults';
import { shapePath } from '../../shared/geometry';
import type { LineStyle, ShapeKind } from '../../shared/types';
import { TEMPLATES } from '../../shared/templates';
import { Popover, Swatches } from '../ui/Popover';
import { insertImageFile, insertTemplate, redo, setTool, undo } from './actions';
import { getState, setState, type Tool, useBoard, votingActive } from './store';

function ToolButton({
  tool,
  icon,
  label,
  hotkey,
}: {
  tool: Tool;
  icon: ReactNode;
  label: string;
  hotkey: string;
}) {
  const active = useBoard((s) => s.tool === tool);
  return (
    <button
      type="button"
      className={`tool-btn ${active ? 'active' : ''}`}
      onClick={() => setTool(tool)}
      title={`${label} (${hotkey})`}
      aria-label={label}
      aria-pressed={active}
      data-tool={tool}
    >
      {icon}
    </button>
  );
}

export function ShapeIcon({ kind, size = 20 }: { kind: ShapeKind; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="-2 -2 24 24">
      <path d={shapePath(kind, 20, 20)} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

const LINE_STYLES: { style: LineStyle; name: string; d: string }[] = [
  { style: 'straight', name: 'Прямая', d: 'M3 17 L17 3' },
  { style: 'elbow', name: 'Ломаная', d: 'M3 17 H10 V3 H17' },
  { style: 'curved', name: 'Кривая', d: 'M3 17 C 12 17, 8 3, 17 3' },
];

export function LineStyleIcon({ style }: { style: LineStyle }) {
  const d = LINE_STYLES.find((l) => l.style === style)!.d;
  return (
    <svg width="20" height="20" viewBox="0 0 20 20">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** Дополнительные настройки активного инструмента (цвет стикера, фигура, перо…). */
function ToolOptions() {
  const tool = useBoard((s) => s.tool);
  const stickyColor = useBoard((s) => s.stickyColor);
  const shapeKind = useBoard((s) => s.shapeKind);
  const penColor = useBoard((s) => s.penColor);
  const penWidth = useBoard((s) => s.penWidth);
  const connectorStyle = useBoard((s) => s.connectorStyle);

  if (tool === 'sticky') {
    return (
      <div className="tool-options" data-ui>
        <div className="tool-options-title">Цвет стикера</div>
        <Swatches colors={STICKY_COLORS} value={stickyColor} onPick={(c) => setState({ stickyColor: c })} columns={5} />
        <div className="hint">Кликните на холст, чтобы поставить стикер</div>
      </div>
    );
  }
  if (tool === 'shape') {
    return (
      <div className="tool-options" data-ui>
        <div className="tool-options-title">Фигура</div>
        <div className="icon-grid">
          {SHAPE_KINDS.map((s) => (
            <button
              key={s.kind}
              type="button"
              className={`icon-btn ${shapeKind === s.kind ? 'active' : ''}`}
              title={s.name}
              onClick={() => setState({ shapeKind: s.kind })}
            >
              <ShapeIcon kind={s.kind} />
            </button>
          ))}
        </div>
        <div className="hint">Кликните или протяните на холсте. Shift — пропорционально</div>
      </div>
    );
  }
  if (tool === 'pen') {
    return (
      <div className="tool-options" data-ui>
        <div className="tool-options-title">Цвет и толщина</div>
        <Swatches colors={PALETTE.filter((c) => c !== 'transparent' && c !== '#ffffff')} value={penColor} onPick={(c) => setState({ penColor: c })} columns={7} />
        <div className="width-row">
          {[2, 4, 8, 14].map((w) => (
            <button key={w} type="button" className={`icon-btn ${penWidth === w ? 'active' : ''}`} onClick={() => setState({ penWidth: w })} title={`${w} px`}>
              <span className="dot" style={{ width: w + 2, height: w + 2 }} />
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (tool === 'connector') {
    return (
      <div className="tool-options" data-ui>
        <div className="tool-options-title">Тип линии</div>
        <div className="icon-grid">
          {LINE_STYLES.map((l) => (
            <button
              key={l.style}
              type="button"
              className={`icon-btn ${connectorStyle === l.style ? 'active' : ''}`}
              title={l.name}
              onClick={() => setState({ connectorStyle: l.style })}
            >
              <LineStyleIcon style={l.style} />
            </button>
          ))}
        </div>
        <div className="hint">Протяните от объекта к объекту</div>
      </div>
    );
  }
  return null;
}

export function Toolbar() {
  const canUndo = useBoard((s) => s.canUndo);
  const canRedo = useBoard((s) => s.canRedo);
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="toolbar-wrap">
      <div className="toolbar panel" data-ui>
        <ToolButton tool="select" icon={<MousePointer2 size={20} />} label="Выбор" hotkey="V" />
        <ToolButton tool="hand" icon={<Hand size={20} />} label="Рука" hotkey="H" />
        <div className="sep" />
        <ToolButton tool="sticky" icon={<StickyNote size={20} />} label="Стикер" hotkey="N" />
        <ToolButton tool="text" icon={<Type size={20} />} label="Текст" hotkey="T" />
        <ToolButton tool="shape" icon={<Shapes size={20} />} label="Фигуры" hotkey="S" />
        <ToolButton tool="connector" icon={<Spline size={20} />} label="Коннектор" hotkey="L" />
        <ToolButton tool="pen" icon={<PenLine size={20} />} label="Перо" hotkey="P" />
        <ToolButton tool="eraser" icon={<Eraser size={20} />} label="Ластик" hotkey="E" />
        <ToolButton tool="frame" icon={<Frame size={20} />} label="Фрейм" hotkey="F" />
        <ToolButton tool="comment" icon={<MessageSquarePlus size={20} />} label="Комментарий" hotkey="C" />
        <button type="button" className="tool-btn" title="Изображение" aria-label="Изображение" onClick={() => fileRef.current?.click()}>
          <ImagePlus size={20} />
        </button>
        <Popover
          placement="right"
          trigger={(_o, toggle) => (
            <button
              type="button"
              className="tool-btn"
              title="Вставить шаблон"
              aria-label="Вставить шаблон"
              onClick={() => (votingActive() ? undefined : toggle())}
              data-testid="templates-button"
            >
              <LayoutTemplate size={20} />
            </button>
          )}
        >
          {(close) => (
            <div className="list">
              <div className="list-title">Вставить шаблон в центр экрана</div>
              {TEMPLATES.filter((t) => t.id !== 'blank').map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className="list-item"
                  data-testid={`insert-template-${t.id}`}
                  onClick={() => {
                    close();
                    insertTemplate(t.id);
                  }}
                >
                  <div>
                    <div>{t.name}</div>
                    <div className="muted small-text">{t.description}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </Popover>
        <button
          type="button"
          className="tool-btn"
          title="Фреймы и презентация"
          aria-label="Фреймы и презентация"
          onClick={() => setState({ panel: getState().panel === 'frames' ? null : 'frames' })}
          data-testid="frames-button"
        >
          <ListOrdered size={20} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void insertImageFile(f);
            e.target.value = '';
          }}
        />
      </div>
      <div className="toolbar panel" data-ui>
        <button type="button" className="tool-btn" disabled={!canUndo} onClick={undo} title="Отменить (Ctrl+Z)" aria-label="Отменить">
          <Undo2 size={20} />
        </button>
        <button type="button" className="tool-btn" disabled={!canRedo} onClick={redo} title="Повторить (Ctrl+Shift+Z)" aria-label="Повторить">
          <Redo2 size={20} />
        </button>
      </div>
      <ToolOptions />
    </div>
  );
}
