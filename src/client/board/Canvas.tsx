import { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { ItemMap } from '../../shared/types';
import { Interactions } from './interactions';
import { DraftLayer, ItemView } from './items';
import { Overlay } from './Overlay';
import { setState, useBoard } from './store';

let lastItems: ItemMap | null = null;
let lastOrder: string[] = [];

/** Порядок отрисовки: фреймы → остальные объекты → коннекторы (внутри слоя — по z). */
function renderOrder(items: ItemMap): string[] {
  if (items === lastItems) return lastOrder;
  const layer = (t: string) => (t === 'frame' ? 0 : t === 'connector' ? 2 : 1);
  lastOrder = Object.values(items)
    .sort((a, b) => layer(a.type) - layer(b.type) || a.z - b.z || (a.id < b.id ? -1 : 1))
    .map((i) => i.id);
  lastItems = items;
  return lastOrder;
}

export let interactions: Interactions | null = null;

export function Canvas() {
  const ref = useRef<HTMLDivElement>(null);
  const camera = useBoard((s) => s.camera);
  const order = useBoard(useShallow((s) => renderOrder(s.items)));
  const tool = useBoard((s) => s.tool);
  const panning = useBoard((s) => s.panning);
  const spacePan = useBoard((s) => s.spacePan);

  useEffect(() => {
    const el = ref.current!;
    const it = new Interactions(el);
    interactions = it;
    const ro = new ResizeObserver(() => setState({ viewport: { w: el.clientWidth, h: el.clientHeight } }));
    ro.observe(el);
    setState({ viewport: { w: el.clientWidth, h: el.clientHeight } });
    const onWheel = (e: WheelEvent) => it.wheel(e);
    el.addEventListener('wheel', onWheel, { passive: false });
    // жесты Safari
    const prevent = (e: Event) => e.preventDefault();
    el.addEventListener('gesturestart', prevent);
    return () => {
      ro.disconnect();
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', prevent);
      interactions = null;
    };
  }, []);

  const grid = 24 * camera.zoom;
  const showGrid = camera.zoom >= 0.3;
  const cursorClass = panning ? 'panning' : spacePan || tool === 'hand' ? 'grab' : `tool-${tool}`;

  return (
    <div
      ref={ref}
      className={`viewport ${cursorClass}`}
      style={
        showGrid
          ? {
              backgroundSize: `${grid}px ${grid}px`,
              backgroundPosition: `${camera.x % grid}px ${camera.y % grid}px`,
            }
          : { backgroundImage: 'none' }
      }
      onPointerDown={(e) => interactions?.pointerDown(e.nativeEvent)}
      onMouseDown={(e) => {
        // не отдаём фокус body: иначе только что открытый редактор текста сразу потеряет фокус
        if (!(e.target as Element).closest('[data-editor]')) e.preventDefault();
      }}
      onPointerMove={(e) => interactions?.pointerMove(e.nativeEvent)}
      onPointerUp={(e) => interactions?.pointerUp(e.nativeEvent)}
      onPointerCancel={(e) => interactions?.pointerUp(e.nativeEvent)}
      onPointerLeave={() => interactions?.leave()}
      onDoubleClick={(e) => interactions?.doubleClick(e.nativeEvent)}
      onContextMenu={(e) => e.preventDefault()}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => interactions?.drop(e.nativeEvent)}
      data-testid="canvas"
    >
      <div
        className="world"
        style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}
      >
        {order.map((id) => (
          <ItemView key={id} id={id} />
        ))}
        <DraftLayer />
      </div>
      <Overlay />
    </div>
  );
}
