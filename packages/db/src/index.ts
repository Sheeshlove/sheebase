export { createDb, type Db, type DbHandle } from './client';
export { MIGRATIONS_DIR, runMigrations } from './migrate';
export * as schema from './schema';

export const PACKAGE = '@shibase/db';
