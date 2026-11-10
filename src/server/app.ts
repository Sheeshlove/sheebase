import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { WebSocketServer } from 'ws';
import { TEMPLATES } from '../shared/templates';
import { sanitizeName } from '../shared/validate';
import { BoardRepository } from './repository';
import { Rooms } from './rooms';

export interface ServerOptions {
  port: number;
  dataDir: string;
  /** Каталог собранного клиента (dist/client). Если не существует — статика не раздаётся. */
  staticDir?: string;
  saveDelayMs?: number;
  quiet?: boolean;
}

export interface RunningServer {
  port: number;
  repo: BoardRepository;
  close(): Promise<void>;
}

export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  const repo = new BoardRepository(opts.dataDir, opts.saveDelayMs);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 20 * 1024 * 1024 });
  const rooms = new Rooms(repo, wss);

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    if (pathname !== '/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  // ---------- REST API ----------
  const api = express.Router();

  api.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  api.get('/templates', (_req, res) => {
    res.json(TEMPLATES);
  });

  api.get('/boards', (_req, res) => {
    res.json(repo.list());
  });

  api.post('/boards', (req, res) => {
    const body = req.body ?? {};
    const template = typeof body.template === 'string' ? body.template : 'blank';
    const tplName = TEMPLATES.find((t) => t.id === template)?.name;
    const fallback = template !== 'blank' && tplName ? tplName : 'Новая доска';
    const meta = repo.create(sanitizeName(body.name, fallback), template);
    res.status(201).json(meta);
  });

  api.get('/boards/:id', (req, res) => {
    const board = repo.get(req.params.id);
    if (!board) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json({ meta: repo.metaOf(req.params.id), items: board.items });
  });

  api.patch('/boards/:id', (req, res) => {
    const meta = repo.rename(req.params.id, sanitizeName(req.body?.name, 'Без названия'));
    if (!meta) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    rooms.notifyMeta(meta);
    res.json(meta);
  });

  api.post('/boards/:id/duplicate', (req, res) => {
    const src = repo.metaOf(req.params.id);
    if (!src) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const meta = repo.duplicate(req.params.id, sanitizeName(req.body?.name, `${src.name} (копия)`));
    res.status(201).json(meta);
  });

  api.delete('/boards/:id', async (req, res) => {
    const ok = await repo.remove(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    rooms.closeBoard(req.params.id);
    res.status(204).end();
  });

  app.use('/api', api);

  // ---------- Статика (собранный клиент) ----------
  if (opts.staticDir && fs.existsSync(path.join(opts.staticDir, 'index.html'))) {
    app.use(express.static(opts.staticDir, { index: 'index.html', maxAge: '1h' }));
  } else if (!opts.quiet) {
    app.get('/', (_req, res) => {
      res
        .type('text/plain; charset=utf-8')
        .send('Клиент не собран. Запустите `npm run build` или используйте `npm run dev` (http://localhost:5173).');
    });
  }

  await new Promise<void>((resolve) => server.listen(opts.port, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : opts.port;

  return {
    port,
    repo,
    async close() {
      rooms.close();
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await repo.flush();
    },
  };
}
