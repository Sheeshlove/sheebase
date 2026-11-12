import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client';

export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

/** Применяет все ещё не применённые миграции. Миграции только вперёд (docs/SPEC.md, 7.1). */
export async function runMigrations(connectionString: string): Promise<void> {
  const handle = createDb(connectionString, { max: 1 });
  try {
    await migrate(handle.db, { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await handle.close();
  }
}
