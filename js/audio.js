/* Meow Memory — original score playback + hand-crafted WebAudio sound effects. */
(function () {
  'use strict';

  const AudioCtx = window.AudioContext || window.webkitAudioContext;

  const MMAudio = {
    ctx: null,
    unlocked: false,
    scene: 'menu',
    musicEnabled: true,
    sfxEnabled: true,
    musicVolume: 0.7,
    sfxVolume: 0.8,
    masterMusic: 0.76,
    masterSfx: 0.9,
    activeTrack: null,
    fadeTimers: new Map(),
    lastTickAt: 0,
    _musicElements: {},
    _duckedFor: null,
    storyTheme: null,
    storyAudio: null,
    _storyAudioCache: {},
    storyThemeMap: {
      intro: 'story-intro',
      tutorial: 'story-intro',
      zaatar: 'story-zaatar',
      luz: 'story-luz',
      mishmish: 'story-mishmish',
      zill: 'story-zill',
      bundoq: 'story-bundoq',
      final: 'story-final'
    },

    init() {
      this._musicElements.menu = document.getElementById('musicMenu');
      this._musicElements.game = document.getElementById('musicGame');
      Object.values(this._musicElements).forEach((el) => {
        if (!el) return;
        el.volume = 0;
        el.loop = true;
        el.addEventListener('error', () => {
          /* If a source cannot load, the game still runs silently. */
          console.warn('Meow Memory: audio source unavailable for', el.id);
        });
      });
      this._bindUnlock();
      this._bindVisibility();
    },

    _bindUnlock() {
      const unlock = () => {
        this.unlock();
        document.removeEventListener('pointerdown', unlock, true);
        document.removeEventListener('keydown', unlock, true);
        document.removeEventListener('touchstart', unlock, true);
      };
      document.addEventListener('pointerdown', unlock, true);
      document.addEventListener('keydown', unlock, true);
      document.addEventListener('touchstart', unlock, true);
    },

    _bindVisibility() {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this._wasPlaying = !!(this.activeTrack && !this.activeTrack.paused);
          if (this._wasPlaying) this.activeTrack.pause();
        } else if (this._wasPlaying && this.musicEnabled) {
          this._wasPlaying = false;
          this.playCurrentScene(true);
        }
      });
    },

    unlock() {
      if (this.unlocked) return;
      this.unlocked = true;
      try {
        if (AudioCtx) {
          this.ctx = new AudioCtx();
          if (this.ctx.state === 'suspended') this.ctx.resume();
          this._buildNoise();
        }
      } catch (err) {
        this.ctx = null;
      }
      if (this.musicEnabled) this.playCurrentScene();
    },

    _buildNoise() {
      if (!this.ctx || this.noiseBuffer) return;
      const len = Math.floor(this.ctx.sampleRate * 1.2);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buf;

      const crackleLen = Math.floor(this.ctx.sampleRate * 0.12);
      const crackle = this.ctx.createBuffer(1, crackleLen, this.ctx.sampleRate);
      const cdata = crackle.getChannelData(0);
      for (let i = 0; i < crackleLen; i++) {
        const env = Math.pow(1 - i / crackleLen, 1.7);
        cdata[i] = (Math.random() * 2 - 1) * env;
      }
      this.crackleBuffer = crackle;
    },

    /* ───────────── music ───────────── */
    setMusicEnabled(on) {
      this.musicEnabled = on;
      if (!on) {
        this.fadeTrack(this.activeTrack, 0, 0.4);
        Object.values(this._musicElements).forEach((el) => el && this.fadeTrack(el, 0, 0.3));
      } else {
        this.unlock();
        this.playCurrentScene();
      }
    },

    setSfxEnabled(on) {
      this.sfxEnabled = on;
    },

    setMusicVolume(v) {
      this.musicVolume = Math.max(0, Math.min(1, v));
      if (this.activeTrack && this.musicEnabled) {
        this.activeTrack.volume = this._targetVolume();
      }
    },

    setSfxVolume(v) {
      this.sfxVolume = Math.max(0, Math.min(1, v));
      if (this.masterSfxNode) this.masterSfxNode.gain.value = this.masterSfx * this.sfxVolume;
    },

    _targetVolume() {
      return this.masterMusic * this.musicVolume * 0.86;
    },

    setScene(scene) {
      if (this.scene === scene && !this.storyTheme) return;
      this.scene = scene;
      if (scene === 'menu' && this.storyTheme) {
        const oldStory = this.storyAudio;
        this.storyTheme = null;
        this.storyAudio = null;
        if (oldStory) this.fadeTrack(oldStory, 0, 0.65, true);
      }
      this.playCurrentScene();
    },

    sceneTrackName(scene = this.scene) {
      if (scene === 'game' || scene === 'results') return 'game';
      return 'menu';
    },

    /* Story chapters use their own original loops instead of the menu/game beds. */
    setStoryTheme(chapterId) {
      const theme = this.storyThemeMap[chapterId] || 'story-intro';
      this.storyTheme = theme;
      if (this.musicEnabled) this._playStoryTheme(theme);
    },

    clearStoryTheme() {
      if (!this.storyTheme && !this.storyAudio) return;
      const old = this.storyAudio;
      this.storyTheme = null;
      this.storyAudio = null;
      if (old) this.fadeTrack(old, 0, 0.65, true);
      if (this.activeTrack === old) this.activeTrack = null;
    },

    _ensureStoryAudio(theme) {
      let el = this._storyAudioCache[theme];
      if (el) return el;
      el = new Audio(`assets/audio/${theme}.mp3`);
      el.loop = true;
      el.preload = 'auto';
      el.volume = 0;
      el.addEventListener('error', () => {
        console.warn('Meow Memory: story theme unavailable for', theme);
      });
      this._storyAudioCache[theme] = el;
      return el;
    },

    _playStoryTheme(theme = this.storyTheme) {
      if (!this.musicEnabled || !this.unlocked || !theme) return;
      const el = this._ensureStoryAudio(theme);
      const previousStory = this.storyAudio;
      const previousScene = this.activeTrack && this.activeTrack !== el ? this.activeTrack : null;
      if (previousStory === el) {
        this.activeTrack = el;
        if (el.paused) this._safePlay(el);
        this.fadeTrack(el, this._targetVolume(), 0.5);
        return;
      }
      this.storyAudio = el;
      this.activeTrack = el;
      if (previousStory) this.fadeTrack(previousStory, 0, 0.7, true);
      if (previousScene && previousScene !== previousStory) this.fadeTrack(previousScene, 0, 0.7, true);
      el.volume = 0;
      this._safePlay(el);
      this.fadeTrack(el, this._targetVolume(), 0.95);
    },

    playCurrentScene(force) {
      if (!this.musicEnabled) return;
      if (!this.unlocked) return; // waits for a gesture
      if (this.storyTheme && this.scene !== 'menu') {
        this._playStoryTheme(this.storyTheme);
        return;
      }
      const name = this.sceneTrackName();
      const el = this._musicElements[name];
      if (!el) return;
      if (this.activeTrack === el && !el.paused && !force) return;
      this._transitionTo(el);
    },

    _transitionTo(el) {
      const prev = this.activeTrack;
      this.activeTrack = el;
      if (prev === el) {
        this.fadeTrack(el, this._targetVolume(), 0.5);
        if (el.paused) this._safePlay(el);
        return;
      }
      if (prev) this.fadeTrack(prev, 0, 0.7, true);
      el.volume = 0;
      this._safePlay(el);
      this.fadeTrack(el, this._targetVolume(), 0.9);
    },

    _safePlay(el) {
      if (!el) return;
      const p = el.play();
      if (p && p.catch) p.catch(() => {
        // A later user gesture retries via unlock/playCurrentScene.
      });
    },

    fadeTrack(el, to, duration = 0.5, pauseAtEnd = false) {
      if (!el) return;
      if (this.fadeTimers.has(el)) {
        cancelAnimationFrame(this.fadeTimers.get(el));
        this.fadeTimers.delete(el);
      }
      const from = el.volume;
      const start = performance.now();
      const ms = Math.max(30, duration * 1000);
      const step = (now) => {
        const t = Math.min(1, (now - start) / ms);
        const eased = 1 - Math.pow(1 - t, 3);
        el.volume = Math.max(0, Math.min(1, from + (to - from) * eased));
        if (t < 1) {
          this.fadeTimers.set(el, requestAnimationFrame(step));
        } else {
          this.fadeTimers.delete(el);
          if (pauseAtEnd && to === 0) {
            el.pause();
            // keep position, so returning to a loop is instant
          }
        }
      };
      this.fadeTimers.set(el, requestAnimationFrame(step));
    },

    duckMusic(amount = 0.35, key = 'modal') {
      if (!this.activeTrack) return;
      this._duckedFor = key;
      this.fadeTrack(this.activeTrack, this._targetVolume() * amount, 0.35);
    },

    unduckMusic(key = 'modal') {
      if (this._duckedFor && this._duckedFor !== key) return;
      this._duckedFor = null;
      if (this.activeTrack && this.musicEnabled) this.fadeTrack(this.activeTrack, this._targetVolume(), 0.6);
    },

    pauseMusic() {
      Object.values(this._musicElements).forEach((el) => {
        if (el && !el.paused) this.fadeTrack(el, 0, 0.35, true);
      });
      this.activeTrack = null;
    },

    resumeMusic() {
      if (this.musicEnabled) {
        this.activeTrack = null;
        this.playCurrentScene();
      }
    },

    /* ───────────── sfx helpers ───────────── */
    get out() {
      if (!this.ctx) return null;
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx.destination;
    },

    _masterSfx() {
      if (!this.ctx) return null;
      if (!this.masterSfxNode) {
        this.masterSfxNode = this.ctx.createGain();
        this.masterSfxNode.gain.value = this.masterSfx * this.sfxVolume;
        this.masterSfxNode.connect(this.ctx.destination);
      }
      return this.masterSfxNode;
    },

    _canSfx() {
      return this.unlocked && this.sfxEnabled && this.ctx && this.sfxVolume > 0.001;
    },

    tone({ freq = 440, dur = 0.2, type = 'sine', vol = 0.2, when = 0, attack = 0.005, decay = null, pan = 0, glide = null, detune = 0 }) {
      if (!this._canSfx()) return null;
      const ctx = this.ctx;
      const t0 = ctx.currentTime + when;
      const out = this._masterSfx();
      const gain = ctx.createGain();
      const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (panner) { panner.pan.value = Math.max(-1, Math.min(1, pan)); panner.connect(out); }
      gain.connect(panner || out);
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      osc.detune.setValueAtTime(detune, t0);
      if (glide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, glide), t0 + dur);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.001, vol), t0 + attack);
      const rel = decay || dur;
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + rel);
      osc.start(t0);
      osc.stop(t0 + rel + 0.02);
      return { osc, gain };
    },

    noise({ dur = 0.15, vol = 0.1, when = 0, hp = 500, lp = 5000, pan = 0, q = 0.7, delay = 0 }) {
      if (!this._canSfx() || !this.noiseBuffer) return;
      const ctx = this.ctx;
      const t0 = ctx.currentTime + when;
      const out = this._masterSfx();
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const gain = ctx.createGain();
      const hpFilter = ctx.createBiquadFilter();
      hpFilter.type = 'highpass';
      hpFilter.frequency.value = hp;
      const lpFilter = ctx.createBiquadFilter();
      lpFilter.type = 'lowpass';
      lpFilter.frequency.value = lp;
      lpFilter.Q.value = q;
      const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (panner) { panner.pan.value = Math.max(-1, Math.min(1, pan)); panner.connect(out); }
      src.connect(hpFilter).connect(lpFilter).connect(gain).connect(panner || out);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.001, vol), t0 + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.start(t0, delay % 0.15, dur + 0.02);
    },

    reverbTone({ freq = 440, dur = 0.6, vol = 0.08, when = 0, pan = 0 }) {
      if (!this._canSfx()) return;
      // A cheap but pretty ping-pong-ish echo using delayed copies.
      this.tone({ freq, dur, type: 'sine', vol, when, attack: 0.004, pan });
      this.tone({ freq: freq * 2, dur: dur * 0.7, type: 'sine', vol: vol * 0.3, when: when + 0.035, attack: 0.004, pan: pan + 0.15 });
      this.tone({ freq: freq * 1.5, dur: dur * 0.42, type: 'sine', vol: vol * 0.13, when: when + 0.11, attack: 0.004, pan: pan - 0.2 });
    },

    /* ───────────── known sounds ───────────── */
    click() {
      if (!this._canSfx()) return;
      this.tone({ freq: 520, dur: 0.055, type: 'sine', vol: 0.055, pan: 0, attack: 0.002 });
      this.tone({ freq: 1040, dur: 0.035, type: 'sine', vol: 0.024 });
      this.noise({ dur: 0.03, vol: 0.018, hp: 2000, lp: 8000 });
    },

    hover() {
      if (!this._canSfx()) return;
      this.tone({ freq: 880, dur: 0.028, type: 'sine', vol: 0.012 });
    },

    flip(index = 0) {
      if (!this._canSfx()) return;
      const pan = ((index % 6) - 2.5) / 4;
      const base = 210 + (index % 4) * 30;
      this.noise({ dur: 0.11, vol: 0.07, hp: 900, lp: 4800, q: 1.1, pan });
      this.tone({ freq: base, dur: 0.06, type: 'triangle', vol: 0.035, pan, glide: base * 0.75 });
    },

    match(combo = 1, golden = false) {
      if (!this._canSfx()) return;
      const root = 587.33; // D5 — the game's home note
      const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];
      const step = Math.min(9, Math.max(0, combo - 1));
      const note = root * Math.pow(2, scale[step % scale.length] / 12);
      const base = golden ? 1.5 : 1;
      this.reverbTone({ freq: note, dur: 0.55, vol: 0.10 * base, pan: 0.08 });
      this.reverbTone({ freq: note * 1.25, dur: 0.35, vol: 0.05, when: 0.055, pan: -0.1 });
      this.tone({ freq: note * 0.5, dur: 0.25, type: 'triangle', vol: 0.045, when: 0.01 });
      this.noise({ dur: 0.22, vol: 0.035, hp: 3800, lp: 10500, when: 0.02, pan: -0.2 });
      if (golden) {
        [note * 2, note * 2.5, note * 3].forEach((f, i) =>
          this.tone({ freq: f, dur: 0.5, type: 'sine', vol: 0.035, when: 0.1 + i * 0.06, pan: 0.2 - i * 0.15 })
        );
      }
    },

    wrong() {
      if (!this._canSfx()) return;
      this.noise({ dur: 0.12, vol: 0.04, hp: 180, lp: 1400 });
      this.tone({ freq: 196, dur: 0.2, type: 'sine', vol: 0.07, glide: 146, attack: 0.004 });
      this.tone({ freq: 146.8, dur: 0.24, type: 'triangle', vol: 0.045, when: 0.075, glide: 112 });
      this.tone({ freq: 330, dur: 0.1, type: 'sine', vol: 0.02, when: 0.02, glide: 280 });
    },

    power(kind = 'peek') {
      if (!this._canSfx()) return;
      if (kind === 'shuffle') {
        for (let i = 0; i < 5; i++) {
          this.noise({ dur: 0.1, vol: 0.032, hp: 1400 + i * 300, lp: 7000, when: i * 0.055, pan: i % 2 ? .25 : -.25 });
        }
        [392, 523, 659].forEach((f, i) => this.tone({ freq: f, dur: 0.18, type: 'triangle', vol: 0.045, when: 0.28 + i * .06 }));
        this.tone({ freq: 420, dur: 0.45, type: 'sine', vol: 0.02, glide: 820, when: 0.25 });
      } else if (kind === 'freeze') {
        [1568, 2093, 2637].forEach((f, i) => this.reverbTone({ freq: f, dur: 0.75, vol: 0.045, when: i * 0.06, pan: i % 2 ? .22 : -.22 }));
        this.tone({ freq: 880, dur: 0.8, type: 'sine', vol: 0.045, glide: 220, attack: .02 });
        this.noise({ dur: 0.7, vol: 0.03, hp: 4200, lp: 12000, when: 0.02 });
        this.tone({ freq: 110, dur: 0.5, type: 'triangle', vol: 0.04, when: .1, glide: 70 });
      } else if (kind === 'shadow') {
        this.tone({ freq: 92, dur: 1.25, type: 'sawtooth', vol: 0.04, glide: 54, attack: .06 });
        this.tone({ freq: 184, dur: 1.1, type: 'sine', vol: 0.025, glide: 116, attack: .08 });
        this.noise({ dur: 1.2, vol: 0.035, hp: 120, lp: 900, when: .03 });
        [392, 466.16, 587.33].forEach((f, i) => this.reverbTone({ freq: f, dur: 0.8, vol: 0.022, when: .25 + i * .08, pan: -.2 + i * .2 }));
      } else if (kind === 'expand') {
        [392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.reverbTone({ freq: f, dur: 0.42, vol: 0.05, when: i * .06, pan: -.2 + i * .1 }));
        this.noise({ dur: 0.45, vol: 0.035, hp: 2200, lp: 9000, when: .04 });
        this.tone({ freq: 196, dur: 0.55, type: 'triangle', vol: 0.04, glide: 392, when: .05 });
      } else {
        [587, 740, 880, 1175].forEach((f, i) => this.reverbTone({ freq: f, dur: 0.4, vol: 0.045, when: i * 0.055, pan: i % 2 ? .2 : -.2 }));
        this.noise({ dur: 0.4, vol: 0.028, hp: 2600, lp: 9500, when: 0.03 });
      }
    },

    finalChallenge() {
      if (!this._canSfx()) return;
      this.tone({ freq: 73.42, dur: 1.8, type: 'sine', vol: 0.13, glide: 49, attack: 0.02 });
      this.tone({ freq: 146.83, dur: 1.55, type: 'sawtooth', vol: 0.035, glide: 98, attack: 0.1 });
      this.noise({ dur: 1.7, vol: 0.035, hp: 120, lp: 1600, when: 0.02 });
      [146.83, 174.61, 220, 293.66].forEach((f, i) => {
        this.tone({ freq: f, dur: 0.75, type: 'triangle', vol: 0.045, when: 0.38 + i * 0.09 });
        this.reverbTone({ freq: f * 2, dur: 0.85, vol: 0.028, when: 0.4 + i * 0.09, pan: -0.3 + i * 0.2 });
      });
      [1046.5, 1318.5, 1568, 2093].forEach((f, i) =>
        this.tone({ freq: f, dur: 0.65, type: 'sine', vol: 0.022, when: 1.35 + i * 0.08, pan: -0.2 + i * 0.13 })
      );
    },

    fever() {
      if (!this._canSfx()) return;
      this.tone({ freq: 220, dur: 0.55, type: 'sawtooth', vol: 0.02, glide: 880, attack: 0.03 });
      this.tone({ freq: 440, dur: 0.5, type: 'triangle', vol: 0.035, glide: 1760, attack: 0.02 });
      this.noise({ dur: 0.7, vol: 0.035, hp: 2000, lp: 12000, when: 0.05 });
      [880, 1108.7, 1318.5, 1760].forEach((f, i) =>
        this.reverbTone({ freq: f, dur: 0.55, vol: 0.055, when: 0.32 + i * 0.075, pan: -0.25 + i * 0.16 })
      );
      this.tone({ freq: 90, dur: 0.5, type: 'sine', vol: 0.12, when: 0.02, glide: 65 });
    },

    tick(urgent = false) {
      if (!this._canSfx()) return;
      const now = performance.now();
      if (now - this.lastTickAt < 120) return;
      this.lastTickAt = now;
      this.tone({ freq: urgent ? 760 : 620, dur: 0.045, type: 'sine', vol: urgent ? 0.055 : 0.025 });
      this.noise({ dur: 0.025, vol: 0.013, hp: 3000, lp: 9000 });
    },

    countdown(n = 3) {
      if (!this._canSfx()) return;
      this.tone({ freq: n === 0 ? 880 : 440, dur: 0.12, type: 'sine', vol: 0.06, when: 0 });
      this.tone({ freq: n === 0 ? 880 : 660, dur: 0.1, type: 'triangle', vol: 0.025, when: 0.02 });
    },

    star() {
      if (!this._canSfx()) return;
      [1046, 1318, 1568, 2093].forEach((f, i) =>
        this.tone({ freq: f, dur: 0.22, type: 'sine', vol: 0.035, when: i * 0.055, pan: (i - 1.5) * .15 })
      );
    },

    wave() {
      if (!this._canSfx()) return;
      const notes = [392, 523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, i) => this.reverbTone({ freq: f, dur: 0.55, vol: 0.06, when: i * 0.075, pan: -0.25 + i * .12 }));
      this.noise({ dur: 0.45, vol: 0.03, hp: 3000, lp: 10000, when: 0.08 });
    },

    win() {
      if (!this._canSfx()) return;
      const seq = [587.33, 739.99, 880, 1174.66, 1479.98, 1760];
      seq.forEach((f, i) => {
        this.reverbTone({ freq: f, dur: 0.55, vol: 0.062, when: i * 0.105, pan: -0.2 + i * .08 });
        this.tone({ freq: f / 2, dur: 0.4, type: 'triangle', vol: 0.025, when: i * 0.105 });
      });
      this.noise({ dur: 0.9, vol: 0.022, hp: 4000, lp: 11000, when: 0.25 });
    },

    lose() {
      if (!this._canSfx()) return;
      [440, 392, 349.23, 293.66].forEach((f, i) =>
        this.tone({ freq: f, dur: 0.32, type: 'triangle', vol: 0.045, when: i * 0.14, pan: 0 })
      );
      this.tone({ freq: 146.83, dur: 0.55, type: 'sine', vol: 0.05, when: 0.5, glide: 110 });
    },

    meow() {
      if (!this._canSfx()) return;
      const ctx = this.ctx;
      if (!ctx) return;
      const t = ctx.currentTime;
      const out = this._masterSfx();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(900, t);
      filter.frequency.exponentialRampToValueAtTime(1800, t + 0.16);
      filter.frequency.exponentialRampToValueAtTime(700, t + 0.55);
      filter.Q.value = 3.2;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(440, t);
      osc.frequency.linearRampToValueAtTime(740, t + 0.11);
      osc.frequency.exponentialRampToValueAtTime(620, t + 0.3);
      osc.frequency.exponentialRampToValueAtTime(360, t + 0.55);
      const vib = ctx.createOscillator();
      vib.frequency.value = 8.5;
      const vibGain = ctx.createGain();
      vibGain.gain.value = 9;
      vib.connect(vibGain).connect(osc.frequency);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.11, t + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.06, t + 0.26);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      osc.connect(filter).connect(gain).connect(out);
      osc.start(t); vib.start(t); osc.stop(t + 0.62); vib.stop(t + 0.62);
      this.tone({ freq: 1568, dur: 0.11, type: 'sine', vol: 0.018, when: 0.02 });
    },

    cardRiffle() {
      if (!this._canSfx()) return;
      for (let i = 0; i < 7; i++) {
        this.noise({ dur: 0.05, vol: 0.022, hp: 2200 + i * 200, lp: 8000, when: i * 0.035, pan: (i - 3) * .13 });
      }
    },

    whoosh() {
      if (!this._canSfx()) return;
      this.noise({ dur: 0.5, vol: 0.05, hp: 280, lp: 6000, q: 1.2, pan: 0 });
      this.tone({ freq: 180, dur: 0.4, type: 'sine', vol: 0.025, glide: 640 });
    },

    reward() {
      if (!this._canSfx()) return;
      [783.99, 987.77, 1174.66, 1567.98].forEach((f, i) =>
        this.reverbTone({ freq: f, dur: 0.5, vol: 0.05, when: i * 0.08, pan: -0.1 + i * .1 })
      );
    },

    clickDisabled() {
      if (!this._canSfx()) return;
      this.tone({ freq: 150, dur: 0.07, type: 'triangle', vol: 0.025 });
    }
  };

  window.MMAudio = MMAudio;
})();
