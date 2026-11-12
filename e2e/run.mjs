// E2E-сценарий: два участника на одной доске в настоящем браузере.
// Требования: собранный клиент (npm run build) и пакет playwright с Chromium.
// Запуск: npm run e2e

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Не найден пакет playwright. Установите: npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!fs.existsSync(path.join(root, 'dist/client/index.html'))) {
  console.error('Клиент не собран. Выполните: npm run build');
  process.exit(2);
}

const ART = path.join(root, 'e2e/artifacts');
fs.mkdirSync(ART, { recursive: true });
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'board-e2e-'));
const PORT = 3200 + Math.floor(Math.random() * 500);
const BASE = `http://localhost:${PORT}`;

let server = null;
async function startServer() {
  server = spawn(process.execPath, [path.join(root, 'node_modules/tsx/dist/cli.mjs'), 'src/server/main.ts'], {
    cwd: root,
    env: { ...process.env, PORT: String(PORT), DATA_DIR: DATA },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(`сервер завершился с кодом ${server.exitCode}`);
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch {
      /* ещё не поднялся */
    }
    await sleep(100);
  }
  throw new Error('сервер не запустился');
}
async function stopServer() {
  if (!server) return;
  const s = server;
  server = null;
  // процесс мог уже завершиться сам (например, порт занят) — тогда события exit больше не будет
  if (s.exitCode !== null || s.signalCode !== null) return;
  const done = new Promise((r) => s.once('exit', r));
  s.kill('SIGTERM');
  await done;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name} (${Date.now() - t} мс)`);
  } catch (err) {
    results.push({ name, ok: false, err });
    console.log(`  ✗ ${name}\n    ${err.message.split('\n')[0]}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const state = (page) => page.evaluate(() => window.__sheebase.state());
const items = async (page) => Object.values((await state(page)).items);
const waitFor = (page, fn, arg, timeout = 5000) => page.waitForFunction(fn, arg, { timeout });

async function drag(page, from, to, steps = 12) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
  }
  await page.mouse.up();
}

/** Экранные координаты центра объекта (мировые → экранные через камеру). */
async function screenCenter(page, id) {
  return page.evaluate((id) => {
    const s = window.__sheebase.state();
    const it = s.items[id];
    return { x: (it.x + it.w / 2) * s.camera.zoom + s.camera.x, y: (it.y + it.h / 2) * s.camera.zoom + s.camera.y };
  }, id);
}

async function main() {
  await startServer();
  const meta = await (
    await fetch(`${BASE}/api/boards`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'E2E доска' }) })
  ).json();
  const url = `${BASE}/#/b/${meta.id}`;

  const browser = await chromium.launch();
  const ctxA = await browser.newContext({ viewport: { width: 1400, height: 860 }, acceptDownloads: true });
  const ctxB = await browser.newContext({ viewport: { width: 1400, height: 860 } });
  for (const [ctx, name, color] of [
    [ctxA, 'Анна', '#e03131'],
    [ctxB, 'Борис', '#1971c2'],
  ]) {
    await ctx.addInitScript(
      ([name, color]) => localStorage.setItem('sheebase:user', JSON.stringify({ id: name, name, color })),
      [name, color],
    );
  }
  const A = await ctxA.newPage();
  const B = await ctxB.newPage();
  const errors = [];
  for (const [p, n] of [
    [A, 'A'],
    [B, 'B'],
  ]) {
    p.on('pageerror', (e) => errors.push(`${n}: ${e.message}`));
    p.on('console', (m) => m.type() === 'error' && errors.push(`${n}: ${m.text()}`));
  }

  console.log(`Доска: ${url}`);
  await A.goto(url);
  await B.goto(url);
  const online = (p) => p.waitForSelector('[data-testid=status][data-status=online]', { timeout: 5000 });
  await Promise.all([online(A), online(B)]);

  let stickyId;
  let shapeA;
  let shapeB;

  await step('Присутствие: участники видят друг друга', async () => {
    await waitFor(A, () => Object.values(window.__sheebase.state().peers).some((p) => p.name === 'Борис'));
    await waitFor(B, () => Object.values(window.__sheebase.state().peers).some((p) => p.name === 'Анна'));
  });

  await step('Стикер: создание (N + клик), ввод текста, синхронизация', async () => {
    await A.keyboard.press('n');
    await A.mouse.click(420, 400);
    await A.waitForSelector('[data-editor]');
    await A.keyboard.type('Привет, команда');
    await A.keyboard.press('Escape');
    await waitFor(B, () => Object.values(window.__sheebase.state().items).some((i) => i.type === 'sticky' && i.text === 'Привет, команда'));
    stickyId = (await items(A)).find((i) => i.type === 'sticky').id;
  });

  await step('Курсор участника A виден у B', async () => {
    await A.mouse.move(700, 300);
    await A.mouse.move(720, 320);
    await waitFor(B, () => Object.values(window.__sheebase.state().peers).some((p) => p.cursor));
    await B.waitForSelector('.cursor', { state: 'attached' });
  });

  await step('Перемещение стикера синхронизируется', async () => {
    const before = (await state(A)).items[stickyId];
    await drag(A, { x: 420, y: 400 }, { x: 560, y: 470 });
    const after = (await state(A)).items[stickyId];
    assert(Math.abs(after.x - before.x) > 50, 'стикер не сдвинулся у A');
    await waitFor(B, ([id, x]) => Math.abs(window.__sheebase.state().items[id].x - x) < 0.01, [stickyId, after.x]);
  });

  await step('Фигуры: создание протягиванием (R) и текст', async () => {
    await A.keyboard.press('r');
    await drag(A, { x: 800, y: 220 }, { x: 960, y: 320 });
    await A.waitForSelector('[data-editor]');
    await A.keyboard.type('Старт');
    await A.keyboard.press('Escape');
    await A.keyboard.press('r');
    await drag(A, { x: 800, y: 520 }, { x: 960, y: 620 });
    await A.keyboard.type('Финиш');
    await A.keyboard.press('Escape');
    const shapes = (await items(A)).filter((i) => i.type === 'shape');
    assert(shapes.length === 2, `ожидалось 2 фигуры, есть ${shapes.length}`);
    shapeA = shapes.find((s) => s.text === 'Старт').id;
    shapeB = shapes.find((s) => s.text === 'Финиш').id;
  });

  await step('Коннектор (L) привязывается к фигурам и следует за ними', async () => {
    await A.keyboard.press('l');
    await drag(A, await screenCenter(A, shapeA), await screenCenter(A, shapeB));
    const conn = (await items(A)).find((i) => i.type === 'connector');
    assert(conn, 'коннектор не создан');
    assert(conn.from.itemId === shapeA && conn.to.itemId === shapeB, 'концы не привязаны к фигурам');
    await A.mouse.click(650, 130); // снять выделение
    const c = await screenCenter(A, shapeB);
    const x0 = (await state(B)).items[shapeB].x;
    await drag(A, c, { x: c.x + 220, y: c.y + 20 });
    await waitFor(B, ([id, x]) => window.__sheebase.state().items[id].x > x + 100, [shapeB, x0]);
    const connB = (await items(B)).find((i) => i.type === 'connector');
    assert(connB.to.itemId === shapeB, 'у B коннектор не привязан');
  });

  await step('Быстрое создание кнопкой «+» (копия + коннектор)', async () => {
    await A.mouse.click(...Object.values(await screenCenter(A, shapeA)));
    await A.waitForSelector('.quick-dot');
    const n0 = (await items(A)).length;
    await A.click('[data-handle=dot-right]');
    await A.waitForSelector('[data-editor]');
    await A.keyboard.type('Ветка');
    await A.keyboard.press('Escape');
    const all = await items(A);
    assert(all.length === n0 + 2, `ожидалось +2 объекта, получилось ${all.length - n0}`);
    assert(all.some((i) => i.type === 'shape' && i.text === 'Ветка'), 'копия не создана');
  });

  await step('Перо, Undo и Redo синхронизируются', async () => {
    await A.keyboard.press('p');
    await A.mouse.move(300, 650);
    await A.mouse.down();
    for (let i = 0; i < 20; i++) await A.mouse.move(300 + i * 12, 650 + Math.sin(i / 2) * 30);
    await A.mouse.up();
    await waitFor(B, () => Object.values(window.__sheebase.state().items).some((i) => i.type === 'path'));
    await A.keyboard.press('v');
    await A.keyboard.press('Control+z');
    await waitFor(B, () => !Object.values(window.__sheebase.state().items).some((i) => i.type === 'path'));
    await A.keyboard.press('Control+Shift+z');
    await waitFor(B, () => Object.values(window.__sheebase.state().items).some((i) => i.type === 'path'));
  });

  await step('Фрейм: содержимое перемещается вместе с ним', async () => {
    const s = await screenCenter(A, stickyId);
    await A.keyboard.press('f');
    await drag(A, { x: s.x - 150, y: s.y - 150 }, { x: s.x + 150, y: s.y + 150 });
    const frame = (await items(A)).find((i) => i.type === 'frame');
    assert(frame, 'фрейм не создан');
    await A.mouse.click(650, 130);
    const title = A.locator(`.frame-title[data-id="${frame.id}"]`);
    const box = await title.boundingBox();
    const before = (await state(A)).items[stickyId];
    await drag(A, { x: box.x + 10, y: box.y + box.height / 2 }, { x: box.x + 10, y: box.y + box.height / 2 + 120 });
    const after = (await state(A)).items[stickyId];
    assert(after.y - before.y > 80, 'стикер внутри фрейма не сдвинулся');
    await waitFor(B, ([id, y]) => Math.abs(window.__sheebase.state().items[id].y - y) < 0.01, [stickyId, after.y]);
  });

  await step('Копирование и вставка (Ctrl+C / Ctrl+V)', async () => {
    await A.mouse.click(...Object.values(await screenCenter(A, shapeA)));
    const n0 = (await items(A)).length;
    await A.keyboard.press('Control+c');
    await A.mouse.move(1100, 250);
    await A.keyboard.press('Control+v');
    await waitFor(A, (n) => Object.keys(window.__sheebase.state().items).length === n + 1, n0);
    await A.keyboard.press('Control+d');
    await waitFor(A, (n) => Object.keys(window.__sheebase.state().items).length === n + 2, n0);
  });

  await step('Удаление и отмена удаления', async () => {
    const n0 = (await items(A)).length;
    await A.keyboard.press('Delete');
    await waitFor(B, (n) => Object.keys(window.__sheebase.state().items).length === n - 1, n0);
    await A.keyboard.press('Control+z');
    await waitFor(B, (n) => Object.keys(window.__sheebase.state().items).length === n, n0);
  });

  await step('Переименование доски видно второму участнику', async () => {
    await A.click('[data-testid=board-name]');
    await A.keyboard.press('Control+a');
    await A.keyboard.type('Карта процесса');
    await A.keyboard.press('Enter');
    await waitFor(B, () => window.__sheebase.state().meta?.name === 'Карта процесса');
  });

  await step('Экспорт PNG скачивает изображение', async () => {
    await A.mouse.click(650, 130);
    await A.click('[data-testid=export-menu]');
    const [download] = await Promise.all([A.waitForEvent('download'), A.click('[data-testid=export-png]')]);
    const file = path.join(ART, 'export.png');
    await download.saveAs(file);
    const size = fs.statSync(file).size;
    assert(size > 5000, `PNG слишком маленький: ${size} байт`);
  });

  // ---------------------------------------------------------------- итерация 2
  const fitBoth = async () => {
    for (const p of [A, B]) {
      await p.mouse.click(650, 130);
      await p.keyboard.press('Escape');
      await p.keyboard.press('Shift+1');
    }
    await sleep(200);
  };
  await fitBoth();
  const count = (p) => p.evaluate(() => Object.keys(window.__sheebase.state().items).length);

  await step('Регрессия: брошенный пустой текст не оставляет «фантома» в истории', async () => {
    const n0 = await count(A);
    await A.keyboard.press('t');
    await A.mouse.click(620, 800);
    await A.waitForSelector('[data-editor]');
    await A.keyboard.press('Escape');
    assert((await count(A)) === n0, 'остался пустой текстовый блок');
    await A.keyboard.press('Control+z');
    const texts = (await items(A)).filter((i) => i.type === 'text' && !i.text.trim());
    assert(texts.length === 0, 'Ctrl+Z вернул пустой текст');
    await A.keyboard.press('Control+Shift+z');
  });

  await step('Комментарии: тред на стикере, ответ второго участника, «решено»', async () => {
    const c = await screenCenter(A, stickyId);
    await A.keyboard.press('c');
    await A.mouse.click(c.x + 30, c.y - 30);
    await A.waitForSelector('[data-testid=comment-draft]');
    await A.keyboard.type('Что думаете?');
    await A.keyboard.press('Enter');
    await A.waitForSelector('[data-testid=thread-card]');
    const t = Object.values((await state(A)).comments)[0];
    assert(t && t.itemId === stickyId, 'тред не привязан к стикеру');
    await B.waitForSelector('[data-testid=comment-pin]');
    await B.click('[data-testid=comment-pin]');
    await B.waitForSelector('[data-testid=thread-reply]');
    await B.fill('[data-testid=thread-reply]', 'Согласен');
    await B.keyboard.press('Enter');
    await waitFor(A, () => Object.values(window.__sheebase.state().comments)[0]?.messages.length === 2);
    await A.click('[data-testid=thread-resolve]');
    await waitFor(B, () => Object.values(window.__sheebase.state().comments)[0]?.resolved === true);
    await A.keyboard.press('Escape');
    await B.keyboard.press('Escape');
  });

  await step('Голосование: лимит, скрытые итоги, результаты у всех', async () => {
    await A.click('[data-testid=voting-button]');
    await A.click('button[aria-label="Меньше"]');
    await A.click('[data-testid=voting-start]');
    await B.waitForSelector('[data-testid=voting-banner]');
    const c = await screenCenter(B, stickyId);
    for (let i = 0; i < 3; i++) {
      await B.mouse.click(c.x, c.y);
      await sleep(80);
    }
    await waitFor(B, (id) => window.__sheebase.state().session.voting?.myVotes[id] === 2, stickyId);
    await waitFor(A, () => window.__sheebase.state().session.voting?.voters === 1);
    assert((await state(A)).session.voting.results === null, 'итоги видны до завершения');
    assert(Object.keys((await state(A)).session.voting.myVotes).length === 0, 'A видит чужие голоса');
    await A.click('[data-testid=voting-end]');
    await waitFor(A, (id) => window.__sheebase.state().session.voting?.results?.[id] === 2, stickyId);
    await B.waitForSelector('[data-testid=results-panel]');
    await A.click('[data-testid=results-panel] .side-foot .chip');
    await waitFor(B, () => window.__sheebase.state().session.voting === null);
  });

  await step('Таймер общий для участников', async () => {
    await A.click('[data-testid=timer-button]');
    await A.click('[data-testid=timer-3]');
    await B.waitForSelector('[data-testid=timer-pill]');
    const t = await B.textContent('[data-testid=timer-pill]');
    assert(/[23]:\d\d/.test(t), `таймер у второго участника: ${t}`);
    await A.click('[data-testid=timer-pill]');
    await A.click('[data-testid=timer-reset]');
    await B.waitForSelector('[data-testid=timer-button]');
  });

  await step('«Собрать всех ко мне»: второй участник следует за видом', async () => {
    await A.click('.avatar.me');
    await A.click('[data-testid=summon]');
    await B.waitForSelector('[data-testid=follow-banner]');
    await A.keyboard.press('Escape');
    await A.mouse.move(700, 450);
    await A.keyboard.down('Control');
    await A.mouse.wheel(0, -300);
    await A.keyboard.up('Control');
    const za = (await state(A)).camera.zoom;
    await waitFor(B, (z) => Math.abs(window.__sheebase.state().camera.zoom - z) < 0.01, za);
    await B.mouse.move(700, 450);
    await B.mouse.wheel(0, 200);
    await waitFor(B, () => window.__sheebase.state().following === null);
  });

  await fitBoth();

  await step('Поиск по доске (Ctrl+F)', async () => {
    await A.keyboard.press('Control+f');
    await A.waitForSelector('[data-testid=search-input]');
    await A.keyboard.type('команда');
    await waitFor(A, () => window.__sheebase.state().search.hits.length === 1);
    assert((await A.textContent('[data-testid=search-count]')).includes('1 из 1'), 'счётчик совпадений');
    await A.keyboard.press('Escape');
    await fitBoth();
  });

  await step('Выравнивание по левому краю (Alt+A) синхронизируется', async () => {
    const a = await screenCenter(A, shapeA);
    const b = await screenCenter(A, shapeB);
    await A.mouse.click(a.x, a.y);
    await A.keyboard.down('Shift');
    await A.mouse.click(b.x, b.y);
    await A.keyboard.up('Shift');
    await A.keyboard.press('Alt+a');
    const it = (await state(A)).items;
    assert(Math.abs(it[shapeA].x - it[shapeB].x) < 0.01, 'фигуры не выровнены');
    await waitFor(B, ([x, y]) => Math.abs(window.__sheebase.state().items[x].x - window.__sheebase.state().items[y].x) < 0.01, [shapeA, shapeB]);
    await A.mouse.click(650, 130);
  });

  await step('Контекстное меню: дублирование и отмена', async () => {
    const n0 = await count(A);
    const c = await screenCenter(A, stickyId);
    await A.mouse.click(c.x, c.y, { button: 'right' });
    await A.waitForSelector('[data-testid=context-menu]');
    await A.click('[data-testid=context-menu] >> text=Дублировать');
    await waitFor(B, (n) => Object.keys(window.__sheebase.state().items).length === n + 1, n0);
    await A.keyboard.press('Control+z');
    await waitFor(B, (n) => Object.keys(window.__sheebase.state().items).length === n, n0);
  });

  await step('Ссылка на объекте видна второму участнику', async () => {
    const c = await screenCenter(A, stickyId);
    await A.mouse.click(c.x, c.y);
    await A.click('[data-testid=ctx-link]');
    await A.fill('[data-testid=link-input]', 'example.com/retro');
    await A.keyboard.press('Enter');
    await waitFor(B, (id) => window.__sheebase.state().items[id].link === 'https://example.com/retro', stickyId);
    await B.waitForSelector('.link-badge');
    await A.mouse.click(650, 130);
  });

  await step('Автор стикера показывается по настройке «Вид»', async () => {
    await B.click('[data-testid=view-menu]');
    await B.click('[data-testid=toggle-authors]');
    await B.waitForSelector('.sticky-author');
    assert((await B.textContent('.sticky-author')) === 'Анна', 'неверный автор');
    await B.keyboard.press('Escape');
  });

  await step('Двойной клик редактирует объект; индикатор «редактирует …»; защита от одновременного ввода', async () => {
    const c = await screenCenter(A, stickyId);
    await A.mouse.dblclick(c.x, c.y);
    await A.waitForSelector('[data-editor]');
    // регрессия: двойной клик редактирует объект под курсором, а не создаёт новый стикер
    assert((await state(A)).editingId === stickyId, 'двойной клик не открыл ввод в стикере');
    await B.waitForSelector('.peer-tag.editing');
    const cb = await screenCenter(B, stickyId);
    await B.mouse.dblclick(cb.x, cb.y);
    await sleep(200);
    assert((await state(B)).editingId === null, 'второй участник смог начать ввод');
    await A.keyboard.press('Escape');
    await B.keyboard.press('Escape');
  });

  await step('Смена имени видна коллеге сразу', async () => {
    await A.click('.avatar.me');
    const input = A.locator('.me-panel input');
    await input.fill('Анна К.');
    await input.press('Enter');
    await waitFor(B, () => Object.values(window.__sheebase.state().peers).some((p) => p.name === 'Анна К.'));
    await A.keyboard.press('Escape');
  });

  await step('Вставка шаблона в доску — один шаг отмены', async () => {
    const n0 = await count(A);
    await A.click('[data-testid=templates-button]');
    await A.click('[data-testid=insert-template-kanban]');
    await waitFor(B, (n) => Object.keys(window.__sheebase.state().items).length > n + 10, n0);
    await A.keyboard.press('Control+z');
    await waitFor(B, (n) => Object.keys(window.__sheebase.state().items).length === n, n0);
    await A.keyboard.press('Control+Shift+z');
    await waitFor(B, (n) => Object.keys(window.__sheebase.state().items).length > n + 10, n0);
  });

  await step('Панель фреймов и режим презентации', async () => {
    await A.click('[data-testid=frames-button]');
    await A.waitForSelector('[data-testid=frames-panel]');
    await A.click('[data-testid=present-start]');
    await A.waitForSelector('[data-testid=presentation-bar]');
    const total = Number((await A.textContent('[data-testid=presentation-count]')).split('/')[1]);
    assert(total >= 5, `фреймов в показе: ${total}`);
    await A.keyboard.press('ArrowRight');
    assert((await A.textContent('[data-testid=presentation-count]')).trim().startsWith('2'), 'не перешли к следующему фрейму');
    await A.screenshot({ path: path.join(ART, 'presentation.png') });
    await A.keyboard.press('Escape');
    await A.waitForSelector('[data-testid=presentation-bar]', { state: 'detached' });
  });

  await step('История версий: сохранить и восстановить у всех участников', async () => {
    await A.click('[data-testid=versions-button]');
    await A.fill('[data-testid=version-name]', 'Перед чисткой');
    await A.click('[data-testid=version-save]');
    await A.waitForSelector('[data-testid=version-row] >> text=Перед чисткой');
    const n0 = await count(A);
    await A.mouse.click(650, 130);
    await A.keyboard.press('Control+a');
    await A.keyboard.press('Delete');
    await waitFor(B, () => Object.keys(window.__sheebase.state().items).length === 0);
    A.once('dialog', (d) => d.accept());
    await A.click('[data-testid=version-row] >> nth=0');
    await A.click('[data-testid=version-restore]');
    await waitFor(B, (n) => Object.keys(window.__sheebase.state().items).length === n, n0);
    await waitFor(A, (n) => Object.keys(window.__sheebase.state().items).length === n, n0);
    await A.click('[data-testid=versions-button]');
  });

  await step('Миниатюра доски на дашборде', async () => {
    const D = await ctxB.newPage();
    await D.goto(`${BASE}/#/`);
    const img = await D.waitForSelector('[data-testid=board-thumbnail]');
    const ok = await img.evaluate((el) =>
      el.complete ? el.naturalWidth > 0 : new Promise((r) => ((el.onload = () => r(el.naturalWidth > 0)), (el.onerror = () => r(false)))),
    );
    assert(ok, 'миниатюра не загрузилась');
    await D.screenshot({ path: path.join(ART, 'dashboard.png') });
    await D.close();
  });

  await fitBoth();
  await A.screenshot({ path: path.join(ART, 'user-a.png') });
  await B.screenshot({ path: path.join(ART, 'user-b.png') });

  await step('Состояние сходится: A = B = сервер', async () => {
    await sleep(300);
    const server = await (await fetch(`${BASE}/api/boards/${meta.id}`)).json();
    const a = (await state(A)).items;
    const b = (await state(B)).items;
    // каноническая форма: порядок ключей не важен
    const canon = (v) =>
      Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
    const norm = (o) => JSON.stringify(canon(o));
    assert(norm(a) === norm(b), 'A и B расходятся');
    assert(norm(a) === norm(server.items), 'клиент и сервер расходятся');
  });

  await step('Офлайн-правки доходят после перезапуска сервера; данные сохраняются', async () => {
    await stopServer();
    await waitFor(A, () => window.__sheebase.state().status === 'offline', undefined, 5000);
    const s = await screenCenter(A, shapeA);
    await drag(A, s, { x: s.x, y: s.y - 120 });
    const moved = (await state(A)).items[shapeA];
    await startServer();
    await Promise.all([online(A), online(B)].map((p) => p.catch(() => null)));
    await waitFor(A, () => window.__sheebase.state().status === 'online', undefined, 15000);
    await waitFor(B, ([id, y]) => Math.abs(window.__sheebase.state().items[id]?.y - y) < 0.01, [shapeA, moved.y], 15000);
    const server = await (await fetch(`${BASE}/api/boards/${meta.id}`)).json();
    assert(server.meta.name === 'Карта процесса', 'имя доски не сохранилось');
    assert(Math.abs(server.items[shapeA].y - moved.y) < 0.01, 'офлайн-правка не дошла до сервера');
  });

  await step('Нет ошибок в консоли браузера', async () => {
    const real = errors.filter((e) => !/WebSocket|ERR_CONNECTION_REFUSED|Failed to load resource/.test(e));
    assert(real.length === 0, real.join('\n'));
  });

  await browser.close();
}

try {
  await main();
} catch (err) {
  console.error(err);
  results.push({ name: 'run', ok: false, err });
} finally {
  await stopServer();
  fs.rmSync(DATA, { recursive: true, force: true });
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} шагов прошли. Скриншоты: e2e/artifacts/`);
process.exit(failed.length ? 1 : 0);
