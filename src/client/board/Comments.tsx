import { CircleCheck, MessageSquare, RotateCcw, Send, Trash, X } from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import type { CommentThread } from '../../shared/types';
import { LIMITS } from '../../shared/validate';
import { getUser } from '../user';
import { openThread, threadPosition } from './actions';
import { board } from './controller';
import { type Camera, getState, setState, useBoard, worldToScreen } from './store';

export function timeAgo(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return 'только что';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} мин назад`;
  const d = new Date(ts);
  const today = new Date(now).toDateString() === d.toDateString();
  const hm = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return today ? `сегодня, ${hm}` : `${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}, ${hm}`;
}

/** Тред непрочитан, если обновился после последнего просмотра и последнее сообщение не наше. */
export function isUnread(t: CommentThread, seen: Record<string, number>, me: string): boolean {
  const last = t.messages[t.messages.length - 1];
  return !!last && last.authorId !== me && t.updatedAt > (seen[t.id] ?? 0);
}

/** Пины комментариев в экранном слое (постоянного размера при любом масштабе). */
export function CommentPins({ cam }: { cam: Camera }) {
  const comments = useBoard((s) => s.comments);
  const items = useBoard((s) => s.items);
  const showResolved = useBoard((s) => s.showResolved);
  const openId = useBoard((s) => s.openThreadId);
  const seen = useBoard((s) => s.seen);
  const draft = useBoard((s) => s.commentDraft);
  const me = getUser().id;
  return (
    <>
      {Object.values(comments).map((t) => {
        if (t.resolved && !showResolved && openId !== t.id) return null;
        const p = worldToScreen(cam, threadPosition(t, items));
        const first = t.messages[0];
        if (!first) return null;
        return (
          <button
            type="button"
            key={t.id}
            className={`comment-pin ${t.resolved ? 'resolved' : ''} ${openId === t.id ? 'open' : ''}`}
            style={{ transform: `translate(${p.x}px, ${p.y}px)` }}
            data-ui="1"
            data-testid="comment-pin"
            title={`${first.authorName}: ${first.text.slice(0, 80)}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => openThread(t.id)}
          >
            <span className="pin-avatar" style={{ background: first.authorColor }}>
              {first.authorName.slice(0, 1).toUpperCase()}
            </span>
            {t.messages.length > 1 && <span className="pin-count">{t.messages.length}</span>}
            {isUnread(t, seen, me) && <span className="pin-unread" />}
          </button>
        );
      })}
      {draft && (
        <div className="comment-pin draft" style={{ transform: `translate(${worldToScreen(cam, draft).x}px, ${worldToScreen(cam, draft).y}px)` }}>
          <span className="pin-avatar">+</span>
        </div>
      )}
    </>
  );
}

/** Поле ввода: Enter — отправить, Shift+Enter — перенос строки, Esc — закрыть. */
function Composer({ placeholder, onSend, onCancel, testId }: { placeholder: string; onSend: (text: string) => void; onCancel: () => void; testId?: string }) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const send = () => {
    const v = text.trim();
    if (!v) return;
    onSend(v);
    setText('');
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
    if (e.key === 'Escape') onCancel();
  };
  return (
    <div className="composer">
      <textarea
        ref={ref}
        value={text}
        maxLength={LIMITS.comment}
        placeholder={placeholder}
        rows={2}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        data-testid={testId}
      />
      <button type="button" className="icon-btn primary" disabled={!text.trim()} onClick={send} title="Отправить (Enter)" aria-label="Отправить">
        <Send size={16} />
      </button>
    </div>
  );
}

/** Карточка рядом с пином: позиция в экранных координатах, прижата к границам окна. */
function cardPosition(p: { x: number; y: number }, vp: { w: number; h: number }, w = 320, h = 360) {
  return { left: Math.min(Math.max(8, p.x + 28), vp.w - w - 8), top: Math.min(Math.max(70, p.y - 40), vp.h - h - 8) };
}

export function ThreadCard() {
  const id = useBoard((s) => s.openThreadId);
  const t = useBoard((s) => (s.openThreadId ? s.comments[s.openThreadId] : undefined));
  const items = useBoard((s) => s.items);
  const cam = useBoard((s) => s.camera);
  const vp = useBoard((s) => s.viewport);
  const me = getUser().id;
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [t?.messages.length]);
  if (!id || !t) return null;
  const pos = cardPosition(worldToScreen(cam, threadPosition(t, items)), vp);
  const close = () => setState({ openThreadId: null });
  return (
    <div className="thread-card panel" style={pos} data-ui onPointerDown={(e) => e.stopPropagation()} data-testid="thread-card">
      <div className="thread-head">
        <MessageSquare size={16} />
        <span className="thread-title">{t.resolved ? 'Решено' : 'Обсуждение'}</span>
        <button
          type="button"
          className="icon-btn small"
          title={t.resolved ? 'Открыть снова' : 'Отметить как решённое'}
          onClick={() => board.comment({ action: 'resolve', threadId: t.id, resolved: !t.resolved })}
          data-testid="thread-resolve"
        >
          {t.resolved ? <RotateCcw size={16} /> : <CircleCheck size={16} />}
        </button>
        <button
          type="button"
          className="icon-btn small"
          title="Удалить обсуждение"
          onClick={() => window.confirm('Удалить обсуждение целиком?') && board.comment({ action: 'delete', threadId: t.id })}
        >
          <Trash size={16} />
        </button>
        <button type="button" className="icon-btn small" title="Закрыть (Esc)" onClick={close}>
          <X size={16} />
        </button>
      </div>
      <div className="thread-messages" ref={listRef}>
        {t.messages.map((m) => (
          <div key={m.id} className="thread-message">
            <span className="avatar small" style={{ background: m.authorColor }}>
              {m.authorName.slice(0, 1).toUpperCase()}
            </span>
            <div className="message-body">
              <div className="message-meta">
                <b>{m.authorName}</b> <span>{timeAgo(m.createdAt)}</span>
                {m.authorId === me && (
                  <button
                    type="button"
                    className="link-btn"
                    title="Удалить сообщение"
                    onClick={() => board.comment({ action: 'deleteMessage', threadId: t.id, messageId: m.id })}
                  >
                    удалить
                  </button>
                )}
              </div>
              <div className="message-text">{m.text}</div>
            </div>
          </div>
        ))}
      </div>
      <Composer placeholder="Ответить…" onSend={(text) => board.comment({ action: 'reply', threadId: t.id, text })} onCancel={close} testId="thread-reply" />
    </div>
  );
}

export function CommentDraft() {
  const draft = useBoard((s) => s.commentDraft);
  const cam = useBoard((s) => s.camera);
  const vp = useBoard((s) => s.viewport);
  if (!draft) return null;
  const pos = cardPosition(worldToScreen(cam, draft), vp, 320, 140);
  const cancel = () => setState({ commentDraft: null });
  return (
    <div className="thread-card panel draft" style={pos} data-ui onPointerDown={(e) => e.stopPropagation()}>
      <div className="thread-head">
        <MessageSquare size={16} />
        <span className="thread-title">Новый комментарий</span>
        <button type="button" className="icon-btn small" title="Отмена (Esc)" onClick={cancel}>
          <X size={16} />
        </button>
      </div>
      <Composer
        placeholder="Напишите комментарий…"
        onSend={(text) => {
          board.comment({ action: 'create', x: draft.x, y: draft.y, itemId: draft.itemId, text });
          setState({ commentDraft: null });
        }}
        onCancel={cancel}
        testId="comment-draft"
      />
    </div>
  );
}

export function CommentsPanel() {
  const comments = useBoard((s) => s.comments);
  const seen = useBoard((s) => s.seen);
  const [tab, setTab] = useState<'open' | 'resolved'>('open');
  const me = getUser().id;
  const all = Object.values(comments).sort((a, b) => b.updatedAt - a.updatedAt);
  const open = all.filter((t) => !t.resolved);
  const resolved = all.filter((t) => t.resolved);
  const list = tab === 'open' ? open : resolved;
  return (
    <div className="side-panel panel" data-ui data-testid="comments-panel">
      <div className="side-head">
        <h3>Комментарии</h3>
        <button type="button" className="icon-btn small" onClick={() => setState({ panel: null })} aria-label="Закрыть">
          <X size={16} />
        </button>
      </div>
      <div className="tabs">
        <button type="button" className={tab === 'open' ? 'active' : ''} onClick={() => setTab('open')}>
          Открытые ({open.length})
        </button>
        <button
          type="button"
          className={tab === 'resolved' ? 'active' : ''}
          onClick={() => {
            setTab('resolved');
            setState({ showResolved: true });
          }}
        >
          Решённые ({resolved.length})
        </button>
      </div>
      <div className="side-list">
        {list.length === 0 && (
          <div className="empty small">
            {tab === 'open' ? 'Открытых обсуждений нет. Инструмент «Комментарий» (C): клик по доске или объекту.' : 'Решённых обсуждений нет.'}
          </div>
        )}
        {list.map((t) => {
          const first = t.messages[0];
          return (
            <button type="button" key={t.id} className="side-item" onClick={() => openThread(t.id, true)}>
              <span className="avatar small" style={{ background: first.authorColor }}>
                {first.authorName.slice(0, 1).toUpperCase()}
              </span>
              <div className="side-item-body">
                <div className="message-meta">
                  <b>{first.authorName}</b> <span>{timeAgo(t.updatedAt)}</span>
                  {isUnread(t, seen, me) && <span className="dot-unread" title="Есть новые сообщения" />}
                </div>
                <div className="clamp-2">{first.text}</div>
                {t.messages.length > 1 && <div className="muted small-text">Ответов: {t.messages.length - 1}</div>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Число открытых тредов и есть ли непрочитанные — для кнопки в шапке. */
export function commentStats() {
  const { comments, seen } = getState();
  const me = getUser().id;
  let open = 0;
  let unread = false;
  for (const t of Object.values(comments)) {
    if (!t.resolved) open++;
    if (isUnread(t, seen, me)) unread = true;
  }
  return { open, unread };
}
