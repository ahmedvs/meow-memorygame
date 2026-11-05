/* ══════════════════════════════════════════════════════════════════
   MEOW MEMORY — STORY MODE
   Campaign map, cinematic dialogue, boss profiles and progression.
   ══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const App = window.MMApp;
  const Art = window.MMArt;
  const Game = window.MMGame;
  const Sfx = window.MMAudio;
  const UI = window.MMUI;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const AR = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  const num = (n) => String(Math.max(0, Math.round(Number(n) || 0))).replace(/\d/g, (d) => AR[+d]);

  const EXPRESSION_LABEL = {
    happy: 'سعيد',
    surprised: 'متفاجئ',
    angry: 'غاضب',
    confident: 'واثق',
    sad: 'حزين',
    mysterious: 'غامض',
    neutral: 'هادئ'
  };

  /* ─────────────────────────── campaign data ─────────────────────────── */
  const CHAPTERS = [
    {
      id: 'tutorial',
      number: 1,
      title: 'اختبار الذاكرة',
      tag: 'البداية',
      place: 'ساحة البداية',
      opponentId: 'meow',
      opponent: 'مياو ميموري',
      ability: 'none',
      abilityLabel: 'ودّي… في الظاهر',
      accent: '#b79aff',
      difficulty: 'easy',
      profile: { knownPairChance: .3, followChance: .25, observeChance: .35, confidenceMin: .6, firstThink: 820, secondThink: 720 },
      summary: 'مواجهة تعليمية خفيفة مع مياو ميموري. لا قدرات، فقط ذاكرة وابتسامة.',
      preScene: 'tutorial-pre',
      winScene: 'tutorial-win',
      loseScene: 'tutorial-lose',
      intro: [
        { who: 'meow', expression: 'happy', text: 'مياااو! أهلاً بك! كنت أنتظرك!' },
        { who: 'meow', expression: 'happy', text: 'أنا مياو ميموري! أحب الألعاب والألغاز… وأعتقد أنك تحبها أيضاً!' },
        { who: 'meow', expression: 'confident', text: 'ما رأيك في تحدٍّ صغير؟ لا تقلق، سأكون لطيفاً معك!' },
        { who: 'meow', expression: 'happy', text: 'لنرَ من يمتلك الذاكرة الأقوى!' }
      ],
      pre: [
        { who: 'meow', expression: 'happy', text: 'ساحة البداية تنتظرنا. هذه المرة سألعب بجدية أكبر قليلاً!' },
        { who: 'meow', expression: 'confident', text: 'تذكّر: اقلب بطاقتين فقط في كل دور. البطاقة الذهبية تمنحك وقتاً إضافياً.' }
      ],
      win: [
        { who: 'meow', expression: 'surprised', text: 'مياااو! لقد فزت بالفعل!' },
        { who: 'meow', expression: 'happy', text: 'لقد تعلمت الأساسيات… الآن تبدأ الحكاية الحقيقية.' },
        { speaker: 'الراوي', text: 'انفتح الفصل الأول: زعتر.', expression: 'mysterious' }
      ],
      lose: [
        { who: 'meow', expression: 'happy', text: 'لا بأس! كل حارس ذاكرة يبدأ بخطوة.' },
        { who: 'meow', expression: 'confident', text: 'حاول مرة أخرى… أنا واثق بك.' }
      ]
    },
    {
      id: 'zaatar',
      number: 2,
      title: 'ساحة زعتر',
      tag: 'الفصل الأول',
      place: 'حديقة زعتر',
      opponentId: 'zaatar',
      opponent: 'زعتر',
      ability: 'none',
      abilityLabel: 'ذاكرة حادة',
      accent: '#78a9cb',
      difficulty: 'medium',
      profile: { knownPairChance: .52, followChance: .48, observeChance: .72, confidenceMin: .55, firstThink: 620, secondThink: 520 },
      summary: 'زعتر لا يحتاج إلى قدرات. ذاكرته وحدها كافية لتقلب الطاولة.',
      preScene: 'zaatar-pre',
      winScene: 'zaatar-win',
      loseScene: 'zaatar-lose',
      pre: [
        { who: 'meow', expression: 'happy', text: 'أريد أن أعرفك على شخص آخر!' },
        { who: 'meow', expression: 'confident', text: 'هذا زعتر! إنه يحب الفوز كثيراً… وربما أكثر مما ينبغي!' },
        { who: 'zaatar', expression: 'angry', text: 'إذا كنت تعتقد أنك تستطيع الفوز عليّ، فأثبت ذلك!' },
        { who: 'zaatar', expression: 'confident', text: 'سأراقب كل بطاقة تقلبها. لا تستعجل.' }
      ],
      win: [
        { who: 'meow', expression: 'happy', text: 'أحسنت! زعتر يعرف الآن أنك خصم حقيقي.' },
        { who: 'zaatar', expression: 'angry', text: 'هذه المرة… لكنني سأعود أقوى.' },
        { speaker: 'الراوي', text: 'انفتح الفصل الثاني: لوز.', expression: 'mysterious' }
      ],
      lose: [
        { who: 'zaatar', expression: 'confident', text: 'الفوز يحتاج صبراً. ذاكرتك قوية، لكنها تحتاج ترتيباً.' },
        { who: 'meow', expression: 'happy', text: 'لا تستسلم! أعد المحاولة، سأشجعك.' }
      ]
    },
    {
      id: 'luz',
      number: 3,
      title: 'حديقة الهدوء',
      tag: 'الفصل الثاني',
      place: 'حديقة لوز',
      opponentId: 'luz',
      opponent: 'لوز',
      ability: 'freeze',
      abilityLabel: 'تجميد الدور',
      accent: '#a8c6e8',
      difficulty: 'medium',
      profile: { knownPairChance: .62, followChance: .58, observeChance: .8, confidenceMin: .55, firstThink: 540, secondThink: 450 },
      summary: 'لوز يوقف دورك في اللحظة الحرجة. قدرته تتجدد كل خمسة أدوار لك.',
      preScene: 'luz-pre',
      winScene: 'luz-win',
      loseScene: 'luz-lose',
      pre: [
        { who: 'meow', expression: 'surprised', text: 'هذا لوز! يبدو هادئاً، لكنه يستطيع إيقافك في منتصف المباراة!' },
        { who: 'luz', expression: 'confident', text: 'أنا لا أحتاج إلى السرعة… أنا أحتاج إلى التوقيت الصحيح.' },
        { who: 'luz', expression: 'neutral', text: 'حين تتجمد، لا تحاول المقاومة. انتظر… ثم عد.' }
      ],
      win: [
        { who: 'meow', expression: 'happy', text: 'تغلبت على التجميد! رائع!' },
        { who: 'luz', expression: 'sad', text: 'توقيتك… كان أفضل من توقيتي.' },
        { speaker: 'الراوي', text: 'انفتح الفصل الثالث: مشمش.', expression: 'mysterious' }
      ],
      lose: [
        { who: 'luz', expression: 'confident', text: 'الهدوء نصف الفوز. تنفس… ثم حاول مجدداً.' },
        { who: 'meow', expression: 'happy', text: 'تذكّر: تجميده يتجدد كل خمسة أدوار لك. استغل الفرصة بينهما.' }
      ]
    },
    {
      id: 'mishmish',
      number: 4,
      title: 'بيت المقالب',
      tag: 'الفصل الثالث',
      place: 'بيت مشمش',
      opponentId: 'mishmish',
      opponent: 'مشمش',
      ability: 'shuffle',
      abilityLabel: 'تبديل البطاقات',
      accent: '#e6a273',
      difficulty: 'medium',
      profile: { knownPairChance: .7, followChance: .66, observeChance: .85, confidenceMin: .5, firstThink: 520, secondThink: 420 },
      summary: 'مشمش يبدّل موقع بطاقتين دون أن يكشفهما. لا تغضب… أعد ترتيب ذاكرتك.',
      preScene: 'mishmish-pre',
      winScene: 'mishmish-win',
      loseScene: 'mishmish-lose',
      pre: [
        { who: 'meow', expression: 'surprised', text: 'أوه لا! إنه مشمش! أتمنى ألا يكون قد بدأ مقالبَه بالفعل!' },
        { who: 'mishmish', expression: 'happy', text: 'هاهاها! هل تحب ألعاب الذاكرة؟ دعنا نجعلها أكثر إثارة!' },
        { who: 'mishmish', expression: 'confident', text: 'بطاقتان ستغيّران مكانهما… وأنت لن تعرف أيهما!' }
      ],
      win: [
        { who: 'mishmish', expression: 'surprised', text: 'ماذا؟ لم تنطلِ عليك الحيلة!' },
        { who: 'meow', expression: 'happy', text: 'أحسنت! مشمش سيعتزل المقالب… ليوم واحد على الأقل.' },
        { speaker: 'الراوي', text: 'انفتح الفصل الرابع: ظل.', expression: 'mysterious' }
      ],
      lose: [
        { who: 'mishmish', expression: 'happy', text: 'هاهاها! الخلطة نجحت هذه المرة!' },
        { who: 'meow', expression: 'confident', text: 'لا تقلق، بطاقات مشمش لا تغيّر هوياتها. ركّز في اللحظة التالية.' }
      ]
    },
    {
      id: 'zill',
      number: 5,
      title: 'عالم الظل',
      tag: 'الفصل الرابع',
      place: 'وادي الظل',
      opponentId: 'zill',
      opponent: 'ظل',
      ability: 'shadow',
      abilityLabel: 'عالم الظلام',
      accent: '#9a82d2',
      difficulty: 'hard',
      profile: { knownPairChance: .8, followChance: .76, observeChance: .9, confidenceMin: .48, firstThink: 460, secondThink: 360 },
      summary: 'ظل يغطي اللوحة بالظلام لثوانٍ. عيناك البنفسجيتان فقط تريان الطريق.',
      preScene: 'zill-pre',
      winScene: 'zill-win',
      loseScene: 'zill-lose',
      pre: [
        { who: 'meow', expression: 'sad', text: 'لقد وصلنا إلى مكان غريب… كن حذراً.' },
        { who: 'zill', expression: 'mysterious', text: 'النور لن يساعدك هنا.' },
        { who: 'zill', expression: 'confident', text: 'حين يختفي كل شيء، تبقى الذاكرة وحدها.' }
      ],
      win: [
        { who: 'zill', expression: 'surprised', text: 'رأيتَ الطريق رغم الظلام…' },
        { who: 'meow', expression: 'happy', text: 'كنت أعلم أنك تستطيع! انفتح الفصل الخامس: بندق.' }
      ],
      lose: [
        { who: 'zill', expression: 'mysterious', text: 'الظلام لا يخفي البطاقات… بل يخفي ثقتك.' },
        { who: 'meow', expression: 'confident', text: 'خذ نفساً. عندما يزول الظلام، ستعود اللوحة كما كانت.' }
      ]
    },
    {
      id: 'bundoq',
      number: 6,
      title: 'مكتبة الألغاز',
      tag: 'الفصل الخامس',
      place: 'مكتبة بندق',
      opponentId: 'bundoq',
      opponent: 'بندق',
      ability: 'expand',
      abilityLabel: 'توسيع اللوحة',
      accent: '#a8c584',
      difficulty: 'hard',
      profile: { knownPairChance: .88, followChance: .84, observeChance: .95, confidenceMin: .45, firstThink: 420, secondThink: 320 },
      summary: 'بندق يضيف صفاً كاملاً من البطاقات. اللوحة تكبر… وذاكرتك يجب أن تكبر معها.',
      preScene: 'bundoq-pre',
      winScene: 'bundoq-win',
      loseScene: 'bundoq-lose',
      pre: [
        { who: 'meow', expression: 'surprised', text: 'هذا بندق! إنه أذكى شخص قابلته في حياتي!' },
        { who: 'bundoq', expression: 'confident', text: 'المشكلة ليست في عدد البطاقات، بل في قدرتك على تذكرها جميعاً.' },
        { who: 'bundoq', expression: 'neutral', text: 'استعد. عندما أضيف صفاً جديداً، لا تفقد خريطة ذاكرتك.' }
      ],
      win: [
        { who: 'bundoq', expression: 'surprised', text: 'حتى اللوحة الكبيرة لم توقفك…' },
        { who: 'meow', expression: 'confident', text: 'بقي واحد فقط. أنا.' },
        { speaker: 'الراوي', text: 'انفتح الفصل السادس: المواجهة الأخيرة.', expression: 'mysterious' }
      ],
      lose: [
        { who: 'bundoq', expression: 'confident', text: 'كل بطاقة إضافية اختبار. أعد ترتيب أولوياتك.' },
        { who: 'meow', expression: 'happy', text: 'لا بأس. حتى أذكى القطط يبدأ من صفحة واحدة.' }
      ]
    },
    {
      id: 'final',
      number: 7,
      title: 'قمة الذاكرة',
      tag: 'الفصل السادس',
      place: 'الساحة الأولى',
      opponentId: 'meow',
      opponent: 'مياو ميموري',
      ability: 'all',
      abilityLabel: 'كل القدرات',
      accent: '#e2b75f',
      difficulty: 'hard',
      profile: { knownPairChance: .95, followChance: .92, observeChance: .98, confidenceMin: .42, firstThink: 360, secondThink: 270 },
      summary: 'مياو ميموري يستخدم كل القدرات. إنه لا يغش… لكنه لا ينسى شيئاً.',
      finalBoss: true,
      preScene: 'final-pre',
      winScene: 'final-win',
      loseScene: 'final-lose',
      pre: [
        { who: 'meow', expression: 'happy', text: 'أهلاً بعودتك! لقد قطعت شوطاً طويلاً!' },
        { who: 'meow', expression: 'confident', text: 'لقد واجهت الجميع، وتعلمت كل قدراتهم…' },
        { who: 'meow', expression: 'mysterious', text: 'لكن هل تستطيع مواجهتي أنا؟' },
        { who: 'meow', expression: 'mysterious', text: 'هذه ليست نهاية الحكاية… إنها قمتها.' }
      ],
      win: [
        { who: 'meow', expression: 'surprised', text: 'لقد… فزت حقاً؟!' },
        { who: 'meow', expression: 'happy', text: 'هاهاها! كنت أعلم أنك تستطيع فعلها!' },
        { who: 'meow', expression: 'confident', text: 'لأنني كنت أبحث عن شخص يستطيع الوصول إلى مستواي!' }
      ],
      lose: [
        { who: 'meow', expression: 'confident', text: 'قريب جداً… لكن القمة تحتاج قلباً لا يرتجف.' },
        { who: 'meow', expression: 'happy', text: 'أنا هنا. خذ نفساً، ثم حاول مرة أخرى.' }
      ]
    }
  ];

  const chapterById = (id) => CHAPTERS.find((c) => c.id === id) || null;
  const nextChapter = (id) => {
    const index = CHAPTERS.findIndex((c) => c.id === id);
    return index >= 0 ? CHAPTERS[index + 1] || null : null;
  };

  /* ─────────────────────────── saved progress ─────────────────────────── */
  function storySave() {
    const save = App.save();
    if (!save.story || typeof save.story !== 'object') {
      save.story = {};
    }
    const st = save.story;
    if (!Array.isArray(st.unlocked)) st.unlocked = ['tutorial'];
    if (!Array.isArray(st.completed)) st.completed = [];
    if (!st.stars || typeof st.stars !== 'object') st.stars = {};
    if (!st.best || typeof st.best !== 'object') st.best = {};
    if (!Array.isArray(st.seenScenes)) st.seenScenes = [];
    if (typeof st.seenIntro !== 'boolean') st.seenIntro = false;
    if (typeof st.completedStory !== 'boolean') st.completedStory = false;
    if (!st.current) st.current = 'tutorial';

    CHAPTERS.forEach((chapter, index) => {
      if (index === 0) {
        if (!st.unlocked.includes('tutorial')) st.unlocked.push('tutorial');
        return;
      }
      const previous = CHAPTERS[index - 1];
      if (st.completed.includes(previous.id) && !st.unlocked.includes(chapter.id)) {
        st.unlocked.push(chapter.id);
      }
    });
    if (!chapterById(st.current)) st.current = 'tutorial';
    return st;
  }

  function chapterUnlocked(id) {
    return storySave().unlocked.includes(id);
  }

  function isChapterComplete(id) {
    return storySave().completed.includes(id);
  }

  function chapterStars(id) {
    return Math.max(0, Math.min(3, Number(storySave().stars[id]) || 0));
  }

  function totalStoryStars() {
    return CHAPTERS.reduce((sum, ch) => sum + chapterStars(ch.id), 0);
  }

  function completedCount() {
    return CHAPTERS.filter((ch) => isChapterComplete(ch.id)).length;
  }

  function markSceneSeen(sceneId) {
    if (!sceneId) return;
    const st = storySave();
    if (!st.seenScenes.includes(sceneId)) {
      st.seenScenes.push(sceneId);
      App.persist();
    }
  }

  /* ─────────────────────────── map rendering ─────────────────────────── */
  let lastDialog = null;

  function updateMapChrome() {
    const st = storySave();
    const done = completedCount();
    const totalStars = totalStoryStars();
    const bannerProgress = $('#storyBannerProgress');
    if (bannerProgress) bannerProgress.textContent = `${num(done)} / ${num(CHAPTERS.length)} فصول`;
    const progressStars = $('#storyProgressStars');
    if (progressStars) progressStars.textContent = `${num(totalStars)} / ${num(CHAPTERS.length * 3)}`;
    const progressChapters = $('#storyProgressChapters');
    if (progressChapters) progressChapters.textContent = `${num(done)} / ${num(CHAPTERS.length)}`;
    const fill = $('#storyProgressFill');
    if (fill) fill.style.width = `${(done / CHAPTERS.length) * 100}%`;
    const continueBtn = $('#btnStoryContinue .btn-label');
    if (continueBtn) {
      if (done >= CHAPTERS.length) continueBtn.textContent = 'أعد الحكاية من البداية';
      else if (done === 0) continueBtn.textContent = st.seenIntro ? 'ابدأ المواجهة الأولى' : 'ابدأ الحكاية';
      else continueBtn.textContent = 'واصل المغامرة';
    }
    const note = $('#storyFooterNote');
    if (note) {
      note.textContent = st.completedStory
        ? 'أكملت الحكاية. يمكنك إعادة أي فصل لكسر رقمك القياسي.'
        : 'التقدم يُحفظ تلقائيًا على هذا الجهاز.';
    }
  }

  function chapterActionLabel(ch) {
    if (!chapterUnlocked(ch.id)) return 'مقفل';
    if (isChapterComplete(ch.id)) return 'إعادة الفصل';
    return 'ابدأ الفصل';
  }

  function renderMap() {
    const map = $('#storyMap');
    if (!map) return;
    const st = storySave();
    const current = st.current || 'tutorial';
    map.innerHTML = CHAPTERS.map((ch) => {
      const unlocked = chapterUnlocked(ch.id);
      const complete = isChapterComplete(ch.id);
      const isCurrent = current === ch.id && unlocked && !complete;
      const stars = chapterStars(ch.id);
      const cat = Art.catById(ch.opponentId);
      const stateLabel = complete ? 'مكتمل' : unlocked ? (isCurrent ? 'الآن' : 'متاح') : 'مقفل';
      const stateIcon = complete ? 'i-check' : unlocked ? 'i-sparkle' : 'i-lock';
      const starsMarkup = [0, 1, 2].map((i) => `<i class="${i < stars ? 'is-full' : ''}"></i>`).join('');
      return `
        <button type="button" class="story-node${unlocked ? ' is-unlocked' : ' is-locked'}${complete ? ' is-complete' : ''}${isCurrent ? ' is-current' : ''}" data-story-chapter="${ch.id}" style="--accent:${ch.accent}" ${unlocked ? '' : 'disabled'} aria-label="${esc(ch.tag)} — ${esc(ch.title)} — ${esc(stateLabel)}">
          <span class="story-node-top">
            <span class="story-node-num">${num(ch.number)}</span>
            <span class="story-node-state"><svg class="ico"><use href="#${stateIcon}"/></svg>${stateLabel}</span>
          </span>
          <span class="story-node-avatar">${Art.catAvatarSvg(cat)}</span>
          <span class="story-node-title"><b>${esc(ch.title)}</b><span>${esc(ch.opponent)} • ${esc(ch.place)}</span></span>
          <span class="story-node-ability">${ch.ability === 'all' ? '<svg class="ico"><use href="#i-crown"/></svg>' : ch.ability === 'freeze' ? '<svg class="ico"><use href="#i-clock"/></svg>' : ch.ability === 'shuffle' ? '<svg class="ico"><use href="#i-shuffle"/></svg>' : ch.ability === 'shadow' ? '<svg class="ico"><use href="#i-eye"/></svg>' : ch.ability === 'expand' ? '<svg class="ico"><use href="#i-expand"/></svg>' : '<svg class="ico"><use href="#i-paw"/></svg>'} ${esc(ch.abilityLabel)}</span>
          <span class="story-node-stars">${starsMarkup}</span>
          ${unlocked ? '' : '<span class="story-node-lock"><span><svg class="ico"><use href="#i-lock"/></svg></span></span>'}
        </button>`;
    }).join('');
    updateMapChrome();
  }

  function openMap() {
    if (lastDialog && lastDialog.open) {
      closeStage(true);
    }
    renderMap();
    UI.open('story');
  }

  function continueStory() {
    const st = storySave();
    const next = CHAPTERS.find((ch) => !st.completed.includes(ch.id) && st.unlocked.includes(ch.id));
    if (!next) {
      startChapter(CHAPTERS[0].id, { restart: true });
      return;
    }
    startChapter(next.id);
  }

  /* ─────────────────────────── cinematic engine ─────────────────────────── */
  const stage = $('#storyStage');
  const portrait = $('#storyPortrait');
  const speakerEl = $('#storySpeakerName');
  const chapterTag = $('#storyChapterTag');
  const textEl = $('#storyDialogueText');
  const nextBtn = $('#storyDialogueNext');
  const skipBtn = $('#storyDialogueSkip');
  const expressionChip = $('#storyExpressionChip');
  const introTitle = $('#storyIntroTitle');
  let typeTimer = null;
  let introTimer = null;
  let resolveDialog = null;
  let currentLine = null;
  let currentLines = [];
  let currentIndex = 0;
  let currentScene = null;
  let currentChapter = null;
  let isTyping = false;
  let fullText = '';

  function setPortrait(line) {
    const who = line && line.who;
    if (who === 'player') {
      const save = App.save();
      const cat = Art.catById(save.currentCat || 'lulu');
      const expr = line.expression || 'confident';
      portrait.innerHTML = Art.catAvatarSvg(cat, `expr-${expr}`);
      speakerEl.textContent = line.speaker || save.names?.p1 || 'أنت';
      expressionChip.textContent = EXPRESSION_LABEL[expr] || EXPRESSION_LABEL.neutral;
      return;
    }
    if (!who) {
      portrait.innerHTML = '<span class="story-narrator-glyph">✦</span>';
      speakerEl.textContent = line?.speaker || 'الراوي';
      expressionChip.textContent = 'حكاية';
      return;
    }
    const cat = Art.catById(who);
    const expr = line.expression || 'confident';
    portrait.innerHTML = Art.catAvatarSvg(cat, `expr-${expr}`);
    speakerEl.textContent = line.speaker || cat.name;
    expressionChip.textContent = EXPRESSION_LABEL[expr] || EXPRESSION_LABEL.neutral;
  }

  function clearTypewriter() {
    if (typeTimer) {
      clearInterval(typeTimer);
      typeTimer = null;
    }
    isTyping = false;
    textEl.classList.remove('is-typing');
  }

  function completeTyping() {
    clearTypewriter();
    textEl.textContent = fullText;
  }

  function typeLine(text) {
    clearTypewriter();
    fullText = text || '';
    textEl.textContent = '';
    textEl.classList.add('is-typing');
    isTyping = true;
    let index = 0;
    typeTimer = setInterval(() => {
      index += 1;
      textEl.textContent = fullText.slice(0, index);
      if (index >= fullText.length) {
        clearTypewriter();
      }
    }, 17);
  }

  function setLine(index) {
    currentIndex = index;
    if (index >= currentLines.length) {
      finishDialog();
      return;
    }
    const line = currentLines[index];
    currentLine = line;
    setPortrait(line);
    if (currentChapter) {
      chapterTag.textContent = line.tag || currentChapter.tag;
    }
    nextBtn.innerHTML = index === currentLines.length - 1 ? 'متابعة <svg class="ico"><use href="#i-arrow-left"/></svg>' : 'متابعة <svg class="ico"><use href="#i-arrow-left"/></svg>';
    typeLine(line.text || '');
  }

  function advanceDialog() {
    if (!lastDialog || !lastDialog.open) return;
    if (isTyping) {
      completeTyping();
      Sfx.click?.();
      return;
    }
    if (currentIndex + 1 >= currentLines.length) {
      finishDialog();
      return;
    }
    Sfx.click?.();
    setLine(currentIndex + 1);
  }

  function finishDialog(skipped = false) {
    if (!lastDialog || !lastDialog.open) return;
    const sceneId = currentScene;
    const finish = () => {
      if (!lastDialog) return;
      lastDialog.open = false;
      clearTypewriter();
      if (introTimer) { clearTimeout(introTimer); introTimer = null; }
      stage.classList.remove('is-open', 'is-intro', 'is-dialogue', 'is-ending', 'is-closing');
      stage.hidden = true;
      stage.style.removeProperty('--story-accent');
      markSceneSeen(sceneId);
      currentLine = null;
      currentLines = [];
      const resolve = resolveDialog;
      resolveDialog = null;
      lastDialog = null;
      if (resolve) resolve({ skipped });
    };
    if (skipped) {
      stage.classList.add('is-closing');
      setTimeout(finish, 180);
    } else {
      finish();
    }
  }

  function closeStage(immediate = false) {
    if (!lastDialog || !lastDialog.open) {
      if (stage) { stage.hidden = true; stage.classList.remove('is-open'); }
      return;
    }
    if (immediate) {
      if (resolveDialog) {
        const resolve = resolveDialog;
        resolveDialog = null;
        lastDialog.open = false;
        stage.hidden = true;
        stage.classList.remove('is-open', 'is-intro', 'is-dialogue', 'is-ending', 'is-closing');
        resolve({ skipped: true });
      }
      return;
    }
    finishDialog(true);
  }

  function playScene(sceneId, lines, opts = {}) {
    if (!stage || !lines || !lines.length) return Promise.resolve({ skipped: false });
    if (lastDialog && lastDialog.open) {
      finishDialog(true);
    }
    currentScene = sceneId;
    currentChapter = opts.chapter || null;
    currentLines = lines;
    currentIndex = 0;
    clearTypewriter();
    stage.hidden = false;
    stage.classList.remove('is-open', 'is-intro', 'is-dialogue', 'is-ending', 'is-closing');
    stage.classList.add('is-open');
    if (opts.chapter && opts.chapter.accent) stage.style.setProperty('--story-accent', opts.chapter.accent);
    if (opts.chapter) chapterTag.textContent = opts.chapter.tag;
    if (opts.intro) {
      stage.classList.add('is-intro');
      if (opts.title) {
        introTitle.innerHTML = `<span>MEOW&nbsp;MEMORY</span><strong>${esc(opts.title)}</strong><em>${esc(opts.subtitle || 'كل ذكرى لها قلب… وكل قلب له حارس')}</em>`;
      }
    } else {
      stage.classList.add('is-dialogue');
    }
    lastDialog = { open: true, sceneId };
    return new Promise((resolve) => {
      resolveDialog = resolve;
      const begin = () => {
        if (!lastDialog || !lastDialog.open) return;
        if (opts.intro) {
          stage.classList.remove('is-intro');
          stage.classList.add('is-dialogue');
        }
        setLine(0);
      };
      if (opts.intro) {
        introTimer = setTimeout(begin, 2450);
      } else {
        setTimeout(begin, 120);
      }
    });
  }

  function specialTitle(main, sub) {
    return new Promise((resolve) => {
      if (!stage) { resolve(); return; }
      const el = document.createElement('div');
      el.className = 'story-special-title';
      el.innerHTML = `<span>${esc(sub || '')}</span><strong>${esc(main)}</strong>`;
      stage.appendChild(el);
      requestAnimationFrame(() => el.classList.add('is-on'));
      setTimeout(() => {
        el.classList.remove('is-on');
        setTimeout(() => { el.remove(); resolve(); }, 500);
      }, 2050);
    });
  }

  function finalTransformation() {
    return new Promise((resolve) => {
      if (!stage) { resolve(); return; }
      const meow = Art.catById('meow');
      const el = document.createElement('div');
      el.className = 'final-transformation';
      el.innerHTML = `
        <span class="final-aura a1"></span>
        <span class="final-aura a2"></span>
        <span class="final-aura a3"></span>
        <span class="final-stars">✦</span>
        <span class="final-portrait">${Art.catAvatarSvg(meow, 'expr-mysterious')}</span>
        <span class="final-kicker">MEOW MEMORY</span>
        <strong>THE ULTIMATE CHALLENGE</strong>
        <em>المواجهة الأخيرة • كل القدرات • لا مجال للنسيان</em>
      `;
      stage.hidden = false;
      stage.classList.add('is-open', 'is-transforming');
      stage.appendChild(el);
      void el.offsetWidth;
      el.classList.add('is-on');
      Sfx.finalChallenge?.();
      setTimeout(() => {
        el.classList.remove('is-on');
        setTimeout(() => {
          el.remove();
          stage.classList.remove('is-transforming', 'is-open');
          stage.hidden = true;
          resolve();
        }, 650);
      }, 2850);
    });
  }

  /* ─────────────────────────── chapter flow ─────────────────────────── */
  function dialogueLines(chapter, type) {
    if (!chapter) return [];
    if (type === 'win') return chapter.win || [];
    if (type === 'lose') return chapter.lose || [];
    return chapter.pre || [];
  }

  async function startChapter(id, opts = {}) {
    const chapter = chapterById(id);
    if (!chapter) return;
    if (!chapterUnlocked(id)) {
      App.toast('أكمل الفصل السابق أولاً لتفتح هذه المواجهة', { icon: 'lock' });
      Sfx.clickDisabled();
      return;
    }
    UI.closeAll();
    Sfx.setStoryTheme?.(chapter.id);
    const st = storySave();
    if (id === 'tutorial' && !st.seenIntro && !opts.skipIntro) {
      await playScene('intro', chapter.intro, {
        intro: true,
        chapter,
        title: 'رحلة الذاكرة',
        subtitle: 'كل ذكرى لها قلب… وكل قلب له حارس'
      });
      st.seenIntro = true;
      App.persist(true);
    } else {
      await playScene(chapter.preScene, dialogueLines(chapter, 'pre'), { chapter });
    }
    if (chapter.finalBoss) {
      await finalTransformation();
    }
    startMatch(chapter);
  }

  function startMatch(chapter) {
    const save = App.save();
    const playerName = (save.names?.p1 || 'لاعب ١').trim() || 'لاعب ١';
    const config = {
      mode: 'story',
      difficulty: chapter.difficulty,
      storyChapter: chapter.id,
      chapterTitle: chapter.title,
      chapterTag: chapter.tag,
      aiProfile: chapter.profile,
      bossAbilities: chapter.ability === 'all'
        ? ['freeze', 'shuffle', 'shadow', 'expand']
        : chapter.ability === 'none' ? [] : [chapter.ability],
      players: [
        { name: playerName, catId: save.currentCat || 'lulu', bot: false },
        { name: chapter.opponent, catId: chapter.opponentId, bot: true }
      ]
    };
    storySave().current = chapter.id;
    App.persist(true);
    Sfx.setStoryTheme?.(chapter.id);
    UI.closeAll();
    closeStage(true);
    Game.start(config);
  }

  function calculateRating(payload) {
    const stats = payload.stats || {};
    const accuracy = stats.moves ? stats.matches / stats.moves : 0;
    const player = payload.playerScore || 0;
    const enemy = payload.enemyScore || 0;
    const lead = player / Math.max(1, enemy);
    let rating = 1;
    if (accuracy >= .55 || lead >= 1.12) rating = 2;
    if (accuracy >= .67 && lead >= 1.25) rating = 3;
    return rating;
  }

  function onGameEnd(payload) {
    const chapter = chapterById(payload.chapterId);
    if (!chapter) return null;
    const st = storySave();
    const won = !!payload.won;
    let rating = 0;
    let rewardStars = 2;
    let isNewCompletion = false;
    if (won) {
      rating = calculateRating(payload);
      rewardStars = 5 + rating * 2;
      if (!st.completed.includes(chapter.id)) {
        st.completed.push(chapter.id);
        isNewCompletion = true;
      }
      const previousStars = Number(st.stars[chapter.id]) || 0;
      st.stars[chapter.id] = Math.max(previousStars, rating);
      st.best[chapter.id] = Math.max(Number(st.best[chapter.id]) || 0, Number(payload.playerScore) || 0);
      const next = nextChapter(chapter.id);
      if (next && !st.unlocked.includes(next.id)) st.unlocked.push(next.id);
      st.current = next ? next.id : chapter.id;
      if (chapter.id === 'final') st.completedStory = true;
    } else {
      st.current = chapter.id;
    }
    App.persist(true);
    updateMapChrome();
    return {
      won,
      rating,
      rewardStars,
      chapter,
      next: won ? nextChapter(chapter.id) : chapter,
      final: !!chapter.finalBoss,
      isNewCompletion,
      playerScore: payload.playerScore || 0,
      enemyScore: payload.enemyScore || 0
    };
  }

  let lastStoryInfo = null;

  function afterResults(info) {
    if (!info) return;
    lastStoryInfo = info;
    const nextBtn = $('#btnStoryNext');
    const mapBtn = $('#btnStoryMap');
    const changeBtn = $('#btnChangeMode');
    const homeBtn = $('#btnResultsHome');
    if (nextBtn) {
      nextBtn.hidden = false;
      nextBtn.disabled = true;
      const label = nextBtn.querySelector('.btn-label') || nextBtn;
      if (info.won) {
        if (info.final) label.textContent = 'شاهد النهاية';
        else label.textContent = 'الفصل التالي';
      } else {
        label.textContent = 'حاول مجددًا';
      }
    }
    if (mapBtn) {
      mapBtn.hidden = false;
      mapBtn.disabled = true;
    }
    if (changeBtn) changeBtn.hidden = true;
    if (homeBtn) homeBtn.hidden = true;

    const enableStoryActions = () => {
      if (nextBtn) nextBtn.disabled = false;
      if (mapBtn) mapBtn.disabled = false;
    };
    const chapter = info.chapter;
    const sceneId = info.won ? chapter.winScene : chapter.loseScene;
    const lines = info.won ? chapter.win : chapter.lose;
    if (!lines || !lines.length) {
      enableStoryActions();
      return;
    }
    const timer = setTimeout(() => {
      if (!document.getElementById('screen-results')?.classList.contains('is-active')) return;
      playScene(sceneId, lines, { chapter }).then(() => {
        enableStoryActions();
        if (info.final && info.won) showEnding();
      });
    }, 1450);
    info._dialogTimer = timer;
  }

  function nextAfterStory() {
    if (!lastStoryInfo) { openMap(); return; }
    if (!lastStoryInfo.won) {
      startChapter(lastStoryInfo.chapter.id, { skipIntro: true });
      return;
    }
    if (lastStoryInfo.final) {
      showEnding();
      return;
    }
    startChapter(lastStoryInfo.next ? lastStoryInfo.next.id : lastStoryInfo.chapter.id, { skipIntro: true });
  }

  function showEnding() {
    const st = storySave();
    st.completedStory = true;
    App.persist(true);
    const ending = $('#storyEndingCard');
    const cats = $('#endingCats');
    if (cats) {
      const cast = [...Art.cats, ...Art.storyCats];
      cats.innerHTML = cast
        .map((cat, index) => `<span style="animation-delay:${(index * .06).toFixed(2)}s">${Art.catAvatarSvg(cat)}</span>`).join('');
    }
    if (!lastDialog || !lastDialog.open) {
      stage.hidden = false;
      stage.classList.add('is-open');
      lastDialog = { open: true, sceneId: 'ending' };
    }
    stage.classList.add('is-ending');
    stage.classList.remove('is-intro', 'is-dialogue');
    if (ending) ending.hidden = false;
    if (textEl) textEl.textContent = '';
    markSceneSeen('ending');
    Sfx.setStoryTheme?.('intro');
    Sfx.reward();
    setTimeout(() => Sfx.win(), 260);
  }

  function hideEnding() {
    const ending = $('#storyEndingCard');
    if (ending) ending.hidden = true;
    if (!lastDialog || !lastDialog.open) {
      stage.hidden = true;
      stage.classList.remove('is-open', 'is-ending');
      lastDialog = null;
    }
    lastDialog = null;
    stage.classList.remove('is-open', 'is-ending');
    stage.hidden = true;
    clearTypewriter();
  }

  function backToMapFromEnding() {
    hideEnding();
    Game.leaveToMenu();
    setTimeout(openMap, 260);
  }

  function backToHomeFromEnding() {
    hideEnding();
    Game.leaveToMenu();
  }

  /* ─────────────────────────── bindings ─────────────────────────── */
  function bindEvents() {
    $('#btnStoryMode')?.addEventListener('click', () => {
      App.initAudio?.();
      openMap();
    });
    $('#storyMap')?.addEventListener('click', (e) => {
      const node = e.target.closest('[data-story-chapter]');
      if (!node) return;
      const id = node.getAttribute('data-story-chapter');
      if (!chapterUnlocked(id)) {
        App.toast('هذا الفصل مقفل. أكمل الفصل السابق أولاً.', { icon: 'lock' });
        Sfx.clickDisabled();
        return;
      }
      startChapter(id);
    });
    $('#btnStoryContinue')?.addEventListener('click', () => {
      App.initAudio?.();
      continueStory();
    });
    $('#btnStoryGuide')?.addEventListener('click', () => {
      UI.open('guide', { returnModal: 'story' });
    });
    nextBtn?.addEventListener('click', (e) => { e.stopPropagation(); advanceDialog(); });
    skipBtn?.addEventListener('click', (e) => { e.stopPropagation(); finishDialog(true); });
    stage?.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      if (e.target.closest('.story-ending-card')) return;
      advanceDialog();
    });
    $('#btnStoryNext')?.addEventListener('click', () => {
      if (lastStoryInfo && lastStoryInfo._dialogTimer) clearTimeout(lastStoryInfo._dialogTimer);
      nextAfterStory();
    });
    $('#btnStoryMap')?.addEventListener('click', () => {
      if (lastStoryInfo && lastStoryInfo._dialogTimer) clearTimeout(lastStoryInfo._dialogTimer);
      closeStage(true);
      Game.leaveToMenu();
      setTimeout(openMap, 280);
    });
    $('#btnEndingMap')?.addEventListener('click', backToMapFromEnding);
    $('#btnEndingHome')?.addEventListener('click', backToHomeFromEnding);
    document.addEventListener('keydown', (e) => {
      if (!lastDialog || !lastDialog.open) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        finishDialog(true);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        advanceDialog();
      }
    });
    // Keep the mode banner in sync when the page is restored.
    window.addEventListener('pageshow', updateMapChrome);
  }

  function init() {
    storySave();
    bindEvents();
    renderMap();
    updateMapChrome();
  }

  const Story = {
    chapters: CHAPTERS,
    chapterById,
    nextChapter,
    openMap,
    renderMap,
    updateMapChrome,
    startChapter,
    startMatch,
    playScene,
    showEnding,
    onGameEnd,
    afterResults,
    closeStage,
    hideEnding,
    storySave,
    chapterStars,
    totalStoryStars,
    get lastStoryInfo() { return lastStoryInfo; }
  };

  window.MMStory = Story;
  init();
})();
