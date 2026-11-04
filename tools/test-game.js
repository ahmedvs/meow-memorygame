const { chromium } = require('playwright-core');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  const browserErrors = [];
  async function makePage(viewport, label) {
    const page = await browser.newPage({ viewport });
    page.on('pageerror', (err) => browserErrors.push(`${label} PAGEERROR: ${err.message}`));
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !msg.text().includes('favicon')) browserErrors.push(`${label} CONSOLE: ${msg.text()}`);
    });
    await page.goto('http://127.0.0.1:5173/?capture=1', { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    return page;
  }

  // desktop modes and setup
  const page = await makePage({ width: 1440, height: 900 }, 'desktop');
  await page.click('#btnPlayHero');
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'preview/modes-desktop.png' });
  await page.click('[data-mode="duel"]');
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'preview/setup-desktop.png' });
  // Choose names + start
  await page.fill('#setup-name-0', 'ليلى');
  await page.fill('#setup-name-1', 'أختي');
  await page.click('#btnStartGame');
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'preview/countdown-desktop.png' });
  await page.waitForTimeout(3600);
  await page.screenshot({ path: 'preview/game-desktop.png' });
  let state = await page.evaluate(() => {
    const s = window.MMGame.state;
    return s ? { phase: s.phase, deck: s.deck.map(c => ({ f: c.fruit, m: c.matched, u: c.faceUp })), current: s.current, time: s.timeLeft } : null;
  });
  console.log('STATE AFTER START', JSON.stringify(state).slice(0, 700));
  if (state) {
    const pair = {};
    state.deck.forEach((c, i) => { if (!c.m && c.f === (Object.keys(pair)[0] || c.f) && !(c.f in pair)) {} });
    const map = {};
    state.deck.forEach((c, i) => { if (!c.m) (map[c.f] = map[c.f] || []).push(i); });
    const firstFruit = Object.keys(map).find(f => map[f].length === 2);
    const [a, b] = map[firstFruit];
    await page.evaluate(([a, b]) => {
      const cards = document.querySelectorAll('.memory-card');
      cards[a].click();
    }, [a, b]);
    await page.waitForTimeout(350);
    await page.evaluate(([a, b]) => document.querySelectorAll('.memory-card')[b].click(), [a, b]);
    await page.waitForTimeout(1300);
    await page.screenshot({ path: 'preview/game-match-desktop.png' });
    state = await page.evaluate(() => {
      const s = window.MMGame.state;
      return { phase: s.phase, current: s.current, p0: s.players[0], p1: s.players[1], time: s.timeLeft, cleared: Array.from(document.querySelectorAll('.memory-card.is-cleared')).length };
    });
    console.log('STATE AFTER MATCH', JSON.stringify(state).slice(0, 1000));
    await page.click('#btnGamePause');
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'preview/pause-desktop.png' });
    await page.click('#btnResume');
    await page.waitForTimeout(300);
  }

  // mobile modes/setup/game
  const mobile = await makePage({ width: 390, height: 844 }, 'mobile');
  await mobile.click('#btnPlayHero');
  await mobile.waitForTimeout(600);
  await mobile.screenshot({ path: 'preview/modes-mobile.png' });
  await mobile.click('[data-mode="duel"]');
  await mobile.waitForTimeout(500);
  await mobile.screenshot({ path: 'preview/setup-mobile.png' });
  await mobile.click('#btnStartGame');
  await mobile.waitForTimeout(4000);
  await mobile.screenshot({ path: 'preview/game-mobile.png' });
  const mobileMetrics = await mobile.evaluate(() => {
    const s = window.MMGame.state;
    const board = document.querySelector('#board').getBoundingClientRect();
    const shell = document.querySelector('.game-shell').getBoundingClientRect();
    return { state: s && { phase: s.phase, time: s.timeLeft }, board: { y: board.y, h: board.height }, shell: { h: shell.height }, innerHeight, scrollW: document.documentElement.scrollWidth, cards: document.querySelectorAll('.memory-card').length };
  });
  console.log('MOBILE METRICS', JSON.stringify(mobileMetrics));

  // arcade quick capture
  const arcade = await makePage({ width: 390, height: 844 }, 'arcade');
  await arcade.evaluate(() => {
    window.MMGame.start({ mode: 'arcade', players: [{ name: 'ليلى', catId: 'lulu', bot: false }] }, { skipCountdown: true });
  });
  await arcade.waitForTimeout(500);
  await arcade.screenshot({ path: 'preview/arcade-mobile.png' });
  const arcadeState = await arcade.evaluate(() => ({ phase: window.MMGame.state.phase, time: window.MMGame.state.arcade.timeLeft, cards: document.querySelectorAll('.memory-card').length }));
  console.log('ARCADE', JSON.stringify(arcadeState));

  console.log('ERRORS:', browserErrors.length ? browserErrors.join('\n') : 'none');
  await browser.close();
})();
