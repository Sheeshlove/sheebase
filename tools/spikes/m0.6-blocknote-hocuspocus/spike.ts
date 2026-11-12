// M0.6: BlockNote + Hocuspocus — два клиента, стабильность id блоков при вставке,
// server-util Markdown → Y.Doc. Запуск: pnpm --filter @shibase/spikes m0.6
import { JSDOM } from 'jsdom';

// BlockNote/ProseMirror требуют DOM: в Node подставляем jsdom (в браузере это не нужно).
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
for (const key of [
  'window',
  'document',
  'Node',
  'Element',
  'HTMLElement',
  'DocumentFragment',
  'MutationObserver',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'DOMParser',
  'Text',
  'Range',
  'Selection',
  'KeyboardEvent',
  'MouseEvent',
  'Event',
  'CustomEvent',
  'ClipboardEvent',
  'InputEvent',
  'innerHeight',
  'innerWidth',
  'ShadowRoot',
  'HTMLDivElement',
  'SVGElement',
]) {
  if (!(key in globalThis)) {
    try {
      Object.defineProperty(globalThis, key, {
        value: (dom.window as never)[key],
        configurable: true,
        writable: true,
      });
    } catch {
      /* уже есть */
    }
  }
}
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
const proto = dom.window.Range.prototype as unknown as Record<string, unknown>;
proto.getClientRects ??= () => [];
proto.getBoundingClientRect ??= () => ({
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
});
(dom.window.document as unknown as Record<string, unknown>).elementFromPoint ??= () => null;

const { BlockNoteEditor } = await import('@blocknote/core');
const { ServerBlockNoteEditor } = await import('@blocknote/server-util');
const { Server } = await import('@hocuspocus/server');
const { HocuspocusProvider } = await import('@hocuspocus/provider');
const Y = await import('yjs');

const FRAGMENT = 'document-store';
const PORT = 39711;
const results: { check: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  results.push({ check: name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean, ms = 5000) {
  const t = Date.now();
  while (!fn()) {
    if (Date.now() - t > ms) throw new Error('timeout');
    await wait(20);
  }
}

const server = new Server({ port: PORT, quiet: true });
await server.listen();

function client(name: string) {
  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({
    url: `ws://127.0.0.1:${PORT}`,
    name: 'spike-doc',
    document: doc,
  });
  return { name, doc, provider };
}
const a = client('A');
const b = client('B');
await until(() => a.provider.synced && b.provider.synced);
check('два клиента подключились к Hocuspocus и синхронизированы', true);

// 1. Сервер: Markdown → блоки → Y.Doc (сценарий импорта, FR-IMP)
const md = '# Проект\n\nПервый абзац.\n\n- пункт один\n- пункт два\n\n## Сроки\n\nСдать до пятницы.\n';
const serverEditor = ServerBlockNoteEditor.create();
const blocks = await serverEditor.tryParseMarkdownToBlocks(md);
const seeded = serverEditor.blocksToYDoc(blocks, FRAGMENT);
const t0 = performance.now();
Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(seeded));
const ids = (doc: InstanceType<typeof Y.Doc>) => serverEditor.yDocToBlocks(doc, FRAGMENT).map((x) => x.id);
await until(() => ids(b.doc).length === blocks.length);
const syncMs = performance.now() - t0;
const idsA0 = ids(a.doc);
check(
  'server-util: Markdown → блоки → Y.Doc',
  blocks.length === 6,
  `блоков: ${blocks.length} (${blocks.map((x) => x.type).join(', ')})`,
);
check(
  'клиент B получил тот же документ с теми же id блоков',
  JSON.stringify(ids(b.doc)) === JSON.stringify(idsA0),
  `доставка за ${syncMs.toFixed(0)} мс`,
);
check(
  'id блоков из Markdown сохраняются при записи в Y.Doc',
  JSON.stringify(blocks.map((x) => x.id)) === JSON.stringify(idsA0),
);

// 2. Настоящие редакторы на двух клиентах (y-prosemirror), вставка блока в середину
function editor(c: ReturnType<typeof client>, color: string) {
  const e = BlockNoteEditor.create({
    collaboration: {
      fragment: c.doc.getXmlFragment(FRAGMENT),
      provider: c.provider,
      user: { name: c.name, color },
    },
  });
  const el = document.createElement('div');
  document.body.appendChild(el);
  e.mount(el);
  return e;
}
const edA = editor(a, '#35546c');
const edB = editor(b, '#5c7da6');
await wait(200);
const before = edA.document.map((x) => x.id);
check(
  'редактор, смонтированный поверх Y.Doc, не перегенерировал id',
  JSON.stringify(before) === JSON.stringify(idsA0),
);

const anchor = before[1]!;
edA.insertBlocks([{ type: 'paragraph', content: 'Вставка от клиента A' }], anchor, 'after');
await until(() => edB.document.length === before.length + 1);
const afterA = edA.document.map((x) => x.id);
const afterB = edB.document.map((x) => x.id);
const inserted = afterA.filter((id) => !before.includes(id));
check(
  'вставка в середину: старые id не изменились',
  before.every((id) => afterA.includes(id)) && inserted.length === 1,
  `новый id: ${inserted[0]}`,
);
check(
  'вставка в середину: у клиента B тот же порядок и те же id',
  JSON.stringify(afterA) === JSON.stringify(afterB),
);

// 3. Одновременная правка разных блоков
edA.updateBlock(before[0]!, { content: 'Проект (правка A)' });
edB.updateBlock(before[before.length - 1]!, { content: 'Сдать до четверга (правка B)' });
await wait(400);
const snap = (e: typeof edA) => JSON.stringify(e.document.map((x) => [x.id, x.content]));
check('одновременные правки разных блоков сходятся', snap(edA) === snap(edB));
check(
  'после правок id блоков прежние',
  JSON.stringify(edA.document.map((x) => x.id)) === JSON.stringify(afterA),
);

// 4. Обратно: Y.Doc → Markdown на сервере
const outMd = await serverEditor.blocksToMarkdownLossy(serverEditor.yDocToBlocks(b.doc, FRAGMENT));
check('server-util: Y.Doc → Markdown', outMd.includes('правка A') && outMd.includes('Вставка от клиента A'));

a.provider.destroy();
b.provider.destroy();
await server.destroy();
const failed = results.filter((r) => !r.ok).length;
console.log(`\nИтог M0.6: ${results.length - failed}/${results.length} проверок`);
process.exit(failed ? 1 : 0);
