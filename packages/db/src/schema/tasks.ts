import { date, index, integer, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';
import { aiRuns } from './ai';
import { users } from './auth';
import { createdAt, id, ts } from './columns';
import { linkEndpointKind, linkRelation, taskOrigin, taskStatus } from './enums';
import { workspaces } from './workspaces';

export const tasks = pgTable(
  'tasks',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    status: taskStatus('status').notNull().default('todo'),
    position: text('position').notNull(), // дробный индекс внутри статуса
    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    dueDate: date('due_date', { mode: 'string' }),
    origin: taskOrigin('origin').notNull().default('manual'),
    aiRunId: uuid('ai_run_id').references(() => aiRuns.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    completedAt: ts('completed_at'),
  },
  (t) => [
    unique('tasks_workspace_number_uq').on(t.workspaceId, t.number),
    index('tasks_workspace_status_idx').on(t.workspaceId, t.status, t.position),
    index('tasks_assignee_id_idx').on(t.assigneeId),
    index('tasks_ai_run_id_idx').on(t.aiRunId),
  ],
);

export const workspaceCounters = pgTable('workspace_counters', {
  workspaceId: uuid('workspace_id')
    .primaryKey()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  nextTaskNumber: integer('next_task_number').notNull().default(1),
});

export const objectLinks = pgTable(
  'object_links',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    fromKind: linkEndpointKind('from_kind').notNull(),
    // без внешних ключей на pages: связь переживает удаление страницы и помечается broken_at (FR-LINK-4)
    fromPageId: uuid('from_page_id'),
    fromRef: text('from_ref').notNull(),
    toKind: linkEndpointKind('to_kind').notNull(),
    toPageId: uuid('to_page_id'),
    toRef: text('to_ref').notNull(),
    relation: linkRelation('relation').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    brokenAt: ts('broken_at'),
  },
  (t) => [
    index('object_links_to_idx').on(t.workspaceId, t.toKind, t.toPageId, t.toRef),
    index('object_links_from_idx').on(t.workspaceId, t.fromKind, t.fromPageId, t.fromRef),
  ],
);
