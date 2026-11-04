const { chromium } = require('playwright-core');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });
  await page.goto('http://127.0.0.1:5173/trailer/?capture=1', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.TRAILER && window.TRAILER.ready);
  await page.waitForTimeout(600);
  fs.mkdirSync('preview/trailer', { recursive: true });
  const frames = [0.9, 2.1, 3.4, 5.7, 8.1, 10.3, 12.5, 13.9, 15.1, 16.2, 17.6, 19.4, 20.4, 22.2, 24.7, 25.8, 27.1, 29.0, 29.7, 30.9, 32.8, 34.7, 36.7, 38.6, 41.8, 43.4];
  for (const t of frames) {
    await page.evaluate(t => window.TRAILER.seek(t), t);
    await page.waitForTimeout(70);
    await page.screenshot({ path: `preview/trailer/t_${String(t).replace('.', '_')}.jpg`, type: 'jpeg', quality: 86 });
  }
  console.log('ERRORS', errors.length ? errors : 'none');
  await browser.close();
})();
