const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  await page.goto('http://127.0.0.1:5173/trailer/?capture=1', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.TRAILER);
  for (const t of [1.9, 2.5, 6.9, 7.2, 11.9, 12.1, 15.2, 15.4, 18.9, 19.2, 23.9, 24.1, 28.6, 28.8, 33.4, 33.7, 35.9, 36.2, 40.7, 41.0, 43.2, 44.6]) {
    await page.evaluate(t => window.TRAILER.seek(t), t);
    await page.waitForTimeout(30);
    await page.screenshot({ path: `preview/trailer/b_${String(t).replace('.', '_')}.jpg`, type: 'jpeg', quality: 82 });
  }
  await browser.close();
})();
