import { ChevronLeft, ChevronRight, LogOut, MonitorPlay, Play, Users, X } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { frameChildren } from '../../shared/geometry';
import { frameOrder } from '../../shared/layout';
import type { FrameItem } from '../../shared/types';
import { presentationGo, setSelection, showPresentedFrame, startPresentation, stopPresentation } from './actions';
import { board } from './controller';
import { setState, useBoard, worldRectToScreen } from './store';

export function FramesPanel() {
  const items = useBoard((s) => s.items);
  const order = useMemo(() => frameOrder(items), [items]);
  return (
    <div className="side-panel panel" data-ui data-testid="frames-panel">
      <div className="side-head">
        <h3>Фреймы</h3>
        <button type="button" className="icon-btn small" onClick={() => setState({ panel: null })} aria-label="Закрыть">
          <X size={16} />
        </button>
      </div>
      <div className="hint pad">Порядок — как читают: по строкам сверху вниз, слева направо.</div>
      <div className="side-list">
        {order.length === 0 && <div className="empty small">На доске нет фреймов. Инструмент «Фрейм» (F) — клик или протягивание.</div>}
        {order.map((id, i) => {
          const f = items[id] as FrameItem;
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
                  <div className="muted small-text">Объектов: {frameChildren(f, items).length}</div>
                </div>
              </button>
              <button type="button" className="icon-btn small" title="Показывать с этого фрейма" onClick={() => startPresentation(i)}>
                <Play size={15} />
              </button>
            </div>
          );
        })}
      </div>
      <div className="side-foot">
        <button type="button" className="primary-btn full" disabled={!order.length} onClick={() => startPresentation(0)} data-testid="present-start">
          <MonitorPlay size={16} /> Презентация
        </button>
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
    <div className="presentation-bar panel" data-ui data-testid="presentation-bar">
      <button type="button" className="icon-btn" onClick={() => presentationGo(presenting.index - 1)} disabled={presenting.index === 0} title="Назад (←)">
        <ChevronLeft size={18} />
      </button>
      <span className="pres-count" data-testid="presentation-count">
        {presenting.index + 1} / {order.length}
      </span>
      <button
        type="button"
        className="icon-btn"
        onClick={() => presentationGo(presenting.index + 1)}
        disabled={presenting.index >= order.length - 1}
        title="Вперёд (→, Пробел)"
      >
        <ChevronRight size={18} />
      </button>
      <span className="pres-title">{f?.title}</span>
      <button type="button" className="chip" onClick={() => board.summon()} title="Участники начнут следовать за вашим экраном">
        <Users size={14} /> Собрать всех
      </button>
      <button type="button" className="chip" onClick={stopPresentation} title="Выйти (Esc)">
        <LogOut size={14} /> Выйти
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
  return <div className="presentation-mask" style={{ transform: `translate(${r.x}px, ${r.y}px)`, width: r.w, height: r.h }} />;
}
