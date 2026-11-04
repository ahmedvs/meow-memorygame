const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) errors.push('CONSOLE ' + m.text()); });
  await page.goto('http://127.0.0.1:5173/?capture=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  const log = (...args) => console.log(...args);

  // start duel skip countdown
  await page.evaluate(() => window.MMGame.start({ mode: 'duel', players: [{ name: 'ليلى', catId: 'lulu', bot: false }, { name: 'أختي', catId: 'zaatar', bot: false }] }, { skipCountdown: true }));
  await page.waitForTimeout(700);
  let info = await page.evaluate(() => {
    const s = window.MMGame.state;
    return { phase: s.phase, energy: s.players[0].energy, paused: s.paused, first: s.firstPick };
  });
  log('start', info);

  // mismatch
  const indices = await page.evaluate(() => {
    const s = window.MMGame.state;
    const a = 0;
    const b = s.deck.findIndex((c, i) => c.fruit !== s.deck[a].fruit);
    return [a, b];
  });
  await page.evaluate(([a, b]) => {
    document.querySelectorAll('.memory-card')[a].click();
  }, indices);
  await page.waitForTimeout(200);
  await page.evaluate(([a, b]) => document.querySelectorAll('.memory-card')[b].click(), indices);
  await page.waitForTimeout(1600);
  info = await page.evaluate(() => {
    const s = window.MMGame.state;
    return { current: s.current, phase: s.phase, time: s.timeLeft, first: s.firstPick, up: s.deck.filter(c => c.faceUp).length, active: s.players[s.current].name };
  });
  log('after mismatch', info);

  // use peek (set energy 5)
  await page.evaluate(() => { window.MMGame.state.players[window.MMGame.state.current].energy = 5; window.MMGame.updateAbilityUI(); });
  await page.click('#abilityPeek');
  await page.waitForTimeout(300);
  info = await page.evaluate(() => ({ peeked: document.querySelectorAll('.is-peeked').length, energy: window.MMGame.state.players[window.MMGame.state.current].energy }));
  log('peek', info);
  await page.waitForTimeout(1800);
  await page.screenshot({ path: 'preview/game-peek-finish.png' });

  // pause + timer freeze
  const before = await page.evaluate(() => window.MMGame.state.timeLeft);
  await page.click('#btnGamePause');
  await page.waitForTimeout(700);
  const pausedState = await page.evaluate(() => ({ paused: window.MMGame.state.paused, time: window.MMGame.state.timeLeft, modal: window.MMUI.current }));
  log('pause', { before, pausedState });
  await page.click('#btnResume');
  await page.waitForTimeout(500);
  const resumedState = await page.evaluate(() => ({ paused: window.MMGame.state.paused, time: window.MMGame.state.timeLeft, modal: window.MMUI.current }));
  log('resume', resumedState);

  // force results
  await page.evaluate(() => {
    const s = window.MMGame.state;
    s.players[0].pairs = 6; s.players[0].score = 700; s.players[1].pairs = 4; s.players[1].score = 500;
    s.stats.maxCombo = 4; s.stats.matches = 10; s.stats.moves = 14; s.stats.peeks = 2; s.stats.shuffles = 1;
    s.deck.forEach(c => { c.matched = true; });
    window.MMGame.finishGame(0);
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'preview/results-mobile.png' });
  info = await page.evaluate(() => ({ screen: document.querySelector('.screen.is-active')?.id, title: document.querySelector('#resultTitle').textContent, stars: window.MMApp.save().stars, err: document.querySelectorAll('.result-stat').length }));
  log('results', info);

  // results rematch
  await page.click('#btnRematch');
  await page.waitForTimeout(3800);
  info = await page.evaluate(() => ({ screen: document.querySelector('.screen.is-active')?.id, phase: window.MMGame.state?.phase, cards: document.querySelectorAll('.memory-card').length }));
  log('rematch', info);

  // arcade end
  await page.evaluate(() => window.MMGame.start({ mode: 'arcade', players: [{ name: 'ليلى', catId: 'lulu', bot: false }] }, { skipCountdown: true }));
  await page.waitForTimeout(500);
  await page.evaluate(() => { window.MMGame.state.arcade.score = 1200; window.MMGame.state.arcade.timeLeft = 0.1; });
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'preview/results-arcade-mobile.png' });
  info = await page.evaluate(() => ({ screen: document.querySelector('.screen.is-active')?.id, title: document.querySelector('#resultTitle').textContent, best: window.MMApp.save().bestArcade }));
  log('arcade results', info);

  // AI mode
  await page.evaluate(() => window.MMGame.start({ mode: 'ai', difficulty: 'hard', players: [{ name: 'ليلى', catId: 'lulu', bot: false }, { name: 'زعتر', catId: 'zaatar', bot: true }] }, { skipCountdown: true }));
  await page.waitForTimeout(9000);
  info = await page.evaluate(() => {
    const s = window.MMGame.state;
    return { phase: s.phase, current: s.current, up: s.deck.filter(c => c.faceUp).length, matched: s.deck.filter(c => c.matched).length, p1: s.players[1].pairs, aiTimer: !!s.aiTimer, time: s.timeLeft };
  });
  log('ai after 9s', info);
  await page.screenshot({ path: 'preview/game-ai.png' });

  console.log('ERRORS:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
})();
