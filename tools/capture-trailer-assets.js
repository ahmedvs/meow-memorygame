const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

(async () => {
  const outDir = path.join(process.cwd(), 'assets', 'trailer');
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  const context = await browser.newContext({ viewport: { width: 432, height: 768 }, deviceScaleFactor: 2.5, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://127.0.0.1:5173/?capture=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const shot = async (name) => {
    await page.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
    await page.waitForTimeout(80);
    await page.screenshot({ path: path.join(outDir, name), type: 'jpeg', quality: 94, animations: 'disabled' });
    console.log('shot', name);
  };

  // 1. pristine menu
  await shot('menu.jpg');

  // give wardrobe some unlocked cats for the feature montage screenshot
  await page.evaluate(() => {
    const save = window.MMApp.save();
    save.stars = 120;
    save.unlocked = ['lulu', 'zaatar', 'mishmish', 'layl', 'naanaa'];
    window.MMApp.persist(true);
    window.MMApp.updateStarUI();
    window.MMApp.updateMenuStats();
    window.MMApp.renderAvatarTargets();
  });
  await page.evaluate(() => window.MMUI.open('modes'));
  await page.waitForTimeout(500);
  await shot('modes.jpg');
  await page.evaluate(() => window.MMUI.open('wardrobe'));
  await page.waitForTimeout(450);
  await shot('wardrobe.jpg');
  await page.evaluate(() => window.MMUI.closeAll());
  await page.waitForTimeout(200);

  // 2. duel board – stage a visually rich, readable moment
  await page.evaluate(() => {
    window.MMGame.start({
      mode: 'duel',
      players: [
        { name: 'ليلى', catId: 'lulu', bot: false },
        { name: 'أختي', catId: 'zaatar', bot: false }
      ]
    }, { skipCountdown: true });
  });
  await page.waitForTimeout(1100);
  await page.evaluate(() => {
    const g = window.MMGame;
    const s = g.state;
    s.paused = true; // freeze clock and interaction for a clean still, no modal
    s.phase = 'playing';
    s.locked = false;
    const groups = {};
    s.deck.forEach((c, i) => { (groups[c.fruit] = groups[c.fruit] || []).push(i); });
    const keys = Object.keys(groups);
    // clear five pairs as pockets of memory
    [0, 1, 2, 3, 4].forEach((k) => {
      const [a, b] = groups[keys[k]];
      s.deck[a].matched = true; s.deck[b].matched = true;
      document.querySelector(`[data-index="${a}"]`)?.classList.add('is-cleared', 'is-locked');
      document.querySelector(`[data-index="${b}"]`)?.classList.add('is-cleared', 'is-locked');
    });
    // reveal one matching pair from an untouched fruit
    const pairKey = keys[7];
    const [pa, pb] = groups[pairKey];
    g.flipUp(pa, 'human');
    g.flipUp(pb, 'human');
    s.firstPick = pa; s.secondPick = pb;
    const elA = document.querySelector(`[data-index="${pa}"]`);
    const elB = document.querySelector(`[data-index="${pb}"]`);
    elA?.classList.add('is-matched');
    elB?.classList.add('is-matched');
    s.players[0].pairs = 5; s.players[0].score = 780; s.players[0].combo = 2; s.players[0].energy = 4;
    s.players[1].pairs = 3; s.players[1].score = 470; s.players[1].energy = 3;
    s.current = 0; s.timeLeft = 11; s.turnMax = 16;
    s.deck.forEach((c) => { if (c.golden) c.faceUp = c.faceUp; });
    g.updateHUD(true);
    g.updateAbilityUI();
    g.updateTimerDisplay();
    document.querySelector('#turnMessageText').textContent = 'بطاقة واحدة… أكملي!';
    document.querySelector('#abilityPeek').disabled = false;
    document.querySelector('#abilityShuffle').disabled = false;
  });
  await page.waitForTimeout(450);
  await shot('game-duel.jpg');

  // 3. arcade board
  await page.evaluate(() => {
    window.MMGame.start({
      mode: 'arcade',
      players: [{ name: 'ليلى', catId: 'lulu', bot: false }]
    }, { skipCountdown: true });
  });
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    const g = window.MMGame;
    const s = g.state;
    s.paused = true;
    s.arcade.timeLeft = 41.4;
    s.arcade.score = 1680;
    s.arcade.wave = 2;
    s.arcade.matches = 9;
    s.players[0].combo = 3;
    s.players[0].energy = 5;
    s.players[0].pairs = 8;
    s.players[0].score = 1680;
    const groups = {};
    s.deck.forEach((c, i) => { (groups[c.fruit] = groups[c.fruit] || []).push(i); });
    const keys = Object.keys(groups);
    [0, 1, 2, 3].forEach((k) => {
      const [a, b] = groups[keys[k]];
      s.deck[a].matched = true; s.deck[b].matched = true;
      document.querySelector(`[data-index="${a}"]`)?.classList.add('is-cleared', 'is-locked');
      document.querySelector(`[data-index="${b}"]`)?.classList.add('is-cleared', 'is-locked');
    });
    const [a, b] = groups[keys[5]];
    g.flipUp(a, 'human'); g.flipUp(b, 'human');
    document.querySelector(`[data-index="${a}"]`)?.classList.add('is-matched');
    document.querySelector(`[data-index="${b}"]`)?.classList.add('is-matched');
    g.updateHUD(true);
    g.updateAbilityUI();
    g.updateTimerDisplay();
    document.querySelector('#abilityPeek').disabled = false;
    document.querySelector('#abilityShuffle').disabled = false;
  });
  await page.waitForTimeout(450);
  await shot('game-arcade.jpg');

  // 4. results
  await page.evaluate(() => {
    const g = window.MMGame;
    const s = g.state;
    s.paused = false;
    s.arcade.score = 1680;
    s.arcade.matches = 12;
    s.arcade.wave = 3;
    s.arcade.moves = 15;
    s.stats.matches = 12;
    s.stats.moves = 15;
    s.stats.maxCombo = 4;
    s.arcade.timeLeft = 0;
    g.finishArcade();
  });
  await page.waitForTimeout(800);
  await shot('results.jpg');

  // 5. AI board and setup/modes
  await page.evaluate(() => {
    window.MMGame.start({
      mode: 'ai', difficulty: 'hard',
      players: [
        { name: 'ليلى', catId: 'lulu', bot: false },
        { name: 'زعتر', catId: 'zaatar', bot: true }
      ]
    }, { skipCountdown: true });
  });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const g = window.MMGame, s = g.state;
    s.paused = true;
    s.locked = false;
    s.players[1].pairs = 2; s.players[1].score = 320; s.players[0].pairs = 1; s.players[0].score = 120;
    s.current = 1; s.timeLeft = 13;
    g.updateHUD(true);
    g.updateAbilityUI();
    document.querySelector('#turnMessageText').textContent = 'زعتر يفكر…';
    document.querySelector('#turnMessage').classList.add('is-ai');
    document.querySelector('#gameModeChip').innerHTML = '<svg class="ico"><use href="#i-bot"/></svg><span>تحدي زعتر</span>';
  });
  await page.waitForTimeout(350);
  await shot('game-ai.jpg');

  console.log('ERRORS', errors.length ? errors : 'none');
  await browser.close();
})();
