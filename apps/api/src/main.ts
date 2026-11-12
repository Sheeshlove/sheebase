import { loadEnv } from '@shibase/shared';
import { buildApp } from './app';

const env = loadEnv(process.env);
const app = buildApp(env);
await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
