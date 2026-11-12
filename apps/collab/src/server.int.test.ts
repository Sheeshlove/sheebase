import { expect, it } from 'vitest';
import { buildCollab } from './server';

it('M0.3: collab отвечает на /healthz', async () => {
  const port = 39000 + Math.floor(Math.random() * 500);
  const server = buildCollab({ COLLAB_PORT: port, LOG_LEVEL: 'silent' });
  await server.listen();
  const res = await fetch(`http://127.0.0.1:${port}/healthz`);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ status: 'ok', service: 'collab' });
  await server.destroy();
});
