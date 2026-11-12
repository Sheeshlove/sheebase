import { z } from 'zod';

// Переменные окружения (docs/SPEC.md, Приложение B). Каждое приложение вызывает loadEnv()
// при старте: при ошибке процесс не стартует и печатает, каких переменных не хватает (разд. 13.5).

const port = z.coerce.number().int().min(1).max(65535);

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.url().default('http://localhost:5173'),
  SITE_URL: z.url().default('http://localhost:4321'),
  API_PORT: port.default(3000),
  COLLAB_PORT: port.default(3001),
  WORKER_PORT: port.default(3002),
  DATABASE_URL: z.string().min(1).default('postgres://shibase:shibase@localhost:5432/shibase'),
  VALKEY_URL: z.string().min(1).default('redis://localhost:6379'),
  S3_ENDPOINT: z.string().default('http://localhost:9000'),
  S3_REGION: z.string().default('ru-central1'),
  S3_BUCKET: z.string().default('shibase'),
  S3_ACCESS_KEY: z.string().default('minioadmin'),
  S3_SECRET_KEY: z.string().default('minioadmin'),
  SESSION_SECRET: z.string().min(32, 'нужно не меньше 32 символов'),
  COLLAB_JWT_SECRET: z.string().min(32, 'нужно не меньше 32 символов'),
  SMTP_URL: z.string().default('smtp://localhost:1025'),
  MAIL_FROM: z.string().default('ШИБЕЙС <no-reply@localhost>'),
  LLM_PROVIDER: z.enum(['mock', 'replay', 'yandex', 'gigachat']).default('mock'),
  EMBEDDING_PROVIDER: z.enum(['mock', 'yandex']).default('mock'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

export class EnvError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Некорректное окружение:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'EnvError';
  }
}

/** Разобрать окружение. Бросает EnvError со списком проблем по каждой переменной. */
export function loadEnv(source: Record<string, string | undefined>): Env {
  const parsed = envSchema.safeParse(source);
  if (parsed.success) return parsed.data;
  throw new EnvError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
}
