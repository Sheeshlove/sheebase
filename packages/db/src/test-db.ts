import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { createDb, type DbHandle } from './client';
import { runMigrations } from './migrate';

const DEFAULT_URL = 'postgres://shibase:shibase@localhost:5432/shibase';

export interface TestDatabase extends DbHandle {
  url: string;
  /** Закрывает соединения и удаляет временную базу. */
  drop(): Promise<void>;
}

/**
 * Создаёт отдельную базу для интеграционного теста и применяет к ней все миграции с нуля.
 * Каждый тестовый файл работает в своей базе и не зависит от порядка (docs/SPEC.md, разд. 12).
 * Если PostgreSQL недоступен, тест падает: пропускать интеграционные тесты молча нельзя.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const baseUrl = process.env.DATABASE_URL ?? DEFAULT_URL;
  const name = `shibase_test_${randomBytes(6).toString('hex')}`;
  const target = new URL(baseUrl);
  target.pathname = `/${name}`;
  const url = target.toString();

  await withAdmin(baseUrl, (admin) => admin.query(`create database ${name}`));
  const dropDatabase = () =>
    withAdmin(baseUrl, (admin) => admin.query(`drop database if exists ${name} with (force)`));
  let handle: DbHandle;
  try {
    await runMigrations(url);
    handle = createDb(url, { max: 4 });
  } catch (error) {
    await dropDatabase(); // не оставлять временную базу, если миграции упали
    throw error;
  }
  return {
    ...handle,
    url,
    async drop() {
      await handle.close();
      await dropDatabase();
    },
  };
}

async function withAdmin(baseUrl: string, fn: (admin: pg.Client) => Promise<unknown>): Promise<void> {
  const admin = new pg.Client({ connectionString: baseUrl });
  try {
    await admin.connect();
  } catch (cause) {
    const where = new URL(baseUrl);
    throw new Error(
      `Не удалось подключиться к PostgreSQL (${where.host}${where.pathname}): ${(cause as Error).message}. ` +
        'Проверьте DATABASE_URL и запустите pnpm infra:up.',
      { cause },
    );
  }
  try {
    await fn(admin);
  } finally {
    await admin.end();
  }
}
