import Fastify, { type FastifyInstance } from 'fastify';
import type { Env } from '@shibase/shared';

/** Собирает HTTP-приложение. Отдельно от запуска — чтобы тестировать через inject(). */
export function buildApp(env: Pick<Env, 'LOG_LEVEL' | 'NODE_ENV'>): FastifyInstance {
  const app = Fastify({ logger: env.NODE_ENV === 'test' ? false : { level: env.LOG_LEVEL } });
  // Живость процесса. Готовность зависимостей (/readyz: БД, Valkey, S3) появится в M1.
  app.get('/healthz', async () => ({ status: 'ok', service: 'api' }));
  return app;
}
