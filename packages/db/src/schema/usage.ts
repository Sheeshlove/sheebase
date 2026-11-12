import {
  bigint,
  char,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth';
import { createdAt, id } from './columns';
import { feedbackKind } from './enums';
import { workspaces } from './workspaces';

export const usageCounters = pgTable(
  'usage_counters',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    period: char('period', { length: 7 }).notNull(), // 'YYYY-MM'
    aiStructurings: integer('ai_structurings').notNull().default(0),
    aiQuestions: integer('ai_questions').notNull().default(0),
    inputTokens: bigint('input_tokens', { mode: 'number' }).notNull().default(0),
    outputTokens: bigint('output_tokens', { mode: 'number' }).notNull().default(0),
    costKopecks: bigint('cost_kopecks', { mode: 'number' }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.period] })],
);

export const aiDailySpend = pgTable('ai_daily_spend', {
  day: date('day', { mode: 'string' }).primaryKey(),
  costKopecks: bigint('cost_kopecks', { mode: 'number' }).notNull().default(0),
});

export const analyticsEvents = pgTable(
  'analytics_events',
  {
    id: id(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    props: jsonb('props').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index('analytics_events_name_created_idx').on(t.name, t.createdAt)],
);

export const feedback = pgTable('feedback', {
  id: id(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
  kind: feedbackKind('kind').notNull(),
  rating: smallint('rating'),
  answers: jsonb('answers').$type<Record<string, unknown>>(),
  text: text('text'),
  createdAt: createdAt(),
});
