import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ACTIONS, type Action, can, isReadOnly, type Role, ROLES } from './permissions';

/** Строки матрицы Приложения E → действия модуля. Порядок совпадает со спецификацией. */
const LABELS: Record<string, Action> = {
  'Читать страницы, задачи, доску': 'content.read',
  'Создавать, править, перемещать страницы': 'page.write',
  'Архивировать страницу': 'page.archive',
  'Окончательно удалять из архива': 'page.purge',
  'Восстанавливать версию документа': 'page.restoreVersion',
  'Создавать и править задачи, принимать черновики': 'task.write',
  'Создавать и удалять связи': 'link.write',
  'Импорт файлов': 'file.import',
  'Запуск структурирования': 'ai.structure',
  'Поиск и вопросы': 'search.query',
  Сводка: 'summary.read',
  'Приглашать участников': 'member.invite',
  'Менять роли, исключать': 'member.manage',
  'Переименовать пространство, поле «Вуз»': 'workspace.update',
  'Удалить пространство, передать владение': 'workspace.delete',
  'Журнал действий': 'audit.read',
  'Экспорт в Markdown': 'page.export',
  'Тариф и использование (просмотр)': 'usage.read',
};

interface Row {
  label: string;
  action: Action | undefined;
  owner: boolean;
  editor: boolean;
  viewer: boolean;
  guest: boolean;
}

/** Матрица читается прямо из спецификации: тест падает, если код или ТЗ разошлись. */
function specMatrix(): Row[] {
  const spec = readFileSync(new URL('../../../docs/SPEC.md', import.meta.url), 'utf8');
  const start = spec.indexOf('## Приложение E. Матрица прав');
  const section = spec.slice(start, spec.indexOf('\n## ', start + 1));
  return section
    .split('\n')
    .filter((line) => line.startsWith('|') && !line.startsWith('| Действие') && !line.startsWith('|---'))
    .map((line) => {
      const cells = line
        .split('|')
        .slice(1, -1)
        .map((c) => c.trim());
      const allowed = (cell: string | undefined) => {
        if (cell === undefined || !/^(✓|—)/.test(cell))
          throw new Error(`Непонятная ячейка матрицы: «${cell}»`);
        return cell.startsWith('✓');
      };
      const label = cells[0]!;
      return {
        label,
        action: LABELS[label],
        owner: allowed(cells[1]),
        editor: allowed(cells[2]),
        viewer: allowed(cells[3]),
        guest: allowed(cells[4]),
      };
    });
}

const matrix = specMatrix();

describe('NFR-SEC-5: матрица прав совпадает с Приложением E', () => {
  it('в спецификации 18 действий, и каждому соответствует действие модуля', () => {
    expect(matrix).toHaveLength(18);
    expect(matrix.map((r) => r.action)).toEqual([...ACTIONS]);
  });

  for (const row of matrix) {
    for (const role of ROLES) {
      it(`${role} × «${row.label}» → ${row[role] ? 'разрешено' : 'запрещено'}`, () => {
        expect(can(role, row.action!)).toBe(row[role]);
      });
    }
    it(`guest × «${row.label}» → ${row.guest ? 'разрешено' : 'запрещено'}`, () => {
      // гость — редактор в своей копии демо-пространства (FR-GUEST-1)
      expect(can('editor', row.action!, { isGuest: true })).toBe(row.guest);
    });
  }
});

describe('NFR-SEC-5: отказ по умолчанию', () => {
  it('не участник пространства не может ничего', () => {
    for (const action of ACTIONS) {
      expect(can(null, action)).toBe(false);
      expect(can(undefined, action)).toBe(false);
      expect(can(null, action, { isGuest: true })).toBe(false);
    }
  });

  it('неизвестные роль и действие запрещены', () => {
    expect(can('admin' as Role, 'content.read')).toBe(false);
    expect(can('owner', 'workspace.nuke' as Action)).toBe(false);
    expect(can('owner', 'toString' as Action)).toBe(false);
    expect(can('owner', '__proto__' as Action)).toBe(false);
  });

  it('гостевой признак только сужает права и никогда их не расширяет', () => {
    for (const role of ROLES) {
      for (const action of ACTIONS) {
        if (can(role, action, { isGuest: true })) expect(can(role, action)).toBe(true);
      }
    }
  });

  it('гость с ролью читателя не получает прав редактора', () => {
    expect(can('viewer', 'page.write', { isGuest: true })).toBe(false);
    expect(can('viewer', 'content.read', { isGuest: true })).toBe(true);
  });

  it('права вложены: редактор может всё, что читатель; владелец — всё, что редактор', () => {
    for (const action of ACTIONS) {
      if (can('viewer', action)) expect(can('editor', action)).toBe(true);
      if (can('editor', action)) expect(can('owner', action)).toBe(true);
    }
  });
});

describe('8.3: режим только чтения для совместного редактирования', () => {
  it('читатель и не участник подключаются только на чтение, редактор и гость-редактор — на запись', () => {
    expect(isReadOnly('viewer')).toBe(true);
    expect(isReadOnly(null)).toBe(true);
    expect(isReadOnly('editor')).toBe(false);
    expect(isReadOnly('owner')).toBe(false);
    expect(isReadOnly('editor', { isGuest: true })).toBe(false);
  });
});
