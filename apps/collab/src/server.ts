import { Server } from '@hocuspocus/server';
import { pino } from 'pino';
import type { Env } from '@shibase/shared';

/**
 * Сервер синхронизации Y.Doc. На этапе M0 — только каркас с /healthz;
 * аутентификация, режим чтения и хранение появятся в M2.2 (docs/spec/20-editor.md, 8.3).
 */
export function buildCollab(env: Pick<Env, 'COLLAB_PORT' | 'LOG_LEVEL'>) {
  const log = pino({ level: env.LOG_LEVEL, name: 'collab' });
  return new Server({
    port: env.COLLAB_PORT,
    quiet: true,
    async onRequest({ request, response }) {
      if (request.url === '/healthz') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ status: 'ok', service: 'collab' }));
        // Hocuspocus: отклонённый промис означает «запрос обработан, дальше не идти»
        throw null;
      }
    },
    async onListen() {
      log.info({ port: env.COLLAB_PORT }, 'collab слушает');
    },
  });
}
