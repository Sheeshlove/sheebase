import { Map as MapIcon, Maximize, Minus, Plus } from 'lucide-react';
import { useRef } from 'react';
import { boundsOf, itemBounds, rectUnion } from '../../shared/geometry';
import { board } from './controller';
import { getState, screenToWorld, setState, useBoard } from './store';

const MM_W = 200;
const MM_H = 130;

function Minimap() {
  const items = useBoard((s) => s.items);
  const cam = useBoard((s) => s.camera);
  const vp = useBoard((s) => s.viewport);
  const dragging = useRef(false);

  const tl = screenToWorld(cam, { x: 0, y: 0 });
  const view = { x: tl.x, y: tl.y, w: vp.w / cam.zoom, h: vp.h / cam.zoom };
  const content = boundsOf(Object.keys(items), items);
  const world = rectUnion(content ? [content, view] : [view])!;
  const pad = Math.max(world.w, world.h) * 0.05;
  const W = { x: world.x - pad, y: world.y - pad, w: world.w + pad * 2, h: world.h + pad * 2 };
  const k = Math.min(MM_W / W.w, MM_H / W.h);
  const ox = (MM_W - W.w * k) / 2;
  const oy = (MM_H - W.h * k) / 2;
  const tx = (x: number) => ox + (x - W.x) * k;
  const ty = (y: number) => oy + (y - W.y) * k;

  const moveTo = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const wx = (e.clientX - r.left - ox) / k + W.x;
    const wy = (e.clientY - r.top - oy) / k + W.y;
    board.centerOn({ x: wx, y: wy });
  };

  const fillOf = (t: string, it: (typeof items)[string]) => {
    if (it.type === 'sticky') return it.color;
    if (it.type === 'shape') return it.fill === 'transparent' || it.fill === '#ffffff' ? '#ced4da' : it.fill;
    if (it.type === 'frame') return '#e9ecef';
    if (t === 'image') return '#adb5bd';
    return '#868e96';
  };

  return (
    <div
      className="minimap panel"
      data-ui
      onPointerDown={(e) => {
        dragging.current = true;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        moveTo(e);
      }}
      onPointerMove={(e) => dragging.current && moveTo(e)}
      onPointerUp={() => (dragging.current = false)}
      title="Мини-карта: кликните или перетащите, чтобы перейти"
    >
      <svg width={MM_W} height={MM_H}>
        {Object.values(items).map((it) => {
          if (it.type === 'connector') return null;
          const b = itemBounds(it, items);
          return (
            <rect
              key={it.id}
              x={tx(b.x)}
              y={ty(b.y)}
              width={Math.max(1, b.w * k)}
              height={Math.max(1, b.h * k)}
              fill={fillOf(it.type, it)}
              stroke={it.type === 'frame' ? '#adb5bd' : 'none'}
              strokeWidth={0.5}
            />
          );
        })}
        <rect x={tx(view.x)} y={ty(view.y)} width={view.w * k} height={view.h * k} className="minimap-view" />
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
