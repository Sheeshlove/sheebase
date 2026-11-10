import { Pause, Play, Timer, TimerReset, Trophy, Vote, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { itemText } from '../../shared/layout';
import { Popover } from '../ui/Popover';
import { focusItem } from './actions';
import { board } from './controller';
import { setState, showToast, useBoard } from './store';

// ------------------------------------------------------------------ таймер

export function formatDuration(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  return h ? `${h}:${mm}:${String(s).padStart(2, '0')}` : `${mm}:${String(s).padStart(2, '0')}`;
}

/** Короткий сигнал без аудиофайлов (Web Audio). */
function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.7);
    osc.start();
    osc.stop(ctx.currentTime + 0.7);
    osc.onended = () => void ctx.close();
  } catch {
    /* звук недоступен */
  }
}

const PRESETS = [1, 3, 5, 10, 15];

export function TimerWidget() {
  const timer = useBoard((s) => s.session.timer);
  const offset = useBoard((s) => s.serverOffset);
  const [, tick] = useState(0);
  const [custom, setCustom] = useState('7');
  const alerted = useRef<number | null>(null);

  useEffect(() => {
    if (!timer?.running) return;
    const id = setInterval(() => tick((x) => x + 1), 250);
    return () => clearInterval(id);
  }, [timer?.running, timer?.endsAt]);

  // остаток считается по часам сервера — у всех участников одинаково
  const remaining = timer ? (timer.running && timer.endsAt !== null ? Math.max(0, timer.endsAt - (Date.now() + offset)) : timer.remainingMs) : 0;
  const expired = !!timer && timer.running && remaining <= 0;

  useEffect(() => {
    if (expired && timer?.endsAt && alerted.current !== timer.endsAt) {
      alerted.current = timer.endsAt;
      showToast('Время вышло!');
      beep();
    }
  }, [expired, timer?.endsAt]);

  const start = (minutes: number) => board.timer({ action: 'start', durationMs: Math.round(minutes * 60_000) });

  return (
    <Popover
      placement="bottom"
      className="align-right"
      trigger={(_o, toggle) =>
        timer ? (
          <button
            type="button"
            className={`timer-pill ${expired ? 'expired' : timer.running ? 'running' : 'paused'}`}
            onClick={toggle}
            title={`Таймер (запустил: ${timer.by})`}
            data-testid="timer-pill"
          >
            <Timer size={15} /> {formatDuration(remaining)}
          </button>
        ) : (
          <button type="button" className="icon-btn" title="Таймер" onClick={toggle} data-testid="timer-button">
            <Timer size={18} />
          </button>
        )
      }
    >
      {(close) => (
        <div className="menu-panel">
          <div className="list-title">Таймер для всех участников</div>
          {timer && (
            <div className="row-buttons">
              {timer.running && !expired ? (
                <button type="button" className="chip" onClick={() => board.timer({ action: 'pause' })}>
                  <Pause size={14} /> Пауза
                </button>
              ) : (
                remaining > 0 && (
                  <button type="button" className="chip" onClick={() => board.timer({ action: 'resume' })}>
                    <Play size={14} /> Продолжить
                  </button>
                )
              )}
              <button type="button" className="chip" onClick={() => board.timer({ action: 'add', deltaMs: 60_000 })}>
                +1 мин
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => {
                  board.timer({ action: 'reset' });
                  close();
                }}
              >
                <TimerReset size={14} /> Сброс
              </button>
            </div>
          )}
          <div className="list-title">{timer ? 'Перезапустить' : 'Запустить'}</div>
          <div className="row-buttons">
            {PRESETS.map((m) => (
              <button
                key={m}
                type="button"
                className="chip"
                onClick={() => {
                  start(m);
                  close();
                }}
                data-testid={`timer-${m}`}
              >
                {m} мин
              </button>
            ))}
          </div>
          <form
            className="row-buttons"
            onSubmit={(e) => {
              e.preventDefault();
              const m = Number(custom.replace(',', '.'));
              if (!Number.isFinite(m) || m <= 0) return showToast('Укажите время в минутах');
              start(Math.min(m, 180));
              close();
            }}
          >
            <input className="small-input" value={custom} onChange={(e) => setCustom(e.target.value)} inputMode="decimal" aria-label="Минут" />
            <span className="muted">мин</span>
            <button type="submit" className="chip primary">
              Старт
            </button>
          </form>
        </div>
      )}
    </Popover>
  );
}

// ------------------------------------------------------------------ голосование

export function VotingMenu() {
  const voting = useBoard((s) => s.session.voting);
  const [n, setN] = useState(3);
  const used = voting ? Object.values(voting.myVotes).reduce((a, b) => a + b, 0) : 0;
  return (
    <Popover
      placement="bottom"
      className="align-right"
      trigger={(_o, toggle) => (
        <button
          type="button"
          className={`icon-btn ${voting?.status === 'active' ? 'active' : ''}`}
          title="Голосование"
          onClick={toggle}
          data-testid="voting-button"
        >
          <Vote size={18} />
        </button>
      )}
    >
      {(close) => (
        <div className="menu-panel">
          {!voting && (
            <>
              <div className="list-title">Голосование за объекты</div>
              <div className="hint">Каждый участник распределяет голоса между стикерами и фигурами. Чужие голоса скрыты до завершения.</div>
              <div className="row-buttons">
                <span>Голосов на участника:</span>
                <button type="button" className="chip" onClick={() => setN((v) => Math.max(1, v - 1))} aria-label="Меньше">
                  −
                </button>
                <b data-testid="votes-per-user">{n}</b>
                <button type="button" className="chip" onClick={() => setN((v) => Math.min(10, v + 1))} aria-label="Больше">
                  +
                </button>
              </div>
              <button
                type="button"
                className="primary-btn full"
                onClick={() => {
                  board.voting({ action: 'start', votesPerUser: n });
                  close();
                }}
                data-testid="voting-start"
              >
                Начать голосование
              </button>
            </>
          )}
          {voting?.status === 'active' && (
            <>
              <div className="list-title">Идёт голосование</div>
              <div>
                Ваши голоса: {used} из {voting.votesPerUser}. Проголосовали: {voting.voters}.
              </div>
              <button
                type="button"
                className="primary-btn full"
                onClick={() => {
                  board.voting({ action: 'end' });
                  close();
                }}
              >
                Завершить и показать итоги
              </button>
            </>
          )}
          {voting?.status === 'ended' && (
            <>
              <div className="list-title">Голосование завершено</div>
              <button
                type="button"
                className="chip"
                onClick={() => {
                  setState({ panel: 'results' });
                  close();
                }}
              >
                <Trophy size={14} /> Показать итоги
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => {
                  board.voting({ action: 'clear' });
                  close();
                }}
              >
                Очистить результаты
              </button>
            </>
          )}
        </div>
      )}
    </Popover>
  );
}

export function VotingBanner() {
  const voting = useBoard((s) => s.session.voting);
  if (!voting || voting.status !== 'active') return null;
  const used = Object.values(voting.myVotes).reduce((a, b) => a + b, 0);
  return (
    <div className="voting-banner panel" data-ui data-testid="voting-banner">
      <Vote size={18} />
      <span>
        Голосование: осталось <b>{voting.votesPerUser - used}</b> из {voting.votesPerUser} · проголосовали: {voting.voters}
      </span>
      <span className="muted">Клик по стикеру — голос, Alt+клик — снять</span>
      <button type="button" className="primary-btn small" onClick={() => board.voting({ action: 'end' })} data-testid="voting-end">
        Завершить
      </button>
    </div>
  );
}

export function ResultsPanel() {
  const voting = useBoard((s) => s.session.voting);
  const items = useBoard((s) => s.items);
  const rows = Object.entries(voting?.results ?? {})
    .filter(([id, n]) => items[id] && n > 0)
    .sort((a, b) => b[1] - a[1]);
  const max = rows[0]?.[1] ?? 1;
  return (
    <div className="side-panel panel" data-ui data-testid="results-panel">
      <div className="side-head">
        <h3>Итоги голосования</h3>
        <button type="button" className="icon-btn small" onClick={() => setState({ panel: null })} aria-label="Закрыть">
          <X size={16} />
        </button>
      </div>
      <div className="side-list">
        {!voting?.results && <div className="empty small">Итоги появятся после завершения голосования.</div>}
        {voting?.results && rows.length === 0 && <div className="empty small">Никто не проголосовал.</div>}
        {rows.map(([id, n], i) => (
          <button type="button" key={id} className="side-item result-row" onClick={() => focusItem(id, false)}>
            <span className="rank">{i + 1}</span>
            <div className="side-item-body">
              <div className="clamp-2">{itemText(items[id]) || 'Без текста'}</div>
              <div className="result-bar">
                <span style={{ width: `${(n / max) * 100}%` }} />
              </div>
            </div>
            <b className="result-count">{n}</b>
          </button>
        ))}
      </div>
      {voting && (
        <div className="side-foot">
          <button type="button" className="chip" onClick={() => board.voting({ action: 'clear' })}>
            Очистить результаты
          </button>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ следование

/** Рамка цвета ведущего вокруг вида, пока мы следуем за ним. */
export function FollowFrame() {
  const color = useBoard((s) => (s.following ? s.peers[s.following]?.color : undefined));
  if (!color) return null;
  return <div className="follow-frame" style={{ borderColor: color }} />;
}

export function FollowLabel() {
  const peer = useBoard((s) => (s.following ? s.peers[s.following] : undefined));
  if (!peer) return null;
  return (
    <div className="follow-label" style={{ background: peer.color }} data-ui data-testid="follow-banner">
      Вы следуете за: {peer.name}
      <button type="button" onClick={() => board.stopFollowing()}>
        Перестать
      </button>
    </div>
  );
}
