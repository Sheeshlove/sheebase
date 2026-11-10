import { Map as MapIcon, Maximize, Minus, Plus } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { boundsOf, itemBounds, type Rect, rectUnion } from '../../shared/geometry';
import type { Item } from '../../shared/types';
import { board } from './controller';
import { getState, screenToWorld, setState, useBoard } from './store';

const MM_W = 200;
const MM_H = 130;

type MapFrame = { W: Rect; k: number; ox: number; oy: number };

function fillOf(it: Item): string {
  switch (it.type) {
    case 'sticky':
      return it.color;
    case 'shape':
      return it.fill === 'transparent' || it.fill === '#ffffff' ? '#ced4da' : it.fill;
    case 'frame':
      return '#e9ecef';
    case 'image':
      return '#adb5bd';
    default:
      return '#868e96';
  }
}

function Minimap() {
  const items = useBoard((s) => s.items);
  const cam = useBoard((s) => s.camera);
  const vp = useBoard((s) => s.viewport);
  /** Отображение мир → мини-карта, зафиксированное на время перетаскивания (иначе вид «убегает»). */
  const frozen = useRef<MapFrame | null>(null);

  // Содержимое зависит только от объектов — не пересчитывается при панорамировании
  const content = useMemo(() => {
    const ids = Object.keys(items);
    const rects = Object.values(items)
      .filter((it) => it.type !== 'connector')
      .map((it) => {
        const b = itemBounds(it, items);
        return (
          <rect
            key={it.id}
            x={b.x}
            y={b.y}
            width={Math.max(1, b.w)}
            height={Math.max(1, b.h)}
            fill={fillOf(it)}
            stroke={it.type === 'frame' ? '#adb5bd' : 'none'}
            strokeWidth={0.5}
            vectorEffect="non-scaling-stroke"
          />
        );
      });
    return { bounds: boundsOf(ids, items), rects };
  }, [items]);

  const tl = screenToWorld(cam, { x: 0, y: 0 });
  const view = { x: tl.x, y: tl.y, w: vp.w / cam.zoom, h: vp.h / cam.zoom };
  const live = (): MapFrame => {
    const world = rectUnion(content.bounds ? [content.bounds, view] : [view])!;
    const pad = Math.max(world.w, world.h) * 0.05;
    const W = { x: world.x - pad, y: world.y - pad, w: world.w + pad * 2, h: world.h + pad * 2 };
    const k = Math.min(MM_W / W.w, MM_H / W.h);
    return { W, k, ox: (MM_W - W.w * k) / 2, oy: (MM_H - W.h * k) / 2 };
  };
  const f = frozen.current ?? live();
  const tx = (x: number) => f.ox + (x - f.W.x) * f.k;
  const ty = (y: number) => f.oy + (y - f.W.y) * f.k;

  const moveTo = (e: React.PointerEvent, frame: MapFrame) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    board.centerOn({ x: (e.clientX - r.left - frame.ox) / frame.k + frame.W.x, y: (e.clientY - r.top - frame.oy) / frame.k + frame.W.y });
  };

  return (
    <div
      className="minimap panel"
      data-ui
      onPointerDown={(e) => {
        frozen.current = f;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        moveTo(e, f);
      }}
      onPointerMove={(e) => frozen.current && moveTo(e, frozen.current)}
      onPointerUp={() => (frozen.current = null)}
      onPointerCancel={() => (frozen.current = null)}
      title="Мини-карта: кликните или перетащите, чтобы перейти"
    >
      <svg width={MM_W} height={MM_H}>
        <g transform={`translate(${f.ox - f.W.x * f.k} ${f.oy - f.W.y * f.k}) scale(${f.k})`}>{content.rects}</g>
        <rect x={tx(view.x)} y={ty(view.y)} width={view.w * f.k} height={view.h * f.k} className="minimap-view" />
      </svg>
    </div>
  );
}

export function NavControls() {
  const zoom = useBoard((s) => s.camera.zoom);
  const showMinimap = useBoard((s) => s.showMinimap);
  return (
    <div className="nav-wrap">
      {showMinimap && <Minimap />}
      <div className="zoom panel" data-ui>
        <button
          type="button"
          className="icon-btn"
          title="Мини-карта"
          aria-pressed={showMinimap}
          onClick={() => setState({ showMinimap: !getState().showMinimap })}
        >
          <MapIcon size={18} />
        </button>
        <div className="sep-v" />
        <button type="button" className="icon-btn" title="Уменьшить (−)" onClick={() => board.zoomAt(zoom / 1.25)} aria-label="Уменьшить">
          <Minus size={18} />
        </button>
        <button type="button" className="zoom-value" title="Масштаб 100% (Shift+0)" onClick={() => board.zoomAt(1)} data-testid="zoom-value">
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" className="icon-btn" title="Увеличить (+)" onClick={() => board.zoomAt(zoom * 1.25)} aria-label="Увеличить">
          <Plus size={18} />
        </button>
        <button type="button" className="icon-btn" title="Вписать всё (Shift+1)" onClick={() => board.zoomToFit()} aria-label="Вписать всё">
          <Maximize size={18} />
        </button>
      </div>
    </div>
  );
}
