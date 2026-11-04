const { chromium } = require('playwright-core');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  const errors = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push('CONSOLE: ' + msg.text()); });
  page.on('pageerror', (err) => errors.push('PAGEERROR: ' + err.message));
  page.on('requestfailed', (req) => errors.push('REQFAIL: ' + req.url() + ' ' + (req.failure()?.errorText || '')));
  await page.goto('http://127.0.0.1:5173/?capture=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'preview/menu-desktop.png', fullPage: false });
  const mobile = await context.newPage();
  mobile.on('pageerror', (err) => errors.push('MOBILE PAGEERROR: ' + err.message));
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto('http://127.0.0.1:5173/?capture=1', { waitUntil: 'networkidle' });
  await mobile.waitForTimeout(1000);
  await mobile.screenshot({ path: 'preview/menu-mobile.png', fullPage: false });
  const small = await context.newPage();
  small.on('pageerror', (err) => errors.push('SMALL PAGEERROR: ' + err.message));
  await small.setViewportSize({ width: 360, height: 680 });
  await small.goto('http://127.0.0.1:5173/?capture=1', { waitUntil: 'networkidle' });
  await small.waitForTimeout(800);
  await small.screenshot({ path: 'preview/menu-small.png', fullPage: false });
  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
})();
