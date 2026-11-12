#!/usr/bin/env node
// Хук PreToolUse для Edit и Write: не даёт править защищённые файлы (docs/SPEC.md, 15.3).
// Вход — JSON события в stdin; код 2 блокирует правку, текст из stderr получает агент.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const RULES = [
  {
    re: /^docs\/SPEC\.md$/,
    why: 'Спецификация — единственный источник истины, её меняет только человек. Расхождение запиши в docs/STATUS.md.',
  },
  { re: /^pnpm-lock\.yaml$/, why: 'Lock-файл меняется только командами pnpm.' },
  {
    re: /^reports\//,
    why: 'Протоколы создают генераторы (pnpm eval:*, report:*). Числа руками не правятся.',
  },
  { re: /^data\/eval\/.*\/gold\//, why: 'Эталонную разметку ведёт человек.' },
  { re: /(^|\/)qrels\.jsonl$/, why: 'Оценки релевантности ведёт человек.' },
  {
    re: /^\.github\/workflows\//,
    why: 'CI меняется только по задаче с пометкой. Нужно по задаче — запусти с SHIBASE_ALLOW_CI_EDIT=1.',
    env: 'SHIBASE_ALLOW_CI_EDIT',
  },
  {
    re: /^packages\/db\/migrations\//,
    why: 'Применённые миграции не редактируются. Нужна новая: pnpm db:generate.',
    committedOnly: true,
  },
];

/** Возвращает причину запрета или null. Вынесено для тестов. */
export function check(relPath, { env = process.env, isCommitted = () => false } = {}) {
  const p = relPath.split(path.sep).join('/');
  for (const rule of RULES) {
    if (!rule.re.test(p)) continue;
    if (rule.env && env[rule.env] === '1') continue;
    if (rule.committedOnly && !isCommitted(p)) continue; // новые файлы текущей ветки править можно
    return rule.why;
  }
  return null;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  let file;
  try {
    file = JSON.parse(input).tool_input?.file_path;
  } catch {
    process.exit(0);
  }
  if (!file) process.exit(0);
  const root = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const rel = path.relative(root, path.resolve(root, file));
  const isCommitted = (p) => {
    try {
      execFileSync('git', ['cat-file', '-e', `HEAD:${p}`], { cwd: root, stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  };
  const why = check(rel, { isCommitted });
  if (why) {
    console.error(`Правка ${rel} заблокирована. ${why}`);
    process.exit(2);
  }
}
