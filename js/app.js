/* ══════════════════════════════════════════════════════════════════
   مياو ميموري — Meow Memory
   A complete, hand-built memory action game.
   ══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  /* ───────────────────────────── tiny helpers ───────────────────────────── */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  const num = (n) => String(Math.max(0, Math.round(Number(n) || 0))).replace(/\d/g, (d) => AR_DIGITS[+d]);
  const numF = (n) => String(n).replace(/\d/g, (d) => AR_DIGITS[+d]);
  const prefersReducedMotion = () =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches || !!save.settings.reduceMotion || !!save.settings.reduceMotionManual;

  /* ───────────────────────────── persistence ───────────────────────────── */
  const SAVE_KEY = 'meowMemorySave.v1';
  const defaultSave = {
    version: 1,
    stars: 0,
    totalWins: 0,
    gamesPlayed: 0,
    bestArcade: 0,
    unlocked: ['lulu', 'zaatar'],
    currentCat: 'lulu',
    names: { p1: 'لاعب ١', p2: 'لاعب ٢' },
    settings: {
      music: true,
      sfx: true,
      musicVol: 70,
      sfxVol: 80,
      reduceMotion: false,
      reduceMotionManual: false
    },
    story: {
      unlocked: ['tutorial'],
      completed: [],
      stars: {},
      best: {},
      seenScenes: [],
      seenIntro: false,
      completedStory: false,
      current: 'tutorial'
    },
    launch: {
      supportAnswer: null,
      noticesSeen: false
    },
    secretFound: false
  };

  function deepMerge(base, source) {
    const out = Array.isArray(base) ? base.slice() : { ...base };
    if (!source || typeof source !== 'object') return out;
    Object.keys(source).forEach((key) => {
      if (Array.isArray(base[key]) && Array.isArray(source[key])) out[key] = source[key].slice();
      else if (base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) out[key] = deepMerge(base[key], source[key]);
      else if (typeof source[key] === typeof base[key] || source[key] == null) out[key] = source[key];
    });
    return out;
  }

  function loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return deepMerge(defaultSave, {});
      const parsed = JSON.parse(raw);
      const merged = deepMerge(defaultSave, parsed);
      if (merged.names) {
        if (merged.names.p1 === 'لاعبة ١') merged.names.p1 = 'لاعب ١';
        if (merged.names.p2 === 'لاعبة ٢') merged.names.p2 = 'لاعب ٢';
      }
      merged.unlocked = Array.from(new Set([...(merged.unlocked || []), 'lulu', 'zaatar']));
      if (!MMArt.catById(merged.currentCat)) merged.currentCat = 'lulu';
      return merged;
    } catch (err) {
      return deepMerge(defaultSave, {});
    }
  }

  let save = loadSave();
  let saveTimer = null;
  function persist(immediate = false) {
    if (saveTimer) clearTimeout(saveTimer);
    if (immediate) {
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (err) { /* storage can be unavailable */ }
      return;
    }
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (err) { /* ignore */ }
    }, 220);
  }

  /* ───────────────────────────── shared UI tools ───────────────────────────── */
  const toastStack = $('#toastStack');
  const TOAST_ICONS = {
    star: 'i-star', paw: 'i-paw', heart: 'i-heart', bolt: 'i-bolt', eye: 'i-eye',
    clock: 'i-clock', info: 'i-info', crown: 'i-crown', check: 'i-check',
    lock: 'i-lock', shuffle: 'i-shuffle', sparkle: 'i-sparkle', trophy: 'i-trophy'
  };
  function toast(message, opts = {}) {
    if (!toastStack) return;
    const el = document.createElement('div');
    el.className = `toast${opts.tone === 'gold' ? ' toast--gold' : ''}${opts.tone === 'warm' ? ' toast--warm' : ''}`;
    el.innerHTML = `<svg class="ico"><use href="#${TOAST_ICONS[opts.icon] || 'i-paw'}"/></svg><span>${message}</span>`;
    toastStack.appendChild(el);
    setTimeout(() => {
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 400);
    }, opts.duration || 2800);
    while (toastStack.children.length > 3) toastStack.firstElementChild.remove();
  }

  function addStars(n, opts = {}) {
    if (!n) return;
    save.stars = Math.max(0, Number(save.stars || 0) + n);
    persist(true);
    updateStarUI();
    updateMenuStats();
    if (opts.silent !== true) {
      toast(`<b>+${num(n)}</b> نجمة أُضيفت إلى رصيدك`, { icon: 'star', tone: 'gold' });
    }
  }

  function updateStarUI() {
    $$('[data-stars]').forEach((el) => { el.textContent = num(save.stars); });
    const wardrobeStars = $$('.wardrobe-stars b');
    wardrobeStars.forEach((el) => { el.textContent = num(save.stars); });
  }

  function updateMenuStats() {
    $$('[data-best]').forEach((el) => { el.textContent = num(save.bestArcade || 0); });
    $$('[data-stars]').forEach((el) => { el.textContent = num(save.stars); });
  }

  function renderAvatarTargets(root = document) {
    $$('[data-cat-avatar]', root).forEach((el) => {
      const id = el.getAttribute('data-cat-avatar');
      if (el.dataset.avatarRendered === id) return;
      const cat = MMArt.catById(id);
      el.innerHTML = MMArt.catAvatarSvg(cat);
      el.dataset.avatarRendered = id;
    });
  }

  function renderMascots(root = document) {
    $$('[data-mascot]', root).forEach((el) => {
      if (el.dataset.mascotRendered === 'true') return;
      el.innerHTML = MMArt.mascotSvg;
      el.dataset.mascotRendered = 'true';
    });
  }

  function updateProfileCats() {
    const cat = MMArt.catById(save.currentCat);
    ['.mini-sigil', '.profile-cat'].forEach((sel) => {
      const el = $(sel);
      if (el) {
        el.innerHTML = MMArt.catAvatarSvg(cat);
        el.dataset.avatarRendered = save.currentCat;
      }
    });
    $$('[data-cat-avatar="current"]').forEach((el) => {
      el.innerHTML = MMArt.catAvatarSvg(cat);
    });
  }

  let audioInited = false;
  function initAudio() {
    if (audioInited) return;
    audioInited = true;
    MMAudio.init();
    applySoundSettings();
    MMAudio.setScene('menu');
  }

  function applySoundSettings() {
    MMAudio.setMusicEnabled(save.settings.music);
    MMAudio.setSfxEnabled(save.settings.sfx);
    MMAudio.setMusicVolume(save.settings.musicVol / 100);
    MMAudio.setSfxVolume(save.settings.sfxVol / 100);
    document.body.classList.toggle('is-muted', !save.settings.music);
    document.body.classList.toggle('reduce-motion', !!save.settings.reduceMotion);
    $$('[data-sound-toggle]').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(save.settings.music));
      btn.classList.toggle('is-muted', !save.settings.music);
    });
    syncSettingsInputs();
  }

  function toggleMusic(force) {
    initAudio();
    const next = typeof force === 'boolean' ? force : !save.settings.music;
    if (next === save.settings.music) return;
    save.settings.music = next;
    persist();
    applySoundSettings();
    if (next) {
      MMAudio.unlock();
      MMAudio.playCurrentScene();
      MMAudio.click();
      toast('الموسيقى عادت… استمتع', { icon: 'star', tone: 'warm' });
    } else {
      toast('الموسيقى متوقفة مؤقتًا', { icon: 'info' });
    }
  }

  /* ───────────────────────────── modal manager ───────────────────────────── */
  const modalLayer = $('#modalLayer');
  const modalBackdrop = $('#modalBackdrop');
  const UI = {
    current: null,
    returnModal: null,
    lastFocus: null,
    confirmState: null,
    isOpen() { return !!this.current; },

    open(id, opts = {}) {
      const target = document.getElementById(`modal${id.charAt(0).toUpperCase()}${id.slice(1)}`);
      if (!target) return;
      if (this.current === 'trailer' && id !== 'trailer') this.closeTrailer();
      if (!modalLayer.classList.contains('is-open')) {
        this.lastFocus = document.activeElement;
        modalLayer.classList.add('is-open');
        document.body.classList.add('modal-open');
      }
      if (this.current && this.current !== 'confirm') {
        const prev = document.getElementById(`modal${this.current.charAt(0).toUpperCase()}${this.current.slice(1)}`);
        if (prev) prev.classList.remove('is-open');
      }
      $$('.modal.is-open').forEach((m) => { if (m.id !== 'modalConfirm') m.classList.remove('is-open'); });
      this.current = id;
      this.returnModal = opts.returnModal || null;
      target.classList.add('is-open');
      target.setAttribute('aria-hidden', 'false');
      target.scrollTop = 0;
      const focusTarget = target.querySelector('.modal-close, button, input');
      if (focusTarget) setTimeout(() => focusTarget.focus({ preventScroll: true }), 80);

      if (id === 'modes') this.prepareModes();
      if (id === 'wardrobe') this.prepareWardrobe();
      if (id === 'settings') syncSettingsInputs();
      if (id === 'trailer') this.openTrailer();
      if (id === 'pause') window.MMGame?.openPauseUI();
      if (id === 'setup') this.prepareSetupInfo();
    },

    close(opts = {}) {
      const current = this.current;
      if (!current) return;
      if (current === 'trailer') this.closeTrailer();
      if (current === 'pause' && window.MMGame?.state && window.MMGame.state.paused && !opts.fromReturn) {
        window.MMGame.resume({ silent: true });
      }
      if (this.returnModal && !opts.skipReturn) {
        const next = this.returnModal;
        this.returnModal = null;
        this.current = null;
        this.open(next, { returnModal: null });
        return;
      }
      $$('.modal.is-open').forEach((m) => m.classList.remove('is-open'));
      modalLayer.classList.remove('is-open');
      document.body.classList.remove('modal-open');
      this.current = null;
      this.returnModal = null;
      MMAudio.unduckMusic('modal');
      if (this.lastFocus && this.lastFocus.focus) {
        try { this.lastFocus.focus({ preventScroll: true }); } catch (err) { /* ignore */ }
      }
    },

    closeAll() {
      this.confirmState = null;
      const confirm = $('#modalConfirm');
      if (confirm) confirm.classList.remove('is-open');
      $$('.modal.is-open').forEach((m) => m.classList.remove('is-open'));
      modalLayer.classList.remove('is-open');
      document.body.classList.remove('modal-open');
      if (this.current === 'trailer') this.closeTrailer();
      this.current = null;
      this.returnModal = null;
      MMAudio.unduckMusic('modal');
    },

    prepareModes() {
      renderAvatarTargets($('#modalModes'));
    },

    prepareSetupInfo() {
      /* the actual setup markup is built by buildSetup() */
    },

    confirm(options) {
      const opts = Object.assign({
        title: 'هل أنت متأكد؟',
        text: 'سيُفقد تقدم هذه الجولة.',
        confirmLabel: 'نعم، أكّد',
        cancelLabel: 'تراجع',
        icon: 'i-info',
        onConfirm: () => {}
      }, options || {});
      this.confirmState = opts;
      const modal = $('#modalConfirm');
      $('#confirmTitle').textContent = opts.title;
      $('#confirmText').textContent = opts.text;
      $('#confirmYes').textContent = opts.confirmLabel;
      $('#confirmCancel').textContent = opts.cancelLabel;
      $('#confirmIcon').innerHTML = `<svg class="ico"><use href="#${opts.icon}"/></svg>`;
      if (!modalLayer.classList.contains('is-open')) {
        modalLayer.classList.add('is-open');
        document.body.classList.add('modal-open');
      }
      modal.classList.add('is-open');
      modal.setAttribute('aria-hidden', 'false');
      $('#confirmCancel').focus({ preventScroll: true });
    },

    confirmClose() {
      const modal = $('#modalConfirm');
      modal.classList.remove('is-open');
      modal.setAttribute('aria-hidden', 'true');
      this.confirmState = null;
      if (!this.current) {
        modalLayer.classList.remove('is-open');
        document.body.classList.remove('modal-open');
      }
    },

    confirmAccept() {
      const cb = this.confirmState && this.confirmState.onConfirm;
      this.confirmClose();
      if (cb) cb();
    },

    /* tracker video */
    openTrailer() {
      MMAudio.pauseMusic();
      const video = $('#trailerVideo');
      const tap = $('#videoTap');
      if (!video) return;
      tap.classList.remove('is-hidden');
      video.muted = false;
      video.loop = true;
      video.currentTime = 0;
      $('#videoMute').innerHTML = `<svg class="ico"><use href="#i-sound"/></svg>`;
      const playPromise = video.play();
      if (playPromise && playPromise.then) {
        playPromise.then(() => { tap.classList.add('is-hidden'); }).catch(() => {});
      }
      $('#videoFrame').classList.add('is-playing');
    },

    closeTrailer() {
      const video = $('#trailerVideo');
      if (video) { video.pause(); video.currentTime = 0; }
      MMAudio.resumeMusic();
    },

    prepareWardrobe() {
      renderWardrobe();
    }
  };

  /* mode cards + generic data-open links */
  document.addEventListener('click', (e) => {
    const opener = e.target.closest('[data-open]');
    if (opener) {
      e.preventDefault();
      const id = opener.getAttribute('data-open');
      let returnModal = null;
      if (UI.current === 'pause' && (id === 'guide' || id === 'settings')) returnModal = 'pause';
      if (UI.current === 'modes' && id === 'guide') returnModal = 'modes';
      if (id === 'modes') returnModal = null;
      if (id === 'pause') returnModal = null;
      UI.open(id, { returnModal });
      return;
    }
    const closer = e.target.closest('[data-close]');
    if (closer) {
      e.preventDefault();
      UI.close();
      return;
    }
    const modeBtn = e.target.closest('[data-mode]');
    if (modeBtn) {
      const mode = modeBtn.getAttribute('data-mode');
      UI.open('setup', { returnModal: null });
      buildSetup(mode);
      return;
    }
  });

  modalBackdrop.addEventListener('click', () => {
    if (UI.confirmState) { UI.confirmClose(); return; }
    UI.close();
  });

  $('#confirmCancel').addEventListener('click', () => UI.confirmClose());
  $('#confirmYes').addEventListener('click', () => UI.confirmAccept());

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (UI.confirmState) { UI.confirmClose(); return; }
      if (UI.isOpen()) {
        if (UI.current === 'setup') { UI.open('modes'); return; }
        UI.close();
      }
      return;
    }
    if (!UI.isOpen() || e.key !== 'Tab') return;
    const activeDialog = $('#modalConfirm').classList.contains('is-open')
      ? $('#modalConfirm')
      : $(`.modal.is-open`);
    if (!activeDialog) return;
    const focusables = $$('button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex="-1"])', activeDialog)
      .filter((el) => el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  function syncSettingsInputs() {
    const music = $('#musicVolume');
    const sfx = $('#sfxVolume');
    if (music) {
      music.value = save.settings.musicVol;
      music.style.setProperty('--fill', save.settings.musicVol + '%');
      $('#musicVolLabel').textContent = `${num(save.settings.musicVol)}٪`;
    }
    if (sfx) {
      sfx.value = save.settings.sfxVol;
      sfx.style.setProperty('--fill', save.settings.sfxVol + '%');
      $('#sfxVolLabel').textContent = `${num(save.settings.sfxVol)}٪`;
    }
    const musicSwitch = $('#musicSwitch');
    const sfxSwitch = $('#sfxSwitch');
    const motionSwitch = $('#motionSwitch');
    if (musicSwitch) musicSwitch.setAttribute('aria-checked', String(!!save.settings.music));
    if (sfxSwitch) sfxSwitch.setAttribute('aria-checked', String(!!save.settings.sfx));
    if (motionSwitch) motionSwitch.setAttribute('aria-checked', String(!!save.settings.reduceMotion));
    const motionLabel = $('#motionLabel');
    if (motionLabel) motionLabel.textContent = save.settings.reduceMotion ? 'هادئة' : 'ممتعة';
  }

  /* settings interactions */
  $('#musicVolume')?.addEventListener('input', (e) => {
    save.settings.musicVol = +e.target.value;
    if (!save.settings.music && save.settings.musicVol > 0) { save.settings.music = true; }
    e.target.style.setProperty('--fill', save.settings.musicVol + '%');
    $('#musicVolLabel').textContent = `${num(save.settings.musicVol)}٪`;
    applySoundSettings();
    persist();
  });
  $('#sfxVolume')?.addEventListener('input', (e) => {
    save.settings.sfxVol = +e.target.value;
    if (!save.settings.sfx && save.settings.sfxVol > 0) { save.settings.sfx = true; }
    e.target.style.setProperty('--fill', save.settings.sfxVol + '%');
    $('#sfxVolLabel').textContent = `${num(save.settings.sfxVol)}٪`;
    applySoundSettings();
    MMAudio.tick(false);
    persist();
  });
  $('#musicSwitch')?.addEventListener('click', () => {
    save.settings.music = !save.settings.music;
    if (save.settings.music) { initAudio(); MMAudio.unlock(); }
    applySoundSettings();
    persist(true);
    syncSettingsInputs();
    if (save.settings.music) { MMAudio.unlock(); MMAudio.playCurrentScene(); MMAudio.star(); }
  });
  $('#sfxSwitch')?.addEventListener('click', () => {
    save.settings.sfx = !save.settings.sfx;
    applySoundSettings();
    persist(true);
    syncSettingsInputs();
    if (save.settings.sfx) { MMAudio.unlock(); MMAudio.click(); }
  });
  $('#motionSwitch')?.addEventListener('click', () => {
    save.settings.reduceMotion = !save.settings.reduceMotion;
    document.body.classList.toggle('reduce-motion', !!save.settings.reduceMotion);
    applySoundSettings();
    persist(true);
    syncSettingsInputs();
    MMAudio.click();
  });
  $('#btnResetProgress')?.addEventListener('click', () => {
    UI.confirm({
      title: 'نبدأ من جديد؟',
      text: 'ستُحذف النجوم، أفضل نتيجة، والقطط المفتوحة. ستبقى إعدادات الصوت والحركة كما هي.',
      confirmLabel: 'نعم، ابدأ من جديد',
      cancelLabel: 'لا، احتفظ بتقدمي',
      icon: 'i-refresh',
      onConfirm: () => {
        const settings = save.settings;
        save = deepMerge(defaultSave, { settings });
        persist(true);
        updateStarUI();
        updateProfileCats();
        applySoundSettings();
        renderWardrobe();
        toast('بدأت صفحة جديدة… بالتوفيق!', { icon: 'sparkle', tone: 'warm' });
      }
    });
  });

  $$('[data-sound-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      initAudio();
      toggleMusic();
    });
  });

  /* document-wide clickable feedback: soft click + ripple + tiny note for menu fruit */
  const buttonClickSfx = (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    initAudio();
    if (!btn.classList.contains('memory-card') && !btn.classList.contains('float-fruit') && !btn.disabled) {
      MMAudio.click();
      const ripple = document.createElement('span');
      ripple.className = 'btn-ripple';
      const rect = btn.getBoundingClientRect();
      ripple.style.left = `${e.clientX - rect.left}px`;
      ripple.style.top = `${e.clientY - rect.top}px`;
      btn.appendChild(ripple);
      setTimeout(() => ripple.remove(), 700);
    }
  };
  document.addEventListener('click', buttonClickSfx, true);

  /* ───────────────────────────── boot & chrome ───────────────────────────── */
  function initBoot() {
    const boot = $('#boot');
    const hide = () => {
      if (boot) boot.classList.add('is-gone');
      setTimeout(() => boot && boot.remove(), 900);
      document.body.classList.add('ready');
    };
    const minDelay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 200 : 1100;
    Promise.race([
      (document.fonts && document.fonts.ready) || Promise.resolve(),
      new Promise((resolve) => setTimeout(resolve, 1500))
    ]).then(() => setTimeout(hide, minDelay));
    // capture mode skips the intro and can be used for marketing stills
    if (new URLSearchParams(location.search).has('capture')) {
      setTimeout(() => hide(), 60);
    }
    $('#boot')?.addEventListener('click', hide);
  }

  function initAmbientDecor() {
    const host = $('#ambientDeco');
    if (!host) return;
    const fragments = [];
    const orbs = [
      { left: '8%', top: '18%', size: 16, o: .5 },
      { left: '90%', top: '30%', size: 11, o: .42 },
      { left: '21%', top: '75%', size: 22, o: .22 },
      { left: '74%', top: '83%', size: 14, o: .5 },
      { left: '55%', top: '12%', size: 9, o: .4 },
      { left: '36%', top: '42%', size: 7, o: .2 }
    ];
    orbs.forEach((orb, i) => {
      fragments.push(`<span class="deco-orb" style="left:${orb.left};top:${orb.top};width:${orb.size}px;height:${orb.size}px;opacity:${orb.o};animation:deco-twinkle ${6 + i}s ${-i * .8}s ease-in-out infinite"></span>`);
    });
    const stars = [
      [12, 31, 11, -1], [84, 12, 16, -2.4], [7, 64, 8, -3.1], [93, 63, 13, -1.7],
      [45, 84, 10, -4.2], [67, 5, 8, -2.8], [29, 10, 7, -3.7], [78, 44, 10, -5.1],
      [16, 88, 14, -2.1], [97, 24, 8, -4.5]
    ];
    stars.forEach(([l, t, size, delay]) => {
      fragments.push(`<span class="deco-star" style="left:${l}%;top:${t}%;font-size:${size}px;animation-delay:${delay}s">✦</span>`);
    });
    const cards = [
      [11, 55, -18, .11], [89, 76, 14, .07], [49, 92, -7, .06], [72, 19, 21, .08]
    ];
    cards.forEach(([l, t, r, op]) => {
      fragments.push(`<span class="deco-mini-card" style="left:${l}%;top:${t}%;transform:rotate(${r}deg);opacity:${op}">
        <svg class="ico"><use href="#i-paw"/></svg></span>`);
    });
    const paws = [[84, 54, -20], [18, 38, 16], [42, 18, -8], [66, 68, 28]];
    paws.forEach(([l, t, r]) => {
      fragments.push(`<span class="deco-paw" style="left:${l}%;top:${t}%;transform:rotate(${r}deg)"><svg class="ico" style="width:100%;height:100%"><use href="#i-paw"/></svg></span>`);
    });
    host.innerHTML = fragments.join('');
  }

  /* soft living dust canvas, pointer influenced */
  function initAmbientCanvas() {
    const canvas = $('#ambientCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let w = 0, h = 0, dpr = 1;
    let particles = [];
    let pointer = { x: -1000, y: -1000 };
    let raf = null;
    let active = true;

    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = w < 640 ? 26 : 48;
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: rand(.7, 2.6),
        vx: rand(-.08, .08),
        vy: rand(-.16, -.035),
        a: rand(.12, .54),
        hue: pick(['255,247,232', '248,215,195', '207,191,224', '209,226,241']),
        phase: rand(0, Math.PI * 2)
      }));
    };
    const draw = (time) => {
      if (!active) return;
      ctx.clearRect(0, 0, w, h);
      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.phase += .008;
        const dx = p.x - pointer.x;
        const dy = p.y - pointer.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 22000) {
          const d = Math.sqrt(d2) || 1;
          p.x += (dx / d) * .35;
          p.y += (dy / d) * .35;
        }
        if (p.y < -12) { p.y = h + 10; p.x = Math.random() * w; }
        if (p.x < -12) p.x = w + 10;
        if (p.x > w + 12) p.x = -10;
        const twinkle = .75 + .25 * Math.sin(time * .001 + p.phase);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * twinkle, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.hue},${p.a * twinkle})`;
        ctx.fill();
      });
      raf = requestAnimationFrame(draw);
    };
    window.addEventListener('pointermove', (e) => { pointer.x = e.clientX; pointer.y = e.clientY; }, { passive: true });
    window.addEventListener('pointerleave', () => { pointer.x = -1000; pointer.y = -1000; });
    window.addEventListener('resize', resize, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { active = false; cancelAnimationFrame(raf); }
      else if (!active) { active = true; raf = requestAnimationFrame(draw); }
    });
    resize();
    if (!prefersReducedMotion()) raf = requestAnimationFrame(draw);
  }

  /* cursor glow + magnetic buttons + parallax */
  function initPointerMagic() {
    const glow = $('#cursorGlow');
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (glow && finePointer) {
      let rx = window.innerWidth / 2, ry = window.innerHeight / 2, gx = rx, gy = ry;
      window.addEventListener('pointermove', (e) => {
        rx = e.clientX; ry = e.clientY;
        glow.classList.add('is-on');
        gx += (rx - gx) * .09;
        gy += (ry - gy) * .09;
        glow.style.transform = `translate(${gx}px, ${gy}px)`;
      }, { passive: true });
      window.addEventListener('pointerleave', () => glow.classList.remove('is-on'));
      const follow = () => {
        gx += (rx - gx) * .1; gy += (ry - gy) * .1;
        glow.style.transform = `translate(${gx}px, ${gy}px)`;
        requestAnimationFrame(follow);
      };
      requestAnimationFrame(follow);
    }

    const magnetics = $$('.magnetic');
    if (finePointer) {
      magnetics.forEach((el) => {
        el.addEventListener('pointermove', (e) => {
          if (prefersReducedMotion()) return;
          const r = el.getBoundingClientRect();
          const x = clamp((e.clientX - r.left - r.width / 2) * .055, -4, 4);
          const y = clamp((e.clientY - r.top - r.height / 2) * .07, -4, 4);
          el.style.translate = `${x}px ${y}px`;
        });
        el.addEventListener('pointerleave', () => { el.style.translate = '0px 0px'; });
      });

      const stage = document.getElementById('mascotStage');
      const art = document.querySelector('.hero-art');
      if (stage && art) {
        art.addEventListener('pointermove', (e) => {
          if (prefersReducedMotion()) return;
          const r = art.getBoundingClientRect();
          const x = (e.clientX - r.left) / r.width - .5;
          const y = (e.clientY - r.top) / r.height - .5;
          stage.style.transform = `perspective(900px) rotateX(${(-y * 3.2).toFixed(2)}deg) rotateY(${(x * 4).toFixed(2)}deg) translate3d(${(x * 8).toFixed(1)}px, ${(y * 5).toFixed(1)}px, 0)`;
          const pb = document.querySelector('.speech-bubble');
          if (pb) pb.style.translate = `${(x * -4).toFixed(1)}px ${(y * -3).toFixed(1)}px`;
        });
        art.addEventListener('pointerleave', () => {
          stage.style.transform = '';
          const pb = document.querySelector('.speech-bubble');
          if (pb) pb.style.translate = '';
        });
      }
    }
  }

  /* menu sound / interactivity */
  const MASCOT_LINES = [
    'جاهز للتحدي؟',
    'تذكر مكان الفراولة…',
    'زعتر يظن أنه سيفوز. مسكينة!',
    'قلبي يخفق مثل المؤقت!',
    'هل نلعب جولة سريعة؟',
    'الفواكه هنا… والنجوم هناك!',
    'أنا معك… دائمًا.'
  ];
  const FRUIT_NOTES = { strawberry: 587.33, orange: 659.25, grapes: 783.99, banana: 880, cherry: 987.77 };
  let mascotLineIndex = 0;
  let secretClicks = new Set();

  function initMenuInteractions() {
    const mascotBtn = document.getElementById('mascotBtn');
    const bubble = document.getElementById('mascotSpeech');
    if (mascotBtn) {
      mascotBtn.addEventListener('click', () => {
        initAudio();
        MMAudio.meow();
        mascotBtn.classList.remove('is-meowing');
        void mascotBtn.offsetWidth;
        mascotBtn.classList.add('is-meowing');
        setTimeout(() => mascotBtn.classList.remove('is-meowing'), 750);
        if (bubble) {
          bubble.classList.remove('is-popping');
          void bubble.offsetWidth;
          bubble.classList.add('is-popping');
          bubble.querySelector('span').textContent = MASCOT_LINES[mascotLineIndex++ % MASCOT_LINES.length];
        }
        spawnHearts(mascotBtn, randInt(2, 4));
      });
    }

    $$('.float-fruit').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        initAudio();
        const fruit = btn.dataset.fruit;
        const note = FRUIT_NOTES[fruit] || 660;
        MMAudio.reverbTone({ freq: note, dur: .55, vol: .06, pan: rand(-.4, .4) });
        MMAudio.reverbTone({ freq: note * 1.25, dur: .35, vol: .025, when: .08, pan: rand(-.3, .3) });
        spawnHearts(btn, 2);
        spawnNote(btn, fruit === 'grapes' ? '♪' : pick(['✦', '♪', '✧']));
        secretClicks.add(fruit);
        if (!save.secretFound && secretClicks.size >= 5) {
          save.secretFound = true;
          addStars(10, { silent: false });
          MMAudio.reward();
          if (bubble) {
            bubble.classList.add('is-warm');
            bubble.querySelector('span').textContent = 'لقيت سر لولو! خذ ١٠ نجوم ✦';
            setTimeout(() => {
              bubble.classList.remove('is-warm');
              bubble.querySelector('span').textContent = 'جاهز للتحدي؟';
            }, 4200);
          }
          spawnHearts(btn, 8);
          toast('سر لولو: لعبت مع كل الفواكه… <b>+١٠ نجوم</b>', { icon: 'star', tone: 'gold', duration: 4200 });
        }
      });
    });
  }

  function spawnHearts(anchor, count = 3) {
    if (prefersReducedMotion() || !anchor) return;
    const r = anchor.getBoundingClientRect();
    for (let i = 0; i < count; i++) {
      const el = document.createElement('span');
      el.className = 'heart-pop';
      el.innerHTML = '<svg class="ico"><use href="#i-heart"/></svg>';
      el.style.left = `${r.left + r.width / 2 + rand(-r.width * .3, r.width * .3)}px`;
      el.style.top = `${r.top + r.height * .35}px`;
      el.style.setProperty('--dx', `${rand(-34, 34)}px`);
      el.style.setProperty('--rot', `${rand(-25, 25)}deg`);
      el.style.animationDelay = `${i * 65}ms`;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 1500);
    }
  }

  function spawnNote(anchor, symbol = '♪') {
    if (prefersReducedMotion() || !anchor) return;
    const r = anchor.getBoundingClientRect();
    const el = document.createElement('span');
    el.className = 'note-pop';
    el.textContent = symbol;
    el.style.left = `${r.left + r.width / 2}px`;
    el.style.top = `${r.top + 6}px`;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1600);
  }

  /* ambient reactive click sparkles on empty menu space */
  function initBackgroundClicks() {
    document.addEventListener('pointerdown', (e) => {
      if (!document.getElementById('screen-menu').classList.contains('is-active')) return;
      if (e.target.closest('button, a, input, .modal')) return;
      if (prefersReducedMotion()) return;
      const n = randInt(3, 6);
      for (let i = 0; i < n; i++) {
        const bit = document.createElement('span');
        bit.className = 'spark-burst';
        bit.style.left = e.clientX + 'px';
        bit.style.top = e.clientY + 'px';
        bit.style.setProperty('--dx', `${rand(-55, 55)}px`);
        bit.style.setProperty('--dy', `${rand(-45, 30)}px`);
        bit.style.background = pick(['#eac06a', '#dba6b0', '#c4acdb', '#fff8eb']);
        bit.style.animationDelay = `${i * 18}ms`;
        document.body.appendChild(bit);
        setTimeout(() => bit.remove(), 900);
      }
      MMAudio.reverbTone({ freq: rand(780, 1100), dur: .3, vol: .02, pan: (e.clientX / innerWidth - .5) });
    }, { passive: true });
  }

  /* ───────────────────────────── setup flow ───────────────────────────── */
  const setupState = {
    mode: 'duel',
    p1Cat: 'lulu',
    p2Cat: 'zaatar',
    p1Name: 'لاعب ١',
    p2Name: 'لاعب ٢',
    difficulty: 'medium'
  };
  const DIFFICULTY = {
    easy: { label: 'هادئ', hint: 'زعتر يتذكر قليلًا', knownPairChance: .2, followChance: .44, think: 950, firstThink: 1050, memoryChance: .45 },
    medium: { label: 'محترف', hint: 'زعتر لا ينسى بسهولة', knownPairChance: .56, followChance: .78, think: 680, firstThink: 780, memoryChance: .75 },
    hard: { label: 'أسطوري', hint: 'زعتر يتذكر كل شيء', knownPairChance: .85, followChance: .96, think: 430, firstThink: 520, memoryChance: .96 }
  };

  function pickDifferentCat(preferred) {
    const unlocked = save.unlocked.filter((id) => MMArt.catById(id));
    if (!unlocked.includes(preferred) || preferred === setupState.p1Cat) {
      return unlocked.find((id) => id !== setupState.p1Cat) || (save.unlocked.includes(save.currentCat) ? save.currentCat : 'lulu');
    }
    return preferred;
  }

  function catDotsMarkup(selected, slot) {
    return `<div class="cat-dots" role="group" aria-label="اختر القطة">${MMArt.cats.map((cat) => {
      const unlocked = save.unlocked.includes(cat.id);
      return `<button type="button" class="cat-dot${cat.id === selected ? ' is-selected' : ''}${unlocked ? '' : ' is-locked'}" style="--swatch:${cat.swatch}" data-cat-pick="${cat.id}" data-slot="${slot}" aria-label="${cat.name}${unlocked ? '' : ' — مقفلة'}" aria-pressed="${cat.id === selected}" title="${cat.name}${unlocked ? '' : ` • ${cat.need} نجمة`}">${MMArt.catAvatarSvg(cat)}</button>`;
    }).join('')}</div>`;
  }

  function setupPlayerMarkup(slot) {
    const catId = slot === 0 ? setupState.p1Cat : setupState.p2Cat;
    const cat = MMArt.catById(catId);
    const name = slot === 0 ? setupState.p1Name : setupState.p2Name;
    return `<section class="setup-player ${slot === 0 ? 'is-primary' : 'is-rival'}" data-setup-slot="${slot}">
      <div class="setup-player-head">
        <span class="setup-player-label">${slot === 0 ? 'اللاعب الأول' : 'اللاعب الثاني'}<b>${escapeHtml(name)}</b></span>
        <span class="setup-badge">${slot === 0 ? 'أنت' : 'على نفس الجهاز'}</span>
      </div>
      <div class="setup-player-top">
        <div class="setup-avatar-wrap" data-setup-avatar="${slot}">${MMArt.catAvatarSvg(cat)}</div>
        <div class="setup-picker-wrap">
          <label class="setup-input-label" for="setup-name-${slot}">الاسم على الشاشة</label>
          <input class="setup-name-input" id="setup-name-${slot}" data-name-input="${slot}" maxlength="14" value="${escapeHtml(name)}" placeholder="اكتب اسمًا" autocomplete="off">
          ${catDotsMarkup(catId, slot)}
        </div>
      </div>
      <p class="setup-trait"><b>${cat.name}</b> — ${cat.trait}. ${slot === 0 ? 'قلبك هو الأسرع.' : 'منافس ودّي… حتى الآن.'}</p>
    </section>`;
  }

  function setupRivalMarkup() {
    const cat = MMArt.catById(setupState.p2Cat);
    return `<section class="setup-player is-rival setup-rival">
      <div class="setup-player-head">
        <span class="setup-player-label">الخصم<b>زعتر</b></span>
        <span class="setup-badge">قطّ آلي</span>
      </div>
      <div class="setup-player-top">
        <div class="setup-avatar-wrap">${MMArt.catAvatarSvg(cat)}</div>
        <div class="setup-picker-wrap">
          <span class="setup-input-label">مستوى الذكاء</span>
          <div class="ai-levels" role="group" aria-label="مستوى ذكاء زعتر">
            ${Object.entries(DIFFICULTY).map(([key, d]) => `<button type="button" class="ai-level${setupState.difficulty === key ? ' is-selected' : ''}" data-difficulty="${key}" aria-pressed="${setupState.difficulty === key}">${d.label}<small>${key === 'easy' ? 'هادئ' : key === 'medium' ? 'ذكي' : 'خارق'}</small></button>`).join('')}
          </div>
        </div>
      </div>
      <p class="setup-opponent-note"><svg class="ico"><use href="#i-info"/></svg> ${DIFFICULTY[setupState.difficulty].hint}. يتذكر ما يراه، ولا يغفر الخطأ.</p>
    </section>`;
  }

  function arcadeBriefMarkup() {
    return `<aside class="arcade-brief">
      <div class="arcade-brief-head">
        <span class="arcade-badge"><svg class="ico"><use href="#i-bolt"/></svg> ضد الساعة</span>
      </div>
      <h3>تحدي البرق</h3>
      <p>طابق أكبر عدد من الأزواج في ٧٠ ثانية. المطابقة تضيف وقتًا، الخطأ يسرق منه، والسلسلة تضاعف النقاط.</p>
      <div class="arcade-goals">
        <span class="arcade-goal"><svg class="ico"><use href="#i-clock"/></svg> ٧٠ ثانية</span>
        <span class="arcade-goal"><svg class="ico"><use href="#i-bolt"/></svg> مضاعف ×٥</span>
        <span class="arcade-goal"><svg class="ico"><use href="#i-star"/></svg> نجوم</span>
      </div>
      <div class="arcade-best"><svg class="ico" style="width:16px;height:16px;color:#b9863c"><use href="#i-trophy"/></svg> أفضل نتيجة حتى الآن <b>${num(save.bestArcade)}</b></div>
      <div class="arcade-fruits">
        <img src="assets/img/fruits/lemon.svg" alt=""><img src="assets/img/fruits/watermelon.svg" alt=""><img src="assets/img/fruits/pineapple.svg" alt=""><img src="assets/img/fruits/orange.svg" alt=""><img src="assets/img/fruits/strawberry.svg" alt="">
      </div>
    </aside>`;
  }

  function updateSetupSummary() {
    const summary = $('#setupSummary');
    const start = $('#btnStartGame .btn-label');
    if (!summary) return;
    if (setupState.mode === 'duel') {
      summary.innerHTML = `<svg class="ico"><use href="#i-users"/></svg> <b>${escapeHtml(setupState.p1Name)}</b> ضد <b>${escapeHtml(setupState.p2Name)}</b> <span>— ١٥ زوجًا من الفواكه</span>`;
      if (start) start.textContent = 'هيا نلعب';
    } else if (setupState.mode === 'ai') {
      summary.innerHTML = `<svg class="ico"><use href="#i-bot"/></svg> <b>${escapeHtml(setupState.p1Name)}</b> ضد <b>زعتر</b> <span>— مستوى ${DIFFICULTY[setupState.difficulty].label}</span>`;
      if (start) start.textContent = 'تحدّي زعتر';
    } else {
      summary.innerHTML = `<svg class="ico"><use href="#i-bolt"/></svg> <b>${escapeHtml(setupState.p1Name)}</b> <span>— ٧٠ ثانية من البرق، وأفضل نتيجة ${num(save.bestArcade)}</span>`;
      if (start) start.textContent = 'أشعل البرق';
    }
  }

  function buildSetup(mode) {
    setupState.mode = mode || setupState.mode;
    setupState.p1Cat = save.unlocked.includes(save.currentCat) ? save.currentCat : 'lulu';
    setupState.p1Name = save.names.p1 || 'لاعب ١';
    setupState.p2Name = save.names.p2 || 'لاعب ٢';
    setupState.p2Cat = save.unlocked.includes('zaatar') && setupState.p1Cat !== 'zaatar' ? 'zaatar' : pickDifferentCat('mishmish');
    setupState.difficulty = setupState.difficulty || 'medium';
    const kicker = $('#setupKicker');
    const sub = $('#setupSub');
    const head = $('#setupTitle');
    if (setupState.mode === 'duel') {
      kicker.innerHTML = '<span class="kicker-line"></span> مواجهة الأصدقاء';
      head.textContent = 'من سيصنع الذكريات؟';
      sub.textContent = 'لاعبان، لوحة واحدة، وقلب واحد سريع. اختر القطة والاسم… ثم اترك المخالب تتكلم.';
    } else if (setupState.mode === 'ai') {
      kicker.innerHTML = '<span class="kicker-line"></span> تحدي زعتر';
      head.textContent = 'أمام مرآة القط الذكي';
      sub.textContent = 'اختر قواك، ثم حدد مستوى ذكاء زعتر. تذكر: هو يرى كل بطاقة تُقلب.';
    } else {
      kicker.innerHTML = '<span class="kicker-line"></span> تحدي البرق';
      head.textContent = 'سبعون ثانية… وقلب واحد';
      sub.textContent = 'اختر القطة واسمك، ثم استعد لموجات سريعة من الفواكه والنقاط.';
    }
    renderSetup();
  }

  function renderSetup() {
    const content = $('#setupContent');
    if (!content) return;
    if (setupState.mode === 'duel') {
      content.innerHTML = `<div class="setup-duo">
        ${setupPlayerMarkup(0)}
        <div class="setup-vs">VS</div>
        ${setupPlayerMarkup(1)}
      </div>`;
    } else if (setupState.mode === 'ai') {
      content.innerHTML = `<div class="setup-duo setup-duo-ai">
        ${setupPlayerMarkup(0)}
        <div class="setup-vs">VS</div>
        ${setupRivalMarkup()}
      </div>`;
    } else {
      content.innerHTML = `<div class="setup-arcade">
        ${setupPlayerMarkup(0)}
        ${arcadeBriefMarkup()}
      </div>`;
    }
    updateSetupSummary();
    renderAvatarTargets(content);
  }

  const setupContent = $('#setupContent');
  setupContent?.addEventListener('click', (e) => {
    const catBtn = e.target.closest('[data-cat-pick]');
    if (catBtn) {
      const slot = Number(catBtn.dataset.slot);
      const catId = catBtn.dataset.catPick;
      const cat = MMArt.catById(catId);
      if (!save.unlocked.includes(catId)) {
        toast(`<b>${cat.name}</b> مقفلة — تحتاج ${num(cat.need)} نجمة (لديك ${num(save.stars)})`, { icon: 'lock' });
        return;
      }
      if (slot === 0) {
        const old = setupState.p1Cat;
        setupState.p1Cat = catId;
        save.currentCat = catId;
        if (setupState.mode !== 'arcade' && setupState.p2Cat === catId) {
          setupState.p2Cat = old !== catId ? old : pickDifferentCat('mishmish');
        }
        updateProfileCats();
        persist();
      } else {
        if (catId === setupState.p1Cat) {
          toast('كل لاعب يحتاج قطته الخاصة… اختر قطة أخرى', { icon: 'info' });
          return;
        }
        setupState.p2Cat = catId;
      }
      renderSetup();
      MMAudio.click();
      return;
    }
    const diffBtn = e.target.closest('[data-difficulty]');
    if (diffBtn) {
      setupState.difficulty = diffBtn.dataset.difficulty;
      renderSetup();
      MMAudio.click();
    }
  });

  setupContent?.addEventListener('input', (e) => {
    const input = e.target.closest('[data-name-input]');
    if (!input) return;
    const slot = Number(input.dataset.nameInput);
    const value = input.value.slice(0, 14);
    if (slot === 0) setupState.p1Name = value || 'لاعب ١';
    else setupState.p2Name = value || 'لاعب ٢';
    save.names[slot === 0 ? 'p1' : 'p2'] = value;
    updateSetupSummary();
    persist();
    const label = input.closest('.setup-player')?.querySelector('.setup-player-label b');
    if (label) label.textContent = value || (slot === 0 ? 'لاعب ١' : 'لاعب ٢');
  });

  $('#btnStartGame')?.addEventListener('click', () => {
    initAudio();
    const p1Name = (setupState.p1Name || 'لاعب ١').trim().slice(0, 14) || 'لاعب ١';
    const p2Name = (setupState.p2Name || 'لاعب ٢').trim().slice(0, 14) || 'لاعب ٢';
    save.names.p1 = p1Name;
    save.names.p2 = p2Name;
    if (setupState.mode !== 'arcade') save.currentCat = setupState.p1Cat;
    persist(true);
    const config = {
      mode: setupState.mode,
      difficulty: setupState.difficulty,
      players: [
        { name: p1Name, catId: setupState.p1Cat, bot: false },
        {
          name: setupState.mode === 'ai' ? 'زعتر' : p2Name,
          catId: setupState.mode === 'ai' ? setupState.p2Cat : setupState.p2Cat,
          bot: setupState.mode === 'ai'
        }
      ]
    };
    if (setupState.mode === 'arcade') config.players = config.players.slice(0, 1);
    UI.closeAll();
    window.MMGame?.start(config);
  });

  /* ───────────────────────────── wardrobe ───────────────────────────── */
  function renderWardrobe() {
    const grid = $('#catGrid');
    if (!grid) return;
    updateStarUI();
    grid.innerHTML = MMArt.cats.map((cat) => {
      const unlocked = save.unlocked.includes(cat.id);
      const current = save.currentCat === cat.id;
      return `<button class="wardrobe-cat${current ? ' is-current' : ''}${unlocked ? '' : ' is-locked'}" data-wardrobe-cat="${cat.id}" aria-label="${cat.name} ${unlocked ? (current ? '— مختارة حاليًا' : '— اختر') : `— مقفلة بـ ${cat.need} نجمة`}">
        ${unlocked ? '' : '<span class="lock-veil"><svg class="ico"><use href="#i-lock"/></svg></span>'}
        <span class="wardrobe-avatar">${MMArt.catAvatarSvg(cat)}</span>
        <h4>${cat.name}</h4>
        <span class="wardrobe-trait">${cat.trait}</span>
        ${unlocked
          ? `<span class="wardrobe-status">${current ? '<svg class="ico"><use href="#i-check"/></svg> مختارة' : 'اختر'}</span>`
          : `<span class="wardrobe-status"><svg class="ico"><use href="#i-star"/></svg> ${num(cat.need)}</span>`}
      </button>`;
    }).join('');
  }

  function wardrobePick(catId) {
    const cat = MMArt.catById(catId);
    const unlocked = save.unlocked.includes(cat.id);
    if (!unlocked) {
      if (save.stars < cat.need) {
        toast(`تحتاج ${num(cat.need - save.stars)} نجمة إضافية لفتح <b>${cat.name}</b>`, { icon: 'lock' });
        MMAudio.clickDisabled();
        return;
      }
      UI.confirm({
        title: `نفتح قلب ${cat.name}؟`,
        text: `ستستخدم ${num(cat.need)} نجمة من رصيدك. ${cat.trait} وستكون معك في كل الجولات القادمة.`,
        confirmLabel: `افتح ${cat.name}`,
        cancelLabel: 'ليس الآن',
        icon: 'i-heart',
        onConfirm: () => {
          save.stars -= cat.need;
          save.unlocked.push(cat.id);
          save.currentCat = cat.id;
          persist(true);
          updateStarUI();
          updateProfileCats();
          renderWardrobe();
          MMAudio.reward();
          toast(`أهلًا بـ<b>${cat.name}</b> في عائلتك!`, { icon: 'heart', tone: 'warm' });
        }
      });
      return;
    }
    save.currentCat = cat.id;
    persist(true);
    updateProfileCats();
    renderWardrobe();
    MMAudio.meow();
    toast(`<b>${cat.name}</b> ستكون رفيقك في اللعبة`, { icon: 'paw' });
  }

  $('#catGrid')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-wardrobe-cat]');
    if (btn) wardrobePick(btn.dataset.wardrobeCat);
  });

  /* ───────────────────────────── trailer controls ───────────────────────────── */
  const trailerVideo = $('#trailerVideo');
  const videoTap = $('#videoTap');
  if (trailerVideo) {
    const fmtTime = (t) => {
      if (!Number.isFinite(t)) t = 0;
      const m = Math.floor(t / 60);
      const s = Math.floor(t % 60);
      return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    };
    const updateProgress = () => {
      const d = trailerVideo.duration || 45;
      const p = (trailerVideo.currentTime / d) * 100;
      $('#videoProgressFill').style.width = p + '%';
      $('#videoScrubber').style.left = p + '%';
      $('#videoTime').textContent = `${fmtTime(trailerVideo.currentTime)} / ${fmtTime(d)}`;
      $('#videoPlay').innerHTML = trailerVideo.paused
        ? '<svg class="ico"><use href="#i-play"/></svg>'
        : '<svg class="ico"><use href="#i-pause"/></svg>';
    };
    videoTap?.addEventListener('click', () => {
      trailerVideo.play().then(() => videoTap.classList.add('is-hidden')).catch(() => {});
    });
    trailerVideo.addEventListener('timeupdate', updateProgress);
    trailerVideo.addEventListener('loadedmetadata', updateProgress);
    trailerVideo.addEventListener('play', () => { videoTap?.classList.add('is-hidden'); updateProgress(); });
    trailerVideo.addEventListener('pause', updateProgress);
    trailerVideo.addEventListener('ended', () => { videoTap?.classList.remove('is-hidden'); });
    $('#videoPlay')?.addEventListener('click', () => {
      if (trailerVideo.paused) trailerVideo.play().catch(() => {});
      else trailerVideo.pause();
    });
    $('#videoMute')?.addEventListener('click', () => {
      trailerVideo.muted = !trailerVideo.muted;
      $('#videoMute').innerHTML = trailerVideo.muted
        ? '<svg class="ico"><use href="#i-muted"/></svg>'
        : '<svg class="ico"><use href="#i-sound"/></svg>';
    });
    $('#videoFull')?.addEventListener('click', () => {
      const frame = $('#videoFrame');
      if (document.fullscreenElement) document.exitFullscreen?.();
      else frame.requestFullscreen?.().catch(() => {});
    });
    $('#videoProgress')?.addEventListener('click', (e) => {
      const bar = e.currentTarget.getBoundingClientRect();
      const p = clamp((e.clientX - bar.left) / bar.width, 0, 1);
      if (Number.isFinite(trailerVideo.duration)) trailerVideo.currentTime = p * trailerVideo.duration;
    });
    trailerVideo.addEventListener('error', () => {
      if (videoTap) videoTap.innerHTML = '<span class="video-missing">الإعلان قادم خلال لحظات…</span>';
    });
  }

  /* initial paint of shared bits */
  renderMascots();
  renderAvatarTargets();
  updateProfileCats();
  updateStarUI();
  updateMenuStats();
  initAmbientDecor();
  initAmbientCanvas();
  initMenuInteractions();
  initPointerMagic();
  initBackgroundClicks();
  initBoot();
  loadVideosPoster?.();

  /* First real gesture boots the audio graph, then the score can breathe. */
  let audioPrimed = false;
  function primeAudio() {
    if (audioPrimed) return;
    audioPrimed = true;
    initAudio();
    if (save.settings.music) {
      try { MMAudio.unlock(); } catch (err) { /* autoplay restrictions are harmless */ }
    }
  }
  document.addEventListener('pointerdown', primeAudio, true);
  document.addEventListener('keydown', primeAudio, true);
  document.addEventListener('touchstart', primeAudio, true);

  function loadVideosPoster() { /* reserved for future poster generation */ }

  /* expose a small surface for the game engine and for deterministic captures */
  const App = {
    save: () => save,
    persist,
    addStars,
    toast,
    UI,
    renderAvatarTargets,
    updateProfileCats,
    updateStarUI,
    updateMenuStats,
    buildSetup,
    renderWardrobe,
    initAudio,
    toggleMusic
  };
  window.MMApp = App;
  window.MMUI = UI;

  /* Game is defined below and attached by the next script section. */
  window.__MM_APP_READY = true;
})();
