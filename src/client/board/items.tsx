import { type CSSProperties, memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  arrowHeadPath,
  connectorGeometry,
  geometryPath,
  shapePath,
  shapeTextBox,
  smoothPath,
} from '../../shared/geometry';
import type {
  ConnectorItem,
  FrameItem,
  ImageItem,
  Item,
  ItemMap,
  PathItem,
  ShapeItem,
  StickyItem,
  TextItem,
} from '../../shared/types';
import { stopEditing, updateItems } from './actions';
import { getState, useBoard } from './store';
import { fitText, layoutText, LINE_HEIGHT, stickyText, TEXT_PAD } from './text';

const boxStyle = (it: Item): CSSProperties => ({
  width: it.w,
  height: it.h,
  transform: `translate(${it.x}px, ${it.y}px)`,
});

function Lines({ lines }: { lines: string[] }) {
  return (
    <>
      {lines.map((l, i) => (
        <div key={i} className="line">
          {l || ' '}
        </div>
      ))}
    </>
  );
}

// ------------------------------------------------------------------ редактор текста

interface EditorProps {
  itemId: string;
  value: string;
  onChange: (text: string) => void;
  className?: string;
  style?: CSSProperties;
  placeholder?: string;
}

/**
 * Встроенный редактор (contentEditable). Неконтролируемый: React не трогает
 * содержимое после монтирования, чтобы не сбивать каретку.
 */
function TextEditor({ itemId, value, onChange, className, style, placeholder }: EditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  const initial = useRef(value);

  useLayoutEffect(() => {
    const el = ref.current!;
    el.innerText = initial.current;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, []);

  const read = () => {
    // innerText у пустого contentEditable может вернуть "\n"
    const t = ref.current!.innerText.replace(/ /g, ' ');
    return t === '\n' ? '' : t.replace(/\n$/, '');
  };

  return (
    <div
      ref={ref}
      data-editor="1"
      className={`editor ${className ?? ''}`}
      style={style}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      data-placeholder={placeholder}
      onInput={() => onChange(read())}
      onPaste={(e) => {
        e.preventDefault();
        const text = e.clipboardData.getData('text/plain');
        document.execCommand('insertText', false, text);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          stopEditing();
        }
      }}
      onBlur={() => {
        // blur при клике вне — завершаем редактирование
        setTimeout(() => {
          const el = ref.current;
          if (getState().editingId === itemId && (!el || document.activeElement !== el)) stopEditing();
        }, 0);
      }}
    />
  );
}

const editText = (id: string, field: 'text' | 'label' | 'title') => (text: string) => updateItems([{ id, patch: { [field]: text } }]);

// ------------------------------------------------------------------ объекты

function StickyView({ item, editing }: { item: StickyItem; editing: boolean }) {
  const t = useMemo(() => stickyText(item.text, item.w, item.h), [item.text, item.w, item.h]);
  const style: CSSProperties = { padding: t.pad, fontSize: t.size, lineHeight: LINE_HEIGHT };
  return (
    <div className="item sticky" data-id={item.id} style={{ ...boxStyle(item), background: item.color }}>
      {editing ? (
        <div className="text-center" style={style}>
          <TextEditor itemId={item.id} value={item.text} onChange={editText(item.id, 'text')} className="center" style={{ minHeight: `${LINE_HEIGHT}em` }} />
        </div>
      ) : (
        <div className="text-center" style={style}>
          <div>
            <Lines lines={t.lines} />
          </div>
        </div>
      )}
    </div>
  );
}

function ShapeView({ item, editing }: { item: ShapeItem; editing: boolean }) {
  const box = shapeTextBox(item.shape, item.w, item.h);
  const t = useMemo(
    () => fitText(item.text, box.w, box.h, item.fontSize, 6),
    [item.text, box.w, box.h, item.fontSize],
  );
  const d = useMemo(() => shapePath(item.shape, item.w, item.h), [item.shape, item.w, item.h]);
  const textStyle: CSSProperties = {
    left: box.x,
    top: box.y,
    width: box.w,
    height: box.h,
    color: item.textColor,
    fontSize: editing ? item.fontSize : t.size,
    lineHeight: LINE_HEIGHT,
  };
  return (
    <div className="item shape" data-id={item.id} style={boxStyle(item)}>
      <svg className="shape-svg" width={item.w} height={item.h}>
        <path
          d={d}
          fill={item.fill === 'transparent' ? 'none' : item.fill}
          stroke={item.strokeWidth > 0 ? item.stroke : 'none'}
          strokeWidth={item.strokeWidth}
          strokeLinejoin="round"
        />
      </svg>
      <div className="text-center abs" style={textStyle}>
        {editing ? (
          <TextEditor itemId={item.id} value={item.text} onChange={editText(item.id, 'text')} className="center" style={{ minHeight: `${LINE_HEIGHT}em` }} />
        ) : (
          <div>
            <Lines lines={t.lines} />
          </div>
        )}
      </div>
    </div>
  );
}

function TextView({ item, editing }: { item: TextItem; editing: boolean }) {
  const lines = useMemo(
    () => layoutText(item.text, item.fontSize, Math.max(1, item.w - TEXT_PAD * 2), item.bold),
    [item.text, item.fontSize, item.w, item.bold],
  );
  const style: CSSProperties = {
    ...boxStyle(item),
    height: editing ? 'auto' : item.h,
    minHeight: item.h,
    padding: TEXT_PAD,
    fontSize: item.fontSize,
    lineHeight: LINE_HEIGHT,
    fontWeight: item.bold ? 700 : 400,
    color: item.color,
    textAlign: item.align,
  };
  return (
    <div className="item text" data-id={item.id} style={style}>
      {editing ? (
        <TextEditor itemId={item.id} value={item.text} onChange={editText(item.id, 'text')} placeholder="Введите текст" />
      ) : (
        <Lines lines={lines} />
      )}
    </div>
  );
}

function FrameView({ item, editing }: { item: FrameItem; editing: boolean }) {
  const zoom = useBoard((s) => s.camera.zoom);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);
  return (
    <>
      <div
        className="item frame"
        data-id={item.id}
        data-frame-body="1"
        style={{ ...boxStyle(item), background: item.fill === 'transparent' ? 'rgba(255,255,255,0.4)' : item.fill }}
      />
      <div
        className="frame-title"
        data-id={item.id}
        style={{
          transform: `translate(${item.x}px, ${item.y}px) scale(${1 / zoom}) translateY(-100%)`,
          maxWidth: Math.max(60, item.w * zoom),
        }}
      >
        {editing ? (
          <input
            ref={inputRef}
            data-editor="1"
            className="frame-title-input"
            defaultValue={item.title}
            maxLength={200}
            onChange={(e) => updateItems([{ id: item.id, patch: { title: e.target.value } }])}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' || e.key === 'Escape') stopEditing();
            }}
            onBlur={() => getState().editingId === item.id && stopEditing()}
          />
        ) : (
          item.title || 'Фрейм'
        )}
      </div>
    </>
  );
}

function ImageView({ item }: { item: ImageItem }) {
  return (
    <div className="item image" data-id={item.id} style={boxStyle(item)}>
      <img src={item.src} alt="" draggable={false} />
    </div>
  );
}

function PathView({ item }: { item: PathItem }) {
  const d = useMemo(() => smoothPath(item.points), [item.points]);
  return (
    <div className="item path" data-id={item.id} style={boxStyle(item)}>
      <svg className="overflow" width={Math.max(1, item.w)} height={Math.max(1, item.h)}>
        <path d={d} fill="none" stroke={item.stroke} strokeWidth={item.strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
        <path d={d} className="hit" fill="none" strokeWidth={item.strokeWidth + 14} strokeLinecap="round" />
      </svg>
    </div>
  );
}

function ConnectorView({ item, editing }: { item: ConnectorItem; editing: boolean }) {
  const a = useBoard((s) => (item.from.itemId ? s.items[item.from.itemId] : undefined));
  const b = useBoard((s) => (item.to.itemId ? s.items[item.to.itemId] : undefined));
  const g = useMemo(() => {
    const map: ItemMap = {};
    if (a) map[a.id] = a;
    if (b) map[b.id] = b;
    return connectorGeometry(item, map);
  }, [item, a, b]);
  const pad = 30 + item.strokeWidth * 3;
  const xs = g.points.map((p) => p.x);
  const ys = g.points.map((p) => p.y);
  const bx = Math.min(...xs) - pad;
  const by = Math.min(...ys) - pad;
  const bw = Math.max(...xs) + pad - bx;
  const bh = Math.max(...ys) + pad - by;
  const d = geometryPath(g);
  return (
    <div className="item connector" data-id={item.id} style={{ width: bw, height: bh, transform: `translate(${bx}px, ${by}px)` }}>
      <svg width={bw} height={bh}>
        <g transform={`translate(${-bx} ${-by})`}>
          <path d={d} fill="none" stroke={item.stroke} strokeWidth={item.strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
          {item.endArrow === 'arrow' && <path d={arrowHeadPath(g.end, g.endDir, item.strokeWidth)} fill={item.stroke} />}
          {item.startArrow === 'arrow' && <path d={arrowHeadPath(g.start, g.startDir, item.strokeWidth)} fill={item.stroke} />}
          <path d={d} className="hit" fill="none" strokeWidth={item.strokeWidth + 16} />
        </g>
      </svg>
      {(item.label || editing) && (
        <div className="connector-label" style={{ left: g.mid.x - bx, top: g.mid.y - by }}>
          {editing ? <TextEditor itemId={item.id} value={item.label} onChange={editText(item.id, 'label')} placeholder="Подпись" /> : item.label}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ диспетчер

export const ItemView = memo(function ItemView({ id }: { id: string }) {
  const item = useBoard((s) => s.items[id]);
  const editing = useBoard((s) => s.editingId === id);
  if (!item) return null;
  switch (item.type) {
    case 'sticky':
      return <StickyView item={item} editing={editing} />;
    case 'shape':
      return <ShapeView item={item} editing={editing} />;
    case 'text':
      return <TextView item={item} editing={editing} />;
    case 'frame':
      return <FrameView item={item} editing={editing} />;
    case 'image':
      return <ImageView item={item} />;
    case 'path':
      return <PathView item={item} />;
    case 'connector':
      return <ConnectorView item={item} editing={editing} />;
  }
});

/** Черновик штриха пера, пока пользователь рисует. */
export function DraftLayer() {
  const draft = useBoard((s) => s.draft);
  const eraser = useBoard((s) => s.eraser);
  const zoom = useBoard((s) => s.camera.zoom);
  const tool = useBoard((s) => s.tool);
  return (
    <>
      {draft && draft.points.length >= 2 && (
        <svg className="draft">
          <path
            d={smoothPath(draft.points)}
            fill="none"
            stroke={draft.color}
            strokeWidth={draft.width}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
      {tool === 'eraser' && eraser && (
        <div
          className="eraser-cursor"
          style={{ width: 20 / zoom, height: 20 / zoom, transform: `translate(${eraser.x - 10 / zoom}px, ${eraser.y - 10 / zoom}px)`, borderWidth: 1.5 / zoom }}
        />
      )}
    </>
  );
}

