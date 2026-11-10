import { describe, expect, it } from 'vitest';
import { makeConnector, makeSticky } from '../src/shared/defaults';
import { buildTemplate, TEMPLATES } from '../src/shared/templates';
import { sanitizeItem, sanitizeName, sanitizeOps, sanitizeOpsReport, sanitizePatch } from '../src/shared/validate';
import { uid } from '../src/shared/ops';

describe('валидация', () => {
  it('пропускает корректные объекты', () => {
    const s = makeSticky('abc', 1, 2, 3, '#fff', 'hi');
    expect(sanitizeItem(s)).toEqual(s);
    const c = makeConnector('c1', { itemId: 'abc', side: 'auto', x: 0, y: 0 }, { x: 10, y: 10 }, 4);
    expect(sanitizeItem(c)).toEqual(c);
  });

  it('отбрасывает некорректные объекты', () => {
    expect(sanitizeItem(null)).toBeNull();
    expect(sanitizeItem({ ...makeSticky('a', 0, 0, 1, '#fff'), x: NaN })).toBeNull();
    expect(sanitizeItem({ ...makeSticky('a', 0, 0, 1, '#fff'), type: 'virus' })).toBeNull();
    expect(sanitizeItem({ ...makeSticky('a b', 0, 0, 1, '#fff') })).toBeNull();
    const { text: _t, ...noText } = makeSticky('a', 0, 0, 1, '#fff');
    expect(sanitizeItem(noText)).toBeNull();
    expect(sanitizeItem({ id: 'i', type: 'image', x: 0, y: 0, w: 1, h: 1, z: 1, src: 'javascript:alert(1)' })).toBeNull();
  });

  it('патч: отбрасывает неизвестные поля, id/type и неверные значения', () => {
    expect(sanitizePatch({ x: 5, id: 'hack', type: 'shape', evil: 1, y: 'no' })).toEqual({ x: 5 });
    expect(sanitizePatch({ evil: 1 })).toBeNull();
    expect(sanitizePatch({ groupId: null, locked: true })).toEqual({ groupId: null, locked: true });
  });

  it('операции: мусор отфильтровывается', () => {
    const ops = sanitizeOps([
      { t: 'add', item: makeSticky('a', 0, 0, 1, '#fff') },
      { t: 'update', id: 'a', patch: { x: 1 } },
      { t: 'delete', id: 'a' },
      { t: 'drop', id: 'a' },
      { t: 'update', id: 'a', patch: {} },
      'garbage',
      null,
    ]);
    expect(ops.map((o) => o.t)).toEqual(['add', 'update', 'delete']);
    expect(sanitizeOps('nope')).toEqual([]);
  });

  it('имя доски', () => {
    expect(sanitizeName('  Привет\n мир ', 'x')).toBe('Привет  мир');
    expect(sanitizeName('', 'x')).toBe('x');
    expect(sanitizeName(42, 'x')).toBe('x');
  });

  it('все шаблоны строят валидные объекты', () => {
    for (const t of TEMPLATES) {
      const items = buildTemplate(t.id, () => uid());
      for (const it of items) expect(sanitizeItem(it), `${t.id}: ${it.type}`).toEqual(it);
      if (t.id !== 'blank') expect(items.length).toBeGreaterThan(0);
    }
  });
});

describe('отчёт о валидации (коррекция отправителя)', () => {
  it('помечает объекты, чьи операции отброшены или урезаны', () => {
    const r = sanitizeOpsReport([
      { t: 'update', id: 'ok', patch: { x: 1 } },
      { t: 'update', id: 'cut', patch: { x: 1, label: 'л'.repeat(600) } },
      { t: 'update', id: 'drop', patch: { label: 'л'.repeat(600) } },
      { t: 'add', item: { ...makeSticky('extra', 0, 0, 1, '#fff'), unknownField: 1 } },
      { t: 'add', item: { id: 'bad', type: 'sticky' } },
      { t: 'delete', id: 'gone' },
    ]);
    expect(r.rejected).toEqual(['cut', 'drop', 'extra', 'bad']);
    expect(r.ops.map((o) => (o.t === 'add' ? o.item.id : o.id))).toEqual(['ok', 'cut', 'extra', 'gone']);
  });
});
