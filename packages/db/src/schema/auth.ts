import { boolean, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { citext, createdAt, id, ts } from './columns';
import { emailTokenPurpose } from './enums';

export const users = pgTable('users', {
  id: id(),
  email: citext('email').notNull().unique(),
  emailVerifiedAt: ts('email_verified_at'),
  passwordHash: text('password_hash'), // у гостя пароля нет
  displayName: text('display_name').notNull(),
  avatarColor: text('avatar_color').notNull(),
  isGuest: boolean('is_guest').notNull().default(false),
  guestExpiresAt: ts('guest_expires_at'),
  blockedAt: ts('blocked_at'),
  pdConsentVersion: integer('pd_consent_version'),
  pdConsentAt: ts('pd_consent_at'),
  createdAt: createdAt(),
  deletedAt: ts('deleted_at'),
});

export const sessions = pgTable(
  'sessions',
  {
    idHash: text('id_hash').primaryKey(), // хранится хеш идентификатора сессии, не он сам
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    expiresAt: ts('expires_at').notNull(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    userAgent: text('user_agent'),
    ipHash: text('ip_hash'),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
);

export const emailTokens = pgTable(
  'email_tokens',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: emailTokenPurpose('purpose').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: ts('expires_at').notNull(),
    usedAt: ts('used_at'),
  },
  (t) => [index('email_tokens_user_id_idx').on(t.userId)],
);
