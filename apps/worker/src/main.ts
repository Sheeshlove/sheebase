import { pino } from 'pino';
import { loadEnv } from '@shibase/shared';
import { buildHealthServer } from './health';

const env = loadEnv(process.env);
const log = pino({ level: env.LOG_LEVEL, name: 'worker' });
buildHealthServer().listen(env.WORKER_PORT, () => log.info({ port: env.WORKER_PORT }, 'worker слушает'));
