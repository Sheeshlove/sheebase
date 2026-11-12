import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Db;
  pool: pg.Pool;
  close(): Promise<void>;
}

/** Подключение к PostgreSQL. Вызывающий отвечает за close() при остановке процесса. */
export function createDb(connectionString: string, options: { max?: number } = {}): DbHandle {
  const pool = new pg.Pool({ connectionString, max: options.max ?? 10 });
  // обрыв простаивающего соединения не должен ронять процесс: пул сам откроет новое
  pool.on('error', () => {});
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}
