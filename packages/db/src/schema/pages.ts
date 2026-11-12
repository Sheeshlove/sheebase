import { type AnyPgColumn, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { users } from './auth';
import { bytea, createdAt, id, ts } from './columns';
import { pageKind, snapshotReason } from './enums';
import { files } from './files';
import { workspaces } from './workspaces';

export const pages = pgTable(
  'pages',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => pages.id, { onDelete: 'restrict' }),
    kind: pageKind('kind').notNull(),
    title: text('title').notNull().default(''),
    icon: text('icon'),
    position: text('position').notNull(), // дробный индекс
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    archivedAt: ts('archived_at'),
    sourceFileId: uuid('source_file_id').references(() => files.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('pages_workspace_parent_idx').on(t.workspaceId, t.parentId, t.position),
    index('pages_parent_id_idx').on(t.parentId),
    index('pages_source_file_id_idx').on(t.sourceFileId),
  ],
);

export const yjsDocuments = pgTable('yjs_documents', {
  pageId: uuid('page_id')
    .primaryKey()
    .references(() => pages.id, { onDelete: 'cascade' }),
  state: bytea('state').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const pageSnapshots = pgTable(
  'page_snapshots',
  {
    id: id(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => pages.id, { onDelete: 'cascade' }),
    state: bytea('state').notNull(),
    reason: snapshotReason('reason').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('page_snapshots_page_created_idx').on(t.pageId, t.createdAt)],
);
