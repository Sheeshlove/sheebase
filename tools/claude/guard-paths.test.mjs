import { expect, it } from 'vitest';
import { check } from './guard-paths.mjs';

it('M0.5: защищённые пути блокируются с объяснением', () => {
  expect(check('docs/SPEC.md')).toMatch(/Спецификация/);
  expect(check('pnpm-lock.yaml')).toBeTruthy();
  expect(check('reports/kpi-1.md')).toBeTruthy();
  expect(check('data/eval/structuring/gold/a.json')).toBeTruthy();
  expect(check('data/eval/search/qrels.jsonl')).toBeTruthy();
  expect(check('.github/workflows/ci.yml')).toBeTruthy();
  expect(check('.github/workflows/ci.yml', { env: { SHIBASE_ALLOW_CI_EDIT: '1' } })).toBeNull();
});

it('M0.5: применённые миграции закрыты, новые файлы ветки — нет', () => {
  expect(check('packages/db/migrations/0001_init.sql', { isCommitted: () => true })).toBeTruthy();
  expect(check('packages/db/migrations/0002_new.sql', { isCommitted: () => false })).toBeNull();
});

it('M0.5: обычные файлы не затрагиваются', () => {
  expect(check('docs/STATUS.md')).toBeNull();
  expect(check('apps/api/src/app.ts')).toBeNull();
});
