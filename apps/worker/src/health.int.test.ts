import type { AddressInfo } from 'node:net';
import { expect, it } from 'vitest';
import { buildHealthServer } from './health';

it('M0.3: worker отвечает на /healthz', async () => {
  const server = buildHealthServer();
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/healthz`);
  expect(await res.json()).toEqual({ status: 'ok', service: 'worker' });
  await new Promise((r) => server.close(r));
});
