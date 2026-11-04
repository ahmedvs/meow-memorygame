const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:5173/?capture=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await page.evaluate(() => window.MMGame.start({ mode:'ai', difficulty:'hard', players:[{name:'ليلى',catId:'lulu',bot:false},{name:'زعتر',catId:'zaatar',bot:true}] }, {skipCountdown:true}));
  await page.waitForTimeout(400);
  const pair = await page.evaluate(() => {
    const s=window.MMGame.state; const map={}; s.deck.forEach((c,i)=>{(map[c.fruit]=map[c.fruit]||[]).push(i)}); const f=Object.keys(map)[0]; const [a,b]=map[f]; window.MMGame.remember(a); window.MMGame.remember(b); return {a,b,f};
  });
  await page.evaluate(() => window.MMGame.switchTurn('test'));
  const timeline=[];
  for (let i=0;i<8;i++) { await page.waitForTimeout(500); timeline.push(await page.evaluate(() => ({t:document.querySelectorAll('.is-flipped').length, current:window.MMGame.state.current, pairs:window.MMGame.state.players.map(p=>p.pairs), timer:window.MMGame.state.timeLeft}))); }
  await page.waitForTimeout(2500);
  const info = await page.evaluate(() => { const s=window.MMGame.state; return {current:s.current, p2pairs:s.players[1].pairs, matched:s.deck.filter(c=>c.matched).length, up:s.deck.filter(c=>c.faceUp).length, log:document.querySelector('#turnMessageText').textContent}; });
  console.log(JSON.stringify({pair, timeline, info, errors}, null, 2));
  await page.screenshot({ path:'preview/game-ai-match.png' });
  await browser.close();
})();
