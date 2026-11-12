import { index, integer, jsonb, pgTable, real, text, uuid } from 'drizzle-orm/pg-core';
import { users } from './auth';
import { createdAt, id, ts } from './columns';
import { aiRunStatus } from './enums';
import { pages } from './pages';
import { workspaces } from './workspaces';

export const aiRuns = pgTable(
  'ai_runs',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    sourcePageIds: uuid('source_page_ids').array().notNull(),
    targetBoardId: uuid('target_board_id').references(() => pages.id, { onDelete: 'set null' }),
    status: aiRunStatus('status').notNull().default('queued'),
    progress: real('progress').notNull().default(0),
    options: jsonb('options').$type<Record<string, unknown>>().notNull(),
    provider: text('provider'),
    model: text('model'),
    promptVersion: text('prompt_version'),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costKopecks: integer('cost_kopecks').notNull().default(0),
    timings: jsonb('timings').$type<Record<string, number>>(),
    graph: jsonb('graph').$type<Record<string, unknown>>(),
    error: text('error'),
    feedback: jsonb('feedback').$type<Record<string, unknown>>(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    finishedAt: ts('finished_at'),
  },
  (t) => [
    index('ai_runs_workspace_created_idx').on(t.workspaceId, t.createdAt),
    index('ai_runs_target_board_id_idx').on(t.targetBoardId),
  ],
);

export const llmCache = pgTable('llm_cache', {
  key: text('key').primaryKey(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  promptVersion: text('prompt_version').notNull(),
  response: jsonb('response').$type<unknown>().notNull(),
  createdAt: createdAt(),
});
