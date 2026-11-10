import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { WebSocketServer } from 'ws';
import { TEMPLATES } from '../shared/templates';
import { renderThumbnailSvg } from '../shared/thumbnail';
import { isValidId, sanitizeName } from '../shared/validate';
import { BoardRepository } from './repository';
import { Rooms } from './rooms';

export interface ServerOptions {
  port: number;
  dataDir: string;
  /** Каталог собранного клиента (dist/client). Если не существует — статика не раздаётся. */
  staticDir?: string;
  saveDelayMs?: number;
  /** Интервал автоматических снимков версий (по умолчанию 10 минут). */
  autoSnapshotMs?: number;
  /** Источник времени (подменяется в тестах). */
  now?: () => number;
  quiet?: boolean;
}

export interface RunningServer {
  port: number;
  repo: BoardRepository;
  close(): Promise<void>;
}

export async function startServer(opts: ServerOptions): Promise<RunningServer> {
  const repo = new BoardRepository(opts.dataDir, { saveDelayMs: opts.saveDelayMs, autoSnapshotMs: opts.autoSnapshotMs, now: opts.now });
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

  // ---------- Миниатюры ----------

  api.get('/boards/:id/thumbnail.svg', (req, res) => {
    const board = repo.get(req.params.id);
    if (!board) {
      res.status(404).end();
      return;
    }
    const etag = `"${board.meta.updatedAt}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'no-cache');
    // SVG строится из проверенных данных, но на всякий случай запрещаем в нём скрипты
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'");
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }
    res.type('image/svg+xml').send(renderThumbnailSvg(board.items));
  });

  // ---------- История версий ----------

  api.get('/boards/:id/versions', (req, res) => {
    if (!repo.get(req.params.id)) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(repo.versions.list(req.params.id));
  });

  api.post('/boards/:id/versions', (req, res) => {
    const meta = repo.snapshot(req.params.id, sanitizeName(req.body?.name, 'Версия').slice(0, 120));
    if (!meta) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.status(201).json(meta);
  });

  api.get('/boards/:id/versions/:vid', (req, res) => {
    const v = repo.get(req.params.id) && isValidId(req.params.vid) ? repo.versions.get(req.params.id, req.params.vid) : null;
    if (!v) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(v);
  });

  api.post('/boards/:id/versions/:vid/restore', (req, res) => {
    const r = isValidId(req.params.vid) ? repo.restore(req.params.id, req.params.vid) : undefined;
    if (!r) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    rooms.resetBoard(req.params.id, r.items, `Доска восстановлена из версии «${r.version.name}»`, r.threads);
    res.json({ ok: true, version: r.version, itemCount: Object.keys(r.items).length });
  });

  api.delete('/boards/:id/versions/:vid', (req, res) => {
    const ok = repo.get(req.params.id) && isValidId(req.params.vid) && repo.versions.remove(req.params.id, req.params.vid);
    res.status(ok ? 204 : 404).end();
  });

  app.use('/api', api);

  // ---------- Статика (собранный клиент) ----------
  if (opts.staticDir && fs.existsSync(path.join(opts.staticDir, 'index.html'))) {
    app.use(
      express.static(opts.staticDir, {
        index: 'index.html',
        setHeaders(res, filePath) {
          // index.html всегда перепроверяется (иначе после пересборки он сошлётся на удалённые ассеты),
          // файлы из assets/ содержат хеш в имени и неизменяемы
          if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
          else if (filePath.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        },
      }),
    );
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
