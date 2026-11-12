import { loadEnv } from '@shibase/shared';
import { buildCollab } from './server';

await buildCollab(loadEnv(process.env)).listen();
