const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:5173/?capture=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await page.evaluate(() => window.MMGame.start({ mode:'ai', difficulty:'hard', players:[{name:'ليلى',catId:'lulu',bot:false},{name:'زعتر',catId:'zaatar',bot:true}] }, {skipCountdown:true}));
  await page.waitForTimeout(500);
  await page.evaluate(() => window.MMGame.switchTurn('test'));
  await page.waitForTimeout(6000);
  const info = await page.evaluate(() => {
    const s = window.MMGame.state;
    return { current: s.current, phase: s.phase, time: s.timeLeft, p2pairs: s.players[1].pairs, matched: s.deck.filter(c=>c.matched).length, up: s.deck.filter(c=>c.faceUp).length, aiTimer: !!s.aiTimer, aiPlanned: s.aiPlanned, log: document.querySelector('#turnMessageText').textContent };
  });
  console.log(JSON.stringify({info, errors}));
  await page.screenshot({ path: 'preview/game-ai-active.png' });
  await browser.close();
})();
