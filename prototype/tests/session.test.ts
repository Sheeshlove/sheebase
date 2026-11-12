import { describe, expect, it } from 'vitest';
import {
  applyComment,
  applyTimer,
  applyVoting,
  castVote,
  detachThreads,
  emptySession,
  sessionView,
  TIMER_MAX_MS,
  TIMER_MIN_MS,
} from '../src/server/session';
import { makeConnector, makeSticky } from '../src/shared/defaults';
import type { CommentThread, ItemMap } from '../src/shared/types';

const anna = { id: 'ua', name: 'Анна', color: '#e03131' };
const boris = { id: 'ub', name: 'Борис', color: '#1971c2' };

describe('таймер', () => {
  it('старт, пауза, продолжение, добавление времени, сброс', () => {
    const s = emptySession();
    expect(applyTimer(s, { action: 'start', durationMs: 60_000 }, 'Анна', 1000)).toBe(true);
    expect(s.timer).toMatchObject({ running: true, endsAt: 61_000, durationMs: 60_000, by: 'Анна' });
    expect(applyTimer(s, { action: 'pause' }, 'Анна', 11_000)).toBe(true);
    expect(s.timer).toMatchObject({ running: false, endsAt: null, remainingMs: 50_000 });
    expect(applyTimer(s, { action: 'pause' }, 'Анна', 12_000)).toBe(false);
    expect(applyTimer(s, { action: 'add', deltaMs: 60_000 }, 'Анна', 12_000)).toBe(true);
    expect(s.timer!.remainingMs).toBe(110_000);
    expect(applyTimer(s, { action: 'resume' }, 'Анна', 20_000)).toBe(true);
    expect(s.timer).toMatchObject({ running: true, endsAt: 130_000 });
    expect(applyTimer(s, { action: 'add', deltaMs: -500_000 }, 'Анна', 21_000)).toBe(true);
    expect(s.timer!.endsAt).toBe(21_000); // не уходит в прошлое
    expect(applyTimer(s, { action: 'reset' }, 'Анна', 22_000)).toBe(true);
    expect(s.timer).toBeNull();
  });

  it('длительность ограничивается, мусор отклоняется', () => {
    const s = emptySession();
    applyTimer(s, { action: 'start', durationMs: 1 }, 'A', 0);
    expect(s.timer!.durationMs).toBe(TIMER_MIN_MS);
    applyTimer(s, { action: 'start', durationMs: 1e12 }, 'A', 0);
    expect(s.timer!.durationMs).toBe(TIMER_MAX_MS);
    expect(applyTimer(s, { action: 'start', durationMs: 'x' }, 'A', 0)).toBe(false);
    expect(applyTimer(s, { action: 'explode' }, 'A', 0)).toBe(false);
    expect(applyTimer(s, null, 'A', 0)).toBe(false);
  });
});

describe('голосование', () => {
  const items: ItemMap = {
    s1: makeSticky('s1', 0, 0, 1, '#fff', 'Идея 1'),
    s2: makeSticky('s2', 300, 0, 2, '#fff', 'Идея 2'),
    c1: makeConnector('c1', { x: 0, y: 0 }, { x: 10, y: 10 }, 3),
  };

  it('лимит голосов, снятие, недопустимые объекты', () => {
    const s = emptySession();
    applyVoting(s, { action: 'start', votesPerUser: 2 }, 'Анна', 0);
    expect(castVote(s, items, 'ua', 's1', 1)).toBe(true);
    expect(castVote(s, items, 'ua', 's1', 1)).toBe(true);
    expect(castVote(s, items, 'ua', 's2', 1)).toBe(false); // лимит 2
    expect(castVote(s, items, 'ua', 's1', -1)).toBe(true);
    expect(castVote(s, items, 'ua', 's2', 1)).toBe(true);
    expect(castVote(s, items, 'ua', 's2', -1)).toBe(true);
    expect(castVote(s, items, 'ua', 's2', -1)).toBe(false); // нечего снимать
    expect(castVote(s, items, 'ua', 'c1', 1)).toBe(false); // за коннектор нельзя
    expect(castVote(s, items, 'ua', 'nope', 1)).toBe(false);
    expect(castVote(s, items, 'ua', 's1', 5)).toBe(false);
  });

  it('чужие голоса скрыты до завершения, после — итоги', () => {
    const s = emptySession();
    applyVoting(s, { action: 'start', votesPerUser: 3 }, 'Анна', 0);
    castVote(s, items, 'ua', 's1', 1);
    castVote(s, items, 'ub', 's1', 1);
    castVote(s, items, 'ub', 's2', 1);
    const annaView = sessionView(s, 'ua').voting!;
    expect(annaView.myVotes).toEqual({ s1: 1 });
    expect(annaView.voters).toBe(2);
    expect(annaView.results).toBeNull();
    expect(JSON.stringify(annaView)).not.toContain('ub');
    applyVoting(s, { action: 'end' }, 'Анна', 10);
    expect(castVote(s, items, 'ua', 's2', 1)).toBe(false); // после завершения голосовать нельзя
    expect(sessionView(s, 'ub').voting!.results).toEqual({ s1: 2, s2: 1 });
    applyVoting(s, { action: 'clear' }, 'Анна', 20);
    expect(sessionView(s, 'ua').voting).toBeNull();
  });
});

describe('комментарии', () => {
  const items: ItemMap = { s1: makeSticky('s1', 100, 100, 1, '#fff', 'x') };

  it('создание с привязкой к объекту, ответ, решение', () => {
    const comments: Record<string, CommentThread> = {};
    const r = applyComment(comments, items, { action: 'create', x: 150, y: 120, itemId: 's1', text: '  Почему так?  ' }, anna, 5);
    expect(r && 'thread' in r).toBe(true);
    const t = (r as { thread: CommentThread }).thread;
    expect(t).toMatchObject({ itemId: 's1', dx: 50, dy: 20, resolved: false });
    expect(t.messages[0]).toMatchObject({ text: 'Почему так?', authorId: 'ua', authorName: 'Анна', createdAt: 5 });
    const r2 = applyComment(comments, items, { action: 'reply', threadId: t.id, text: 'Потому что' }, boris, 6);
    expect((r2 as { thread: CommentThread }).thread.messages.map((m) => m.authorName)).toEqual(['Анна', 'Борис']);
    const r3 = applyComment(comments, items, { action: 'resolve', threadId: t.id, resolved: true }, boris, 7);
    expect((r3 as { thread: CommentThread }).thread.resolved).toBe(true);
  });

  it('автор не подделывается, пустой и слишком длинный текст отклоняются', () => {
    const comments: Record<string, CommentThread> = {};
    const r = applyComment(
      comments,
      items,
      { action: 'create', x: 0, y: 0, text: 'Привет', authorName: 'Хакер', authorId: 'root' },
      anna,
      1,
    ) as { thread: CommentThread };
    expect(r.thread.messages[0].authorName).toBe('Анна');
    expect(applyComment(comments, items, { action: 'create', x: 0, y: 0, text: '   ' }, anna, 1)).toBeNull();
    expect(applyComment(comments, items, { action: 'create', x: 0, y: 0, text: 'я'.repeat(2001) }, anna, 1)).toBeNull();
    expect(applyComment(comments, items, { action: 'create', x: 0, y: 0, itemId: 'nope', text: 'x' }, anna, 1)).toBeNull();
  });

  it('удалять можно только свои сообщения; удаление первого удаляет тред', () => {
    const comments: Record<string, CommentThread> = {};
    const t = (applyComment(comments, items, { action: 'create', x: 0, y: 0, text: 'Первое' }, anna, 1) as { thread: CommentThread }).thread;
    const reply = (applyComment(comments, items, { action: 'reply', threadId: t.id, text: 'Ответ' }, boris, 2) as { thread: CommentThread })
      .thread.messages[1];
    expect(applyComment(comments, items, { action: 'deleteMessage', threadId: t.id, messageId: reply.id }, anna, 3)).toBeNull();
    const r = applyComment(comments, items, { action: 'deleteMessage', threadId: t.id, messageId: reply.id }, boris, 3);
    expect((r as { thread: CommentThread }).thread.messages).toHaveLength(1);
    expect(applyComment(comments, items, { action: 'deleteMessage', threadId: t.id, messageId: t.messages[0].id }, anna, 4)).toEqual({
      deleted: t.id,
    });
    expect(comments[t.id]).toBeUndefined();
  });

  it('при удалении объекта тред становится свободным на его последней позиции', () => {
    const comments: Record<string, CommentThread> = {};
    const t = (applyComment(comments, items, { action: 'create', x: 150, y: 120, itemId: 's1', text: 'x' }, anna, 1) as {
      thread: CommentThread;
    }).thread;
    const moved: ItemMap = { s1: { ...items.s1, x: 500, y: 600 } };
    const changed = detachThreads(comments, moved, new Set(['s1']), 9);
    expect(changed).toHaveLength(1);
    expect(comments[t.id]).toMatchObject({ itemId: null, x: 550, y: 620, updatedAt: 9 });
  });
});
