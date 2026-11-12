#!/usr/bin/env node
// pnpm licenses:check — проходит по дереву production-зависимостей и падает
// на запрещённых лицензиях и пакетах (docs/SPEC.md, 14.2 и 15.8).
import { execSync } from 'node:child_process';

const ALLOWED = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  'MPL-2.0',
  '0BSD',
  'CC0-1.0',
  'Unlicense',
  'BlueOak-1.0.0',
  'Python-2.0',
]);
const FORBIDDEN_PACKAGES = [/^@blocknote\/xl-/, /^tldraw$/, /^@tldraw\//];

/** Выражение SPDX допустимо, если каждая ветка AND допустима, а у OR — хотя бы одна. */
export function isAllowed(expression) {
  const expr = String(expression)
    .trim()
    .replace(/^\((.*)\)$/, '$1');
  if (/ OR /.test(expr)) return expr.split(' OR ').some(isAllowed);
  if (/ AND /.test(expr)) return expr.split(' AND ').every(isAllowed);
  return ALLOWED.has(expr.replace(/^\(|\)$/g, ''));
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const raw = execSync('pnpm licenses list --prod --json', {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  const byLicense = JSON.parse(raw);
  const problems = [];
  let total = 0;
  for (const [license, packages] of Object.entries(byLicense)) {
    for (const pkg of packages) {
      total += 1;
      if (FORBIDDEN_PACKAGES.some((re) => re.test(pkg.name)))
        problems.push(`${pkg.name}: пакет запрещён (15.8)`);
      else if (!isAllowed(license))
        problems.push(`${pkg.name}@${(pkg.versions ?? []).join(',')}: лицензия «${license}»`);
    }
  }
  if (problems.length) {
    console.error(`Запрещённые зависимости (${problems.length} из ${total}):`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error('Решение принимает человек (docs/SPEC.md, 15.9).');
    process.exit(1);
  }
  console.log(`Лицензии в порядке: проверено пакетов — ${total}`);
}
