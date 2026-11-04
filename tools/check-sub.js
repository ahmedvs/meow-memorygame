const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  await page.goto('http://127.0.0.1:5173/trailer/?capture=1', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.TRAILER);
  for (const t of [38.6, 10.3, 22.2, 29.7, 35.4]) {
    const info = await page.evaluate(t => { window.TRAILER.seek(t); const s=document.querySelector('#subtitle'); return {text:s.innerText, opacity:getComputedStyle(s).opacity, transform:getComputedStyle(s).transform}; }, t);
    console.log(t, info);
  }
  await page.evaluate(() => window.TRAILER.seek(5.7));
  await page.waitForTimeout(50);
  await page.screenshot({ path: 'preview/trailer/logo-fix2.jpg', type:'jpeg', quality: 86 });
  await page.evaluate(() => window.TRAILER.seek(35.4));
  await page.waitForTimeout(50);
  await page.screenshot({ path: 'preview/trailer/letter-fix2.jpg', type:'jpeg', quality: 86 });
  await browser.close();
})();
