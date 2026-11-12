import { createServer, type Server } from 'node:http';

/**
 * HTTP-проба живости воркера. Очереди BullMQ (import, ai, index, maintenance)
 * подключаются на этапах M6–M8; здесь — каркас M0.3.
 */
export function buildHealthServer(): Server {
  return createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'worker' }));
      return;
    }
    res.writeHead(404).end();
  });
}
