/* Meow Memory — the actual memory-action engine.
   Runs after app.js; uses window.MMApp for shared UI/persistence and window.MMAudio for sound. */
(function () {
  'use strict';

  const App = window.MMApp;
  const UI = window.MMUI;
  const Art = window.MMArt;
  const Sfx = window.MMAudio;

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
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const AR = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  const num = (n) => String(Math.max(0, Math.round(Number(n) || 0))).replace(/\d/g, (d) => AR[+d]);
  const pctText = (n) => `${num(n)}٪`;

  const TURN_TIME = 16;
  const SUDDEN_TIME = 12;
  const ARCADE_TIME = 70;
  const ABILITY_COST = { peek: 2, shuffle: 3 };
  const DIFFICULTY = {
    easy: { label: 'هادئ', knownPairChance: .17, followChance: .42, firstThink: 1050, secondThink: 760, memoryChance: .4 },
    medium: { label: 'محترف', knownPairChance: .56, followChance: .79, firstThink: 800, secondThink: 630, memoryChance: .76 },
    hard: { label: 'أسطوري', knownPairChance: .86, followChance: .96, firstThink: 500, secondThink: 430, memoryChance: .97 }
  };
  const BOT_NAMES = ['زعتر'];

  const Game = {
    state: null,
    lastConfig: null,
    lastResult: null,
    raf: null,
    lastFrame: 0,
    lastUiAt: 0,
    lastTickSecond: null,
    confetti: { raf: null, pieces: [], ctx: null, canvas: null, active: false },
    _pausedByVisibility: false,

    /* ═══════════════════════════ lifecycle ═══════════════════════════ */
    start(config, options = {}) {
      if (!config || !config.players || !config.players.length) return;
      this.stopRaf();
      this.stopConfetti();
      this.clearTimers();
      this.clearAiTimer();
      UI.closeAll();

      const mode = config.mode || 'duel';
      const pairCount = mode === 'arcade' ? 12 : 15;
      const cols = mode === 'arcade' ? 6 : 6;
      const turnMax = mode === 'arcade' ? 0 : TURN_TIME;
      const players = config.players.map((spec, index) => {
        const cat = Art.catById(spec.catId || (index === 0 ? 'lulu' : 'zaatar'));
        return {
          index,
          name: (spec.name || (index === 0 ? 'لاعب ١' : 'لاعب ٢')).trim().slice(0, 14) || (index === 0 ? 'لاعب ١' : 'لاعب ٢'),
          catId: cat.id,
          cat,
          bot: !!spec.bot,
          score: 0,
          pairs: 0,
          combo: 0,
          bestCombo: 0,
          energy: 2,
          golden: 0
        };
      });
      if (mode !== 'arcade' && players.length < 2) {
        players.push({
          index: 1, name: 'لاعب ٢', catId: 'zaatar', cat: Art.catById('zaatar'), bot: false,
          score: 0, pairs: 0, combo: 0, bestCombo: 0, energy: 2, golden: 0
        });
      }
      this.lastConfig = JSON.parse(JSON.stringify(config));
      const deck = this.makeDeck(pairCount, mode === 'arcade' ? 12 : 15);

      this.state = {
        mode,
        difficulty: config.difficulty || 'medium',
        players,
        deck,
        cols,
        pairCount,
        current: 0,
        firstPick: null,
        secondPick: null,
        locked: true,
        paused: false,
        phase: options.skipCountdown ? 'countdown' : 'countdown',
        turnMax,
        timeLeft: turnMax,
        lastWholeSecond: null,
        timers: new Set(),
        aiTimer: null,
        aiThinking: false,
        aiPlanned: null,
        aiMemory: new Map(),
        stats: { moves: 0, matches: 0, maxCombo: 0, peeks: 0, shuffles: 0, startedAt: performance.now() },
        arcade: mode === 'arcade' ? {
          timeLeft: ARCADE_TIME,
          score: 0,
          wave: 1,
          matches: 0,
          moves: 0,
          maxCombo: 0,
          newBest: false
        } : null,
        isSudden: false,
        suddenWinner: null,
        round: 1,
        lastActionAt: performance.now(),
        pendingResult: null,
        visibilityPaused: false
      };
      this.lastTickSecond = null;

      // prepare screens & music
      this.activateScreen('screen-game');
      document.body.classList.add('in-game');
      document.body.classList.remove('on-results');
      this.resetGameUI();
      this.renderBoard();
      this.updateHUD(true);
      this.updateAbilityUI();
      this.configureModeChrome();
      Sfx.setScene('game');
      Sfx.whoosh();
      this.startRaf();

      if (options.skipCountdown) {
        this.beginPlay();
      } else {
        this.runCountdown();
      }
    },

    activateScreen(id) {
      $$('.screen').forEach((s) => s.classList.toggle('is-active', s.id === id));
      document.documentElement.classList.toggle('screen-game-active', id === 'screen-game');
      window.scrollTo({ top: 0, behavior: 'instant' in document.documentElement.style ? 'instant' : 'auto' });
    },

    configureModeChrome() {
      const s = this.state;
      if (!s) return;
      const mode = s.mode;
      $('#hudDuel').hidden = mode === 'arcade';
      $('#hudArcade').hidden = mode !== 'arcade';
      const chip = $('#gameModeChip');
      if (chip) {
        let icon = 'i-users';
        let label = 'مواجهة';
        if (mode === 'ai') { icon = 'i-bot'; label = 'تحدي زعتر'; }
        if (mode === 'arcade') { icon = 'i-bolt'; label = 'تحدي البرق'; }
        chip.innerHTML = `<svg class="ico"><use href="#${icon}"/></svg><span>${label}</span>`;
      }
      const hint = $('#feverHint');
      if (hint) hint.textContent = mode === 'arcade' ? 'السلسلة ترفع النقاط… راقب الوقت' : '٣ مطابقات متتالية = وضع البرق ⚡';
      const abilityShuffle = $('#abilityShuffle .ability-copy b');
      if (abilityShuffle) abilityShuffle.textContent = mode === 'arcade' ? 'خلطة + وقت' : 'خلطة';
      const arcadeName = $('.arcade-player [data-hud-name="0"]');
      if (arcadeName) arcadeName.textContent = s.players[0].name;
    },

    beginPlay() {
      const s = this.state;
      if (!s || s.phase === 'ended') return;
      const overlay = $('#countdownOverlay');
      if (overlay) overlay.hidden = true;
      s.phase = 'playing';
      s.locked = false;
      s.paused = false;
      s.lastWholeSecond = null;
      if (s.mode === 'arcade') {
        // timer runs in the global loop
      } else {
        s.timeLeft = s.isSudden ? SUDDEN_TIME : TURN_TIME;
        s.turnMax = s.timeLeft;
      }
      this.lastFrame = performance.now();
      this.updateHUD(true);
      this.updateAbilityUI();
      this.maybeRunAi();
    },

    runCountdown() {
      const s = this.state;
      if (!s) return;
      const overlay = $('#countdownOverlay');
      const number = $('#countdownNumber');
      if (!overlay || !number) { this.beginPlay(); return; }
      overlay.hidden = false;
      s.phase = 'countdown';
      s.locked = true;
      let n = 3;
      const show = (n) => {
        number.textContent = num(n === 0 ? 1 : n);
        number.style.animation = 'none';
        void number.offsetWidth;
        number.style.animation = '';
      };
      show(n);
      Sfx.countdown(n);
      const tick = () => {
        if (!this.state || this.state !== s || s.phase === 'ended') return;
        n -= 1;
        if (n > 0) {
          show(n);
          Sfx.countdown(n);
          this.later(tick, 660);
        } else {
          number.textContent = '✦';
          Sfx.countdown(0);
          this.later(() => {
            if (!this.state || this.state !== s || s.phase === 'ended') return;
            overlay.hidden = true;
            this.beginPlay();
          }, 390);
        }
      };
      this.later(tick, 760);
    },

    resetGameUI() {
      $('#turnTimer').classList.remove('is-low', 'is-paused');
      $('#turnTimerValue').textContent = num(TURN_TIME);
      $('#ringProgress').style.strokeDashoffset = '0';
      $('#arcadeClock').classList.remove('is-low');
      $('#arcadeTimeValue').textContent = num(ARCADE_TIME);
      $('#arcadeTimeBar').style.transform = 'scaleX(1)';
      $('#arcadeScoreValue').textContent = num(0);
      $('#arcadeWave').textContent = num(1);
      $('#arcadeBest').textContent = num(App.save().bestArcade || 0);
      $('#boardBanner').hidden = true;
      $('#countdownOverlay').hidden = true;
      $('#effectLayer').innerHTML = '';
      $('#comboChip').hidden = true;
      $('#boardShell').classList.remove('is-fever');
      $('#screen-game').classList.remove('is-fever');
      $('#board').style.removeProperty('--cols');
      $('#board').classList.remove('is-shuffling');
      $('#board').style.width = '';
      $('#boardShell').classList.remove('is-sudden');
      $('#turnMessage').className = 'turn-message';
    },

    makeDeck(pairCount, fruitCount) {
      const fruits = shuffle(Art.fruits).slice(0, Math.min(fruitCount, pairCount));
      const pairs = [];
      for (let i = 0; i < pairCount; i++) pairs.push(fruits[i % fruits.length].id);
      const goldenPair = randInt(0, pairCount - 1);
      const cards = [];
      pairs.forEach((fruit, pairIndex) => {
        const golden = pairIndex === goldenPair;
        cards.push({ fruit, golden, matched: false, faceUp: false, pairIndex });
        cards.push({ fruit, golden, matched: false, faceUp: false, pairIndex });
      });
      return shuffle(cards);
    },

    renderBoard(customCols) {
      const s = this.state;
      if (!s) return;
      const board = $('#board');
      const cols = customCols || s.cols || 6;
      board.style.setProperty('--cols', cols);
      board.innerHTML = s.deck.map((card, index) => {
        const fruit = Art.fruitById(card.fruit);
        return `<button type="button" class="memory-card${card.golden ? ' is-golden' : ''}" data-index="${index}" style="--i:${index}" aria-label="بطاقة مقلوبة" aria-pressed="false">
          <span class="card-inner">
            <span class="card-back" aria-hidden="true">
              <span class="corner-dot d1"></span><span class="corner-dot d2"></span>
              <svg class="card-back-paw ico"><use href="#i-paw"/></svg>
            </span>
            <span class="card-face" aria-hidden="true">
              <img class="card-fruit" src="${Art.fruitSrc(card.fruit)}" alt="" draggable="false">
              <span class="fruit-label">${fruit.name}</span>
              ${card.golden ? '<svg class="gold-star-badge ico"><use href="#i-sparkle"/></svg>' : ''}
            </span>
          </span>
        </button>`;
      }).join('');
      this.updateCardAria();
    },

    updateCardAria() {
      const s = this.state;
      if (!s) return;
      const board = $('#board');
      if (!board) return;
      s.deck.forEach((card, i) => {
        const el = board.querySelector(`[data-index="${i}"]`);
        if (!el) return;
        const fruit = Art.fruitById(card.fruit);
        if (card.matched) {
          el.setAttribute('aria-label', `تمت مطابقة ${fruit.name}`);
          el.disabled = true;
          el.classList.add('is-locked');
        } else if (card.faceUp) {
          el.setAttribute('aria-label', fruit.name);
          el.setAttribute('aria-pressed', 'true');
        } else {
          el.setAttribute('aria-label', 'بطاقة مقلوبة');
          el.setAttribute('aria-pressed', 'false');
          el.disabled = false;
        }
      });
    },

    /* ═══════════════════════════ time loop ═══════════════════════════ */
    startRaf() {
      this.stopRaf();
      this.lastFrame = performance.now();
      const loop = (now) => {
        const s = this.state;
        if (!s) return;
        const dt = Math.min(.3, Math.max(0, (now - this.lastFrame) / 1000));
        this.lastFrame = now;
        if (!s.paused && !document.hidden && s.phase === 'playing' && !s.pendingResult) {
          if (s.mode === 'arcade') {
            s.arcade.timeLeft = Math.max(0, s.arcade.timeLeft - dt);
            this.arcadeTickSound();
            if (s.arcade.timeLeft <= 0) {
              this.finishArcade();
            }
          } else if (!s.locked) {
            s.timeLeft = Math.max(0, s.timeLeft - dt);
            this.turnTickSound();
            if (s.timeLeft <= 0) {
              this.handleTimeout();
            }
          }
        }
        if (now - this.lastUiAt > 70) {
          this.lastUiAt = now;
          this.updateTimerDisplay();
        }
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    },

    stopRaf() {
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = null;
    },

    turnTickSound() {
      const s = this.state;
      if (!s) return;
      const whole = Math.ceil(s.timeLeft);
      if (whole !== s.lastWholeSecond) {
        s.lastWholeSecond = whole;
        if (whole > 0 && whole <= 5) Sfx.tick(whole <= 3);
      }
    },

    arcadeTickSound() {
      const s = this.state;
      if (!s || !s.arcade) return;
      const whole = Math.ceil(s.arcade.timeLeft);
      if (whole !== this.lastTickSecond) {
        this.lastTickSecond = whole;
        if (whole > 0 && whole <= 10) Sfx.tick(whole <= 5);
      }
    },

    updateTimerDisplay() {
      const s = this.state;
      if (!s) return;
      if (s.mode === 'arcade') {
        const t = Math.max(0, Math.ceil(s.arcade.timeLeft));
        $('#arcadeTimeValue').textContent = num(t);
        $('#arcadeTimeBar').style.transform = `scaleX(${clamp(s.arcade.timeLeft / ARCADE_TIME, 0, 1)})`;
        $('#arcadeClock').classList.toggle('is-low', s.arcade.timeLeft <= 10);
        $('#arcadeScoreValue').textContent = num(s.arcade.score);
        $('#arcadeWave').textContent = num(s.arcade.wave);
        return;
      }
      const active = s.players[s.current];
      const time = Math.max(0, s.timeLeft);
      $('#turnTimerValue').textContent = num(Math.ceil(time));
      const progress = clamp(time / Math.max(1, s.turnMax), 0, 1);
      $('#ringProgress').style.strokeDashoffset = String(169.65 * (1 - progress));
      $('#turnTimer').classList.toggle('is-low', time <= 5 && !s.locked && !s.paused);
      $('#turnTimer').classList.toggle('is-paused', s.paused || s.phase === 'countdown' || s.locked);
      $$('.player-title, .player-card').forEach((card) => {
        const idx = Number(card.dataset.playerCard);
        const bar = card.querySelector('.player-timer-bar span');
        if (bar) {
          if (idx === s.current && s.phase === 'playing' && !s.locked && !s.paused) {
            bar.style.transform = `scaleX(${progress})`;
          } else if (idx !== s.current) {
            bar.style.transform = 'scaleX(0)';
          } else {
            bar.style.transform = `scaleX(${progress})`;
          }
        }
      });
      const chip = $('#comboChip');
      if (active && active.combo >= 2) {
        chip.hidden = false;
        $('#comboText').textContent = `×${num(Math.min(5, active.combo))}`;
        chip.classList.toggle('is-hot', active.combo >= 3);
        const fever = active.combo >= 3;
        $('#boardShell').classList.toggle('is-fever', fever);
        $('#screen-game').classList.toggle('is-fever', fever);
      } else {
        chip.hidden = true;
        $('#boardShell').classList.remove('is-fever');
        $('#screen-game').classList.remove('is-fever');
      }
    },

    handleTimeout() {
      const s = this.state;
      if (!s || s.mode === 'arcade' || s.phase !== 'playing') return;
      if (s.pendingResult) return;
      s.locked = true;
      this.clearAiTimer();
      const p = s.players[s.current];
      p.combo = 0;
      if (s.firstPick != null) {
        this.flipDown(s.firstPick);
        s.firstPick = null;
      }
      s.secondPick = null;
      s.pendingResult = 'timeout-turn';
      this.updateHUD(true);
      this.updateAbilityUI();
      this.flashTurnMessage('انتهى وقت الدور!', 'is-warn');
      Sfx.wrong();
      this.spawnComboCallout('انتهى الوقت', 'خذ نفسًا… الدور ينتقل', '#b95c67');
      this.later(() => {
        if (!this.state || this.state !== s || s.phase === 'ended') return;
        s.pendingResult = null;
        this.switchTurn('timeout');
      }, 950);
    },

    switchTurn(reason = '') {
      const s = this.state;
      if (!s || s.phase === 'ended') return;
      this.clearAiTimer();
      s.current = s.current === 0 ? 1 : 0;
      s.firstPick = null;
      s.secondPick = null;
      s.locked = false;
      s.aiPlanned = null;
      s.phase = 'playing';
      s.timeLeft = s.isSudden ? SUDDEN_TIME : TURN_TIME;
      s.turnMax = s.timeLeft;
      s.lastWholeSecond = null;
      s.pendingResult = null;
      if (s.players[s.current].bot) {
        s.aiThinking = true;
        this.flashTurnMessage('زعتر يفكر…', 'is-ai');
      } else {
        this.flashTurnMessage(s.isSudden ? `جولة الحسم: دور ${s.players[s.current].name}` : `دور ${s.players[s.current].name}…`, '');
      }
      this.updateHUD(true);
      this.updateAbilityUI();
      if (s.players[s.current].bot) this.maybeRunAi();
    },

    flashTurnMessage(text, cls = '') {
      const wrap = $('#turnMessage');
      if (!wrap) return;
      $('#turnMessageText').textContent = text;
      wrap.classList.remove('is-warn', 'is-ai', 'is-fever');
      if (cls) wrap.classList.add(cls.replace(/^\./, ''));
    },

    /* ═══════════════════════════ interaction ═══════════════════════════ */
    handleBoardClick(e) {
      const btn = e.target.closest('.memory-card');
      if (!btn) return;
      this.pickCard(Number(btn.dataset.index), 'human');
    },

    pickCard(index, source = 'human') {
      const s = this.state;
      if (!s || s.phase !== 'playing' || s.paused || s.locked) return;
      const active = s.players[s.current];
      if (!active) return;
      if (active.bot && source !== 'ai') return;
      if (!active.bot && source === 'ai') return;
      const card = s.deck[index];
      if (!card || card.matched || card.faceUp) return;
      if (s.firstPick === index) return;
      if (s.firstPick === null) {
        s.firstPick = index;
        this.flipUp(index, source);
        Sfx.flip(index);
        this.updateAbilityUI();
        this.flashTurnMessage(active.bot ? 'زعتر يقلب بطاقة…' : 'بطاقة واحدة… أكمل!', active.bot ? 'is-ai' : '');
        this.updateHUD();
        if (active.bot) this.maybeRunAi();
        return;
      }
      s.secondPick = index;
      this.flipUp(index, source);
      Sfx.flip(index + 1);
      s.locked = true;
      s.stats.moves++;
      if (s.mode === 'arcade') s.arcade.moves++;
      this.updateHUD();
      this.resolvePair(s.firstPick, s.secondPick);
    },

    flipUp(index, source) {
      const s = this.state;
      const card = s.deck[index];
      if (!card) return;
      card.faceUp = true;
      const el = $('#board').querySelector(`[data-index="${index}"]`);
      if (el) {
        el.classList.add('is-flipped');
        el.classList.remove('is-hit');
        void el.offsetWidth;
        el.classList.add('is-hit');
        el.setAttribute('aria-pressed', 'true');
      }
      this.remember(index);
    },

    flipDown(index) {
      const s = this.state;
      if (!s) return;
      const card = s.deck[index];
      if (!card) return;
      card.faceUp = false;
      const el = $('#board').querySelector(`[data-index="${index}"]`);
      if (el) {
        el.classList.remove('is-flipped', 'is-wrong');
        el.setAttribute('aria-pressed', 'false');
      }
    },

    remember(index) {
      const s = this.state;
      if (!s) return;
      const fruit = s.deck[index].fruit;
      if (!s.aiMemory.has(fruit)) s.aiMemory.set(fruit, new Set());
      s.aiMemory.get(fruit).add(index);
    },

    resolvePair(a, b) {
      const s = this.state;
      if (!s) return;
      const cardA = s.deck[a];
      const cardB = s.deck[b];
      if (!cardA || !cardB) return;
      const active = s.players[s.current];
      const isMatch = cardA.fruit === cardB.fruit;
      if (isMatch) {
        this.resolveMatch(a, b, active);
      } else {
        this.resolveMiss(a, b, active);
      }
    },

    resolveMatch(a, b, player) {
      const s = this.state;
      const cards = [s.deck[a], s.deck[b]];
      cards.forEach((card) => { card.matched = true; });
      s.firstPick = null;
      s.secondPick = null;
      s.locked = true;
      player.combo += 1;
      player.bestCombo = Math.max(player.bestCombo || 0, player.combo);
      s.stats.maxCombo = Math.max(s.stats.maxCombo, player.combo);
      if (s.arcade) {
        s.arcade.maxCombo = Math.max(s.arcade.maxCombo, player.combo);
        s.arcade.matches++;
      }
      const golden = !!(cards[0].golden || cards[1].golden);
      if (golden) player.golden++;
      player.pairs += 1;
      player.energy = clamp(player.energy + (golden ? 2 : 1), 0, 5);
      const fever = player.combo >= 3;
      let points;
      if (s.mode === 'arcade') {
        points = 100 * Math.min(5, player.combo) * (golden ? 1.7 : 1);
        if (fever) points = Math.round(points * 1.5);
        points = Math.round(points);
        s.arcade.score += points;
        player.score = s.arcade.score;
        const timeBonus = golden ? 4 : (fever ? 3.5 : 2.5);
        s.arcade.timeLeft = Math.min(99, s.arcade.timeLeft + timeBonus);
        this.showTimeBonus(timeBonus);
      } else {
        points = 100 * Math.min(5, player.combo);
        if (fever) points *= 2;
        if (golden) points += 150;
        player.score += points;
        s.timeLeft = Math.min(s.turnMax, s.timeLeft + (fever ? 4 : 2));
      }
      s.stats.matches++;
      player.score = Math.round(player.score);
      const board = $('#board');
      cards.forEach((card) => {
        const el = board.querySelector(`[data-index="${s.deck.indexOf(card)}"]`);
        if (el) {
          el.classList.add('is-matched');
          el.disabled = true;
          el.classList.add('is-locked');
        }
      });
      const indexA = a;
      const indexB = b;
      this.spawnMatchEffects(indexA, indexB, s.deck[a].fruit, golden, points, player.combo);
      Sfx.match(player.combo, golden);
      const wasFever = player.combo - 1 >= 3;
      if (fever && !wasFever) this.triggerFever(player);
      if (golden) {
        this.showBanner('فاكهة ذهبية!', `+${num(points)} نقطة وطاقة إضافية`, 'is-gold', 1000);
      }
      this.updateHUD();
      this.updateAbilityUI();
      // clear pair after the cheer lands
      this.later(() => {
        if (!this.state || this.state !== s || s.phase === 'ended') return;
        cards.forEach((card) => {
          const idx = s.deck.indexOf(card);
          const el = board.querySelector(`[data-index="${idx}"]`);
          if (el) el.classList.add('is-cleared');
        });
        this.updateCardAria();
      }, 700);
      this.later(() => {
        if (!this.state || this.state !== s || s.phase === 'ended') return;
        if (s.isSudden) {
          this.finishGame(s.current);
          return;
        }
        if (s.deck.every((c) => c.matched)) {
          if (s.mode === 'arcade') this.completeWave();
          else this.evaluateBoardEnd();
          return;
        }
        s.locked = false;
        s.firstPick = null;
        s.secondPick = null;
        this.updateHUD();
        this.updateAbilityUI();
        this.flashTurnMessage(player.bot ? 'زعتر يواصل…' : `أحسنت يا ${player.name}! أكمل`, '');
        if (player.bot) this.maybeRunAi();
      }, 1080);
    },

    resolveMiss(a, b, player) {
      const s = this.state;
      const board = $('#board');
      player.combo = 0;
      s.stats.maxCombo = Math.max(s.stats.maxCombo, 0);
      [a, b].forEach((index) => {
        const el = board.querySelector(`[data-index="${index}"]`);
        if (el) el.classList.add('is-wrong');
      });
      Sfx.wrong();
      this.updateHUD();
      this.updateAbilityUI();
      $('#boardShell').classList.remove('is-fever');
      $('#screen-game').classList.remove('is-fever');
      this.flashTurnMessage('ليستا متطابقتين…', 'is-warn');
      this.shakeBoard();
      if (s.mode === 'arcade') {
        s.arcade.timeLeft = Math.max(0, s.arcade.timeLeft - 4);
        this.spawnPenalty(a, b);
        this.updateTimerDisplay();
      }
      this.later(() => {
        if (!this.state || this.state !== s || s.phase === 'ended') return;
        this.flipDown(a);
        this.flipDown(b);
        [a, b].forEach((index) => {
          const el = board.querySelector(`[data-index="${index}"]`);
          if (el) el.classList.remove('is-wrong');
        });
      }, 820);
      this.later(() => {
        if (!this.state || this.state !== s || s.phase === 'ended') return;
        s.firstPick = null;
        s.secondPick = null;
        if (s.mode === 'arcade') {
          if (s.arcade.timeLeft <= 0) { this.finishArcade(); return; }
          s.locked = false;
          this.flashTurnMessage('الوقت ينقص… ركز!', 'is-warn');
          this.updateHUD();
          this.updateAbilityUI();
          return;
        }
        if (s.phase === 'playing' || s.phase === 'countdown') {
          this.switchTurn('miss');
        }
      }, 1130);
    },

    /* ═══════════════════════════ abilities ═══════════════════════════ */
    updateAbilityUI() {
      const s = this.state;
      const peekBtn = $('#abilityPeek');
      const shuffleBtn = $('#abilityShuffle');
      if (!s) {
        if (peekBtn) peekBtn.disabled = true;
        if (shuffleBtn) shuffleBtn.disabled = true;
        return;
      }
      const active = s.players[s.current];
      const canAct = s.phase === 'playing' && !s.paused && !s.locked && !active.bot;
      const canPeek = canAct && active.energy >= ABILITY_COST.peek;
      const canShuffle = canAct && active.energy >= ABILITY_COST.shuffle && s.firstPick === null;
      if (peekBtn) {
        peekBtn.disabled = !canPeek;
        peekBtn.classList.toggle('is-ready', canPeek);
        peekBtn.setAttribute('aria-label', `لمحة القطة — تكشف ٤ بطاقات مقابل طاقتين. طاقتك ${num(active.energy)} من ٥`);
        peekBtn.title = active.bot ? 'دور زعتر الآن' : active.energy < ABILITY_COST.peek ? 'تحتاج طاقتين' : 'لمحة القطة (٢ طاقة)';
      }
      if (shuffleBtn) {
        shuffleBtn.disabled = !canShuffle;
        shuffleBtn.classList.toggle('is-ready', canShuffle);
        shuffleBtn.classList.toggle('is-arcade', s.mode === 'arcade');
        shuffleBtn.setAttribute('aria-label', s.mode === 'arcade' ? 'خلطة المخالب — تخلط البطاقات وتضيف ٦ ثوانٍ مقابل ٣ طاقة' : 'خلطة المخالب — تخلط البطاقات وتضيف ٤ ثوانٍ مقابل ٣ طاقة');
        shuffleBtn.title = active.bot ? 'دور زعتر الآن' : s.firstPick !== null ? 'أكمل دورك أولًا' : active.energy < ABILITY_COST.shuffle ? 'تحتاج ٣ طاقة' : 'خلطة المخالب (٣ طاقة)';
      }
      this.updateEnergyPips();
    },

    updateEnergyPips() {
      const s = this.state;
      if (!s) return;
      const active = s.players[s.current];
      $$('[data-hud-energy]').forEach((el, index) => {
        const p = s.players[index];
        if (!p) { el.innerHTML = ''; return; }
        el.innerHTML = Array.from({ length: 5 }, (_, i) => `<i class="${i < p.energy ? 'is-full' : ''}"></i>`).join('');
      });
      const track = $('#activeEnergy');
      if (track) {
        track.innerHTML = Array.from({ length: 5 }, (_, i) => `<i class="${i < active.energy ? 'is-full' : ''}"></i>`).join('');
      }
      const name = $('#energyActiveName');
      if (name) name.textContent = active.name;
      const hint = $('#feverHint');
      if (hint && s.mode === 'arcade') hint.textContent = 'السلسلة ترفع النقاط… راقب الوقت';
      const btnPeek = $('#abilityPeek');
      const btnShuffle = $('#abilityShuffle');
      if (btnPeek) btnPeek.classList.toggle('is-arcade', s.mode === 'arcade');
      if (btnShuffle) btnShuffle.classList.toggle('is-arcade', s.mode === 'arcade');
      $$('.ability-btn').forEach((btn) => {
        btn.classList.toggle('is-used', false);
      });
    },

    useAbility(kind) {
      const s = this.state;
      if (!s || s.phase !== 'playing' || s.paused || s.locked) return;
      const active = s.players[s.current];
      if (!active || active.bot) return;
      const cost = ABILITY_COST[kind];
      if (active.energy < cost) {
        App.toast(`تحتاج ${num(cost)} طاقة… كل مطابقة تمنحك واحدة`, { icon: 'paw' });
        Sfx.clickDisabled();
        return;
      }
      if (kind === 'shuffle' && s.firstPick !== null) {
        App.toast('أكمل البطاقة الأولى أولًا', { icon: 'info' });
        return;
      }
      if (kind === 'peek') {
        active.energy -= cost;
        s.stats.peeks++;
        this.doPeek(active);
      } else if (kind === 'shuffle') {
        active.energy -= cost;
        s.stats.shuffles++;
        this.doShuffle(active);
      }
      const btn = kind === 'peek' ? $('#abilityPeek') : $('#abilityShuffle');
      if (btn) {
        btn.classList.remove('is-used');
        void btn.offsetWidth;
        btn.classList.add('is-used');
      }
      this.updateHUD();
      this.updateAbilityUI();
    },

    doPeek(player) {
      const s = this.state;
      if (!s) return;
      const candidates = s.deck
        .map((card, i) => ({ card, i }))
        .filter(({ card, i }) => !card.matched && !card.faceUp && i !== s.firstPick)
        .map(({ i }) => i);
      const reveal = shuffle(candidates).slice(0, Math.min(4, candidates.length));
      const board = $('#board');
      reveal.forEach((index) => {
        const el = board.querySelector(`[data-index="${index}"]`);
        if (el) el.classList.add('is-peeked');
      });
      Sfx.power('peek');
      App.toast(`<b>لمحة ${esc(player.name)}</b> — أربع بطاقات مكشوفة`, { icon: 'eye', duration: 1900 });
      this.later(() => {
        if (!this.state) return;
        reveal.forEach((index) => {
          const el = board.querySelector(`[data-index="${index}"]`);
          if (el) el.classList.remove('is-peeked');
        });
      }, 1800);
    },

    doShuffle(player) {
      const s = this.state;
      if (!s) return;
      const indices = s.deck.map((card, i) => (!card.matched ? i : -1)).filter((i) => i >= 0);
      const payload = indices.map((i) => ({
        fruit: s.deck[i].fruit,
        golden: s.deck[i].golden,
        faceUp: false,
        matched: false,
        pairIndex: s.deck[i].pairIndex
      }));
      const mixed = shuffle(payload);
      indices.forEach((idx, k) => {
        const old = s.deck[idx];
        s.deck[idx] = Object.assign(mixed[k], { faceUp: false, matched: false });
      });
      s.aiMemory.clear();
      s.firstPick = null;
      s.secondPick = null;
      s.aiPlanned = null;
      const board = $('#board');
      board.classList.add('is-shuffling');
      board.querySelectorAll('.memory-card').forEach((el) => {
        el.classList.remove('is-peeked', 'is-flipped', 'is-wrong', 'is-hit');
        el.setAttribute('aria-pressed', 'false');
        el.setAttribute('aria-label', 'بطاقة مقلوبة');
        el.style.animationDelay = `${Math.random() * .12}s`;
      });
      indices.forEach((idx) => {
        const card = s.deck[idx];
        const el = board.querySelector(`[data-index="${idx}"]`);
        if (!el) return;
        const fruit = Art.fruitById(card.fruit);
        const img = el.querySelector('.card-fruit');
        const label = el.querySelector('.fruit-label');
        if (img) img.src = Art.fruitSrc(card.fruit);
        if (label) label.textContent = fruit.name;
        el.classList.toggle('is-golden', !!card.golden);
      });
      const bonus = s.mode === 'arcade' ? 6 : 4;
      if (s.mode === 'arcade') {
        s.arcade.timeLeft = Math.min(99, s.arcade.timeLeft + bonus);
        this.updateTimerDisplay();
      } else {
        s.timeLeft = Math.min(s.turnMax, s.timeLeft + bonus);
      }
      Sfx.power('shuffle');
      this.shakeBoard(true);
      this.updateHUD();
      this.updateAbilityUI();
      this.later(() => {
        if (this.state) $('#board').classList.remove('is-shuffling');
      }, 650);
      App.toast(`<b>خلطة ${esc(player.name)}</b> — البطاقات اختلطت و+${num(bonus)} ثوانٍ`, { icon: 'shuffle', duration: 2400 });
      this.spawnPawCloud();
    },

    /* ═══════════════════════════ HUD ═══════════════════════════ */
    updateHUD(updateNames = false) {
      const s = this.state;
      if (!s) return;
      if (s.mode === 'arcade') {
        $('#arcadeScoreValue').textContent = num(s.arcade.score);
        $('#arcadeWave').textContent = num(s.arcade.wave);
        $('#arcadeBest').textContent = num(Math.max(App.save().bestArcade || 0, s.arcade.newBest ? s.arcade.score : 0));
        const arcadeName = $('.arcade-player [data-hud-name="0"]');
        if (arcadeName) arcadeName.textContent = s.players[0].name;
        const arcadeAvatar = $('.arcade-player .player-avatar');
        if (arcadeAvatar && arcadeAvatar.dataset.renderedFor !== s.players[0].catId) {
          arcadeAvatar.innerHTML = Art.catAvatarSvg(s.players[0].cat);
          arcadeAvatar.dataset.renderedFor = s.players[0].catId;
        }
      } else {
        s.players.forEach((p, i) => {
          const card = $(`[data-player-card="${i}"]`);
          if (!card) return;
          card.classList.toggle('is-active', i === s.current);
          card.classList.toggle('is-thinking', !!(p.bot && i === s.current && s.phase !== 'ended'));
          card.classList.toggle('is-low', i === s.current && s.timeLeft <= 5 && !s.locked && !s.paused);
          const name = card.querySelector(`[data-hud-name="${i}"]`);
          if (name) name.textContent = p.name;
          const pairs = card.querySelector(`[data-hud-pairs="${i}"]`);
          if (pairs) pairs.textContent = num(p.pairs);
          const points = card.querySelector(`[data-hud-points="${i}"]`);
          if (points) points.textContent = num(p.score);
          const energy = card.querySelector('[data-hud-energy]');
          if (energy) energy.innerHTML = Array.from({ length: 5 }, (_, k) => `<i class="${k < p.energy ? 'is-full' : ''}"></i>`).join('');
          let avatar = card.querySelector('.player-avatar');
          if (avatar) {
            if (avatar.dataset.renderedFor !== p.catId) {
              avatar.innerHTML = Art.catAvatarSvg(p.cat);
              avatar.dataset.renderedFor = p.catId;
            }
            let badge = avatar.querySelector('.avatar-badge');
            if (!badge) {
              badge = document.createElement('span');
              badge.className = 'avatar-badge';
              avatar.appendChild(badge);
            }
            badge.textContent = num(p.pairs);
          }
        });
      }
      const turnText = $('#turnMessageText');
      const turnWrap = $('#turnMessage');
      if (turnText && turnWrap) {
        const active = s.players[s.current];
        if (s.paused) {
          turnText.textContent = 'الوقت متوقف… خذ راحتك';
          turnWrap.classList.remove('is-warn', 'is-ai', 'is-fever');
        } else if (s.isSudden) {
          turnText.textContent = `جولة الحسم — دور ${active.name}`;
        } else if (s.phase === 'countdown') {
          turnText.textContent = 'استعد…';
        } else if (s.mode === 'arcade') {
          turnText.textContent = s.arcade.timeLeft <= 10 ? 'الوقت يلمع… أسرع!' : `الموجة ${num(s.arcade.wave)} — طابق بسرعة!`;
          turnWrap.classList.toggle('is-warn', s.arcade.timeLeft <= 10);
        } else if (active.bot) {
          turnText.textContent = 'زعتر يفكر…';
          turnWrap.classList.remove('is-warn', 'is-fever');
          turnWrap.classList.add('is-ai');
        } else if (s.firstPick !== null) {
          turnText.textContent = 'بطاقة واحدة… أكمل!';
          turnWrap.classList.remove('is-warn', 'is-ai', 'is-fever');
        } else {
          turnText.textContent = s.isSudden ? `أول مطابقة تفوز — دور ${active.name}` : `دور ${active.name}…`;
          turnWrap.classList.remove('is-warn', 'is-ai', 'is-fever');
        }
      }
      // ability energy row
      this.updateEnergyPips();
      // combo chip
      const active = s.players[s.current];
      const chip = $('#comboChip');
      if (chip) {
        if (active && active.combo >= 2) {
          chip.hidden = false;
          $('#comboText').textContent = `×${num(Math.min(5, active.combo))}`;
          chip.classList.toggle('is-hot', active.combo >= 3);
        } else {
          chip.hidden = true;
        }
      }
      const hint = $('#turnHint span');
      if (hint) hint.textContent = s.mode === 'arcade'
        ? (s.firstPick !== null ? 'أكمل الزوج قبل أن ينفد الوقت' : 'اقلب بسرعة… كل ثانية تهم')
        : (s.firstPick !== null ? 'أكمل الزوج… أو سيذهب الدور' : 'اقلب بطاقتين… وابحث عن التوأم');
    },

    animateActivePlayer() {
      const s = this.state;
      if (!s) return;
      $$('.player-card').forEach((card) => {
        card.style.animation = 'none';
        void card.offsetWidth;
        card.style.animation = '';
      });
    },

    /* ═══════════════════════════ AI ═══════════════════════════ */
    availableIndices() {
      const s = this.state;
      if (!s) return [];
      return s.deck.map((card, i) => (!card.matched && !card.faceUp ? i : -1)).filter((i) => i >= 0);
    },

    knownIndicesFor(fruit) {
      const s = this.state;
      if (!s) return [];
      const set = s.aiMemory.get(fruit);
      if (!set) return [];
      return [...set].filter((i) => s.deck[i] && !s.deck[i].matched && !s.deck[i].faceUp);
    },

    knownPairs() {
      const s = this.state;
      const result = [];
      if (!s) return result;
      s.aiMemory.forEach((set, fruit) => {
        const valid = [...set].filter((i) => s.deck[i] && !s.deck[i].matched);
        if (valid.length >= 2) result.push([valid[0], valid[1]]);
      });
      return result;
    },

    chooseAiPair() {
      const s = this.state;
      if (!s) return [];
      const diff = DIFFICULTY[s.difficulty] || DIFFICULTY.medium;
      const available = this.availableIndices();
      if (!available.length) return [];
      const pairs = this.knownPairs();
      if (pairs.length && Math.random() < diff.knownPairChance) {
        const pair = pick(pairs).filter((i) => available.includes(i));
        if (pair.length === 2) return pair;
      }
      const unseen = available.filter((i) => {
        for (const set of s.aiMemory.values()) if (set.has(i)) return false;
        return true;
      });
      let first;
      if (unseen.length && Math.random() < (s.difficulty === 'easy' ? .7 : s.difficulty === 'hard' ? .4 : .55)) first = pick(unseen);
      else first = pick(available);
      const knownMatch = this.knownIndicesFor(s.deck[first].fruit).find((i) => i !== first);
      if (knownMatch != null && Math.random() < diff.followChance) return [first, knownMatch];
      const rest = available.filter((i) => i !== first);
      if (!rest.length) return [first];
      return [first, pick(rest)];
    },

    maybeRunAi() {
      const s = this.state;
      if (!s || s.phase !== 'playing' || s.paused || s.locked) return;
      const active = s.players[s.current];
      if (!active || !active.bot) return;
      if (s.aiTimer) return;
      const diff = DIFFICULTY[s.difficulty] || DIFFICULTY.medium;
      const delay = s.firstPick === null ? diff.firstThink : diff.secondThink;
      s.aiThinking = true;
      this.updateHUD();
      s.aiTimer = this.later(() => {
        const cur = this.state;
        if (!cur || cur !== s || cur.phase !== 'playing' || cur.paused || cur.locked) {
          if (s) s.aiTimer = null;
          return;
        }
        if (!cur.players[cur.current] || !cur.players[cur.current].bot) { s.aiTimer = null; return; }
        s.aiTimer = null;
        if (cur.firstPick === null) {
          const pair = this.chooseAiPair();
          if (!pair.length) { s.aiThinking = false; return; }
          cur.aiPlanned = pair;
          this.pickCard(pair[0], 'ai');
          if (pair.length > 1) this.maybeRunAi();
        } else {
          let second = cur.aiPlanned && cur.aiPlanned[1];
          if (second == null || cur.deck[second].matched || cur.deck[second].faceUp) {
            const match = this.knownIndicesFor(cur.deck[cur.firstPick].fruit).find((i) => i !== cur.firstPick && !cur.deck[i].faceUp);
            const options = this.availableIndices().filter((i) => i !== cur.firstPick);
            second = match != null ? match : (options.length ? pick(options) : null);
          }
          if (second != null) this.pickCard(second, 'ai');
          else this.switchTurn('ai-empty');
        }
      }, delay);
    },

    clearAiTimer() {
      const s = this.state;
      if (!s || !s.aiTimer) return;
      clearTimeout(s.aiTimer);
      if (s.timers) s.timers.delete(s.aiTimer);
      s.aiTimer = null;
      s.aiThinking = false;
    },

    /* ═══════════════════════════ fever & announcements ═══════════════════════════ */
    triggerFever(player) {
      const s = this.state;
      if (!s) return;
      $('#screen-game').classList.add('is-fever');
      $('#boardShell').classList.add('is-fever');
      Sfx.fever();
      this.flashTurnMessage(`وضع البرق! ${player.name} يشتعل ⚡`, 'is-fever');
      this.flashScreen();
      this.spawnComboCallout('وضع البرق!', `سلسلة ${num(player.combo)} — النقاط تتضاعف`, '#b78133');
      this.shakeBoard();
    },

    flashScreen() {
      if (document.body.classList.contains('reduce-motion')) return;
      const flash = document.createElement('div');
      flash.className = 'fever-flash';
      document.body.appendChild(flash);
      setTimeout(() => flash.remove(), 750);
    },

    showBanner(kicker, title, cls = '', duration = 1100) {
      const banner = $('#boardBanner');
      if (!banner) return;
      banner.className = `board-banner${cls ? ' ' + cls : ''}`;
      $('#bannerKicker').textContent = kicker;
      $('#bannerTitle').textContent = title;
      $('#bannerSub').textContent = '';
      banner.hidden = false;
      clearTimeout(this._bannerTimer);
      this._bannerTimer = setTimeout(() => { banner.hidden = true; }, duration);
    },

    showBannerFull(kicker, title, sub, cls = '', duration = 1500) {
      const banner = $('#boardBanner');
      if (!banner) return;
      banner.className = `board-banner${cls ? ' ' + cls : ''}`;
      $('#bannerKicker').textContent = kicker;
      $('#bannerTitle').textContent = title;
      $('#bannerSub').textContent = sub || '';
      banner.hidden = false;
      clearTimeout(this._bannerTimer);
      this._bannerTimer = setTimeout(() => { banner.hidden = true; }, duration);
    },

    showTimeBonus(seconds) {
      const el = document.createElement('div');
      el.className = 'float-score';
      el.style.cssText = 'left:50%;top:10%;color:#7f8d4b;';
      el.textContent = `+${String(seconds.toFixed(seconds % 1 ? 1 : 0)).replace('.', '٫').replace(/\d/g, (d) => AR[+d])} ث`;
      $('#effectLayer').appendChild(el);
      setTimeout(() => el.remove(), 1200);
    },

    spawnPenalty(a, b) {
      const el = document.createElement('div');
      el.className = 'float-score is-big';
      el.style.cssText = 'left:50%;top:38%;color:#b95c67;';
      el.textContent = '−٤ ث';
      $('#effectLayer').appendChild(el);
      setTimeout(() => el.remove(), 1200);
    },

    shakeBoard(soft = false) {
      if (document.body.classList.contains('reduce-motion')) return;
      const area = $('.board-area');
      if (!area) return;
      area.classList.remove('is-shaking');
      void area.offsetWidth;
      area.classList.add('is-shaking');
      setTimeout(() => area.classList.remove('is-shaking'), soft ? 400 : 480);
    },

    spawnComboCallout(big, small, color = '#8a6230') {
      if (document.body.classList.contains('reduce-motion')) return;
      const layer = $('#effectLayer');
      if (!layer) return;
      const el = document.createElement('div');
      el.className = 'combo-callout';
      el.innerHTML = `<strong style="color:${color}">${esc(big)}</strong><span>${esc(small)}</span>`;
      layer.appendChild(el);
      setTimeout(() => el.remove(), 1100);
    },

    spawnMatchEffects(a, b, fruitId, golden, points, combo) {
      const s = this.state;
      if (!s) return;
      const layer = $('#effectLayer');
      const shell = $('#boardShell');
      if (!layer || !shell) return;
      const shellRect = shell.getBoundingClientRect();
      const cards = [a, b].map((i) => $('#board').querySelector(`[data-index="${i}"]`));
      const rect = cards[0] ? cards[0].getBoundingClientRect() : null;
      const midX = cards.reduce((sum, card) => {
        const r = card ? card.getBoundingClientRect() : null;
        return sum + (r ? r.left + r.width / 2 : 0);
      }, 0) / 2 - shellRect.left;
      const midY = cards.reduce((sum, card) => {
        const r = card ? card.getBoundingClientRect() : null;
        return sum + (r ? r.top + r.height / 2 : 0);
      }, 0) / 2 - shellRect.top;
      if (!document.body.classList.contains('reduce-motion')) {
        const fruit = Art.fruitSrc(fruitId);
        const count = golden ? 11 : 7;
        for (let i = 0; i < count; i++) {
          const img = document.createElement('img');
          img.src = fruit;
          img.className = 'fruit-pop';
          img.style.left = midX + rand(-24, 24) + 'px';
          img.style.top = midY + rand(-20, 20) + 'px';
          img.style.setProperty('--dx', rand(-70, 70) + 'px');
          img.style.setProperty('--dy', rand(-95, -25) + 'px');
          img.style.setProperty('--rot', rand(-180, 180) + 'deg');
          img.style.setProperty('--dur', rand(650, 1000) + 'ms');
          img.style.animationDelay = rand(0, 80) + 'ms';
          layer.appendChild(img);
          setTimeout(() => img.remove(), 1200);
        }
        for (let i = 0; i < (golden ? 20 : 11); i++) {
          const bit = document.createElement('span');
          bit.className = 'spark-bit';
          bit.style.left = midX + rand(-16, 16) + 'px';
          bit.style.top = midY + rand(-12, 12) + 'px';
          bit.style.setProperty('--dx', rand(-65, 65) + 'px');
          bit.style.setProperty('--dy', rand(-80, 20) + 'px');
          bit.style.setProperty('--rot', rand(-160, 160) + 'deg');
          bit.style.background = pick(['#f2c466', '#fff3d2', '#dcad5a', '#f7dba6']);
          bit.style.animationDelay = rand(0, 120) + 'ms';
          layer.appendChild(bit);
          setTimeout(() => bit.remove(), 1100);
        }
      }
      const score = document.createElement('div');
      score.className = `float-score${golden || s.players[s.current].combo >= 3 ? ' is-big' : ''}`;
      score.style.left = midX + 'px';
      score.style.top = midY - 10 + 'px';
      score.textContent = `+${num(points)}`;
      layer.appendChild(score);
      setTimeout(() => score.remove(), 1300);
      if (combo >= 2) {
        this.spawnComboCallout(`×${num(Math.min(5, combo))}`, combo >= 3 ? 'سلسلة مشتعلة!' : 'سلسلة رائعة!', combo >= 3 ? '#9e6a25' : '#6b557d');
      }
      if (!document.body.classList.contains('reduce-motion')) {
        const area = $('.board-area');
        area.classList.remove('is-shaking');
        void area.offsetWidth;
        area.classList.add('is-shaking');
        setTimeout(() => area.classList.remove('is-shaking'), 480);
      }
    },

    spawnPawCloud() {
      if (document.body.classList.contains('reduce-motion')) return;
      const layer = $('#effectLayer');
      if (!layer) return;
      for (let i = 0; i < 8; i++) {
        const el = document.createElement('span');
        el.className = 'paw-puff';
        el.innerHTML = '<svg class="ico"><use href="#i-paw"/></svg>';
        el.style.left = rand(20, 80) + '%';
        el.style.top = rand(20, 80) + '%';
        el.style.setProperty('--dx', rand(-40, 40) + 'px');
        el.style.setProperty('--dy', rand(-50, -10) + 'px');
        el.style.setProperty('--rot', rand(-40, 40) + 'deg');
        el.style.animationDelay = i * 40 + 'ms';
        layer.appendChild(el);
        setTimeout(() => el.remove(), 1000);
      }
    },

    /* ═══════════════════════════ wave / ending ═══════════════════════════ */
    completeWave() {
      const s = this.state;
      if (!s || !s.arcade) return;
      s.phase = 'wavebreak';
      s.locked = true;
      const wave = s.arcade.wave;
      const bonus = 250 * wave;
      s.arcade.score += bonus;
      s.players[0].score = s.arcade.score;
      s.arcade.timeLeft = Math.min(99, s.arcade.timeLeft + 15);
      Sfx.wave();
      this.updateHUD();
      this.updateTimerDisplay();
      this.showBannerFull(`الموجة ${num(wave)} اكتملت`, 'استعد للموجة التالية', `+${num(bonus)} نقطة و +١٥ ثانية`, 'is-fever', 1800);
      this.spawnComboCallout('موجة جديدة!', `+${num(bonus)} نقطة`, '#9a6a29');
      if (!document.body.classList.contains('reduce-motion')) {
        const layer = $('#effectLayer');
        if (layer) {
          for (let i = 0; i < 18; i++) {
            const bit = document.createElement('span');
            bit.className = 'spark-bit';
            bit.style.left = rand(15, 85) + '%';
            bit.style.top = rand(20, 80) + '%';
            bit.style.setProperty('--dx', rand(-50, 50) + 'px');
            bit.style.setProperty('--dy', rand(-90, -20) + 'px');
            bit.style.background = pick(['#f2c466', '#fff6df', '#d7a452']);
            layer.appendChild(bit);
            setTimeout(() => bit.remove(), 1200);
          }
        }
      }
      this.later(() => {
        if (!this.state || this.state !== s || s.phase === 'ended') return;
        s.arcade.wave += 1;
        s.players[0].combo = Math.max(0, s.players[0].combo); // carry momentum
        s.deck = this.makeDeck(12, 12);
        s.locked = false;
        s.firstPick = null;
        s.secondPick = null;
        s.phase = 'playing';
        s.cols = 6;
        $('#boardShell').classList.remove('is-sudden');
        this.renderBoard(6);
        this.updateHUD(true);
        this.updateAbilityUI();
        this.lastTickSecond = null;
        $('#boardBanner').hidden = true;
        Sfx.cardRiffle();
        App.toast(`الموجة ${num(s.arcade.wave)} — فرصة جديدة!`, { icon: 'bolt', tone: 'gold' });
      }, 1950);
    },

    evaluateBoardEnd() {
      const s = this.state;
      if (!s) return;
      const [p1, p2] = s.players;
      let winner = null;
      if (p1.pairs > p2.pairs) winner = 0;
      else if (p2.pairs > p1.pairs) winner = 1;
      else if (p1.score > p2.score) winner = 0;
      else if (p2.score > p1.score) winner = 1;
      if (winner === null) {
        this.startSuddenDeath();
        return;
      }
      this.finishGame(winner);
    },

    startSuddenDeath() {
      const s = this.state;
      if (!s) return;
      s.isSudden = true;
      s.round = 2;
      s.phase = 'suddenbreak';
      s.locked = true;
      Sfx.fever();
      this.showBannerFull('تعادل نادر!', 'جولة الحسم الذهبية', 'أول مطابقة تفوز… ولا مجال للخطأ', 'is-gold', 2200);
      this.spawnComboCallout('الجولة الذهبية!', 'أول مطابقة تفوز', '#a36e26');
      this.later(() => {
        if (!this.state || this.state !== s || s.phase === 'ended') return;
        s.deck = this.makeDeck(3, 3);
        s.cols = 3;
        s.current = s.current === 0 ? 1 : 0;
        s.players.forEach((p) => { p.combo = 0; p.energy = 2; });
        s.firstPick = null;
        s.secondPick = null;
        s.locked = false;
        s.phase = 'playing';
        s.timeLeft = SUDDEN_TIME;
        s.turnMax = SUDDEN_TIME;
        s.lastWholeSecond = null;
        $('#boardShell').classList.add('is-sudden');
        this.renderBoard(3);
        this.updateHUD(true);
        this.updateAbilityUI();
        this.flashTurnMessage(`أول مطابقة تفوز — دور ${s.players[s.current].name}`, '');
        Sfx.wave();
        if (s.players[s.current].bot) this.maybeRunAi();
      }, 2400);
    },

    finishGame(winnerIndex) {
      const s = this.state;
      if (!s || s.phase === 'ended') return;
      if (s.paused) {
        s.pendingEnd = { winnerIndex };
        return;
      }
      s.phase = 'ended';
      s.locked = true;
      s.paused = false;
      this.stopRaf();
      this.clearAiTimer();
      this.clearTimers();
      $('#countdownOverlay').hidden = true;
      $('#boardBanner').hidden = true;
      $('#screen-game').classList.remove('is-fever');
      const winner = s.players[winnerIndex] || s.players[0];
      const store = App.save();
      const isAi = s.mode === 'ai';
      const humanWon = winnerIndex === 0;
      let stars;
      if (isAi) stars = humanWon ? 6 : 2;
      else stars = winnerIndex === 0 ? 5 : 4;
      store.stars = Math.max(0, Number(store.stars || 0) + stars);
      store.gamesPlayed = (store.gamesPlayed || 0) + 1;
      if (humanWon) store.totalWins = (store.totalWins || 0) + 1;
      App.persist(true);
      App.updateStarUI();
      App.updateMenuStats();
      const acc = s.stats.moves ? Math.round((s.stats.matches / s.stats.moves) * 100) : 0;
      let title;
      let sub;
      let eyebrow;
      if (isAi) {
        if (humanWon) {
          title = `هزمت زعتر يا ${winner.name}!`;
          sub = 'ذاكرة أسرع من ذكاء القط. إنجاز يستحق الاحتفال.';
          eyebrow = 'انتصار على القط الذكي';
        } else {
          title = 'زعتر ابتسم هذه المرة…';
          sub = 'لا بأس، هو يتدرب منذ سنوات. الثأر في الجولة القادمة!';
          eyebrow = 'جولة قوية… والنتيجة لزعتر';
        }
      } else {
        title = s.isSudden ? `خطفها ${winner.name}!` : `مبروك يا ${winner.name}!`;
        sub = s.isSudden ? 'جولة الحسم… وقلب لم يرتجف. ما أجملها من مواجهة!' : 'قلبٌ سريع… وذاكرة أسرع.';
        eyebrow = s.isSudden ? 'جولة الحسم الذهبية' : 'نهاية مواجهة شرسة';
      }
      const scoreline = s.players.map((p, i) => `<span class="score-player${i === winnerIndex ? ' is-winner' : ''}">
        <span class="mini-cat">${Art.catAvatarSvg(p.cat)}</span>
        <span class="score-player-main">
          <span class="score-name">${esc(p.name)}</span>
          <span class="score-pairs"><b>${num(p.pairs)}</b> زوج <em>•</em> ${num(p.score)} نقطة</span>
        </span>
        ${i === winnerIndex ? '<svg class="ico crown-icon"><use href="#i-crown"/></svg>' : ''}
      </span>`).join('<span class="score-vs">VS</span>');
      const stats = [
        { icon: 'i-paw', value: `${num(s.players[0].pairs)} / ${num(s.players[1].pairs)}`, label: 'الأزواج' },
        { icon: 'i-bolt', value: `×${num(Math.min(5, Math.max(1, s.stats.maxCombo)))}`, label: 'أطول سلسلة' },
        { icon: 'i-eye', value: pctText(acc), label: 'دقة المطابقة' },
        { icon: 'i-sparkle', value: num(s.stats.peeks + s.stats.shuffles), label: 'قدرات مستخدمة' }
      ];
      this.lastResult = { type: 'duel', winnerIndex, config: JSON.parse(JSON.stringify(this.lastConfig || {})), stats: s.stats };
      const isHumanWin = isAi ? humanWon : true;
      if (isHumanWin) Sfx.win(); else Sfx.lose();
      this.showResults({
        eyebrow,
        title,
        sub,
        cat: winner.cat,
        scoreline,
        stats,
        reward: stars,
        newBest: false,
        type: isAi && !humanWon ? 'ai-loss' : 'win',
        confetti: true
      });
    },

    finishArcade() {
      const s = this.state;
      if (!s || s.phase === 'ended' || !s.arcade) return;
      if (s.paused) { s.pendingEnd = { arcade: true }; return; }
      s.phase = 'ended';
      s.locked = true;
      s.paused = false;
      this.stopRaf();
      this.clearAiTimer();
      this.clearTimers();
      $('#countdownOverlay').hidden = true;
      $('#boardBanner').hidden = true;
      $('#screen-game').classList.remove('is-fever');
      const store = App.save();
      const score = s.arcade.score;
      const previousBest = store.bestArcade || 0;
      const newBest = score > previousBest;
      store.bestArcade = Math.max(previousBest, score);
      const stars = Math.max(1, Math.min(14, Math.floor(score / 650) + 1 + (s.arcade.wave - 1)));
      store.stars = Math.max(0, Number(store.stars || 0) + stars);
      store.gamesPlayed = (store.gamesPlayed || 0) + 1;
      App.persist(true);
      App.updateStarUI();
      App.updateMenuStats();
      const acc = s.arcade.moves ? Math.round((s.arcade.matches / s.arcade.moves) * 100) : 0;
      let title;
      let sub;
      let eyebrow;
      if (newBest && score > 0) {
        title = 'رقم قياسي جديد!';
        sub = 'البرق صار أسرع… والرصيد يفتح أبوابًا جديدة. هل تكسره مرة أخرى؟';
        eyebrow = 'أفضل نتيجة جديدة';
      } else if (score >= 1600) {
        title = 'برقٌ لا يُوقف!';
        sub = 'سرعة، ذاكرة، وقدرات قطة. الجمهور في المدرجات يصفق.';
        eyebrow = 'تحدي البرق';
      } else {
        title = score > 0 ? 'قلبُك يلمع!' : 'الوقت انتهى… والبداية غدًا';
        sub = score > 0 ? 'تذكر: كل مطابقة تضيف وقتًا، والخطأ يسرق ثواني. الجولة القادمة أسرع.' : 'الوقت يمر بسرعة… لكن القطط تعود دائمًا.';
        eyebrow = 'تحدي البرق';
      }
      const scoreline = `<span class="score-player is-winner">
        <span class="mini-cat">${Art.catAvatarSvg(s.players[0].cat)}</span>
        <span class="score-player-main">
          <span class="score-name">${esc(s.players[0].name)}</span>
          <span class="score-pairs"><b>${num(score)}</b> نقطة <em>•</em> ${num(s.arcade.matches)} مطابقة</span>
        </span>
        ${newBest ? '<span class="result-best-badge"><svg class="ico"><use href="#i-trophy"/></svg> رقم قياسي</span>' : `<span class="score-vs">أفضل ${num(previousBest)}</span>`}
      </span>`;
      const stats = [
        { icon: 'i-trophy', value: num(score), label: 'النقاط' },
        { icon: 'i-bolt', value: num(s.arcade.wave), label: 'الموجة' },
        { icon: 'i-paw', value: num(s.arcade.matches), label: 'مطابقات' },
        { icon: 'i-eye', value: pctText(acc), label: 'دقة المطابقة' }
      ];
      this.lastResult = { type: 'arcade', config: JSON.parse(JSON.stringify(this.lastConfig || {})), stats: s.stats };
      Sfx.reward();
      setTimeout(() => Sfx.win(), 200);
      this.showResults({
        eyebrow,
        title,
        sub,
        cat: s.players[0].cat,
        scoreline,
        stats,
        reward: stars,
        newBest,
        type: newBest ? 'best' : 'arcade',
        confetti: true
      });
    },

    showResults(data) {
      this.lastResult = this.lastResult || {};
      this.lastResult.presentation = data;
      UI.closeAll();
      this.activateScreen('screen-results');
      document.body.classList.add('on-results');
      document.body.classList.remove('in-game');
      $('#resultsEyebrow').textContent = data.eyebrow || '';
      $('#resultTitle').textContent = data.title || '';
      $('#resultSub').textContent = data.sub || '';
      const catWrap = $('#resultCat');
      if (catWrap) catWrap.innerHTML = Art.catAvatarSvg(data.cat || Art.catById('lulu'));
      $('#resultScoreline').innerHTML = data.scoreline || '';
      $('#resultStats').innerHTML = (data.stats || []).map((stat) => `<div class="result-stat">
        <svg class="ico"><use href="#${stat.icon}"/></svg><div><b>${stat.value}</b><span>${esc(stat.label)}</span></div>
      </div>`).join('');
      const reward = $('#resultReward');
      reward.classList.toggle('is-empty', !data.reward);
      reward.innerHTML = `<svg class="ico"><use href="#i-star"/></svg> <b>+${num(data.reward || 0)} نجوم</b><span>أُضيفت إلى رصيدك</span>`;
      const btnRematchLabel = $('#btnRematch .btn-label') || $('#btnRematch');
      if (btnRematchLabel) btnRematchLabel.textContent = data.type === 'arcade' ? 'جولة برق أخرى' : 'إعادة التحدي';
      Sfx.setScene('results');
      if (data.confetti) this.startConfetti();
      this.tempResultsData = data;
    },

    leaveToMenu(opts = {}) {
      this.stopRaf();
      this.clearTimers();
      this.clearAiTimer();
      this.stopConfetti();
      if (this.state) this.state.phase = 'ended';
      this.state = null;
      UI.closeAll();
      this.activateScreen('screen-menu');
      document.body.classList.remove('in-game');
      document.body.classList.remove('on-results');
      App.updateMenuStats();
      Sfx.setScene('menu');
      if (opts.openModes) setTimeout(() => UI.open('modes'), 280);
    },

    retry() {
      const cfg = this.lastResult && this.lastResult.config;
      if (!cfg) { this.leaveToMenu({ openModes: true }); return; }
      this.start(cfg);
    },

    /* ═══════════════════════════ pause / exit ═══════════════════════════ */
    pause(opts = {}) {
      const s = this.state;
      if (!s || s.phase === 'ended' || s.paused) return;
      if (s.phase === 'countdown') return;
      s.paused = true;
      this.clearAiTimer();
      $('#turnTimer').classList.add('is-paused');
      Sfx.duckMusic(.13, 'pause');
      if (opts.modal !== false) UI.open('pause');
    },

    resume(opts = {}) {
      const s = this.state;
      if (!s || !s.paused) return;
      s.paused = false;
      s.visibilityPaused = false;
      this.lastFrame = performance.now();
      $('#turnTimer').classList.remove('is-paused');
      Sfx.unduckMusic('pause');
      this.updateHUD();
      this.updateAbilityUI();
      if (s.pendingEnd) {
        const pending = s.pendingEnd;
        s.pendingEnd = null;
        if (pending.arcade) this.finishArcade();
        else this.finishGame(pending.winnerIndex);
        return;
      }
      if (s.players[s.current] && s.players[s.current].bot) this.maybeRunAi();
    },

    openPauseUI() {
      const s = this.state;
      if (!s) return;
      const active = s.players[s.current];
      $('#pauseMatches').textContent = s.mode === 'arcade' ? num(s.arcade.matches) : num(active.pairs);
      $('#pauseCombo').textContent = `×${num(Math.min(5, Math.max(1, active.combo)))}`;
      $('#pauseEnergy').textContent = num(active.energy);
      if (s.mode === 'arcade') {
        $('#pauseTitle').textContent = 'خذ نفسًا…';
      } else {
        $('#pauseTitle').textContent = s.isSudden ? 'جولة الحسم تنتظر…' : 'خذ نفسًا…';
      }
    },

    requestExit() {
      const s = this.state;
      if (!s || s.phase === 'ended') {
        this.leaveToMenu();
        return;
      }
      if (!s.paused) this.pause();
      UI.confirm({
        title: 'نترك الجولة الآن؟',
        text: 'سيُفقد تقدم هذه الجولة، لكن النجوم التي جمعتها من قبل ستبقى. سنعود للمائدة الرئيسية.',
        confirmLabel: 'نعم، اخرج',
        cancelLabel: 'لا، أكمل اللعب',
        icon: 'i-home',
        onConfirm: () => {
          App.UI.closeAll();
          this.leaveToMenu();
        }
      });
    },

    restartRequest() {
      UI.confirm({
        title: 'من البداية؟',
        text: 'ستبدأ الجولة من جديد بنفس اللاعبين والإعدادات.',
        confirmLabel: 'نعم، أعد الجولة',
        cancelLabel: 'لا، أكمل',
        icon: 'i-refresh',
        onConfirm: () => {
          App.UI.closeAll();
          const cfg = this.lastConfig || (this.lastResult && this.lastResult.config);
          if (cfg) this.start(JSON.parse(JSON.stringify(cfg)));
        }
      });
    },

    /* ═══════════════════════════ timers ═══════════════════════════ */
    later(fn, ms) {
      const s = this.state;
      if (!s) return null;
      const id = setTimeout(() => {
        if (s.timers) s.timers.delete(id);
        if (!this.state || this.state !== s) return;
        if (s.phase === 'ended') return;
        fn();
      }, ms);
      s.timers.add(id);
      return id;
    },

    clearTimers() {
      const s = this.state;
      if (!s) return;
      if (s.timers) {
        s.timers.forEach((id) => clearTimeout(id));
        s.timers.clear();
      }
      if (s.aiTimer) { clearTimeout(s.aiTimer); s.aiTimer = null; }
      if (this._bannerTimer) { clearTimeout(this._bannerTimer); this._bannerTimer = null; }
    },

    /* ═══════════════════════════ confetti ═══════════════════════════ */
    startConfetti() {
      if (document.body.classList.contains('reduce-motion') || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const canvas = $('#confettiCanvas');
      if (!canvas) return;
      this.stopConfetti();
      const ctx = canvas.getContext('2d');
      const c = this.confetti;
      c.canvas = canvas;
      c.ctx = ctx;
      c.active = true;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const resize = () => {
        canvas.width = innerWidth * dpr;
        canvas.height = innerHeight * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      };
      resize();
      const colors = ['#f1c46c', '#a77bad', '#e3918c', '#96b8d6', '#f9efd9', '#c5a7de', '#cf9f54'];
      c.pieces = Array.from({ length: 155 }, () => ({
        x: rand(0, innerWidth),
        y: rand(-innerHeight * .65, -20),
        w: rand(4, 9),
        h: rand(6, 14),
        vx: rand(-.55, .55),
        vy: rand(1.3, 3.8),
        rot: rand(0, Math.PI * 2),
        vr: rand(-.07, .07),
        color: pick(colors),
        shape: Math.random() < .28 ? 'circle' : Math.random() < .2 ? 'paw' : 'rect',
        wobble: rand(0, Math.PI * 2)
      }));
      let start = performance.now();
      const draw = (now) => {
        if (!c.active) return;
        ctx.clearRect(0, 0, innerWidth, innerHeight);
        c.pieces.forEach((p) => {
          p.x += p.vx + Math.sin(now * .0015 + p.wobble) * .35;
          p.y += p.vy;
          p.rot += p.vr;
          if (p.y > innerHeight + 30) { p.y = -30; p.x = rand(0, innerWidth); }
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.globalAlpha = clamp(1 - (now - start - 4200) / 2600, 0, 1);
          if (p.shape === 'circle') {
            ctx.beginPath();
            ctx.arc(0, 0, p.w * .55, 0, Math.PI * 2);
            ctx.fill();
          } else if (p.shape === 'paw') {
            ctx.beginPath();
            ctx.ellipse(0, 2, p.w * .55, p.h * .35, 0, 0, Math.PI * 2);
            ctx.arc(-p.w * .45, -3, p.w * .22, 0, Math.PI * 2);
            ctx.arc(0, -5, p.w * .24, 0, Math.PI * 2);
            ctx.arc(p.w * .45, -3, p.w * .22, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          }
          ctx.restore();
        });
        if (now - start > 6500) {
          this.stopConfetti();
          return;
        }
        c.raf = requestAnimationFrame(draw);
      };
      c.raf = requestAnimationFrame(draw);
    },

    stopConfetti() {
      const c = this.confetti;
      c.active = false;
      if (c.raf) cancelAnimationFrame(c.raf);
      c.raf = null;
      if (c.ctx && c.canvas) c.ctx.clearRect(0, 0, c.canvas.width, c.canvas.height);
    },

    /* ═══════════════════════════ events ═══════════════════════════ */
    bindEvents() {
      $('#board')?.addEventListener('click', (e) => this.handleBoardClick(e));
      $('#abilityPeek')?.addEventListener('click', () => this.useAbility('peek'));
      $('#abilityShuffle')?.addEventListener('click', () => this.useAbility('shuffle'));
      $('#btnGamePause')?.addEventListener('click', () => this.pause());
      $('#btnGameExit')?.addEventListener('click', () => {
        if (this.state) this.requestExit();
        else this.leaveToMenu();
      });
      $('#btnGameGuide')?.addEventListener('click', () => {
        if (!this.state || this.state.phase === 'ended') return;
        if (!this.state.paused) this.pause();
        UI.open('guide', { returnModal: 'pause' });
      });
      $('#btnResume')?.addEventListener('click', () => UI.close());
      $('#btnRestart')?.addEventListener('click', () => this.restartRequest());
      $('#btnPauseGuide')?.addEventListener('click', () => UI.open('guide', { returnModal: 'pause' }));
      $('#btnPauseSettings')?.addEventListener('click', () => UI.open('settings', { returnModal: 'pause' }));
      $('#btnPauseExit')?.addEventListener('click', () => this.requestExit());
      $('#btnRematch')?.addEventListener('click', () => {
        const cfg = this.lastResult && this.lastResult.config ? this.lastResult.config : this.lastConfig;
        if (!cfg) { this.leaveToMenu({ openModes: true }); return; }
        this.start(cfg);
      });
      $('#btnChangeMode')?.addEventListener('click', () => this.leaveToMenu({ openModes: true }));
      $('#btnResultsHome')?.addEventListener('click', () => this.leaveToMenu());
      $('#btnResultsMenu')?.addEventListener('click', () => this.leaveToMenu());
      document.addEventListener('visibilitychange', () => {
        if (document.hidden && this.state && this.state.phase === 'playing' && !this.state.paused) {
          this._pausedByVisibility = true;
          this.pause();
        }
      });
      window.addEventListener('resize', () => {
        if (this.state && this.state.phase === 'ended') return;
      }, { passive: true });
    },

    /* Debug hooks for the marketing trailer / deterministic screenshots. */
    debugStart(config, options = {}) {
      const cfg = config || {
        mode: 'duel',
        players: [
          { name: 'لولو', catId: 'lulu', bot: false },
          { name: 'زعتر', catId: 'zaatar', bot: false }
        ]
      };
      this.start(cfg, { skipCountdown: true, ...options });
      const s = this.state;
      if (s) {
        s.paused = true;
        s.phase = 'playing';
        s.locked = false;
      }
    },

    debugReveal(indices = []) {
      const s = this.state;
      if (!s) return;
      indices.forEach((index) => {
        if (!s.deck[index] || s.deck[index].matched) return;
        this.flipUp(index, 'human');
      });
      this.updateHUD();
    },

    debugSetScores(pairsA = 4, pairsB = 3, cardsA = 8, cardsB = 6) {
      const s = this.state;
      if (!s) return;
      s.players[0].pairs = pairsA;
      s.players[1].pairs = pairsB;
      s.players[0].score = pairsA * 180;
      s.players[1].score = pairsB * 160;
      let ai = 0, bi = 0;
      s.deck.forEach((card, index) => {
        if (card.matched) return;
        if (ai < cardsA) { card.matched = true; ai++; }
        else if (bi < cardsB) { card.matched = true; bi++; }
      });
      s.deck.forEach((card, index) => {
        if (card.matched) {
          const el = $('#board').querySelector(`[data-index="${index}"]`);
          if (el) el.classList.add('is-cleared', 'is-locked');
        }
      });
      this.updateHUD();
    }
  };

  Game.bindEvents();
  window.MMGame = Game;
  App.Game = Game;
})();
