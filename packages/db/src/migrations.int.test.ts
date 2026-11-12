import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from './migrate';
import * as s from './schema';
import { createTestDatabase, type TestDatabase } from './test-db';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t?.drop();
});

async function seed() {
  const [user] = await t.db
    .insert(s.users)
    .values({ email: `u${Math.random()}@example.test`, displayName: 'Аня', avatarColor: '#5c7da6' })
    .returning();
  const [workspace] = await t.db
    .insert(s.workspaces)
    .values({ name: 'Команда', kind: 'team', plan: 'student', ownerId: user!.id })
    .returning();
  return { user: user!, workspace: workspace! };
}

describe('M1.2: миграции применяются с нуля', () => {
  it('создана 21 таблица и все перечисления', async () => {
    const tables = await t.pool.query(
      `select table_name from information_schema.tables where table_schema = 'public'`,
    );
    expect(tables.rowCount).toBe(21);
    const enums = await t.pool.query(`select typname from pg_type where typtype = 'e'`);
    expect(enums.rowCount).toBe(14);
  });

  it('повторный запуск миграций ничего не меняет', async () => {
    await runMigrations(t.url);
    const applied = await t.pool.query(`select count(*)::int n from drizzle.__drizzle_migrations`);
    expect(applied.rows[0].n).toBe(2);
  });

  it('в базе все столбцы времени — timestamptz, все id — uuid', async () => {
    const cols = await t.pool.query(
      `select table_name, column_name, data_type from information_schema.columns where table_schema = 'public'`,
    );
    const wrongTime = cols.rows.filter(
      (c) => c.column_name.endsWith('_at') && c.data_type !== 'timestamp with time zone',
    );
    const wrongId = cols.rows.filter((c) => /(^|_)id$/.test(c.column_name) && c.data_type !== 'uuid');
    expect(wrongTime).toEqual([]);
    expect(wrongId).toEqual([]);
    expect(cols.rows.filter((c) => c.column_name.endsWith('_at')).length).toBeGreaterThan(30);
  });

  it('id — uuid версии 7, время — с часовым поясом', async () => {
    const { user } = await seed();
    expect(user.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(user.createdAt).toBeInstanceOf(Date);
  });

  it('users.email уникален без учёта регистра (citext)', async () => {
    await t.db.insert(s.users).values({ email: 'Anna@Example.test', displayName: 'А', avatarColor: '#fff' });
    await expect(
      t.db.insert(s.users).values({ email: 'anna@example.TEST', displayName: 'Б', avatarColor: '#fff' }),
    ).rejects.toThrow();
    const found = await t.db.select().from(s.users).where(eq(s.users.email, 'ANNA@EXAMPLE.TEST'));
    expect(found).toHaveLength(1);
  });

  it('tasks: номер уникален внутри пространства, но не между пространствами', async () => {
    const a = await seed();
    const b = await seed();
    const task = (workspaceId: string, createdBy: string) => ({
      workspaceId,
      createdBy,
      number: 1,
      title: 'Задача',
      position: 'a0',
    });
    await t.db.insert(s.tasks).values(task(a.workspace.id, a.user.id));
    await t.db.insert(s.tasks).values(task(b.workspace.id, b.user.id));
    await expect(t.db.insert(s.tasks).values(task(a.workspace.id, a.user.id))).rejects.toThrow();
  });

  it('перечисление отклоняет значение не из списка', async () => {
    const { user } = await seed();
    await expect(
      t.pool.query(
        `insert into workspaces (id, name, kind, plan, owner_id) values (gen_random_uuid(), 'x', 'solo', 'student', $1)`,
        [user.id],
      ),
    ).rejects.toThrow(/workspace_kind/);
  });

  it('yjs_documents.state сохраняет двоичные данные без искажений', async () => {
    const { user, workspace } = await seed();
    const [page] = await t.db
      .insert(s.pages)
      .values({ workspaceId: workspace.id, kind: 'document', position: 'a0', createdBy: user.id })
      .returning();
    const state = new Uint8Array([0, 1, 2, 250, 255, 0, 128]);
    await t.db.insert(s.yjsDocuments).values({ pageId: page!.id, state, sizeBytes: state.length });
    const [row] = await t.db.select().from(s.yjsDocuments).where(eq(s.yjsDocuments.pageId, page!.id));
    expect(Array.from(row!.state)).toEqual(Array.from(state));
  });

  it('memberships: одна роль на пару пространство–пользователь', async () => {
    const { user, workspace } = await seed();
    await t.db.insert(s.memberships).values({ workspaceId: workspace.id, userId: user.id, role: 'owner' });
    await expect(
      t.db.insert(s.memberships).values({ workspaceId: workspace.id, userId: user.id, role: 'viewer' }),
    ).rejects.toThrow();
  });

  it('удаление пространства удаляет его страницы, документы, задачи и связи', async () => {
    const { user, workspace } = await seed();
    const [page] = await t.db
      .insert(s.pages)
      .values({ workspaceId: workspace.id, kind: 'board', position: 'a0', createdBy: user.id })
      .returning();
    await t.db.insert(s.yjsDocuments).values({ pageId: page!.id, state: new Uint8Array([1]), sizeBytes: 1 });
    await t.db
      .insert(s.tasks)
      .values({ workspaceId: workspace.id, createdBy: user.id, number: 1, title: 'З', position: 'a0' });
    await t.db.insert(s.objectLinks).values({
      workspaceId: workspace.id,
      fromKind: 'page',
      fromPageId: page!.id,
      fromRef: '',
      toKind: 'task',
      toRef: 'x',
      relation: 'related',
    });
    await t.db.delete(s.workspaces).where(eq(s.workspaces.id, workspace.id));
    const count = async (table: string) =>
      (await t.pool.query(`select count(*)::int n from ${table} where workspace_id = $1`, [workspace.id]))
        .rows[0].n;
    expect(await count('pages')).toBe(0);
    expect(await count('tasks')).toBe(0);
    expect(await count('object_links')).toBe(0);
    const docs = await t.db.select().from(s.yjsDocuments).where(eq(s.yjsDocuments.pageId, page!.id));
    expect(docs).toHaveLength(0);
  });

  it('FR-LINK-4: связь переживает удаление страницы, на которую ссылается', async () => {
    const { user, workspace } = await seed();
    const page = async () =>
      (
        await t.db
          .insert(s.pages)
          .values({ workspaceId: workspace.id, kind: 'document', position: 'a0', createdBy: user.id })
          .returning()
      )[0]!;
    const from = await page();
    const to = await page();
    const [link] = await t.db
      .insert(s.objectLinks)
      .values({
        workspaceId: workspace.id,
        fromKind: 'block',
        fromPageId: from.id,
        fromRef: 'b1',
        toKind: 'page',
        toPageId: to.id,
        toRef: '',
        relation: 'mention',
      })
      .returning();
    await t.db.delete(s.pages).where(eq(s.pages.id, to.id));
    const [kept] = await t.db.select().from(s.objectLinks).where(eq(s.objectLinks.id, link!.id));
    expect(kept?.toPageId).toBe(to.id);
    expect(kept?.brokenAt).toBeNull(); // помечает фоновая задача M5.5
  });

  it('страницу с дочерними нельзя удалить: поддерево обходит репозиторий', async () => {
    const { user, workspace } = await seed();
    const base = { workspaceId: workspace.id, kind: 'document' as const, position: 'a0', createdBy: user.id };
    const [parent] = await t.db.insert(s.pages).values(base).returning();
    const [child] = await t.db
      .insert(s.pages)
      .values({ ...base, parentId: parent!.id })
      .returning();
    await expect(t.db.delete(s.pages).where(eq(s.pages.id, parent!.id))).rejects.toThrow();
    await t.db.delete(s.pages).where(eq(s.pages.id, child!.id));
    await t.db.delete(s.pages).where(eq(s.pages.id, parent!.id));
  });

  it('FR-AUTH-6: владельца пространства нельзя удалить физически — аккаунт обезличивается', async () => {
    const { user } = await seed();
    await expect(t.db.delete(s.users).where(eq(s.users.id, user.id))).rejects.toThrow();
  });

  it('есть индексы графа связей из 7.1', async () => {
    const idx = await t.pool.query(`select indexdef from pg_indexes where tablename = 'object_links'`);
    const defs = idx.rows.map((r) => r.indexdef).join('\n');
    expect(defs).toContain('(workspace_id, to_kind, to_page_id, to_ref)');
    expect(defs).toContain('(workspace_id, from_kind, from_page_id, from_ref)');
  });
});
