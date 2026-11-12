// Единый модуль прав (docs/SPEC.md, 7.3 и Приложение E; NFR-SEC-5).
// API и сервер совместного редактирования проверяют доступ только через can().

export const ROLES = ['owner', 'editor', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

/** Действия — строки матрицы Приложения E, в том же порядке. */
export const ACTIONS = [
  'content.read',
  'page.write',
  'page.archive',
  'page.purge',
  'page.restoreVersion',
  'task.write',
  'link.write',
  'file.import',
  'ai.structure',
  'search.query',
  'summary.read',
  'member.invite',
  'member.manage',
  'workspace.update',
  'workspace.delete',
  'audit.read',
  'page.export',
  'usage.read',
] as const;
export type Action = (typeof ACTIONS)[number];

export interface PermissionContext {
  /**
   * Пользователь — гость (users.is_guest). Гость работает в своей копии демо-пространства,
   * и для него действует столбец «guest» матрицы поверх его роли.
   */
  isGuest?: boolean;
}

const ALL: readonly Role[] = ROLES;
const EDITORS: readonly Role[] = ['owner', 'editor'];
const OWNER: readonly Role[] = ['owner'];

/** Кому из участников разрешено действие; guest — разрешено ли оно гостю. */
const MATRIX: Record<Action, { roles: readonly Role[]; guest: boolean }> = {
  'content.read': { roles: ALL, guest: true },
  'page.write': { roles: EDITORS, guest: true },
  'page.archive': { roles: EDITORS, guest: true },
  'page.purge': { roles: OWNER, guest: false },
  'page.restoreVersion': { roles: EDITORS, guest: false },
  'task.write': { roles: EDITORS, guest: true },
  'link.write': { roles: EDITORS, guest: true },
  'file.import': { roles: EDITORS, guest: true }, // гостю — файлы до 5 МБ, лимит проверяют тарифы (FR-GUEST-4)
  'ai.structure': { roles: EDITORS, guest: true }, // гостю — с лимитом (FR-GUEST-4)
  'search.query': { roles: ALL, guest: true }, // гостю — с лимитом (FR-GUEST-4)
  'summary.read': { roles: ALL, guest: true },
  'member.invite': { roles: OWNER, guest: false },
  'member.manage': { roles: OWNER, guest: false },
  'workspace.update': { roles: OWNER, guest: false },
  'workspace.delete': { roles: OWNER, guest: false },
  'audit.read': { roles: OWNER, guest: false },
  'page.export': { roles: ALL, guest: false },
  'usage.read': { roles: EDITORS, guest: false },
};

/**
 * Разрешено ли действие участнику с данной ролью.
 * role = null или undefined — пользователь не состоит в пространстве: запрещено всё.
 * Неизвестные роль или действие — запрещено (отказ по умолчанию).
 * Количественные лимиты (размер файла, квоты ИИ) здесь не проверяются — это тарифы.
 */
export function can(role: Role | null | undefined, action: Action, context: PermissionContext = {}): boolean {
  if (!role) return false;
  const rule = Object.hasOwn(MATRIX, action) ? MATRIX[action] : undefined;
  if (!rule || !rule.roles.includes(role)) return false;
  if (context.isGuest && !rule.guest) return false;
  return true;
}

/** Соединение с сервером совместного редактирования открывается только на чтение. */
export function isReadOnly(role: Role | null | undefined, context: PermissionContext = {}): boolean {
  return !can(role, 'page.write', context);
}
