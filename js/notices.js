/* Meow Memory — two launch notices requested for the public build. */
(function () {
  'use strict';

  const App = window.MMApp;
  const Sfx = window.MMAudio;
  const $ = (sel) => document.querySelector(sel);
  const params = new URLSearchParams(window.location.search);
  if (params.has('capture') || params.has('test') || params.has('notices') && params.get('notices') === '0') return;
  if (sessionStorage.getItem('meowMemoryLaunchNotices.v1') === 'done') return;

  const layer = $('#launchLayer');
  const card = $('#launchCard');
  if (!layer || !card || !App) return;

  let answeredSupport = false;

  function openLayer() {
    layer.hidden = false;
    void layer.offsetWidth;
    layer.classList.add('is-open');
    setTimeout(() => {
      const focusTarget = card.querySelector('button');
      if (focusTarget) focusTarget.focus({ preventScroll: true });
    }, 150);
  }

  function closeLayer() {
    layer.classList.remove('is-open');
    setTimeout(() => { layer.hidden = true; }, 420);
    sessionStorage.setItem('meowMemoryLaunchNotices.v1', 'done');
  }

  function supportNotice() {
    card.innerHTML = `
      <span class="launch-icon"><svg class="ico"><use href="#i-heart"/></svg></span>
      <span class="launch-kicker">رسالة من فريق مياو ميموري</span>
      <h2>هل دعمت اللعبة على مرتكز؟</h2>
      <p>دعمك يساعدنا على إكمال النسخة الكاملة، وإضافة فصول جديدة، والمزيد من ذكريات القطط.</p>
      <div class="launch-actions">
        <button type="button" class="launch-choice is-primary" data-support="yes">نعم، دعمتها</button>
        <button type="button" class="launch-choice" data-support="no">ليس بعد</button>
      </div>
      <p class="launch-small">يمكنك تغيير إجابتك لاحقًا. لا يوجد أي التزام.</p>
    `;
    card.querySelectorAll('[data-support]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const answer = btn.getAttribute('data-support');
        answeredSupport = true;
        const save = App.save();
        if (!save.launch) save.launch = {};
        save.launch.supportAnswer = answer;
        App.persist(true);
        Sfx.click();
        if (answer === 'yes') {
          App.toast('شكرًا لدعمك… أنت جزء من الحكاية <3', { icon: 'heart', tone: 'warm', duration: 2600 });
        } else {
          App.toast('لا بأس… يمكنك دعم اللعبة في أي وقت', { icon: 'heart', duration: 2400 });
        }
        developmentNotice();
      });
    });
  }

  function developmentNotice() {
    card.innerHTML = `
      <span class="launch-icon"><svg class="ico"><use href="#i-sparkle"/></svg></span>
      <span class="launch-dev-badge"><svg class="ico" style="width:11px;height:11px"><use href="#i-bolt"/></svg> نسخة قيد التطوير</span>
      <span class="launch-kicker">ملاحظة مهمة قبل أن تبدأ</span>
      <h2>اللعبة قيد التطوير</h2>
      <p>اللعبة الحالية بها أخطاء وغير مكتملة، وقريبًا ستصدر النسخة الكاملة. شكرًا لصبرك ودعمك — كل ملاحظة منك تساعدنا على الوصول أسرع.</p>
      <div class="launch-actions">
        <button type="button" class="launch-choice is-primary" data-dev-understood>فهمت، لنبدأ</button>
      </div>
      <p class="launch-small">وضع القصة والزعماء والقدرات قيد التوسعة الآن.</p>
    `;
    const button = card.querySelector('[data-dev-understood]');
    button?.addEventListener('click', () => {
      Sfx.click();
      const save = App.save();
      if (!save.launch) save.launch = {};
      save.launch.noticesSeen = true;
      App.persist(true);
      closeLayer();
    });
    button?.focus({ preventScroll: true });
  }

  function start() {
    if (answeredSupport) return;
    openLayer();
    supportNotice();
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(start, 850);
  } else {
    window.addEventListener('load', () => setTimeout(start, 850), { once: true });
  }

  window.MMLaunchNotices = { show: start, close: closeLayer };
})();
