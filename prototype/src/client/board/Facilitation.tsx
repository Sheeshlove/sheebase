import { Timer, Vote, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { itemText } from '../../shared/layout';
import { Popover } from '../ui/Popover';
import { focusItem } from './actions';
import { board } from './controller';
import { setState, showToast, useBoard } from './store';

const plural = (n: number, forms: [string, string, string]) => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
};
const votesWord = (n: number) => plural(n, ['голос', 'голоса', 'голосов']);

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
      showToast('Время вышло');
      beep();
    }
  }, [expired, timer?.endsAt]);

  const start = (minutes: number) => board.timer({ action: 'start', durationMs: Math.round(minutes * 60_000) });
  // состояние — словом на заливке: «ВРЕМЯ ВЫШЛО», «ПАУЗА 4:58», во время отсчёта — само время
  const state = expired ? 'expired' : timer?.running ? 'running' : 'paused';
  const label = expired ? 'ВРЕМЯ ВЫШЛО' : timer?.running ? formatDuration(remaining) : `ПАУЗА ${formatDuration(remaining)}`;

  return (
    <Popover
      placement="bottom"
      className="align-right"
      trigger={(_o, toggle) =>
        timer ? (
          <button type="button" className={`timer-pill ${state}`} onClick={toggle} title={`Таймер. Запустил: ${timer.by}`} data-testid="timer-pill">
            {label}
          </button>
        ) : (
          <button type="button" className="icon-btn" title="Запустить таймер" aria-label="Запустить таймер" onClick={toggle} data-testid="timer-button">
            <Timer size={20} />
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
                  Приостановить
                </button>
              ) : (
                remaining > 0 && (
                  <button type="button" className="chip" onClick={() => board.timer({ action: 'resume' })}>
                    Продолжить
                  </button>
                )
              )}
              <button type="button" className="chip" onClick={() => board.timer({ action: 'add', deltaMs: 60_000 })}>
                Добавить минуту
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => {
                  board.timer({ action: 'reset' });
                  close();
                }}
                data-testid="timer-reset"
              >
                Сбросить
              </button>
            </div>
          )}
          <div className="list-title">{timer ? 'Запустить заново' : 'Запустить'}</div>
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
            <input className="field small-input" value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => e.stopPropagation()} inputMode="decimal" aria-label="Минут" />
            <span>мин</span>
            <button type="submit" className="chip primary">
              Запустить
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
          title="Открыть голосование"
          aria-label="Открыть голосование"
          onClick={toggle}
          data-testid="voting-button"
        >
          <Vote size={20} />
        </button>
      )}
    >
      {(close) => (
        <div className="menu-panel">
          {!voting && (
            <>
              <div className="list-title">Голосование</div>
              <div className="hint">Каждый участник раздаёт голоса стикерам и фигурам. Чужие голоса скрыты до завершения.</div>
              <div className="row-buttons">
                <span>Голосов на участника</span>
                <button type="button" className="chip round" onClick={() => setN((v) => Math.max(1, v - 1))} aria-label="Меньше">
                  −
                </button>
                <b className="stepper-value" data-testid="votes-per-user">
                  {n}
                </b>
                <button type="button" className="chip round" onClick={() => setN((v) => Math.min(10, v + 1))} aria-label="Больше">
                  +
                </button>
              </div>
              <button
                type="button"
                className="chip primary full"
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
                Вы отдали {used} из {voting.votesPerUser} {votesWord(voting.votesPerUser)}. Проголосовали: {voting.voters}.
              </div>
              <button
                type="button"
                className="chip primary full"
                onClick={() => {
                  board.voting({ action: 'end' });
                  close();
                }}
              >
                Завершить голосование
              </button>
            </>
          )}
          {voting?.status === 'ended' && (
            <>
              <div className="list-title">Голосование завершено</div>
              <div className="row-buttons">
                <button
                  type="button"
                  className="chip primary"
                  onClick={() => {
                    setState({ panel: 'results' });
                    close();
                  }}
                >
                  Показать итоги
                </button>
                <button
                  type="button"
                  className="chip"
                  onClick={() => {
                    board.voting({ action: 'clear' });
                    close();
                  }}
                >
                  Очистить итоги
                </button>
              </div>
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
  const left = voting.votesPerUser - used;
  return (
    <div className="voting-banner panel bar" data-ui data-testid="voting-banner">
      <span>
        <b>
          Осталось {left} {votesWord(left)} из {voting.votesPerUser}
        </b>{' '}
        · Проголосовали: {voting.voters}
      </span>
      <span className="banner-hint">Нажмите на стикер, чтобы отдать голос. Alt — забрать</span>
      <button type="button" className="chip primary" onClick={() => board.voting({ action: 'end' })} data-testid="voting-end">
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
    <div className="page-panel" data-ui data-testid="results-panel">
      <div className="side-head">
        <h2 className="subtitle">Итоги</h2>
        <button type="button" className="icon-btn" onClick={() => setState({ panel: null })} title="Закрыть" aria-label="Закрыть">
          <X size={20} />
        </button>
      </div>
      <div className="side-list">
        {!voting?.results && <div className="panel-empty">Здесь пока пусто. Итоги появятся после голосования.</div>}
        {voting?.results && rows.length === 0 && <div className="panel-empty">Здесь пока пусто. Никто не проголосовал.</div>}
        {rows.map(([id, n], i) => (
          <button type="button" key={id} className="side-item result-row" onClick={() => focusItem(id, false)}>
            <span className="rank">{i + 1}</span>
            <div className="side-item-body">
              <div className="clamp-2">{itemText(items[id]) || 'Без текста'}</div>
              <div className="result-bar">
                <span style={{ width: `${(n / max) * 100}%` }} />
              </div>
            </div>
            <b className="result-count">
              {n} {votesWord(n)}
            </b>
          </button>
        ))}
      </div>
      {voting && (
        <div className="side-foot">
          <button type="button" className="chip" onClick={() => board.voting({ action: 'clear' })}>
            Очистить итоги
          </button>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ следование

/** Рамка вокруг вида, пока мы следуем за участником (кольцо фокуса sun-400 на синем). */
export function FollowFrame() {
  const on = useBoard((s) => !!(s.following && s.peers[s.following]));
  return on ? <div className="follow-frame" /> : null;
}

export function FollowLabel() {
  const peer = useBoard((s) => (s.following ? s.peers[s.following] : undefined));
  if (!peer) return null;
  return (
    <div className="follow-label panel bar" data-ui data-testid="follow-banner">
      <span>
        Вы следуете за участником: <b>{peer.name}</b>
      </span>
      <button type="button" className="chip primary" onClick={() => board.stopFollowing()}>
        Перестать
      </button>
    </div>
  );
}
