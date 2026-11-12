import { ChevronLeft, ChevronRight, Play, X } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { frameChildren } from '../../shared/geometry';
import { frameOrder } from '../../shared/layout';
import type { FrameItem } from '../../shared/types';
import routeMapUrl from '../design/assets/route-map.png';
import { Button } from '../design/components';
import { presentationGo, setSelection, showPresentedFrame, startPresentation, stopPresentation } from './actions';
import { board } from './controller';
import { setState, useBoard, worldRectToScreen } from './store';

const objectsWord = (n: number) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'объект';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'объекта';
  return 'объектов';
};

export function FramesPanel() {
  const items = useBoard((s) => s.items);
  const order = useMemo(() => frameOrder(items), [items]);
  return (
    <div className="page-panel" data-ui data-testid="frames-panel">
      <div className="side-head">
        <h2 className="subtitle">Фреймы</h2>
        <button type="button" className="icon-btn" onClick={() => setState({ panel: null })} title="Закрыть" aria-label="Закрыть">
          <X size={20} />
        </button>
      </div>
      <div className="side-list">
        {order.length === 0 && (
          <div className="panel-empty">
            <img src={routeMapUrl} alt="" width={116} height={116} />
            <p>Здесь пока пусто. Добавьте первый фрейм.</p>
          </div>
        )}
        {order.map((id, i) => {
          const f = items[id] as FrameItem;
          const n = frameChildren(f, items).length;
          return (
            <div key={id} className="side-item frame-row">
              <button
                type="button"
                className="frame-row-main"
                onClick={() => {
                  board.fitRect({ x: f.x, y: f.y, w: f.w, h: f.h }, 1);
                  setSelection([id]);
                }}
              >
                <span className="rank">{i + 1}</span>
                <div className="side-item-body">
                  <div className="clamp-2">{f.title || 'Фрейм'}</div>
                  <div className="meta-line">
                    {n} {objectsWord(n)}
                  </div>
                </div>
              </button>
              <button type="button" className="icon-btn" title="Показать с этого фрейма" aria-label="Показать с этого фрейма" onClick={() => startPresentation(i)}>
                <Play size={18} />
              </button>
            </div>
          );
        })}
      </div>
      <div className="side-foot">
        <Button variant="primary" disabled={!order.length} onClick={() => startPresentation(0)} data-testid="present-start">
          Показать презентацию
        </Button>
      </div>
    </div>
  );
}

export function PresentationBar() {
  const presenting = useBoard((s) => s.presenting);
  const items = useBoard((s) => s.items);
  const viewport = useBoard((s) => s.viewport);
  const order = useMemo(() => frameOrder(items), [items]);

  // изменился размер окна (вход в полноэкранный режим) — заново вписываем фрейм
  useEffect(() => {
    if (presenting) showPresentedFrame();
  }, [viewport.w, viewport.h, presenting?.index]);

  // фреймы удалили во время показа
  useEffect(() => {
    if (!presenting) return;
    if (!order.length) stopPresentation();
    else if (presenting.index >= order.length) presentationGo(order.length - 1);
  }, [order.length]);

  // выход из полноэкранного режима кнопкой браузера (Esc) завершает показ
  useEffect(() => {
    const onFs = () => {
      if (!document.fullscreenElement) stopPresentation();
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  if (!presenting) return null;
  const f = items[order[presenting.index]] as FrameItem | undefined;
  return (
    <div className="presentation-bar panel bar" data-ui data-testid="presentation-bar">
      <button
        type="button"
        className="icon-btn"
        onClick={() => presentationGo(presenting.index - 1)}
        disabled={presenting.index === 0}
        title="Показать предыдущий (←)"
        aria-label="Показать предыдущий"
      >
        <ChevronLeft size={20} />
      </button>
      <span className="pres-count" data-testid="presentation-count">
        {presenting.index + 1} / {order.length}
      </span>
      <button
        type="button"
        className="icon-btn"
        onClick={() => presentationGo(presenting.index + 1)}
        disabled={presenting.index >= order.length - 1}
        title="Показать следующий (→, Пробел)"
        aria-label="Показать следующий"
      >
        <ChevronRight size={20} />
      </button>
      <span className="pres-title">{f?.title}</span>
      <button type="button" className="chip" onClick={() => board.summon()} title="Участники начнут следовать за вашим экраном">
        Собрать всех
      </button>
      <button type="button" className="chip primary" onClick={stopPresentation} title="Выйти (Esc)">
        Выйти
      </button>
    </div>
  );
}

/** «Прожектор»: всё вне показываемого фрейма закрыто фоном. */
export function PresentationMask() {
  const presenting = useBoard((s) => s.presenting);
  const items = useBoard((s) => s.items);
  const cam = useBoard((s) => s.camera);
  if (!presenting) return null;
  const f = items[frameOrder(items)[presenting.index]];
  if (!f) return null;
  const r = worldRectToScreen(cam, { x: f.x, y: f.y, w: f.w, h: f.h });
  // скругление маски повторяет скругление фрейма (radius-lg в мировых единицах)
  const radius = Math.min(32, f.w / 2, f.h / 2) * cam.zoom;
  return <div className="presentation-mask" style={{ transform: `translate(${r.x}px, ${r.y}px)`, width: r.w, height: r.h, borderRadius: radius }} />;
}
