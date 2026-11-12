import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './app';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const server = await startServer({
  port: Number(process.env.PORT ?? 3000),
  dataDir: path.resolve(process.env.DATA_DIR ?? path.join(root, 'data')),
  staticDir: path.join(root, 'dist/client'),
});

console.log(`Sheebase Board: http://localhost:${server.port}`);

let stopping = false;
const shutdown = async (signal: string) => {
  if (stopping) return;
  stopping = true;
  console.log(`\n${signal}: сохраняю доски и останавливаюсь…`);
  await server.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
