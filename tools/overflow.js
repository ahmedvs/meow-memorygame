const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  for (const vp of [{width:390,height:844},{width:360,height:680},{width:1440,height:900}]) {
    const page = await browser.newPage({ viewport: vp });
    await page.goto('http://127.0.0.1:5173/?capture=1', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const info = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('body *').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width && (r.right > innerWidth + .5 || r.left < -.5)) {
          out.push({tag: el.tagName, cls: typeof el.className === 'string' ? el.className.slice(0,60) : '', id: el.id, l: +r.left.toFixed(1), r: +r.right.toFixed(1), w: +r.width.toFixed(1), pos: getComputedStyle(el).position});
        }
      });
      return { innerWidth, scrollW: document.documentElement.scrollWidth, bodyW: document.body.scrollWidth, out: out.slice(0,40) };
    });
    console.log('VIEWPORT', vp, JSON.stringify(info, null, 2));
    await page.close();
  }
  await browser.close();
})();
