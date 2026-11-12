// Команды pnpm db:migrate и db:reset. Строка подключения — из DATABASE_URL.
import pg from 'pg';
import { runMigrations } from './migrate';

const command = process.argv[2];
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Не задана переменная DATABASE_URL (см. .env.example).');
  process.exit(1);
}

if (command === 'migrate') {
  await runMigrations(url);
  console.log('Миграции применены.');
} else if (command === 'reset') {
  // Защита от запуска на чужой базе: только локальный сервер и не production.
  const host = new URL(url).hostname;
  if (
    process.env.NODE_ENV === 'production' ||
    !['localhost', '127.0.0.1', '::1', 'postgres'].includes(host)
  ) {
    console.error(`db:reset разрешён только для локальной базы; сейчас сервер — ${host}.`);
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    // drizzle — служебная схема с журналом миграций
    await client.query(
      'drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;',
    );
  } finally {
    await client.end();
  }
  console.log('Схема очищена. Дальше: pnpm db:migrate');
} else {
  console.error('Использование: tsx src/cli.ts migrate | reset');
  process.exit(1);
}
