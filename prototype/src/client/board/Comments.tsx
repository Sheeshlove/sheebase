import { CircleCheck, RotateCcw, Send, Trash, X } from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import type { CommentThread } from '../../shared/types';
import { LIMITS } from '../../shared/validate';
import groupUrl from '../design/assets/group.png';
import { Tag } from '../design/components';
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
        const unread = isUnread(t, seen, me);
        return (
          <button
            type="button"
            key={t.id}
            className={`comment-pin ${t.resolved ? 'resolved' : ''} ${openId === t.id ? 'open' : ''} ${unread ? 'unread' : ''}`}
            style={{ transform: `translate(${p.x}px, ${p.y}px)` }}
            data-ui="1"
            data-testid="comment-pin"
            title={`${first.authorName}: ${first.text.slice(0, 80)}${unread ? '. Есть новые сообщения' : ''}`}
            aria-label={`Открыть обсуждение: ${first.authorName}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => openThread(t.id)}
          >
            {first.authorName.slice(0, 1).toUpperCase()}
            {t.messages.length > 1 && <span className="pin-count">{t.messages.length}</span>}
          </button>
        );
      })}
      {draft && (
        <div className="comment-pin draft" style={{ transform: `translate(${worldToScreen(cam, draft).x}px, ${worldToScreen(cam, draft).y}px)` }}>
          +
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
        className="field"
        value={text}
        maxLength={LIMITS.comment}
        placeholder={placeholder}
        aria-label={placeholder}
        rows={2}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        data-testid={testId}
      />
      <button type="button" className="icon-btn active" disabled={!text.trim()} onClick={send} title="Отправить (Enter)" aria-label="Отправить">
        <Send size={18} />
      </button>
    </div>
  );
}

/** Карточка рядом с пином: позиция в экранных координатах, прижата к границам окна. */
function cardPosition(p: { x: number; y: number }, vp: { w: number; h: number }, w = 340, h = 380) {
  return { left: Math.min(Math.max(16, p.x + 30), vp.w - w - 16), top: Math.min(Math.max(88, p.y - 40), Math.max(88, vp.h - h - 16)) };
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
        <span className="thread-title">Обсуждение</span>
        {t.resolved && <Tag tone="low">РЕШЕНО</Tag>}
        <span className="spacer" />
        <button
          type="button"
          className="icon-btn"
          title={t.resolved ? 'Открыть снова' : 'Отметить решённым'}
          aria-label={t.resolved ? 'Открыть снова' : 'Отметить решённым'}
          onClick={() => board.comment({ action: 'resolve', threadId: t.id, resolved: !t.resolved })}
          data-testid="thread-resolve"
        >
          {t.resolved ? <RotateCcw size={18} /> : <CircleCheck size={18} />}
        </button>
        <button
          type="button"
          className="icon-btn"
          title="Удалить обсуждение"
          aria-label="Удалить обсуждение"
          onClick={() => window.confirm('Удалить обсуждение целиком?') && board.comment({ action: 'delete', threadId: t.id })}
        >
          <Trash size={18} />
        </button>
        <button type="button" className="icon-btn" title="Закрыть (Esc)" aria-label="Закрыть" onClick={close}>
          <X size={18} />
        </button>
      </div>
      <div className="thread-messages" ref={listRef}>
        {t.messages.map((m) => (
          <div key={m.id} className="thread-message">
            <span className="avatar small" style={{ background: m.authorColor }} aria-hidden>
              {m.authorName.slice(0, 1).toUpperCase()}
            </span>
            <div className="message-body">
              <div className="message-meta">
                <b>{m.authorName}</b> <span>{timeAgo(m.createdAt)}</span>
                {m.authorId === me && (
                  <button type="button" className="link-btn" onClick={() => board.comment({ action: 'deleteMessage', threadId: t.id, messageId: m.id })}>
                    Удалить
                  </button>
                )}
              </div>
              <div className="message-text">{m.text}</div>
            </div>
          </div>
        ))}
      </div>
      <Composer placeholder="Ответить" onSend={(text) => board.comment({ action: 'reply', threadId: t.id, text })} onCancel={close} testId="thread-reply" />
    </div>
  );
}

export function CommentDraft() {
  const draft = useBoard((s) => s.commentDraft);
  const cam = useBoard((s) => s.camera);
  const vp = useBoard((s) => s.viewport);
  if (!draft) return null;
  const pos = cardPosition(worldToScreen(cam, draft), vp, 340, 170);
  const cancel = () => setState({ commentDraft: null });
  return (
    <div className="thread-card panel draft" style={pos} data-ui onPointerDown={(e) => e.stopPropagation()}>
      <div className="thread-head">
        <span className="thread-title">Новый комментарий</span>
        <span className="spacer" />
        <button type="button" className="icon-btn" title="Отменить (Esc)" aria-label="Отменить" onClick={cancel}>
          <X size={18} />
        </button>
      </div>
      <Composer
        placeholder="Написать комментарий"
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
    <div className="page-panel" data-ui data-testid="comments-panel">
      <div className="side-head">
        <h2 className="subtitle">Комментарии</h2>
        <button type="button" className="icon-btn" onClick={() => setState({ panel: null })} title="Закрыть" aria-label="Закрыть">
          <X size={20} />
        </button>
      </div>
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'open'} className={`chip ${tab === 'open' ? 'primary' : ''}`} onClick={() => setTab('open')}>
          Открытые: {open.length}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'resolved'}
          className={`chip ${tab === 'resolved' ? 'primary' : ''}`}
          onClick={() => {
            setTab('resolved');
            setState({ showResolved: true });
          }}
        >
          Решённые: {resolved.length}
        </button>
      </div>
      <div className="side-list">
        {list.length === 0 && (
          <div className="panel-empty">
            <img src={groupUrl} alt="" width={120} height={120} />
            <p>{tab === 'open' ? 'Здесь пока пусто. Добавьте первый комментарий.' : 'Здесь пока пусто. Решённые обсуждения появятся тут.'}</p>
          </div>
        )}
        {list.map((t) => {
          const first = t.messages[0];
          const replies = t.messages.length - 1;
          return (
            <button type="button" key={t.id} className="side-item" onClick={() => openThread(t.id, true)}>
              <span className="avatar small" style={{ background: first.authorColor }} aria-hidden>
                {first.authorName.slice(0, 1).toUpperCase()}
              </span>
              <div className="side-item-body">
                <div className="message-meta">
                  <b>{first.authorName}</b> <span>{timeAgo(t.updatedAt)}</span>
                  {isUnread(t, seen, me) && <Tag tone="medium">НОВОЕ</Tag>}
                </div>
                <div className="clamp-2">{first.text}</div>
                {replies > 0 && (
                  <div className="meta-line">
                    {replies} {replies % 10 === 1 && replies % 100 !== 11 ? 'ответ' : replies % 10 >= 2 && replies % 10 <= 4 && (replies % 100 < 12 || replies % 100 > 14) ? 'ответа' : 'ответов'}
                  </div>
                )}
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
