const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto('http://127.0.0.1:5173/?capture=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    window.MMGame.start({ mode:'duel', players:[{name:'ليلى',catId:'lulu',bot:false},{name:'أختي',catId:'zaatar',bot:false}] }, {skipCountdown:true});
    const s=window.MMGame.state;
    s.players[0].pairs=6;s.players[0].score=700;s.players[1].pairs=4;s.players[1].score=500;
    s.stats.maxCombo=4;s.stats.matches=10;s.stats.moves=14;s.stats.peeks=2;s.stats.shuffles=1;
    window.MMGame.finishGame(0);
  });
  await page.waitForTimeout(900);
  const info = await page.evaluate(() => ({
    reward: document.querySelector('#resultReward').innerText,
    rewardHTML: document.querySelector('#resultReward').innerHTML,
    scoreline: document.querySelector('#resultScoreline').innerText,
    stats: Array.from(document.querySelectorAll('.result-stat')).map(el => ({ text: el.innerText, html: el.innerHTML })),
    stars: window.MMApp.save().stars
  }));
  console.log(JSON.stringify(info, null, 2));
  await page.screenshot({ path:'preview/results-crop-source.png' });
  await browser.close();
})();
