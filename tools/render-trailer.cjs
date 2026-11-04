/* Renders the deterministic HTML trailer to assets/MeowMemory-Trailer.mp4 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'assets', 'MeowMemory-Trailer.mp4');
const FRAMES = path.join(ROOT, 'preview', 'trailer-frames');
const FPS = Number(process.env.TRAILER_FPS || 24);
const TEST = process.argv.includes('--test');
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.env.TRAILER_URL || 'http://127.0.0.1:5173/trailer/?capture=1';

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.evaluate(() => window.TRAILER && window.TRAILER.ready);
  await page.waitForFunction(() => Array.from(document.images).every((img) => img.complete), null, { timeout: 60000 });
  await page.waitForTimeout(400);

  const duration = await page.evaluate(() => window.TRAILER.duration);
  const total = TEST ? 12 : Math.round(duration * FPS);
  fs.rmSync(FRAMES, { recursive: true, force: true });
  fs.mkdirSync(FRAMES, { recursive: true });

  const started = Date.now();
  for (let i = 0; i < total; i++) {
    const t = TEST ? (i / 12) * duration : i / FPS;
    await page.evaluate((time) => window.TRAILER.seek(time), t);
    await page.screenshot({
      path: path.join(FRAMES, `frame_${String(i).padStart(5, '0')}.jpg`),
      type: 'jpeg',
      quality: 92,
      animations: 'disabled'
    });
    if (i % 50 === 0 || TEST) {
      console.log(`frame ${i + 1}/${total} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
    }
  }
  await browser.close();
  console.log(`captured ${total} frames in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log('errors:', errors.length ? errors : 'none');

  if (TEST) return;

  const audio = path.join(ROOT, 'assets', 'audio', 'trailer-mix.wav');
  console.log('encoding mp4...');
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-framerate', String(FPS),
    '-i', path.join(FRAMES, 'frame_%05d.jpg'),
    '-i', audio,
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k',
    '-shortest', '-movflags', '+faststart',
    OUT
  ], { stdio: 'inherit' });
  console.log('wrote', OUT);
  if (!process.env.KEEP_FRAMES) fs.rmSync(FRAMES, { recursive: true, force: true });
})().catch((err) => { console.error(err); process.exit(1); });
