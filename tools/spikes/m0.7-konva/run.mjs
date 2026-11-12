// M0.7: запускает page.html в Chromium (Playwright) и печатает замеры FPS.
// Запуск: pnpm --filter @shibase/spikes m0.7 [-- --headed]
import { createRequire } from 'node:module';
import os from 'node:os';

const { chromium } = createRequire(import.meta.url)('playwright');
const headed = process.argv.includes('--headed');
const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
await page.goto(new URL('./page.html', import.meta.url).href);
const gpu = await page.evaluate(() => {
  const gl = document.createElement('canvas').getContext('webgl');
  const ext = gl?.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'нет данных';
});
const rows = await page.evaluate(() => window.runSpike(4000));
console.log(
  `Среда: ${os.cpus()[0]?.model}, ядер: ${os.cpus().length}; Chromium ${browser.version()} ${headed ? 'headed' : 'headless'}; рендерер: ${gpu}`,
);
console.table(rows);
console.log(JSON.stringify(rows));
await browser.close();
