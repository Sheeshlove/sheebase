import { expect, it } from 'vitest';
import { buildApp } from './app';

it('M0.3: api отвечает на /healthz', async () => {
  const app = buildApp({ LOG_LEVEL: 'silent', NODE_ENV: 'test' });
  const res = await app.inject({ method: 'GET', url: '/healthz' });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ status: 'ok', service: 'api' });
  await app.close();
});
