#!/usr/bin/env node
// pnpm doctor — проверяет окружение разработки и печатает, чего не хватает (docs/SPEC.md, 13.1).
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';

const results = [];
const add = (level, name, detail) => results.push({ level, name, detail });
const major = (v) => Number(String(v).replace(/^v/, '').split('.')[0]);

// --- версии
const wantNode = major(readFileSync('.nvmrc', 'utf8').trim());
const haveNode = major(process.version);
if (haveNode === wantNode) add('ok', 'Node.js', process.version);
else if (haveNode >= 22)
  add('warn', 'Node.js', `${process.version}; по спецификации нужна линия ${wantNode} LTS`);
else add('fail', 'Node.js', `${process.version}; нужна линия ${wantNode} LTS`);

try {
  const pnpm = execSync('pnpm --version', { encoding: 'utf8' }).trim();
  add(major(pnpm) >= 10 ? 'ok' : 'fail', 'pnpm', pnpm);
} catch {
  add('fail', 'pnpm', 'не найден: corepack enable');
}

// --- переменные окружения (.env не читается инструментами агента, но doctor запускает человек или CI)
const env = { ...process.env };
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && env[m[1]] === undefined) env[m[1]] = m[2];
  }
  add('ok', '.env', 'найден');
} else add('warn', '.env', 'нет файла: cp .env.example .env');

for (const name of ['SESSION_SECRET', 'COLLAB_JWT_SECRET']) {
  if (!env[name]) add('fail', name, 'не задана');
  else if (env[name].length < 32) add('fail', name, 'короче 32 символов');
  else add('ok', name, 'задана');
}

// --- сервисы
function probe(name, url, fallbackPort) {
  let host = 'localhost';
  let port = fallbackPort;
  try {
    const u = new URL(url);
    host = u.hostname;
    port = Number(u.port) || fallbackPort;
  } catch {
    /* оставляем значения по умолчанию */
  }
  return new Promise((resolve) => {
    const socket = net.connect({ host, port, timeout: 1500 });
    const done = (ok) => {
      socket.destroy();
      add(ok ? 'ok' : 'fail', name, `${host}:${port} ${ok ? 'доступен' : 'недоступен — pnpm infra:up'}`);
      resolve();
    };
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}
await Promise.all([
  probe('PostgreSQL', env.DATABASE_URL ?? 'postgres://localhost:5432', 5432),
  probe('Valkey', env.VALKEY_URL ?? 'redis://localhost:6379', 6379),
  probe('S3 (MinIO)', env.S3_ENDPOINT ?? 'http://localhost:9000', 9000),
  probe('SMTP (Mailpit)', env.SMTP_URL ?? 'smtp://localhost:1025', 1025),
]);

// --- миграции: появятся в M1.1 (packages/db)
add('warn', 'Миграции', 'проверка появится в M1.1 вместе с packages/db');

const icon = { ok: '✓', warn: '!', fail: '✗' };
for (const r of results) console.log(`${icon[r.level]} ${r.name.padEnd(18)} ${r.detail}`);
const failed = results.filter((r) => r.level === 'fail').length;
console.log(failed ? `\nНе хватает: ${failed}` : '\nОкружение готово');
process.exit(failed ? 1 : 0);
