import { uid } from '../shared/ops';
import type {
  CommentThread,
  ItemMap,
  ItemType,
  SessionView,
  TimerState,
  VotingView,
} from '../shared/types';
import { isFiniteCoord, isValidId, LIMITS, sanitizeCommentText } from '../shared/validate';

// Сервер-авторитетные данные доски: таймер, голосование, комментарии.
// Клиент присылает намерение, сервер проверяет его, применяет и рассылает результат.

export interface VotingState {
  id: string;
  status: 'active' | 'ended';
  votesPerUser: number;
  startedBy: string;
  startedAt: number;
  endedAt: number | null;
  /** userId → (itemId → число голосов). Клиентам целиком не отдаётся. */
  votes: Record<string, Record<string, number>>;
}

export interface BoardSession {
  timer: TimerState | null;
  voting: VotingState | null;
}

export const emptySession = (): BoardSession => ({ timer: null, voting: null });

export const TIMER_MIN_MS = 5_000;
export const TIMER_MAX_MS = 3 * 60 * 60 * 1000;
const TIMER_ADD_MAX_MS = 60 * 60 * 1000;

/** Объекты, за которые можно голосовать. */
export const VOTABLE: ReadonlySet<ItemType> = new Set(['sticky', 'shape', 'text', 'image']);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

// ------------------------------------------------------------------ таймер

/** Применяет действие с таймером. Возвращает true, если состояние изменилось. */
export function applyTimer(session: BoardSession, raw: unknown, by: string, now: number): boolean {
  if (!isObj(raw)) return false;
  const t = session.timer;
  switch (raw.action) {
    case 'start': {
      if (typeof raw.durationMs !== 'number' || !Number.isFinite(raw.durationMs)) return false;
      const d = clamp(Math.round(raw.durationMs), TIMER_MIN_MS, TIMER_MAX_MS);
      session.timer = { durationMs: d, endsAt: now + d, remainingMs: d, running: true, by };
      return true;
    }
    case 'pause':
      if (!t || !t.running || t.endsAt === null) return false;
      session.timer = { ...t, running: false, remainingMs: Math.max(0, t.endsAt - now), endsAt: null };
      return true;
    case 'resume':
      if (!t || t.running || t.remainingMs <= 0) return false;
      session.timer = { ...t, running: true, endsAt: now + t.remainingMs };
      return true;
    case 'add': {
      if (!t || typeof raw.deltaMs !== 'number' || !Number.isFinite(raw.deltaMs)) return false;
      const delta = clamp(Math.round(raw.deltaMs), -TIMER_ADD_MAX_MS, TIMER_ADD_MAX_MS);
      if (t.running && t.endsAt !== null) {
        const endsAt = Math.max(now, t.endsAt + delta);
        session.timer = { ...t, endsAt, remainingMs: endsAt - now, durationMs: clamp(t.durationMs + delta, 0, TIMER_MAX_MS) };
      } else {
        session.timer = { ...t, remainingMs: clamp(t.remainingMs + delta, 0, TIMER_MAX_MS), durationMs: clamp(t.durationMs + delta, 0, TIMER_MAX_MS) };
      }
      return true;
    }
    case 'reset':
      if (!t) return false;
      session.timer = null;
      return true;
    default:
      return false;
  }
}

// ------------------------------------------------------------------ голосование

export function applyVoting(session: BoardSession, raw: unknown, by: string, now: number): boolean {
  if (!isObj(raw)) return false;
  const v = session.voting;
  switch (raw.action) {
    case 'start': {
      if (typeof raw.votesPerUser !== 'number' || !Number.isFinite(raw.votesPerUser)) return false;
      session.voting = {
        id: uid(10),
        status: 'active',
        votesPerUser: clamp(Math.round(raw.votesPerUser), 1, 99),
        startedBy: by,
        startedAt: now,
        endedAt: null,
        votes: {},
      };
      return true;
    }
    case 'end':
      if (!v || v.status !== 'active') return false;
      session.voting = { ...v, status: 'ended', endedAt: now };
      return true;
    case 'clear':
      if (!v) return false;
      session.voting = null;
      return true;
    default:
      return false;
  }
}

const usedVotes = (votes: Record<string, number> | undefined) => Object.values(votes ?? {}).reduce((s, n) => s + n, 0);

/** Голос (+1) или снятие голоса (−1). Лимит и существование объекта проверяются здесь. */
export function castVote(session: BoardSession, items: ItemMap, userId: string, itemId: unknown, delta: unknown): boolean {
  const v = session.voting;
  if (!v || v.status !== 'active' || !isValidId(itemId) || (delta !== 1 && delta !== -1)) return false;
  const mine = { ...(v.votes[userId] ?? {}) };
  if (delta === 1) {
    const it = items[itemId];
    if (!it || !VOTABLE.has(it.type)) return false;
    if (usedVotes(mine) >= v.votesPerUser) return false;
    mine[itemId] = (mine[itemId] ?? 0) + 1;
  } else {
    if (!mine[itemId]) return false;
    mine[itemId] -= 1;
    if (mine[itemId] === 0) delete mine[itemId];
  }
  session.voting = { ...v, votes: { ...v.votes, [userId]: mine } };
  return true;
}

/** Итоги голосования по объектам. */
export function tally(v: VotingState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const user of Object.values(v.votes)) for (const [id, n] of Object.entries(user)) out[id] = (out[id] ?? 0) + n;
  return out;
}

/** Голосование глазами участника: свои голоса всегда, чужие — только суммой и только после завершения. */
export function votingView(v: VotingState | null, userId: string): VotingView | null {
  if (!v) return null;
  return {
    id: v.id,
    status: v.status,
    votesPerUser: v.votesPerUser,
    startedBy: v.startedBy,
    startedAt: v.startedAt,
    endedAt: v.endedAt,
    myVotes: { ...(v.votes[userId] ?? {}) },
    voters: Object.values(v.votes).filter((u) => usedVotes(u) > 0).length,
    results: v.status === 'ended' ? tally(v) : null,
  };
}

export function sessionView(s: BoardSession, userId: string): SessionView {
  return { timer: s.timer, voting: votingView(s.voting, userId) };
}

// ------------------------------------------------------------------ комментарии

export interface Author {
  id: string;
  name: string;
  color: string;
}

export type CommentResult = { thread: CommentThread } | { deleted: string } | null;

/** Применяет действие с комментариями. Автор и время всегда берутся на сервере. */
export function applyComment(
  comments: Record<string, CommentThread>,
  items: ItemMap,
  raw: unknown,
  author: Author,
  now: number,
): CommentResult {
  if (!isObj(raw)) return null;
  const message = (text: string) => ({
    id: uid(10),
    authorId: author.id,
    authorName: author.name,
    authorColor: author.color,
    text,
    createdAt: now,
  });
  switch (raw.action) {
    case 'create': {
      const text = sanitizeCommentText(raw.text);
      if (!text || !isFiniteCoord(raw.x) || !isFiniteCoord(raw.y)) return null;
      const item = isValidId(raw.itemId) ? items[raw.itemId] : undefined;
      if (raw.itemId != null && !item) return null;
      const x = raw.x as number;
      const y = raw.y as number;
      const thread: CommentThread = {
        id: uid(10),
        x,
        y,
        itemId: item ? item.id : null,
        dx: item ? x - item.x : 0,
        dy: item ? y - item.y : 0,
        resolved: false,
        createdAt: now,
        updatedAt: now,
        messages: [message(text)],
      };
      comments[thread.id] = thread;
      return { thread };
    }
    case 'reply': {
      const text = sanitizeCommentText(raw.text);
      const t = isValidId(raw.threadId) ? comments[raw.threadId] : undefined;
      if (!text || !t || t.messages.length >= LIMITS.threadMessages) return null;
      const thread = { ...t, updatedAt: now, messages: [...t.messages, message(text)] };
      comments[t.id] = thread;
      return { thread };
    }
    case 'resolve': {
      const t = isValidId(raw.threadId) ? comments[raw.threadId] : undefined;
      if (!t || typeof raw.resolved !== 'boolean' || t.resolved === raw.resolved) return null;
      const thread = { ...t, resolved: raw.resolved, updatedAt: now };
      comments[t.id] = thread;
      return { thread };
    }
    case 'deleteMessage': {
      const t = isValidId(raw.threadId) ? comments[raw.threadId] : undefined;
      if (!t || !isValidId(raw.messageId)) return null;
      const idx = t.messages.findIndex((m) => m.id === raw.messageId);
      if (idx < 0 || t.messages[idx].authorId !== author.id) return null;
      if (idx === 0) {
        // первое сообщение открывает тред — удаляется весь тред
        delete comments[t.id];
        return { deleted: t.id };
      }
      const thread = { ...t, updatedAt: now, messages: t.messages.filter((_, i) => i !== idx) };
      comments[t.id] = thread;
      return { thread };
    }
    case 'delete': {
      const t = isValidId(raw.threadId) ? comments[raw.threadId] : undefined;
      if (!t) return null;
      delete comments[t.id];
      return { deleted: t.id };
    }
    default:
      return null;
  }
}

/**
 * Треды, привязанные к исчезающим объектам, становятся свободными на последней
 * позиции объекта. `items` — состояние до удаления. Возвращает изменённые треды.
 */
export function detachThreads(
  comments: Record<string, CommentThread>,
  items: ItemMap,
  goneIds: ReadonlySet<string>,
  now: number,
): CommentThread[] {
  const changed: CommentThread[] = [];
  for (const t of Object.values(comments)) {
    if (!t.itemId || !goneIds.has(t.itemId)) continue;
    const it = items[t.itemId];
    const thread: CommentThread = {
      ...t,
      x: it ? it.x + t.dx : t.x,
      y: it ? it.y + t.dy : t.y,
      itemId: null,
      dx: 0,
      dy: 0,
      updatedAt: now,
    };
    comments[t.id] = thread;
    changed.push(thread);
  }
  return changed;
}

/** Мягкая проверка структуры при загрузке с диска. */
export function loadComments(raw: unknown): Record<string, CommentThread> {
  const out: Record<string, CommentThread> = {};
  if (!isObj(raw)) return out;
  for (const t of Object.values(raw)) {
    if (!isObj(t) || !isValidId(t.id) || !Array.isArray(t.messages) || !isFiniteCoord(t.x) || !isFiniteCoord(t.y)) continue;
    out[t.id] = t as unknown as CommentThread;
  }
  return out;
}

export function loadSession(raw: unknown): BoardSession {
  const s = emptySession();
  if (!isObj(raw)) return s;
  if (isObj(raw.timer) && typeof raw.timer.durationMs === 'number') s.timer = raw.timer as unknown as TimerState;
  if (isObj(raw.voting) && isObj(raw.voting.votes)) s.voting = raw.voting as unknown as VotingState;
  return s;
}
