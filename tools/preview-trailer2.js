const { chromium } = require('playwright-core');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  const errors = []; const requests = [];
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });
  page.on('response', r => { if (r.status() >= 400) requests.push(r.status() + ' ' + r.url()); });
  await page.goto('http://127.0.0.1:5173/trailer/?capture=1', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.TRAILER && window.TRAILER.ready);
  await page.waitForTimeout(500);
  const frames = [3.4, 5.7, 8.1, 10.3, 16.2, 18.5, 24.7, 25.8, 27.1, 29.7, 30.9, 32.8, 35.3, 38.6, 43.4];
  for (const t of frames) {
    await page.evaluate(t => window.TRAILER.seek(t), t);
    await page.waitForTimeout(40);
    await page.screenshot({ path: `preview/trailer/fix_${String(t).replace('.', '_')}.jpg`, type: 'jpeg', quality: 86 });
  }
  console.log('ERRORS', errors); console.log('BAD', [...new Set(requests)]);
  await browser.close();
})();
