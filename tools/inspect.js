const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const failures = [];
  page.on('requestfailed', r => failures.push(r.url()));
  page.on('response', r => { if (r.status() >= 400) failures.push(r.status() + ' ' + r.url()); });
  await page.goto('http://127.0.0.1:5173/?capture=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  const metrics = await page.evaluate(() => {
    const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
    return {
      innerWidth, innerHeight,
      docScrollW: document.documentElement.scrollWidth,
      bodyScrollW: document.body.scrollWidth,
      docScrollL: document.documentElement.scrollLeft,
      bodyScrollL: document.body.scrollLeft,
      dir: getComputedStyle(document.documentElement).direction,
      app: box(document.querySelector('.app')),
      main: box(document.querySelector('.main')),
      screen: box(document.querySelector('#screen-menu')),
      header: box(document.querySelector('.menu-header')),
      actions: box(document.querySelector('.header-actions')),
      minilogo: box(document.querySelector('.mini-logo')),
      ambient: box(document.querySelector('.ambient')),
      hero: box(document.querySelector('.menu-hero')),
      dock: box(document.querySelector('.menu-dock')),
      bodyBg: getComputedStyle(document.body).backgroundColor,
      screenOverflow: getComputedStyle(document.querySelector('#screen-menu')).overflow
    };
  });
  console.log(JSON.stringify(metrics, null, 2));
  console.log('FAILED:', [...new Set(failures)].join('\n'));
  await browser.close();
})();
