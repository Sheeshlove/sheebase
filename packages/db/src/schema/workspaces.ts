import { boolean, index, integer, jsonb, pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';
import { users } from './auth';
import { citext, createdAt, id, ts } from './columns';
import { memberRole, workspaceKind, workspacePlan } from './enums';

export const workspaces = pgTable(
  'workspaces',
  {
    id: id(),
    name: text('name').notNull(),
    kind: workspaceKind('kind').notNull(),
    plan: workspacePlan('plan').notNull(),
    university: text('university'),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    isDemoTemplate: boolean('is_demo_template').notNull().default(false),
    demoCloneOf: uuid('demo_clone_of'), // id демо-шаблона; без внешнего ключа, чтобы шаблон можно было заменить
    expiresAt: ts('expires_at'),
    createdAt: createdAt(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [index('workspaces_owner_id_idx').on(t.ownerId)],
);

export const memberships = pgTable(
  'memberships',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: memberRole('role').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index('memberships_user_id_idx').on(t.userId)],
);

export const invites = pgTable(
  'invites',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: citext('email'), // null — приглашение по ссылке
    role: memberRole('role').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    maxUses: integer('max_uses').notNull().default(1),
    uses: integer('uses').notNull().default(0),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    createdAt: createdAt(),
  },
  (t) => [index('invites_workspace_id_idx').on(t.workspaceId)],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    target: text('target').notNull(),
    meta: jsonb('meta').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index('audit_log_workspace_created_idx').on(t.workspaceId, t.createdAt)],
);
