import { bigint, boolean, index, jsonb, pgTable, real, text, uuid } from 'drizzle-orm/pg-core';
import { users } from './auth';
import { createdAt, id, ts } from './columns';
import { importKind, importStatus } from './enums';
import { workspaces } from './workspaces';

export const files = pgTable(
  'files',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id),
    storageKey: text('storage_key').notNull().unique(),
    originalName: text('original_name').notNull(),
    mime: text('mime').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('files_workspace_id_idx').on(t.workspaceId)],
);

export const importJobs = pgTable(
  'import_jobs',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    // без внешнего ключа на pages: модуль pages сам ссылается на files, а страница может быть удалена позже
    parentPageId: uuid('parent_page_id'),
    kind: importKind('kind').notNull(),
    status: importStatus('status').notNull().default('queued'),
    progress: real('progress').notNull().default(0),
    report: jsonb('report').$type<Record<string, unknown>>(),
    error: text('error'),
    structureAfter: boolean('structure_after').notNull().default(false),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    finishedAt: ts('finished_at'),
  },
  (t) => [index('import_jobs_workspace_created_idx').on(t.workspaceId, t.createdAt)],
);
