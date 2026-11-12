#!/usr/bin/env node
// Хук PostToolUse для Edit и Write: Prettier и eslint --fix для изменённого файла (docs/SPEC.md, 15.3).
// Быстрая правка одного файла, не полная проверка; ошибки не блокируют работу.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

let input = '';
for await (const chunk of process.stdin) input += chunk;
let file;
try {
  file = JSON.parse(input).tool_input?.file_path;
} catch {
  process.exit(0);
}
const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
if (!file || !existsSync(file)) process.exit(0);
const rel = path.relative(root, path.resolve(root, file)).split(path.sep).join('/');
if (rel.startsWith('..') || rel.startsWith('prototype/') || rel.includes('node_modules/')) process.exit(0);

const run = (bin, args) => {
  try {
    execFileSync(path.join(root, 'node_modules/.bin', bin), args, {
      cwd: root,
      stdio: 'ignore',
      timeout: 20000,
    });
  } catch {
    /* замечания линтера покажет pnpm verify */
  }
};
if (/\.(ts|tsx|mjs|js|json|md|ya?ml|css|html|astro)$/.test(rel))
  run('prettier', ['--write', '--ignore-unknown', rel]);
if (/\.(ts|tsx|mjs)$/.test(rel) && !rel.startsWith('tools/spikes/')) run('eslint', ['--fix', rel]);
