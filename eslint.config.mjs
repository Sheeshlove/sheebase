import js from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import tseslint from 'typescript-eslint';

// Границы модулей — docs/SPEC.md, разд. 6.3.
const ISOMORPHIC = ['shared', 'layout', 'doc-model']; // работают и в браузере, и на сервере
// Правило no-restricted-imports не складывается между блоками конфигурации,
// поэтому наборы запретов собираются явно для каждой группы файлов.
const NODE_BUILTINS = [
  'fs',
  'path',
  'http',
  'https',
  'net',
  'os',
  'child_process',
  'crypto',
  'stream',
  'worker_threads',
  'url',
  'util',
];
const DB_ONLY = {
  group: ['pg', 'postgres', 'drizzle-orm', 'drizzle-orm/*'],
  message: 'Доступ к БД — только через @shibase/db (разд. 6.3).',
};
const NO_NODE = {
  group: ['node:*', ...NODE_BUILTINS, ...NODE_BUILTINS.map((n) => `${n}/*`)],
  message: 'Пакет изоморфный: Node API запрещены (разд. 6.3).',
};
const NO_REACT = {
  group: ['react', 'react-dom', 'react-konva', 'react/*', 'react-dom/*'],
  message: 'board-engine не знает о React (разд. 6.3).',
};

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.turbo/**',
      '**/.astro/**',
      '**/coverage/**',
      'prototype/**', // прототип первой итерации: собственные проверки, см. prototype/README.md
      'tools/spikes/**', // спайки M0.6–M0.8: одноразовый исследовательский код
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      'boundaries/elements': [
        { type: 'app', pattern: 'apps/*', capture: ['name'] },
        { type: 'package', pattern: 'packages/*', capture: ['name'] },
      ],
      'import/resolver': { node: { extensions: ['.ts', '.tsx', '.mjs', '.js'] } },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: [
            // приложения используют пакеты; друг друга — нет
            { from: { element: { type: 'app' } }, allow: { to: { element: { type: 'package' } } } },
            // packages/* не импортируют apps/*
            { from: { element: { type: 'package' } }, allow: { to: { element: { type: 'package' } } } },
          ],
        },
      ],
    },
  },
  {
    // БД — только через packages/db (исключение — гибридный запрос поиска)
    files: ['apps/**/*.{ts,tsx}', 'packages/**/*.ts'],
    ignores: ['packages/db/**', 'packages/search/src/query.ts', 'packages/testing/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [DB_ONLY] }] },
  },
  {
    // layout, doc-model, shared не зависят от Node- и DOM-специфичных API
    files: ISOMORPHIC.map((p) => `packages/${p}/src/**/*.ts`),
    ignores: ['**/*.test.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [DB_ONLY, NO_NODE] }],
      'no-restricted-globals': [
        'error',
        'window',
        'document',
        'navigator',
        'localStorage',
        'process',
        'Buffer',
      ],
    },
  },
  {
    // board-engine не знает о React
    files: ['packages/board-engine/src/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: [DB_ONLY, NO_REACT] }] },
  },
  {
    files: ['tools/**/*.mjs', '*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        Buffer: 'readonly',
      },
    },
  },
);
