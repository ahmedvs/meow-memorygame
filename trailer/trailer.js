/* Meow Memory — cinematic trailer, deterministic timeline for frame rendering. */
(function () {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t, a, b) => {
    const x = clamp((t - a) / (b - a), 0, 1);
    return x * x * (3 - 2 * x);
  };
  const easeOut = (x) => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
  const easeOutQuart = (x) => 1 - Math.pow(1 - clamp(x, 0, 1), 4);
  const easeOutBack = (x) => {
    x = clamp(x, 0, 1);
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  };
  const easeInOut = (x) => {
    x = clamp(x, 0, 1);
    return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  };
  const win = (t, a, b, fadeIn = .18, fadeOut = .18) =>
    smooth(t, a, a + fadeIn) * (1 - smooth(t, b - fadeOut, b));
  const num = (n) => String(Math.round(n)).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[+d]);
  const DURATION = 44.8;
  const isCapture = new URLSearchParams(location.search).has('capture');

  const scenes = {
    eyes: $('#sc-eyes'),
    logo: $('#sc-logo'),
    menu: $('#sc-menu'),
    fruit: $('#sc-fruit'),
    play: $('#sc-play'),
    duel: $('#sc-duel'),
    powers: $('#sc-powers'),
    features: $('#sc-features'),
    letter: $('#sc-letter'),
    final: $('#sc-final'),
    end: $('#sc-end')
  };
  const stage = $('#stage');
  const flash = $('#flash');
  const subtitle = $('#subtitle');
  const subtitleSpan = $('#subtitle span');
  const particleCanvas = $('#particleCanvas');
  const particleCtx = particleCanvas.getContext('2d');
  const shakeLayer = $('#shakeLayer');
  const lightStreaks = $('#lightStreaks');

  let stageScale = 1;
  let lastPowerPhase = -1;
  let lastSubtitle = '';
  let startTime = performance.now();
  let playbackTime = 0;
  let playing = !isCapture;
  let raf = null;

  const SH_CUES = [
    [2.7, 4.9, 'في كل ذكرى… قطة صغيرة.'],
    [5.4, 9.133, 'مياو ميموري: لعبة ذاكرة… بطعم الأكشن.'],
    [9.6, 12.0, 'عالم كامل… صُنع ليُبهرك.'],
    [12.8, 16.4, 'افتحِ البطاقة، طابق الفاكهة… وابقَ الأسرع.'],
    [19.7, 23.833, 'لاعبان… مواجهة واحدة… من ستضحك أخيرًا؟'],
    [24.2, 27.2, 'لمحة… خلطة… وبرقٌ لا يتوقف!'],
    [28.9, 33.4, 'ثلاثة أوضاع… موسيقى أصلية… وتفاصيل في كل زاوية.'],
    [37.1, 39.567, 'مياو ميموري… هل تتحداني؟']
  ];

  const SUB_OPTIONAL = new Set([2, 4, 6, 7]);
  const SHAKES = [
    { t: 2.35, amp: 7, dur: .4 },
    { t: 13.75, amp: 12, dur: .35 },
    { t: 16.8, amp: 8, dur: .3 },
    { t: 18.9, amp: 9, dur: .32 },
    { t: 24.0, amp: 16, dur: .5 },
    { t: 25.2, amp: 11, dur: .3 },
    { t: 26.4, amp: 14, dur: .35 },
    { t: 28.2, amp: 12, dur: .3 },
    { t: 36.0, amp: 18, dur: .5 },
    { t: 40.8, amp: 12, dur: .4 }
  ];
  const FLASHES = [
    { t: 2.4, a: .84, dur: .32, color: '#fff6e6' },
    { t: 12.0, a: .72, dur: .26, color: '#fff4df' },
    { t: 13.8, a: .28, dur: .2, color: '#ffe4b0' },
    { t: 16.8, a: .24, dur: .18, color: '#fff0d5' },
    { t: 19.2, a: .62, dur: .24, color: '#fff7e9' },
    { t: 24.0, a: .7, dur: .3, color: '#ffe3aa' },
    { t: 25.2, a: .35, dur: .2, color: '#ffedc8' },
    { t: 26.4, a: .55, dur: .25, color: '#ffe0a2' },
    { t: 28.2, a: .44, dur: .22, color: '#fff1d0' },
    { t: 28.8, a: .5, dur: .22, color: '#fff7ea' },
    { t: 33.6, a: .28, dur: .38, color: '#fff9ed' },
    { t: 36.0, a: .88, dur: .48, color: '#ffe7b8' },
    { t: 40.8, a: .66, dur: .36, color: '#ffedc7' }
  ];

  function setEl(el, { opacity, x = 0, y = 0, s = 1, r = 0, blur = 0 } = {}) {
    if (!el) return;
    if (opacity != null) el.style.opacity = String(clamp(opacity, 0, 1));
    el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${s}) rotate(${r}deg)`;
    el.style.filter = blur > .02 ? `blur(${blur.toFixed(2)}px)` : 'none';
  }

  function showScene(el, opacity, opts = {}) {
    if (!el) return;
    const vis = opacity > .002;
    el.classList.toggle('is-visible', vis);
    el.style.visibility = vis ? 'visible' : 'hidden';
    el.style.opacity = clamp(opacity, 0, 1).toFixed(4);
    const x = opts.x || 0, y = opts.y || 0, s = opts.s || 1, r = opts.r || 0, blur = opts.blur || 0;
    el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${s}) rotate(${r}deg)`;
    el.style.filter = blur > .02 ? `blur(${blur.toFixed(2)}px)` : 'none';
  }

  function makeCats() {
    $$('[data-cat]').forEach((el) => {
      const cat = MMArt.catById(el.getAttribute('data-cat') || 'lulu');
      el.innerHTML = MMArt.catAvatarSvg(cat);
    });
    $$('[data-mascot]').forEach((el) => { el.innerHTML = MMArt.mascotSvg; });
  }

  function buildDecor() {
    // logo shock rings
    const shock = $('#logoShock');
    for (let i = 0; i < 3; i++) {
      const ring = document.createElement('span');
      ring.className = 'shock-ring';
      shock.appendChild(ring);
    }
    // powers shock rings
    const pshock = $('#powerShock');
    for (let i = 0; i < 3; i++) {
      const ring = document.createElement('span');
      ring.className = 'power-shock-ring';
      ring.style.width = ring.style.height = '150px';
      ring.style.left = '0';
      ring.style.top = '0';
      ring.style.marginLeft = '-75px';
      ring.style.marginTop = '-75px';
      pshock.appendChild(ring);
    }
    // letter petals
    const petalField = $('#petalField');
    for (let i = 0; i < 21; i++) {
      const p = document.createElement('span');
      p.className = 'petal';
      p.style.left = `${rand(i * 47.1) * 100}%`;
      p.style.top = `${rand(i * 13.7 + 9) * 110 - 10}%`;
      p.style.opacity = String(.18 + rand(i * 7.3) * .45);
      p.style.transform = `rotate(${rand(i * 2.2) * 360}deg) scale(${.5 + rand(i * 9.3) * .8})`;
      petalField.appendChild(p);
    }
    // equalizer
    const eq = $('#musicEq');
    for (let i = 0; i < 31; i++) {
      const bar = document.createElement('i');
      bar.style.height = `${40 + rand(i * 7.1) * 105}px`;
      eq.appendChild(bar);
    }
  }

  function rand(seed) {
    const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  function fitStage() {
    if (isCapture) { stageScale = 1; }
    else { stageScale = Math.min(innerWidth / 1080, innerHeight / 1920); }
    stage.style.setProperty('--stage-scale', stageScale);
  }

  function stageTransform(shake) {
    const base = `translate(-50%, -50%) scale(${stageScale})`;
    return `${base} translate(${shake.x.toFixed(2)}px, ${shake.y.toFixed(2)}px) rotate(${shake.r.toFixed(3)}deg)`;
  }

  /* ─────────────────────────── particles ─────────────────────────── */
  const dust = Array.from({ length: 92 }, (_, i) => ({
    x: rand(i * 2.13) * 1080,
    y: rand(i * 5.31 + 4) * 1920,
    r: .8 + rand(i * 3.4) * 2.5,
    vx: -.08 + rand(i * 8.2) * .16,
    vy: -.1 - rand(i * 6.7) * .24,
    phase: rand(i * 9.3) * 6.283,
    base: .18 + rand(i * 4.2) * .5,
    hue: rand(i * 11.3) > .55 ? '255,236,190' : (rand(i * 3.7) > .5 ? '227,206,232' : '255,246,229')
  }));
  const confetti = Array.from({ length: 150 }, (_, i) => ({
    x: rand(i * 1.77 + 2) * 1080,
    y: -rand(i * 8.11 + 3) * 1900,
    w: 5 + rand(i * 4.7) * 9,
    h: 7 + rand(i * 7.2) * 14,
    vy: 240 + rand(i * 3.3) * 380,
    vx: -28 + rand(i * 5.2) * 56,
    rot: rand(i * 6.9) * 6.283,
    vr: -2.4 + rand(i * 11.1) * 4.8,
    color: ['#f1c46c', '#e59b91', '#b08bc2', '#99bdd8', '#fff2db', '#d7a951'][i % 6]
  }));

  function drawParticles(t) {
    const ctx = particleCtx;
    ctx.clearRect(0, 0, 1080, 1920);
    let alpha = 0;
    if (t < 2.6) alpha = .38;
    else if (t < 7.4) alpha = .7;
    else if (t < 12) alpha = .18;
    else if (t < 15.5) alpha = .34;
    else if (t < 19.2) alpha = .22;
    else if (t < 24) alpha = .42;
    else if (t < 28.8) alpha = .65;
    else if (t < 33.6) alpha = .14;
    else if (t < 36) alpha = .48;
    else if (t < 40.8) alpha = .7;
    else alpha = .4;
    // drifting dust
    dust.forEach((p) => {
      let x = (p.x + p.vx * t * 40 + Math.sin(t * .27 + p.phase) * 18) % 1080;
      let y = (p.y + p.vy * t * 40) % 1920;
      if (x < 0) x += 1080;
      if (y < 0) y += 1920;
      const tw = .56 + .44 * Math.sin(t * .9 + p.phase);
      ctx.beginPath();
      ctx.fillStyle = `rgba(${p.hue},${(p.base * alpha * tw).toFixed(3)})`;
      ctx.arc(x, y, p.r, 0, Math.PI * 2);
      ctx.fill();
      if (p.r > 2.4) {
        ctx.beginPath();
        ctx.strokeStyle = `rgba(${p.hue},${(p.base * alpha * .28).toFixed(3)})`;
        ctx.arc(x, y, p.r * 2.3, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
    // confetti celebration (final)
    if (t >= 35.95 && t <= 41.0) {
      const local = t - 35.95;
      const fade = 1 - smooth(t, 40.3, 41.0);
      confetti.forEach((c) => {
        const y = c.y + local * c.vy;
        const wrapped = ((y % 1980) + 1980) % 1980 - 30;
        const x = c.x + Math.sin(local * 1.1 + c.rot) * 65 + local * c.vx;
        const rot = c.rot + local * c.vr;
        ctx.save();
        ctx.translate(((x % 1080) + 1080) % 1080, wrapped);
        ctx.rotate(rot);
        ctx.globalAlpha = .8 * fade;
        ctx.fillStyle = c.color;
        ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
        ctx.restore();
      });
    }
    // gold sparks at power section
    if (t >= 24 && t < 28.8) {
      const a = (1 - smooth(t, 28.3, 28.8)) * .6;
      for (let i = 0; i < 24; i++) {
        const x = 540 + Math.sin(i * 2.7 + t * 1.9) * (120 + i * 17);
        const y = 320 + ((t * (130 + i * 9) + i * 83) % 1280);
        ctx.beginPath();
        ctx.fillStyle = `rgba(247,205,127,${a * (.35 + .4 * Math.sin(t * 4 + i))})`;
        ctx.arc(x, y, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /* ──────────────────────── scene renderers ──────────────────────── */
  function renderEyes(t, shake) {
    const exit = smooth(t, 2.24, 2.58);
    const op = smooth(t, 0, .22) * (1 - exit);
    showScene(scenes.eyes, op, { s: 1 + exit * .06, y: -exit * 25, blur: exit * 5 });
    const open = easeInOut(clamp((t - .62) / 1.05, 0, 1));
    const gaze = smooth(t, 1.35, 2.0);
    const arc = Math.sin(t * 1.1) * 2;
    const eyeFrame = $('.eyes-frame');
    eyeFrame.style.transform = `translate(-50%, -50%) scale(${(.89 + .11 * open).toFixed(4)}) rotate(${arc.toFixed(2)}deg)`;
    const lidShift = -108 * open;
    $$('.eye .lid').forEach((lid, i) => {
      lid.style.transform = `translateY(${lidShift.toFixed(2)}%)`;
      lid.style.opacity = open > .99 ? '0' : '1';
    });
    $$('.iris').forEach((iris, i) => {
      iris.style.width = `${(162 + 45 * open).toFixed(1)}px`;
      iris.style.height = `${(175 + 54 * open).toFixed(1)}px`;
      iris.style.transform = `translate(-50%, -50%) translateX(${(gaze * (i ? -6 : 10)).toFixed(1)}px)`;
    });
    $$('.pupil').forEach((pupil) => {
      pupil.style.width = `${(20 + 13 * open).toFixed(1)}px`;
      pupil.style.height = `${(113 + 63 * open).toFixed(1)}px`;
    });
    $$('.glint').forEach((g) => { g.style.opacity = open > .75 ? (g.classList.contains('glint-a') ? '.92' : '.58') : '.1'; });
    const halo = $('#eyesHalo');
    halo.style.transform = `translate(-50%, -50%) scale(${(.85 + .15 * open + Math.sin(t * 2) * .008).toFixed(3)})`;
    const kicker = $('#eyesKicker');
    kicker.style.opacity = String(win(t, 1.5, 2.38, .35, .25));
    kicker.style.transform = `translateY(${(1 - win(t, 1.5, 2.38, .35, .25)) * 12}px)`;
    const small = $('.eyes-small');
    small.style.opacity = String(win(t, 1.85, 2.42, .3, .25));
    $$('.eye-orbit').forEach((orbit, i) => {
      orbit.style.transform = `translate(-50%, -50%) rotate(${(t * (i ? 4 : -2.4) + i * 12).toFixed(2)}deg) scale(${(1 + open * .03).toFixed(3)})`;
    });
    document.querySelector('.eyes-vignette').style.opacity = String(1 - .2 * open);
  }

  function renderLogo(t, shake) {
    const enter = smooth(t, 2.41, 2.7);
    const exit = smooth(t, 6.82, 7.35);
    showScene(scenes.logo, enter * (1 - exit), { s: 1 + exit * .1, y: -exit * 70, blur: exit * 8 });
    const ringIn = smooth(t, 2.42, 3.25);
    $$('.shock-ring').forEach((ring, i) => {
      const p = clamp((t - 2.4 - i * .16) / .95, 0, 1);
      const op = p > 0 && p < 1 ? (1 - p) * .75 : 0;
      ring.style.opacity = String(op);
      ring.style.width = ring.style.height = `${260 + 980 * easeOut(p)}px`;
      ring.style.transform = `translate(-50%, -50%) scale(1)`;
      ring.style.borderColor = i === 1 ? 'rgba(255,234,198,.35)' : 'rgba(255,241,214,.5)';
    });
    const em = $('#brandEmblem');
    const emP = smooth(t, 2.58, 3.2);
    em.style.opacity = String(emP);
    em.style.transform = `translateY(${(1 - easeOutBack(emP)) * 32}px) scale(${.72 + .28 * easeOutBack(emP)}) rotate(${Math.sin(t * .8) * 2}deg)`;
    const kicker = $('.brand-kicker');
    kicker.style.opacity = String(smooth(t, 2.75, 3.2));
    kicker.style.transform = `translateY(${(1 - smooth(t, 2.75, 3.2)) * 15}px)`;
    const word = $('.brand-word');
    const wys = smooth(t, 2.9, 3.55);
    const pulse = t > 4.8 ? 1 + .014 * Math.sin((t - 4.8) * 2.3) : 1;
    word.style.opacity = String(wys);
    word.style.transform = `translateY(${(1 - easeOutBack(wys)) * 55}px) scale(${(.94 + .06 * easeOutBack(wys)) * pulse})`;
    const rule = $('.brand-rule');
    const rp = smooth(t, 3.15, 3.6);
    rule.style.opacity = String(rp);
    rule.style.transform = `scaleX(${.78 + .22 * rp})`;
    const tag = $('.brand-tagline');
    const tp = smooth(t, 4.85, 5.35);
    tag.style.opacity = String(tp);
    tag.style.transform = `translateY(${(1 - tp) * 25}px)`;
    const sub = $('.brand-sub');
    const sp = smooth(t, 5.5, 6.0);
    sub.style.opacity = String(sp);
    sub.style.transform = `translateY(${(1 - sp) * 16}px)`;
    const foot = $('#logoFoot');
    foot.style.opacity = String(smooth(t, 5.9, 6.5) * (1 - exit));
    foot.style.transform = `translateY(${(1 - smooth(t, 5.9, 6.5)) * 15}px)`;
    const lockup = $('#logoLockup');
    lockup.style.opacity = '1';
    const ly = (1 - enter) * 46 - exit * 55;
    lockup.style.transform = `translate(-50%, calc(-50% + ${ly}px)) scale(${1 + exit * .04})`;
    // floating props
    const smallCards = $$('.mini-card');
    const baseRot = [-16, 13, -11, 9];
    const fromX = [-250, 220, 230, -230];
    const fromY = [-140, -80, 120, 150];
    smallCards.forEach((card, i) => {
      const p = smooth(t, 2.65 + i * .09, 3.25 + i * .09);
      const drift = Math.sin(t * .85 + i * 1.6) * 5;
      card.style.opacity = String(p * (0.82 + .18 * smooth(t, 3.2, 4.0)));
      card.style.transform = `translate(${(1 - easeOut(p)) * fromX[i]}px, ${(1 - easeOut(p)) * fromY[i] + drift}px) rotate(${baseRot[i] + Math.sin(t * .7 + i) * 1.4}deg)`;
    });
    $$('.logo-orbit-fruit').forEach((fruit, i) => {
      const p = smooth(t, 2.85 + i * .1, 3.4 + i * .1);
      const drift = Math.sin(t * 1.1 + i * 1.7) * 8;
      fruit.style.opacity = String(p * .92);
      fruit.style.transform = `translateY(${drift + (1 - p) * 20}px) rotate(${Math.sin(t * .55 + i) * 6}deg)`;
    });
    const halo = $('.blob-c');
    halo.style.transform = `translate(${Math.sin(t * .2) * 30}px, ${Math.cos(t * .23) * 30}px) scale(${1 + Math.sin(t * .4) * .05})`;
  }

  function renderMenu(t, shake) {
    const enter = smooth(t, 7.15, 7.65);
    const exit = smooth(t, 11.72, 12.06);
    showScene(scenes.menu, enter * (1 - exit), { s: 1 + exit * .035, blur: exit * 6, y: -exit * 22 });
    const reveal = smooth(t, 7.18, 7.9);
    const visual = $('#menuVisual');
    visual.style.clipPath = `inset(${((1 - reveal) * 34).toFixed(2)}% 0 0 0)`;
    const img = $('#menuImg');
    const push = smooth(t, 7.2, 11.95);
    const zoom = lerp(1.045, 1.105, push) + (t > 10.8 ? smooth(t, 10.8, 12.0) * .04 : 0);
    img.style.transform = `scale(${zoom.toFixed(4)}) translate(${(Math.sin(t * .25) * 4).toFixed(2)}px, ${(-push * 11 + Math.sin(t * .32) * 3).toFixed(2)}px)`;
    img.style.filter = `saturate(1.05) contrast(1.02) brightness(${(1 + .035 * smooth(t, 9.4, 10.3)).toFixed(3)})`;
    const lab1 = $('#menuLabel1'), lab2 = $('#menuLabel2'), lab3 = $('#menuLabel3');
    const l1 = win(t, 7.85, 9.4, .25, .22);
    const l2 = win(t, 8.45, 9.85, .25, .22);
    const l3 = win(t, 9.0, 10.35, .25, .22);
    lab1.style.opacity = String(l1);
    lab1.style.transform = `translate(${(1 - l1) * 24}px, 0)`;
    lab2.style.opacity = String(l2);
    lab2.style.transform = `translate(${(1 - l2) * -24}px, 0)`;
    lab3.style.opacity = String(l3);
    lab3.style.transform = `translate(${(1 - l3) * 24}px, 0)`;
    const head = $('#menuHeadline');
    const h = win(t, 9.55, 11.25, .28, .25);
    head.style.opacity = String(h);
    head.style.transform = `translateY(${(1 - smooth(t, 9.55, 9.9)) * 28}px) scale(${1 + (1 - h) * .012})`;
    const ribbon = $('#menuRibbon');
    const rp = win(t, 10.35, 11.9, .3, .2);
    ribbon.style.opacity = String(rp);
    ribbon.style.transform = `translate(-50%, ${(1 - easeOut(smooth(t, 10.35, 10.7))) * 18}px)`;
  }

  function renderFruit(t, shake) {
    const enter = smooth(t, 12.0, 12.24);
    const exit = smooth(t, 15.12, 15.48);
    showScene(scenes.fruit, enter * (1 - exit), { s: 1 + exit * .08, y: exit * -40, blur: exit * 7 });
    const outline1 = $('#fruitOutline1');
    const outline2 = $('#fruitOutline2');
    outline1.style.opacity = String(smooth(t, 12.1, 12.5) * .55);
    outline1.style.transform = `translate(${Math.sin(t * .3) * 12}px, ${Math.sin(t * .4) * 8}px) rotate(-6deg)`;
    outline2.style.opacity = String(smooth(t, 12.2, 12.6) * .55);
    outline2.style.transform = `translate(${Math.sin(t * .26) * -10}px, 0) rotate(-5deg)`;
    const top = $('#fruitTopline');
    top.style.opacity = String(smooth(t, 12.05, 12.35));
    top.style.transform = `translateY(${(1 - smooth(t, 12.05, 12.35)) * -13}px)`;
    const timer = $('#fruitTimer');
    timer.style.opacity = String(smooth(t, 12.1, 12.45));
    const progress = clamp(1 - (t - 12.0) / 3.4, .14, 1);
    $('#fruitTimerNum').textContent = num(Math.ceil(progress * 16));
    $('#fruitTimerRing').style.strokeDashoffset = String(169.65 * (1 - progress));
    const grid = $('#fruitGrid');
    grid.style.transform = `translateX(-50%) translateY(${(1 - enter) * 55}px) scale(${1 + (.02 * smooth(t, 15.0, 15.5))})`;
    const cardEls = $$('.fruit-card');
    const start = [12.0, 12.09, 12.18, 12.27];
    const fromX = [-170, 170, -150, 150];
    const baseRot = [-4, 3, -3, 4];
    const flips = [13.0, 13.55, 14.1, 14.65];
    cardEls.forEach((card, i) => {
      const p = smooth(t, start[i], start[i] + .5);
      const drift = Math.sin(t * .9 + i * 1.8) * 2.5;
      card.style.opacity = String(p);
      card.style.transform = `translate(${(1 - easeOut(p)) * fromX[i]}px, ${(1 - easeOutBack(p)) * 170 + drift}px) rotate(${baseRot[i] * (1 - easeOut(p))}deg) scale(${.62 + .38 * easeOutBack(p)})`;
      const fp = clamp((t - flips[i]) / .45, 0, 1);
      const inner = card.querySelector('.fcard-inner');
      inner.style.transform = `rotateY(${easeInOut(fp) * 180}deg)`;
      card.classList.toggle('is-matched', i < 2 && t >= 13.78);
    });
    const burst = $('#matchBurst');
    const bp = win(t, 13.72, 14.62, .15, .25);
    burst.style.opacity = String(bp);
    burst.style.transform = `translate(-50%, -50%) scale(${.78 + .3 * easeOutBack(smooth(t, 13.72, 14.0))}) rotate(${(1 - bp) * 4}deg)`;
    $('.burst-ring.b1').style.transform = `scale(${1 + (t - 13.72) * .25})`;
    $('.burst-ring.b2').style.transform = `scale(${1 + (t - 13.72) * .16})`;
    const w1 = $('#fruitWord1');
    const w2 = $('#fruitWord2');
    const wp1 = win(t, 12.15, 13.4, .2, .18);
    const wp2 = win(t, 13.9, 15.05, .2, .2);
    w1.style.opacity = String(wp1);
    w1.style.transform = `translateX(${(1 - wp1) * -25}px) rotate(-2deg)`;
    w2.style.opacity = String(wp2);
    w2.style.transform = `translateX(${(1 - wp2) * 30}px) rotate(-1deg)`;
    const tick = $('#fruitTick');
    tick.style.opacity = String(win(t, 13.25, 14.9, .25, .25) * .85);
  }

  function renderPlay(t, shake) {
    const enter = smooth(t, 15.18, 15.44);
    const exit = smooth(t, 18.9, 19.22);
    showScene(scenes.play, enter * (1 - exit), { s: 1 + exit * .07, blur: exit * 6 });
    const p = clamp((t - 15.2) / 3.85, 0, 1);
    const zoom = $('.play-zoom');
    const z = 1.19 - .15 * easeOut(p) + (t > 17.2 ? .035 * Math.sin((t - 17.2) * 1.1) : 0);
    zoom.style.transform = `scale(${z.toFixed(4)}) translate(${(-8 + p * 6).toFixed(2)}px, ${(4 - p * 12).toFixed(2)}px)`;
    $('#playImg').style.filter = `saturate(${(1.01 + Math.sin(t * .8) * .02).toFixed(3)}) contrast(1.025) brightness(${(1 + .01 * Math.sin(t * 2.2)).toFixed(3)})`;
    const c1 = $('#playCallout1');
    const p1 = win(t, 15.7, 16.75, .18, .17);
    c1.style.opacity = String(p1);
    c1.style.transform = `translateY(${(1 - easeOutBack(smooth(t, 15.7, 16.05))) * -18}px) scale(${.8 + .2 * easeOutBack(smooth(t, 15.7, 16.05))})`;
    const c2 = $('#playCallout2');
    const p2 = win(t, 16.78, 17.9, .18, .16);
    c2.style.opacity = String(p2);
    c2.style.transform = `translateX(${(1 - easeOut(smooth(t, 16.78, 17.1))) * -26}px) scale(${.82 + .18 * easeOutBack(smooth(t, 16.78, 17.12))})`;
    const c3 = $('#playCallout3');
    const p3 = win(t, 17.88, 18.9, .18, .16);
    c3.style.opacity = String(p3);
    c3.style.transform = `translateY(${(1 - easeOut(smooth(t, 17.88, 18.2))) * 18}px)`;
    const head = $('#playHeadline');
    const hp = win(t, 17.0, 19.0, .24, .2);
    head.style.opacity = String(hp);
    head.style.transform = `translateY(${(1 - smooth(t, 17.0, 17.35)) * 22}px)`;
    const lines = $('#speedLines');
    const lp = win(t, 16.6, 18.95, .3, .25);
    lines.style.opacity = String(lp * .78);
    $$('.play-speedlines i').forEach((li, i) => {
      li.style.transform = `translateX(${(t - 16.6) * (i % 2 ? 78 : 112) - 90}px) rotate(${i % 2 ? 16 : -22}deg)`;
    });
    const fl = $('#playFlash');
    fl.style.opacity = String(Math.max(0, .25 - Math.abs(t - 16.82) * 1.4) + Math.max(0, .3 - Math.abs(t - 18.98) * 1.2));
  }

  function renderDuel(t, shake) {
    const enter = smooth(t, 19.16, 19.42);
    const exit = smooth(t, 23.84, 24.1);
    showScene(scenes.duel, enter * (1 - exit), { s: 1 + exit * .02, y: exit * -15 });
    const bgP = easeOut(enter);
    const warm = $('.duel-half.half-warm');
    const cool = $('.duel-half.half-cool');
    warm.style.transform = `translateX(${(1 - bgP) * 300}px)`;
    cool.style.transform = `translateX(${(1 - bgP) * -300}px)`;
    $('.duel-rays').style.transform = `rotate(${t * 1.1}deg)`;
    const kicker = $('#duelKicker');
    kicker.style.opacity = String(win(t, 19.45, 20.8, .3, .25));
    kicker.style.transform = `translateY(${(1 - smooth(t, 19.45, 19.8)) * -12}px)`;
    const lp = smooth(t, 19.28, 19.82);
    const lulu = $('#duelLulu');
    const za = $('#duelZaatar');
    lulu.style.opacity = String(lp);
    za.style.opacity = String(lp);
    lulu.style.transform = `translateX(${(1 - easeOutBack(lp)) * 320}px) translateY(${(1 - lp) * 25}px) rotate(${4 * (1 - lp)}deg)`;
    za.style.transform = `translateX(${(1 - easeOutBack(lp)) * -320}px) translateY(${(1 - lp) * 25}px) rotate(${-4 * (1 - lp)}deg)`;
    const vsP = smooth(t, 19.68, 20.14);
    const vs = $('#duelVs');
    vs.style.opacity = String(vsP);
    vs.style.transform = `translate(-50%, -50%) scale(${.45 + .55 * easeOutBack(vsP)}) rotate(${(1 - vsP) * -15 + Math.sin(t * 1.4) * 1.2}deg)`;
    const scores = $$('.duel-score b');
    if (scores.length === 2) {
      scores[0].textContent = num(Math.round(5 * easeOut(smooth(t, 19.6, 20.8))));
      scores[1].textContent = num(Math.round(3 * easeOut(smooth(t, 19.75, 21.0))));
    }
    const copy = $('#duelCopy');
    const cp = smooth(t, 20.35, 20.85);
    copy.style.opacity = String(cp);
    copy.style.transform = `translateY(${(1 - easeOutBack(cp)) * 42}px) scale(${.95 + .05 * easeOut(cp)})`;
    const details = $('#duelDetails');
    const dp = smooth(t, 21.15, 21.65);
    details.style.opacity = String(dp);
    details.style.transform = `translateY(${(1 - easeOut(dp)) * 17}px)`;
    const cap = $('#duelCaption');
    const capP = win(t, 21.75, 23.4, .3, .25);
    cap.style.opacity = String(capP);
    const cards = $$('.duel-float-card');
    const cardP = smooth(t, 20.1, 20.7);
    const starts = [{ x: -35, y: 20 }, { x: 35, y: 30 }, { x: -25, y: 20 }];
    cards.forEach((card, i) => {
      card.style.opacity = String(cardP * .95);
      card.style.transform = `translate(${Math.sin(t * .7 + i) * 6 + (1 - cardP) * starts[i].x}px, ${Math.sin(t * .8 + i * 2) * 8 + (1 - cardP) * starts[i].y}px) rotate(${[-14, 11, 16][i] + Math.sin(t * .7 + i) * 1.4}deg)`;
    });
    // strobe pulses at the riser
    if (t > 23.2 && t < 24.0) {
      const pulse = Math.max(0, Math.sin((t - 23.2) * 19)) * .12;
      flash.style.opacity = String(parseFloat(flash.style.opacity || 0) + pulse);
    }
  }

  const POWER_PHASES = [
    {
      start: 24.0, icon: 'i-eye', name: 'لمحة', desc: 'اكشف أربع بطاقات… قبل أن يسبقك الخصم', cls: 'peek'
    },
    {
      start: 25.2, icon: 'i-shuffle', name: 'خلطة', desc: 'اخلط البطاقات… واجعل ذاكرتك وحدها تعرف الطريق', cls: 'shuffle'
    },
    {
      start: 26.4, icon: 'i-bolt', name: 'برق!', desc: 'سلسلة متتالية… ونقاط مضاعفة', cls: 'bolt'
    }
  ];
  function updatePowerPhase(phase) {
    if (phase === lastPowerPhase) return;
    lastPowerPhase = phase;
    const p = POWER_PHASES[phase] || POWER_PHASES[0];
    $('#powerSlam').className = `power-slam is-${p.cls}`;
    $('#powerSlam .power-icon use').setAttribute('href', '#' + p.icon);
    $('#powerSlam .power-name').textContent = p.name;
    $('#powerSlam .power-desc').textContent = p.desc;
    const colors = { peek: '#f4ca78', shuffle: '#d8b4e0', bolt: '#ffd36e' };
    $('#powerSlam .power-icon').style.color = colors[p.cls];
  }

  function renderPowers(t, shake) {
    const enter = smooth(t, 23.97, 24.18);
    const exit = smooth(t, 28.62, 28.9);
    showScene(scenes.powers, enter * (1 - exit), { s: 1 + exit * .04, blur: exit * 4 });
    const phase = t < 25.2 ? 0 : t < 26.4 ? 1 : 2;
    updatePowerPhase(phase);
    const panel = $('#powerSlam');
    const isBolt = phase === 2;
    const phaseStart = POWER_PHASES[phase].start;
    const local = t - phaseStart;
    const pin = smooth(local, 0, .24);
    const pout = isBolt ? 0 : smooth(local, 1.05, 1.2);
    panel.style.opacity = String(isBolt ? 0 : pin * (1 - pout));
    panel.style.transform = `translate(-50%, ${(1 - easeOutBack(pin)) * 160 - pout * 90}px) scale(${.82 + .18 * easeOutBack(pin) - pout * .05}) rotate(${(1 - pin) * -1.5}deg)`;
    const kicker = $('#powerKicker');
    kicker.style.opacity = String(smooth(t, 24.05, 24.5) * (1 - smooth(t, 27.8, 28.3)));
    const mini = $('#powerMiniCards');
    const mp = win(t, 24.2, 25.15, .25, .2);
    mini.style.opacity = String(mp);
    mini.style.transform = `translateY(${(1 - easeOut(smooth(t, 24.2, 24.6))) * 20}px)`;
    $$('.p-mini').forEach((card, i) => {
      card.style.transform = `translateY(${[-15, -32, -48, -26][i] + Math.sin(t * 1.2 + i) * 3}px) rotate(${[-7, 4, 7, -3][i] + Math.sin(t * .9 + i) * 2}deg)`;
    });
    const combo = $('#powerCombo');
    const cp = win(t, 26.42, 28.25, .16, .28);
    combo.style.opacity = String(cp);
    const boltPop = smooth(t, 26.42, 26.75);
    combo.style.transform = `scale(${.6 + .4 * easeOutBack(boltPop)}) rotate(${(1 - boltPop) * -5 + Math.sin(t * 2) * .7}deg)`;
    combo.style.filter = cp > .1 ? `drop-shadow(0 0 ${30 + Math.sin(t * 8) * 16}px rgba(255,197,92,.28))` : 'none';
    const caption = $('#powerCaption');
    caption.style.opacity = String(win(t, 24.25, 27.95, .4, .3));
    // lightning pulse
    const lPulse = .3 + .18 * Math.sin(t * 7.4) + (isBolt ? .25 : 0);
    $$('.lightning-bolts .bolt').forEach((bolt, i) => {
      bolt.style.opacity = String(clamp(lPulse + i * .06, .18, .88));
      bolt.style.transform = `rotate(${i === 1 ? 198 : 16}deg) scale(${i === 1 ? 1.5 : 1.2 + Math.sin(t * 3 + i) * .05}) translateY(${Math.sin(t * 2.2 + i) * 11}px)`;
    });
    // shock rings: every half second, ring expansion
    const pshock = $$('.power-shock-ring');
    pshock.forEach((ring, i) => {
      const origin = [24.0, 25.2, 26.4, 28.2][i % 4];
      const p = clamp((t - origin) / .8, 0, 1);
      const visible = t >= origin && t < origin + .85;
      ring.style.opacity = visible ? String((1 - p) * .65) : '0';
      const size = 120 + easeOut(p) * 1100;
      ring.style.width = ring.style.height = `${size}px`;
      ring.style.marginLeft = `${-size / 2}px`;
      ring.style.marginTop = `${-size / 2}px`;
      ring.style.left = '50%';
      ring.style.top = '54%';
      ring.style.borderColor = i === 2 ? 'rgba(255,232,173,.6)' : 'rgba(227,186,125,.38)';
    });
    // quick glitch bars
    shakeLayer.style.opacity = String(isBolt ? .6 : .15);
    lightStreaks.style.opacity = String(win(t, 26.35, 28.35, .08, .2) * .55);
    $$('.light-streaks i').forEach((el, i) => {
      el.style.transform = `translateX(${Math.sin(t * 9 + i) * 40}px) rotate(${i % 2 ? 13 : -19}deg)`;
    });
  }

  const FEATURE_SCHEDULE = [
    { index: 6, start: 28.8, end: 29.4 },
    { index: 0, start: 29.4, end: 30.0 },
    { index: 1, start: 30.0, end: 30.6 },
    { index: 2, start: 30.6, end: 31.2 },
    { index: 3, start: 31.2, end: 31.8 },
    { index: 4, start: 31.8, end: 32.4 },
    { index: 5, start: 32.4, end: 33.62 }
  ];
  const FEATURE_CUTS = [29.4, 30.0, 30.6, 31.2, 31.8, 32.4, 33.0];
  function renderFeatures(t, shake) {
    const enter = smooth(t, 28.78, 29.05);
    const exit = smooth(t, 33.3, 33.62);
    showScene(scenes.features, enter * (1 - exit), { s: 1 + exit * .04, blur: exit * 4 });
    const items = $$('.feature-slide');
    let active = null;
    FEATURE_SCHEDULE.forEach((slot) => {
      const el = items[slot.index];
      if (!el) return;
      const v = win(t, slot.start, slot.end, .1, .1);
      if (v > .01) active = { el, slot, v };
      el.style.opacity = String(v);
      el.style.visibility = v > .002 ? 'visible' : 'hidden';
      const local = clamp((t - slot.start) / (slot.end - slot.start), 0, 1);
      el.style.transform = `scale(${(1.04 - .04 * easeOut(local)).toFixed(4)})`;
      const img = el.querySelector('img');
      if (img) img.style.transform = `scale(${(1.06 - .03 * easeOut(local)).toFixed(4)}) translateY(${(-local * 4).toFixed(2)}px)`;
      const copy = el.querySelector('.feature-copy');
      if (copy) copy.style.transform = `translateY(${(1 - easeOutQuart(local * 1.8)) * 35}px)`;
      const numEl = el.querySelector('.feature-num');
      if (numEl) {
        numEl.style.opacity = String(.75);
        numEl.style.transform = `translateY(${(1 - easeOutQuart(local * 2)) * 25}px) scale(${1 + Math.sin(t * 1.2) * .01})`;
      }
    });
    const top = $('.feature-topline');
    top.style.opacity = String(smooth(t, 28.85, 29.15) * (1 - smooth(t, 33.25, 33.55)));
    const cap = $('#featureCaption');
    const capText = t < 29.35 ? 'ليس مجرد لعبة… عالم كامل' : (t > 32.5 ? 'كل التفاصيل… صُنعت لأجلك' : '');
    if (capText) {
      cap.textContent = capText;
      cap.style.opacity = String(win(t, 28.9, 29.35, .18, .15) || win(t, 32.5, 33.45, .2, .2));
    } else {
      cap.style.opacity = '0';
    }
    let cutFlash = 0;
    FEATURE_CUTS.forEach((ct) => {
      const d = t - ct;
      if (d >= 0 && d < .2) cutFlash = Math.max(cutFlash, (1 - d / .2) * .55);
    });
    $('#featureFlash').style.opacity = String(cutFlash);
    const eq = $$('#musicEq i');
    eq.forEach((bar, i) => {
      const h = .18 + Math.abs(Math.sin(t * (2.1 + (i % 5) * .31) + i * .7)) * .82;
      bar.style.transform = `scaleY(${h.toFixed(3)})`;
      bar.style.opacity = String(.4 + .45 * h);
    });
    const vinyl = $('.vinyl-ring');
    if (vinyl) vinyl.style.transform = `rotate(${t * 42}deg)`;
    const eqwrap = $('#musicEq');
    if (eqwrap) eqwrap.style.transform = `translateY(${Math.sin(t * 2.1) * 4}px)`;
    if (t > 33.4) {
      flash.style.opacity = String(Math.max(parseFloat(flash.style.opacity || 0), smooth(t, 33.4, 33.62) * .45));
    }
  }

  function renderLetter(t, shake) {
    const enter = smooth(t, 33.55, 33.9);
    const exit = smooth(t, 35.82, 36.08);
    showScene(scenes.letter, enter * (1 - exit), { s: 1 + exit * .055, y: -exit * 25, blur: exit * 6 });
    const paper = $('#letterPaper');
    const pp = smooth(t, 33.68, 34.15);
    paper.style.opacity = String(pp);
    paper.style.transform = `translateX(-50%) translateY(${(1 - easeOutBack(pp)) * 70 - exit * 25}px) scale(${.94 + .06 * easeOut(pp) + exit * .02}) rotate(${(1 - pp) * 1.5}deg)`;
    $('.letter-seal').style.transform = `scale(${.6 + .4 * easeOutBack(smooth(t, 33.82, 34.2))}) rotate(${Math.sin(t * 1.2) * 3}deg)`;
    $('.letter-kicker').style.opacity = String(smooth(t, 33.9, 34.2));
    const h2 = $('.letter-paper h2');
    const hp = smooth(t, 33.98, 34.35);
    h2.style.opacity = String(hp);
    h2.style.transform = `translateY(${(1 - easeOut(hp)) * 32}px)`;
    const body = $('.letter-body');
    body.style.opacity = String(smooth(t, 34.15, 34.5));
    body.style.transform = `translateY(${(1 - easeOut(smooth(t, 34.15, 34.5))) * 20}px)`;
    const rule = $('.letter-rule');
    rule.style.opacity = String(smooth(t, 34.35, 34.7));
    rule.style.transform = `scaleX(${.82 + .18 * easeOut(smooth(t, 34.35, 34.7))})`;
    const final = $('#letterFinal');
    const fp = smooth(t, 34.45, 34.88);
    final.style.opacity = String(fp);
    final.style.transform = `translateY(${(1 - easeOut(fp)) * 24}px) scale(${.97 + .03 * easeOut(fp)})`;
    const sign = $('.letter-sign');
    sign.style.opacity = String(smooth(t, 34.7, 35.05));
    const ps = $('#letterPs');
    const psp = smooth(t, 34.95, 35.35);
    ps.style.opacity = String(psp * .9);
    ps.style.transform = `translateY(${(1 - psp) * 12}px)`;
    const doodle = $('#letterDoodle');
    doodle.style.opacity = String(smooth(t, 35.15, 35.5) * .8);
    const mascot = $('#letterMascot');
    const mp = smooth(t, 34.05, 34.6);
    mascot.style.opacity = String(mp);
    mascot.style.transform = `translateX(${(1 - easeOutBack(mp)) * -50}px) translateY(${Math.sin(t * 1.3) * 4}px) scale(${.9 + .1 * easeOut(mp)})`;
    $$('.letter-fruit').forEach((f, i) => {
      const p = smooth(t, 34.2 + i * .1, 34.6 + i * .1);
      f.style.opacity = String(p);
      f.style.transform = `translateY(${(1 - easeOutBack(p)) * 25}px) rotate(${Math.sin(t * .8 + i) * 7}deg)`;
    });
    $('.letter-small').style.opacity = String(smooth(t, 35.05, 35.4) * (1 - exit));
    const petals = $$('.petal');
    petals.forEach((p, i) => {
      const baseX = parseFloat(p.style.left);
      p.style.translate = `${Math.sin(t * .3 + i) * 24}px ${(t * (6 + i % 5) + i * 11) % 60 - 20}px`;
      p.style.rotate = `${t * (5 + i % 4)}deg`;
    });
    // light expands at the riser
    if (t > 35.3) {
      const glow = smooth(t, 35.3, 35.9);
      document.querySelector('.scene-letter').style.filter = `brightness(${(1 + glow * .25).toFixed(3)}) blur(${exit * 6}px)`;
    } else {
      document.querySelector('.scene-letter').style.filter = exit > 0 ? `blur(${exit * 6}px)` : 'none';
    }
  }

  function renderFinal(t, shake) {
    const enter = smooth(t, 35.94, 36.2);
    const exit = smooth(t, 40.55, 40.86);
    showScene(scenes.final, enter * (1 - exit), { s: 1 + exit * .05, y: -exit * 25, blur: exit * 6 });
    const lock = $('#finalLockup');
    const lp = smooth(t, 36.08, 36.55);
    const pulse = 1 + .013 * Math.sin((t - 36.4) * 2.2);
    lock.style.opacity = String(lp);
    lock.style.transform = `translateX(-50%) translateY(${(1 - easeOutBack(lp)) * 55}px) scale(${(1.3 - .3 * easeOutBack(lp)) * pulse})`;
    const ch = $('#finalChallenge');
    const cp = smooth(t, 37.08, 37.5);
    ch.style.opacity = String(cp);
    ch.style.transform = `translateY(${(1 - easeOutBack(cp)) * 90}px) scale(${.72 + .28 * easeOutBack(cp)}) rotate(${(1 - cp) * -4}deg)`;
    const cats = $$('.final-cat');
    const catP = smooth(t, 37.45, 37.95);
    cats.forEach((c, i) => {
      c.style.opacity = String(catP);
      c.style.transform = `translateY(${(1 - easeOutBack(catP)) * 100 + Math.sin(t * 1.1 + i) * 5}px) rotate(${(i ? 8 : -8) + Math.sin(t * .8 + i) * 1.5}deg) scale(${.8 + .2 * easeOutBack(catP)})`;
    });
    const play = $('#finalPlay');
    const fp = smooth(t, 38.25, 38.7);
    play.style.opacity = String(fp);
    play.style.transform = `translateX(-50%) translateY(${(1 - easeOutBack(fp)) * 38}px) scale(${.86 + .14 * easeOutBack(fp)})`;
    const cap = $('#finalCaption');
    cap.style.opacity = String(smooth(t, 38.8, 39.2) * (1 - exit));
    const collage = $('#finalCollage');
    collage.style.transform = `scale(${1.05 + (t - 36) * .012}) translateY(${-(t - 36) * 3}px)`;
    $$('.fc').forEach((fc, i) => {
      fc.style.opacity = String((.11 + .08 * enter) * (1 - smooth(t, 39.8, 40.7) * .5));
    });
    document.querySelector('.final-glow').style.transform = `translate(-50%, -50%) scale(${(1 + Math.sin(t * 1.8) * .04).toFixed(3)})`;
  }

  function renderEnd(t, shake) {
    const enter = smooth(t, 40.75, 41.15);
    const fade = smooth(t, 44.1, 44.72);
    showScene(scenes.end, enter, { s: 1 + .015 * (1 - enter) });
    const mark = $('#endMark');
    const mp = smooth(t, 40.95, 41.4);
    mark.style.opacity = String(mp);
    mark.style.transform = `translateX(-50%) translateY(${(1 - easeOutBack(mp)) * 45}px) scale(${.92 + .08 * easeOut(mp)})`;
    const emb = $('#endEmblem');
    emb.style.transform = `scale(${.78 + .22 * easeOutBack(smooth(t, 41.0, 41.5))}) rotate(${Math.sin(t * .9) * 2.5}deg)`;
    const word = $('.end-word');
    const wp = smooth(t, 41.1, 41.65);
    word.style.opacity = String(wp);
    word.style.transform = `translateY(${(1 - easeOut(wp)) * 25}px) scale(${.96 + .04 * easeOut(wp)})`;
    const line = $('#endLine');
    line.style.opacity = String(smooth(t, 41.45, 41.9));
    const rule = $('.end-rule');
    rule.style.opacity = String(smooth(t, 41.6, 42.05));
    const heart = $('#endHeart');
    const hp = smooth(t, 42.0, 42.42);
    heart.style.opacity = String(hp);
    heart.style.transform = `translateX(-50%) translateY(${(1 - easeOutBack(hp)) * 18}px) scale(${.85 + .15 * easeOutBack(hp)})`;
    const cta = $('#endCta');
    const cp = smooth(t, 42.55, 43.0);
    cta.style.opacity = String(cp);
    cta.style.transform = `translateX(-50%) translateY(${(1 - easeOutBack(cp)) * 26}px) scale(${.92 + .08 * easeOutBack(cp)})`;
    const love = $('#endLove');
    love.style.opacity = String(smooth(t, 43.0, 43.4));
    const halo = $('.end-halo');
    halo.style.transform = `translate(-50%, -50%) scale(${1 + Math.sin(t * 1.4) * .035 + (t > 43.2 ? (t - 43.2) * .02 : 0)})`;
    const endEmblem = $('#endEmblem svg');
    if (endEmblem) endEmblem.style.transform = `translateY(${Math.sin(t * 1.3) * 2.5}px) rotate(${Math.sin(t * .9) * 1.2}deg)`;
    $('.end-fade').style.opacity = String(fade);
  }

  function drawGlobal(t) {
    // flash
    let fl = 0, flColor = '#fff7ea';
    FLASHES.forEach((f) => {
      const d = t - f.t;
      if (d >= 0 && d < f.dur) {
        const v = (1 - d / f.dur) * f.a;
        if (v > fl) { fl = v; flColor = f.color; }
      }
    });
    flash.style.background = flColor;
    flash.style.opacity = String(Math.max(0, Math.min(.9, fl)));
    // shake
    let sx = 0, sy = 0, sr = 0;
    SHAKES.forEach((s) => {
      const d = t - s.t;
      if (d >= 0 && d < s.dur) {
        const env = 1 - d / s.dur;
        const a = s.amp * env * env;
        sx += Math.sin(d * 77 + 1.7) * a;
        sy += Math.cos(d * 61) * a * .7;
        sr += Math.sin(d * 48) * a * .004;
      }
    });
    const shake = { x: sx, y: sy, r: sr };
    stage.style.transform = stageTransform(shake);
    // subtitles
    let subText = '';
    let subIndex = -1;
    SH_CUES.forEach(([a, b, text], i) => {
      if (t >= a && t < b) { subText = text; subIndex = i; }
    });
    if (SUB_OPTIONAL.has(subIndex)) subText = '';
    if (subText) {
      if (lastSubtitle !== subText) {
        subtitleSpan.textContent = subText;
        lastSubtitle = subText;
      }
      const cue = SH_CUES.find((c) => c[2] === subText);
      const localIn = smooth(t, cue[0], cue[0] + .22);
      const localOut = 1 - smooth(t, cue[1] - .2, cue[1]);
      subtitle.style.opacity = String(localIn * localOut);
      subtitle.style.transform = `translateX(-50%) translateY(${(1 - localIn) * 9}px)`;
    } else {
      subtitle.style.opacity = '0';
      if (lastSubtitle !== '') { lastSubtitle = ''; }
    }
    drawParticles(t);
    lightStreaks.style.opacity = '0';
  }

  function seek(tIn) {
    const t = clamp(tIn, 0, DURATION);
    renderEyes(t);
    renderLogo(t);
    renderMenu(t);
    renderFruit(t);
    renderPlay(t);
    renderDuel(t);
    renderPowers(t);
    renderFeatures(t);
    renderLetter(t);
    renderFinal(t);
    renderEnd(t);
    drawGlobal(t);
  }

  function frame(now) {
    if (!playing) return;
    playbackTime = ((now - startTime) / 1000) % DURATION;
    seek(playbackTime);
    raf = requestAnimationFrame(frame);
  }

  function initPreviewControls() {
    if (isCapture) return;
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space') { playing = !playing; if (playing) { startTime = performance.now() - playbackTime * 1000; raf = requestAnimationFrame(frame); } else cancelAnimationFrame(raf); e.preventDefault(); }
      if (e.code === 'ArrowRight') { playbackTime = clamp(playbackTime + 1, 0, DURATION - .01); seek(playbackTime); }
      if (e.code === 'ArrowLeft') { playbackTime = clamp(playbackTime - 1, 0, DURATION - .01); seek(playbackTime); }
    });
    window.addEventListener('resize', () => { fitStage(); seek(playbackTime); });
  }

  makeCats();
  buildDecor();
  fitStage();
  initPreviewControls();
  drawGlobal(0);
  window.TRAILER = {
    seek,
    duration: DURATION,
    ready: (document.fonts && document.fonts.ready) || Promise.resolve()
  };
  if (isCapture) {
    seek(0);
  } else {
    startTime = performance.now();
    raf = requestAnimationFrame(frame);
  }
})();
