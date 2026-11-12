import { readFileSync } from 'node:fs';
import { getTableConfig, isPgEnum, type PgTable } from 'drizzle-orm/pg-core';
import { is } from 'drizzle-orm';
import { PgTable as PgTableClass } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schema from './index';

const tables = (Object.values(schema) as unknown[]).filter((v): v is PgTable => is(v, PgTableClass));
const actual = new Map(
  tables.map((t) => {
    const cfg = getTableConfig(t);
    return [cfg.name, cfg.columns.map((c) => c.name)] as const;
  }),
);

/** Логическая схема из docs/SPEC.md, 7.1: `table(col, col type…, …)` → имена таблиц и столбцов. */
function specTables(): Map<string, string[]> {
  const spec = readFileSync(new URL('../../../../docs/SPEC.md', import.meta.url), 'utf8');
  const start = spec.indexOf('### 7.1. PostgreSQL');
  const block = spec.slice(
    spec.indexOf('```', start) + 3,
    spec.indexOf('```', spec.indexOf('```', start) + 3),
  );
  const out = new Map<string, string[]>();
  for (const m of block.matchAll(
    /^([a-z_]+)\(([\s\S]*?)\)\s*$(?=\n(?:[a-z_]+\(|\s+(?:unique|index)|\n|$))/gm,
  )) {
    const body = m[2]!.replace(/\([^()]*\)/g, '').replace(/'[^']*'/g, ''); // убрать enum(...), pk(...), GENERATED …
    const cols = body
      .split(',')
      .map((part) => part.trim().split(/\s+/)[0]!)
      .filter((name) => /^[a-z_0-9]+$/.test(name) && name !== 'pk');
    out.set(m[1]!, cols);
  }
  return out;
}

const SEARCH_TABLES = ['search_chunks', 'qa_logs']; // создаются на этапе M8

describe('M1.2: схема Drizzle соответствует логической схеме 7.1', () => {
  const spec = specTables();

  it('в спецификации разобраны все 23 таблицы', () => {
    expect(spec.size).toBe(23);
  });

  it('есть все таблицы 7.1, кроме таблиц поиска, и нет лишних', () => {
    const expected = [...spec.keys()].filter((name) => !SEARCH_TABLES.includes(name)).sort();
    expect([...actual.keys()].sort()).toEqual(expected);
  });

  it('столбцы каждой таблицы совпадают со спецификацией', () => {
    for (const [name, columns] of actual) {
      expect({ table: name, columns: [...columns].sort() }).toEqual({
        table: name,
        columns: [...spec.get(name)!].sort(),
      });
    }
  });

  it('первичный ключ id — uuid с генерацией на стороне приложения', () => {
    for (const table of tables) {
      const idColumn = getTableConfig(table).columns.find((c) => c.name === 'id');
      if (!idColumn) continue;
      expect(idColumn.getSQLType()).toBe('uuid');
      expect(idColumn.primary).toBe(true);
      expect(idColumn.defaultFn).toBeTypeOf('function');
    }
  });

  it('все столбцы времени — timestamptz', () => {
    for (const table of tables) {
      for (const column of getTableConfig(table).columns) {
        if (column.name.endsWith('_at'))
          expect(`${column.name}: ${column.getSQLType()}`).toBe(`${column.name}: timestamp with time zone`);
      }
    }
  });
});

describe('M1.2: перечисления совпадают с 7.1 по составу и порядку значений', () => {
  it('каждое enum(...) из спецификации есть в схеме', () => {
    const spec = readFileSync(new URL('../../../../docs/SPEC.md', import.meta.url), 'utf8');
    const section = spec.slice(spec.indexOf('### 7.1. PostgreSQL'), spec.indexOf('### 7.2.'));
    const inSpec = [...section.matchAll(/enum\(([^)]*)\)/g)].map((m) =>
      m[1]!
        .split(',')
        .map((v) => v.trim())
        .join(','),
    );
    const inSchema = new Set(
      (Object.values(schema) as unknown[]).filter(isPgEnum).map((e) => e.enumValues.join(',')),
    );
    const SEARCH_ENUM = 'page_title,doc_section,board_item,task'; // search_chunks.kind — этап M8
    expect(inSpec.length).toBeGreaterThanOrEqual(14);
    for (const values of inSpec) {
      if (values === SEARCH_ENUM) continue;
      expect(inSchema, `enum(${values})`).toContain(values);
    }
  });
});

describe('M1.2: docs/data-model.md не расходится со схемой', () => {
  const doc = readFileSync(new URL('../../../../docs/data-model.md', import.meta.url), 'utf8');

  it('для каждой таблицы в документе перечислены все её столбцы', () => {
    for (const [name, columns] of actual) {
      const row = doc.split('\n').find((line) => new RegExp(`^\\|\\s*\`${name}\`\\s*\\|`).test(line));
      expect(row, `нет строки таблицы ${name}`).toBeDefined();
      for (const column of columns) expect(row, `${name}.${column}`).toContain(`\`${column}\``);
    }
  });
});
