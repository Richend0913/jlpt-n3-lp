// Screens + hash router. Views render HTML strings into #view; clicks are handled by delegation via
// data-go (navigate) and data-act (action) attributes. Rendering never writes state (N3.peekDay, not N3.day),
// because a write bumps updatedAt and would win a cloud sync.
(function () {
  'use strict';
  const N3 = window.N3;
  const S = () => N3.state;
  const esc = N3.esc;
  const I = N3.icon;
  const $view = document.getElementById('view');
  const $app = document.getElementById('app');
  const $nav = document.getElementById('nav');

  // In-memory UI state (runs are not persisted; answers and SRS results are saved as they happen).
  const ui = { session: null, quiz: null, quizMode: 'mixed', listen: null, read: null, mock: null, plan: 'year', planRun: false, furi: true, apRun: null };

  // ---------- helpers ----------
  let toastTimer;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }
  const go = h => { if (location.hash === h) render(); else location.hash = h; };
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const no4 = n => String(n).padStart(4, '0');
  const two = n => String(n).padStart(2, '0');
  const b = v => `<b>${esc(v)}</b>`;
  const range = (a, z) => (a === z ? String(a) : `${a}–${z}`);
  const plural = N3.plural;
  const okOf = q => q.picked !== null && q.picked === q.answer;
  // Listening reply choices are stored as "日本語 (English)"; split them for display.
  const splitChoice = c => { const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(c); return m && /[぀-ヿ一-鿿]/.test(m[1]) ? { ja: m[1], en: m[2] } : { ja: null, en: c }; };
  const unitRangeText = () => (N3.FREE_UNITS === 1 ? 'Unit 1' : `Units 1–${N3.FREE_UNITS}`);
  const isJa = s => /[぀-ヿ一-鿿]/.test(s);
  const t = N3.t, tn = N3.tn;   // UI strings (js/i18n.js)
  const unitRangeT = () => (N3.FREE_UNITS === 1 ? t('pw.unit1') : t('pw.units', { n: N3.FREE_UNITS }));

  function hd(title, opts = {}) {
    const left = opts.back ? `<button class="icon-btn l" data-act="back" aria-label="${esc(t('aria.back'))}">${I('back')}</button>` : '';
    const right = opts.right || '';
    return `<div class="hd"><div class="ttl">${left}<h1>${title}</h1></div>${right ? `<div class="right">${right}</div>` : ''}</div>`;
  }
  const secHead = (title, jp, aside) => `<div class="rule"></div><h2>${title}${jp ? `<span class="jp" lang="ja">${jp}</span>` : ''}${aside ? `<span class="aside">${aside}</span>` : ''}</h2>`;
  const gearBtn = () => `<button class="icon-btn" data-go="#/settings" aria-label="${esc(t('aria.settings'))}">${I('gear')}</button>`;

  // Today's date under the logo (the exam countdown lives in the Home hero).
  function dateLine() {
    return `<div class="date"><b>${esc(N3.fmtShortDate(N3.today()))}</b></div>`;
  }

  // ---------- audio (relative paths so file:// works; a missing file fails silently) ----------
  let curAudio = null;
  function stopAudio() {
    if (curAudio) { try { curAudio.pause(); } catch (e) {} curAudio = null; }
    document.querySelectorAll('.play.on').forEach(el => el.classList.remove('on'));
  }
  function playAudio(kind, id, el) {
    stopAudio();
    if (!/^(word|example|grammar|listening)$/.test(kind) || !/^[a-z0-9-]+$/i.test(id || '')) return;
    let a;
    try { a = new Audio(`audio/${kind}/${id}.mp3`); } catch (e) { return; }
    curAudio = a;
    const off = () => { if (el) el.classList.remove('on'); if (curAudio === a) curAudio = null; };
    a.addEventListener('ended', off);
    a.addEventListener('error', off);
    if (el) el.classList.add('on');
    try { const p = a.play(); if (p && p.catch) p.catch(off); } catch (e) { off(); }
  }
  const playBtn = (kind, id, label, text, cls = '', extra = '') =>
    `<button class="play${cls ? ' ' + cls : ''}" data-act="play" data-arg="${kind}:${esc(id)}" aria-label="${esc(label)}"${extra}>${I('sound')}${text ? `<span>${esc(text)}</span>` : ''}</button>`;

  // ---------- recording answers ----------
  // src: 'quiz' | 'practice' | 'mock'. Every answer feeds its JLPT section estimate; a wrong vocabulary or
  // grammar answer sends the item back to review (due today).
  function record(q, src) {
    const ok = okOf(q);
    const st = S().stats;
    if (src === 'quiz') { st.quizTotal++; if (ok) st.quizRight++; }
    if (q.kind === 'listen' && src !== 'mock') {
      const e = st.listen[q.id] || { ok: 0, n: 0, r: 0 };
      e.n++; if (ok) e.r++; e.ok = ok ? 1 : 0;
      st.listen[q.id] = e;
    }
    N3.recordSection(q.sec, ok);
    N3.day().answers++;
    N3.touchStreak();
    if (q.sec === 'lk' && !ok) N3.srsMarkWrong(q.id);   // saves
    N3.save();
    return ok;
  }

  // ---------- today's plan ----------
  function planLines(p) {
    return p.steps.map(s => `<button class="row${s.done ? ' done' : ''}" data-act="planStep" data-arg="${s.key}">
      <span class="k" lang="ja">${s.jp[0]}</span>
      <span class="t"><span>${esc(s.title)}</span><span class="sub">${esc(s.detail)}</span></span>
      ${s.done ? `<span class="stamp sm" lang="ja" aria-label="${esc(t('done'))}">済</span>` : `<span class="min">${esc(t('min', { n: s.min }))}</span>`}
    </button>`).join('');
  }
  // "Next step" block shown on a finished step while a plan run is going.
  function planNext(fallback) {
    if (!ui.planRun) return fallback;
    const p = N3.todayPlan();
    const s = p.left[0];
    if (!s) { ui.planRun = false; return `<p class="lede">${tn('today.alldone', p.steps.length)}</p><div class="btns"><button class="btn primary" data-act="home">${esc(t('plan.back'))}</button></div>`; }
    return `<div class="btns" style="flex-direction:column"><button class="btn primary" data-act="planStart">${esc(t('plan.next', { title: s.title, n: s.min }))}</button><button class="btn" data-act="home">${esc(t('plan.back'))}</button></div>`;
  }
  // ---------- Early account prompt (guests only) ----------
  // Progress of a guest lives only in this browser's storage (it is uploaded on first signup), so after the
  // first finished session we suggest a free account once, and Home shows a slim reminder until sign-in.
  // Flags live in their own key, not in N3.state, so showing the prompt never bumps updatedAt.
  const AP_KEY = 'n3tango.acctPrompt.v1';   // {shown: bool, account: bool}
  let ap = (() => { try { const v = JSON.parse(localStorage.getItem(AP_KEY)); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; } })();
  const apSave = () => { try { localStorage.setItem(AP_KEY, JSON.stringify(ap)); } catch (e) {} };
  // True once this device has been signed in (also covers an expired session and a later logout).
  function hasAccount() {
    if (ap.account) return true;
    if (N3.sync.signedIn() || N3.sync.email()) { ap.account = true; apSave(); return true; }
    return false;
  }
  // End-screen card. Shown on the first finished run only; it stays on that run's screen until dismissed.
  function acctPrompt(run) {
    if (hasAccount()) return '';
    if (ui.apRun !== run) {
      if (ap.shown) return '';
      ui.apRun = run; ap.shown = true; apSave();
    }
    return `<div class="ap" id="acct-prompt" role="region" aria-labelledby="ap-h">
  <div class="h" id="ap-h">${esc(t('ap.h'))}</div>
  <p>${esc(t('ap.p'))}</p>
  <div class="btns"><button class="btn" data-act="apLater">${esc(t('ap.later'))}</button><button class="btn primary" data-act="apCreate">${esc(t('ap.create'))}</button></div>
</div>`;
  }
  const acctBanner = () => (hasAccount() ? '' : `<p class="ap-bar" id="acct-banner">${esc(t('acct.banner'))} <button class="txtbtn" data-act="accountFirst">${esc(t('acct.createFree'))}</button></p>`);

  function startStep(key) {
    if (key === 'vocab') return startSession('vocab', 'today');
    if (key === 'grammar') return startSession('grammar', 'today');
    if (key === 'listen') return startListen(N3.nextListening(N3.PLAN_LISTEN), true);
    if (key === 'read') { const p = N3.nextReading(); if (p) { openPassage(p, true); return true; } }
    return false;
  }

  // ---------- Home ----------
  // Has this device studied anything yet? (stats strip and install card wait for the first real use)
  const hasStudied = () => Object.keys(S().srs).length > 0 || S().stats.mock.length > 0 ||
    Object.values(S().days).some(d => d.answers || d.newCount || d.reviewCount);
  const mocksV2 = () => S().stats.mock.filter(m => m.v === 2);

  // Language picker: a real <select> under a short "EN / VI / ID" label.
  function langPick() {
    const cur = N3.LANGS.find(l => l[0] === N3.lang()) || N3.LANGS[0];
    return `<label class="lang-pick" title="${esc(t('lang.label'))}"><span aria-hidden="true">${esc(cur[2])}</span><select data-lang aria-label="${esc(t('lang.label'))}">${N3.LANGS.map(([c, name]) => `<option value="${c}"${c === cur[0] ? ' selected' : ''}>${esc(name)}</option>`).join('')}</select></label>`;
  }

  // Hero: exam countdown + the two main actions. Before the first mock test the mock is the primary action
  // (the sharpest hook, especially while everything is free); after it, today's plan leads.
  function heroHtml(p) {
    const today = N3.today();
    const exam = N3.examDate();
    const n = N3.daysBetween(today, exam);
    const next = N3.EXAM_DATES.find(d => d >= today);
    let cd;
    if (n > 0) cd = `<div class="cd"><b class="num" id="cd-days">${N3.num(n)}</b><span>${esc(tn('hero.days', n))}</span></div><p class="until">${esc(t('hero.until', { date: N3.fmtExamDate(exam) }))}</p>`;
    else if (n === 0) cd = `<p class="cd-today">${esc(t('hero.today'))}</p>`;
    else cd = `<p class="until">${esc(t('hero.noexam'))}</p>`;
    // The default exam date is the July one: offer the nearer sitting in one tap.
    const sw = next && next !== exam ? `<button class="txtbtn sw" data-act="exam" data-arg="${next}" id="cd-switch">${esc(t('hero.switch', { date: N3.fmtExamDate(next) }))}</button>` : '';
    const mocks = mocksV2();
    const mockBtn = cls => `<button class="btn${cls}" data-go="#/mock" id="cta-mock">${esc(!mocks.length ? (freeNow() ? t('hero.mock_free') : t('hero.mock')) : t('hero.mock_again'))}</button>`;
    const planOpen = p.steps.length > 0 && !p.allDone;
    const planBtn = cls => (planOpen
      ? `<button class="btn${cls}" data-act="planStart" id="cta-plan">${esc(p.steps.some(s => s.done) ? t('hero.continue') : t('hero.start'))}</button>`
      : `<button class="btn${cls}" data-act="quizFrom" data-arg="mixed" id="cta-plan">${esc(t('hero.plan_done'))}</button>`);
    const ctas = !mocks.length
      ? `${mockBtn(' primary')}<p class="cta-sub">${esc(t('hero.mock_sub', { n: mockMinutes() }))}</p>${planBtn('')}`
      : `${planBtn(' primary')}${mockBtn('')}`;
    return `<div class="hero" id="hero">${cd}${sw}<div class="ctas">${ctas}</div>${statsHtml(mocks)}</div>`;
  }

  // Progress at a glance: streak, words mastered, last mock score with the change from the one before.
  function statsHtml(mocks) {
    if (!hasStudied()) return '';
    const streak = N3.currentStreak();
    const mast = N3.WORDS.reduce((a, w) => a + (N3.isMastered(w.id) ? 1 : 0), 0);
    let mv = '—', trend = '';
    if (mocks.length) {
      const cur = N3.judge(mocks[mocks.length - 1]).total;
      mv = `${cur}<small>/180</small>`;
      if (mocks.length > 1) {
        const d = cur - N3.judge(mocks[mocks.length - 2]).total;
        if (d) trend = `<i class="${d > 0 ? 'up' : 'dn'}">${d > 0 ? '+' : '−'}${Math.abs(d)}</i>`;
      }
    }
    return `<div class="stats" id="home-stats">
  <div><b class="num">${streak}</b><span>${esc(tn('stat.streak', streak))}</span></div>
  <div><b class="num">${N3.num(mast)}</b><span>${esc(tn('stat.mastered', mast))}</span></div>
  <div><b class="num">${mv}${trend}</b><span>${esc(mocks.length ? t('stat.mock') : t('stat.mock_none'))}</span></div>
</div>`;
  }

  // After a mock test: the weakest section of the latest one, with a one-tap way into matching practice.
  function fixCard() {
    const mocks = mocksV2();
    if (!mocks.length) return '';
    const last = mocks[mocks.length - 1];
    const j = N3.judge(last);
    const k = N3.SEC_KEYS.reduce((a, x) => (j.scores[x] < j.scores[a] ? x : a));
    const sc = j.scores[k];
    if (sc >= N3.SEC_MAX) return '';
    return `<div class="fix" id="fix-card" data-sec="${k}">
  <div class="h">${esc(t('fix.h', { sec: t('sec.' + k) }))}</div>
  <p>${esc(t(sc < N3.SEC_CUTOFF ? 'fix.p' : 'fix.p_ok', { score: sc, date: N3.fmtShortDate(last.date) }))}</p>
  ${meter(sc, 60, N3.SEC_CUTOFF)}
  <button class="btn ai" data-act="fixSec" data-arg="${k}" id="fix-btn">${esc(t('fix.btn'))}<small>${esc(t('fix.sub.' + k))}</small></button>
</div>`;
  }

  // "Add to Home Screen" card (js/install.js decides whether and how; dismissal is remembered).
  function installCard() {
    if (!N3.install || !hasStudied()) return '';
    const mode = N3.install.mode();
    if (!mode) return '';
    const how = mode === 'prompt'
      ? `<button class="btn" data-act="install" id="install-btn">${esc(t('inst.btn'))}</button>`
      : `<p class="how">${esc(t(mode === 'ios' ? 'inst.ios' : 'inst.other'))}</p>`;
    return `<div class="inst" id="install-card" data-mode="${mode}">
  <img src="icons/icon-192.png" alt="" width="44" height="44">
  <div class="b"><div class="h">${esc(t('inst.h'))}</div>${how}</div>
  <button class="icon-btn x" data-act="installDismiss" aria-label="${esc(t('inst.close'))}">${I('close')}</button>
</div>`;
  }

  function viewHome() {
    const p = N3.todayPlan();
    const dueW = N3.dueWords().length, dueG = N3.dueGrammar().length;
    const w = N3.wordOfDay();
    let today;
    if (!p.steps.length) {
      today = `<p class="todayline">${esc(t('today.nothing'))}</p>`;
    } else {
      const unit = { vocab: 'u.word', grammar: 'u.pattern', listen: 'u.conversation', read: 'u.passage' };
      const summary = p.allDone
        ? tn('today.alldone', p.steps.length)
        : `${p.left.map(s => `<b>${s.n}</b> ${esc(tn(unit[s.key], s.n))}`).join(' · ')} · ${t('today.about', { n: p.totalMin })}`;
      today = `<p class="todayline">${summary}</p>
        <div class="rows plan">${planLines(p)}</div>`;
    }
    const revParts = [];
    if (dueW) revParts.push(`${dueW} ${tn('u.word', dueW)}`);
    if (dueG) revParts.push(`${dueG} ${tn('u.pattern', dueG)}`);
    return `
<div class="hd"><div class="logo">N3 <span>Tango</span></div><div class="right">${langPick()}${gearBtn()}</div></div>
${dateLine()}
${freeBanner()}
${heroHtml(p)}
${fixCard()}
<div class="sec">${secHead(esc(t('home.today')))}
  ${today}
  <p class="rev">${esc(t('today.reviews'))} <span class="ind">${esc(revParts.length ? revParts.join(' · ') : t('today.none'))}</span></p>
</div>
${installCard()}
${acctBanner()}
<hr class="div">
${w ? `<div class="entry">
  <div class="no">No. ${no4(w._i + 1)}<span class="pos">${esc(N3.POS_LABEL[w.pos] || w.pos || '')}</span></div>
  <div class="word" lang="ja">${N3.ruby(w)}</div>
  <p class="mean">${esc(w.meaning)}</p>
  ${w.example ? `<p class="ex" lang="ja">${N3.exampleHtml(w)}<span class="en" lang="en">${esc(w.example_translation || '')}</span></p>` : ''}
</div>` : ''}
<div class="rows" style="margin-top:30px">
  <a class="row" href="#/quiz"><span class="t">${esc(t('row.quiz'))}<span class="sub">${esc(t('row.quiz.sub'))}</span></span><span class="arr">${I('next')}</span></a>
  <a class="row" href="#/mock"><span class="t">${esc(t('row.mock'))}<span class="sub">${esc(t('row.mock.sub', { n: mockMinutes() }))}</span></span><span class="arr">${I('next')}</span></a>
  <a class="row" href="#/progress"><span class="t">${esc(t('row.progress'))}<span class="sub">${esc(t('row.progress.sub'))}</span></span><span class="arr">${I('next')}</span></a>
</div>`;
  }

  // Shown outside the paywall (locked dividers); the plan card carries the full price.
  const PRICE_ONCE = () => t('prem.price');
  // Free period (N3.FREE_UNTIL in store.js): one message replaces every upgrade prompt until it ends.
  const freeNow = () => N3.isFreePeriod();
  const freeBanner = () => (freeNow() ? `<p class="free-bar" id="free-banner">${esc(t('free.msg'))}</p>` : '');

  // ---------- Learn: two tracks ----------
  function vocabToc() {
    const out = [];
    let lockedShown = false;
    for (const u of N3.UNITS) {
      const ws = N3.unitWords(u);
      const open = N3.isUnitOpen(u);
      if (!open && !lockedShown) {
        lockedShown = true;
        const last = N3.UNITS[N3.UNITS.length - 1];
        out.push(`</div><button class="prem" data-go="#/paywall?unit=${u}">Units ${range(u, last)} · Premium · ${esc(PRICE_ONCE())}</button><div class="toc" style="margin-top:0">`);
      }
      const seen = ws.filter(w => N3.isSeen(w.id)).length;
      const done = open && seen === ws.length && ws.length > 0;
      const first = ws[0]._i + 1, last = ws[ws.length - 1]._i + 1;
      out.push(`<button class="tr${open ? '' : ' dim'}" data-act="unit" data-arg="${u}">
        <span class="n">${two(u)}</span><span class="nm">Unit ${u}${open && seen && !done ? `<small>${seen}/${ws.length}</small>` : ''}</span>${done ? '<span class="stamp" lang="ja" aria-label="Done">済</span>' : ''}<span class="dots"></span><span class="rg">${range(first, last)}</span></button>`);
    }
    return `<div class="toc">${out.join('')}</div>`;
  }
  function grammarToc() {
    const out = [];
    let lockedShown = false;
    for (const u of N3.G_UNITS) {
      const gs = N3.gUnitItems(u);
      const open = N3.isGUnitOpen(u);
      if (!open && !lockedShown) {
        lockedShown = true;
        out.push(`</div><button class="prem" data-go="#/paywall?gunit=${u}">Units ${range(u, N3.G_UNITS[N3.G_UNITS.length - 1])} · Premium · ${esc(PRICE_ONCE())}</button><div class="toc" style="margin-top:0">`);
      }
      const seen = gs.filter(g => N3.isSeen(g.id)).length;
      const done = open && seen === gs.length;
      out.push(`<button class="tr${open ? '' : ' dim'}" data-act="gunit" data-arg="${u}">
        <span class="n">${two(u)}</span><span class="nm" lang="ja">${esc(gs[0].pattern.split('／')[0])}<small lang="en">${open && seen && !done ? `${seen}/${gs.length}` : 'and more'}</small></span>${done ? '<span class="stamp" lang="ja" aria-label="Done">済</span>' : ''}<span class="dots"></span><span class="rg">${range(gs[0].no, gs[gs.length - 1].no)}</span></button>`);
    }
    return `<div class="toc">${out.join('')}</div>`;
  }
  function viewLearn(params) {
    const track = params.get('t') === 'grammar' ? 'grammar' : 'vocab';
    const tabs = `<div class="tabs" role="tablist">
      <button role="tab" class="${track === 'vocab' ? 'on' : ''}" data-go="#/learn"><span class="jp" lang="ja">語彙</span>Vocabulary</button>
      <button role="tab" class="${track === 'grammar' ? 'on' : ''}" data-go="#/learn?t=grammar"><span class="jp" lang="ja">文法</span>Grammar</button></div>`;
    let body;
    if (track === 'vocab') {
      const due = N3.dueWords().length;
      const newLeft = Math.min(N3.newLeftToday(), N3.newWords().length);
      const anyNew = N3.newWords().length;
      let act;
      if (due || newLeft) act = `<button class="btn primary start" data-act="startToday">${newLeft ? `Start today's ${newLeft}` : `Review ${plural(due, 'word')}`}</button>`;
      else if (anyNew) act = `<p class="note">Today's ${S().settings.dailyNew} new words are done and no reviews are due.</p><button class="btn start" data-act="extra">Learn 5 more words</button>`;
      else act = `<p class="note">Every word in ${unitRangeText()} has been started. Reviews come back as they fall due.</p>`;
      body = `<p class="sess">Today — <b>${due}</b> ${due === 1 ? 'review' : 'reviews'} due · <b>${newLeft}</b> new ${newLeft === 1 ? 'word' : 'words'}</p>${act}${vocabToc()}`;
    } else {
      const due = N3.dueGrammar().length;
      const newLeft = Math.min(N3.newGrammarLeftToday(), N3.newGrammar().length);
      let act;
      if (due || newLeft) act = `<button class="btn primary start" data-act="startGrammar">${newLeft ? `Start today's ${plural(newLeft, 'pattern')}` : `Review ${plural(due, 'pattern')}`}</button>`;
      else act = `<p class="note">Today's grammar is done. Tap a unit to study more patterns.</p>`;
      body = `<p class="sess">Today — <b>${due}</b> ${due === 1 ? 'review' : 'reviews'} due · <b>${newLeft}</b> new ${newLeft === 1 ? 'pattern' : 'patterns'}</p>${act}${grammarToc()}`;
    }
    return `
${hd(esc(t('nav.learn')), { right: `<b class="num">${N3.num(N3.WORDS.length)}</b> words · <b class="num">${N3.GRAMMAR.length}</b> patterns` })}
${tabs}
${body}
${N3.META.source === 'sample' ? '<p class="fine">Sample word list (development build).</p>' : ''}`;
  }

  // ---------- study session (red-sheet cards + SRS), vocabulary or grammar ----------
  function startSession(track, kind, unit) {
    const G = track === 'grammar';
    let due, fresh, title;
    if (kind === 'unit') {
      const pool = G ? N3.gUnitItems(unit) : N3.unitWords(unit);
      due = N3.dueItems(pool);
      fresh = N3.newItems(pool).slice(0, G ? 5 : 10);
      title = `${G ? 'Grammar ' : ''}Unit ${unit}`;
    } else if (kind === 'extra') {
      due = [];
      fresh = N3.newWords().slice(0, 5);
      title = 'Extra words';
    } else {
      due = G ? N3.dueGrammar() : N3.dueWords();
      fresh = G ? N3.newGrammar().slice(0, N3.newGrammarLeftToday()) : N3.newWords().slice(0, N3.newLeftToday());
      title = G ? "Today's grammar" : "Today's words";
    }
    const queue = [...due.map(w => ({ id: w.id, kind: 'review' })), ...fresh.map(w => ({ id: w.id, kind: 'new' }))];
    if (!queue.length) return false;
    stopAudio();
    ui.session = { track, kind, title, queue, idx: 0, revealed: false, total: queue.length, done: 0, firstKnow: 0, requeues: {}, finished: false };
    go('#/session');
    return true;
  }

  function vocabCard(w, item, revealed) {
    const tag = item.again ? '<span class="tagl again">Again</span>' : item.kind === 'new' ? '<span class="tagl new">New</span>' : '<span class="tagl rev">Review</span>';
    return `<div class="card" id="study-card">
  <div class="hole h1"></div><div class="hole h2"></div>
  <div class="tag">${tag}<span class="no">No. ${no4(w._i + 1)} · ${esc(N3.POS_LABEL[w.pos] || w.pos || '')} · Unit ${w.unit}</span></div>
  <div class="word" lang="ja">${esc(w.word)}</div>
  <div class="zone${revealed ? ' open' : ''}" data-sheet="session">
    <div class="reading ink" lang="ja">${esc(w.reading)}</div>
    <div class="mean ink">${esc(w.meaning)}</div>
    ${w.example ? `<p class="ex" lang="ja">${N3.exampleHtml(w)}<span class="en ink" lang="en">${esc(w.example_translation || '')}</span></p>` : ''}
    <div class="sheet" role="button" tabindex="0" aria-label="Slide the sheet to show the answer"></div>
  </div>
  ${revealed ? `<div class="btns" style="gap:8px;margin-top:14px">${playBtn('word', w.id, 'Play word', 'Word')}${w.example ? playBtn('example', w.id, 'Play example sentence', 'Example') : ''}</div>`
    : '<p class="hint">The reading and meaning are printed in orange ink under the sheet. Slide it to the right to check yourself.</p>'}
</div>`;
  }
  function grammarCard(g, item, revealed) {
    const tag = item.again ? '<span class="tagl again">Again</span>' : item.kind === 'new' ? '<span class="tagl new">New</span>' : '<span class="tagl rev">Review</span>';
    return `<div class="card" id="study-card">
  <div class="hole h1"></div><div class="hole h2"></div>
  <div class="tag">${tag}<span class="no">G-${String(g.no).padStart(3, '0')} · Grammar unit ${g.unit}</span></div>
  <div class="pat" lang="ja">${esc(g.pattern)}</div>
  <div class="form"><b>Form</b><span lang="ja">${esc(g.formation)}</span></div>
  <div class="zone${revealed ? ' open' : ''}" data-sheet="session">
    <div class="gm ink">${esc(g.meaning)}</div>
    <div class="exs">${g.examples.map(ex => `<div><p class="ex" lang="ja">${N3.rubyHtml(ex.ruby || ex.ja, { mark: ex.blank })}<span class="en ink" lang="en">${esc(ex.en)}</span></p>${revealed && ex.audio ? playBtn('grammar', ex.audio, 'Play example sentence') : ''}</div>`).join('')}</div>
    <div class="sheet" role="button" tabindex="0" aria-label="Slide the sheet to show the answer"></div>
  </div>
  ${revealed ? '' : '<p class="hint">The meaning and translations are printed in orange ink under the sheet. Slide it to the right to check yourself.</p>'}
</div>`;
  }

  function viewSession() {
    const s = ui.session;
    if (!s) { setTimeout(() => go('#/learn')); return ''; }
    const G = s.track === 'grammar';
    if (s.finished) {
      const d = N3.peekDay();
      return `
${hd('Session complete')}
<div class="score"><span class="big">${s.firstKnow}<small> / ${s.total}</small></span><span class="lbl">known on the first look · ${esc(s.title)}</span></div>
${acctPrompt(s)}
<div class="kvs">
  <div class="kv"><span>${G ? 'Grammar reviews due now' : 'Word reviews due now'}</span><b>${G ? N3.dueGrammar().length : N3.dueWords().length}</b></div>
  <div class="kv"><span>${G ? 'New patterns today' : 'New words today'}</span><b>${G ? `${d.gNew} / ${S().settings.dailyGrammar}` : `${d.newCount} / ${S().settings.dailyNew}`}</b></div>
</div>
${planNext(`<div class="btns"><button class="btn" data-go="${G ? '#/learn?t=grammar' : '#/learn'}">Back to Learn</button><button class="btn primary" data-act="quizFrom" data-arg="${G ? 'gfill' : 'vocab'}">Take a quiz</button></div>`)}`;
    }
    const item = s.queue[s.idx];
    const card = G ? grammarCard(N3.G_BY_ID[item.id], item, s.revealed) : vocabCard(N3.BY_ID[item.id], item, s.revealed);
    const actions = s.revealed
      ? `<div class="grade"><button class="btn" data-act="grade" data-arg="0">Don't know</button><button class="btn ai" data-act="grade" data-arg="1">Know</button></div>`
      : `<div class="grade"><button class="btn" data-act="reveal">Show answer</button></div>`;
    return `
<div class="runtop"><button class="icon-btn" data-act="exitSession" aria-label="Close">${I('close')}</button><div class="track"><i style="width:${pct(s.done, s.total)}%"></i></div><div class="n">${s.done} / ${s.total}</div></div>
${card}
${actions}`;
  }

  function gradeCard(know) {
    stopAudio();
    const s = ui.session;
    const item = s.queue[s.idx];
    if (!item.again) { N3.srsGrade(item.id, know); if (know) s.firstKnow++; }
    else N3.srsRelearn(item.id, know);
    const tries = s.requeues[item.id] || 0;
    if (!know && tries < 2) {
      s.requeues[item.id] = tries + 1;
      s.queue.push({ id: item.id, kind: item.kind, again: true });
    } else s.done++;
    s.idx++;
    s.revealed = false;
    if (s.idx >= s.queue.length) {
      s.finished = true;
      if (s.kind === 'today') { N3.markStep(s.track === 'grammar' ? 'grammar' : 'vocab'); N3.save(); }
    }
    render();
  }

  // ---------- question rendering (Quiz, Listening, Reading, Mock) ----------
  // answered: reveal the solution (quiz/practice). In the mock, answers stay hidden until the end.
  function blankSentence(ex, fillWith) {
    const a = ex.blank[0], n = ex.blank[1];
    return `${esc(ex.ja.slice(0, a))}<span class="blank${fillWith ? ' filled' : ''}">${fillWith ? esc(fillWith) : '（　　）'}</span>${esc(ex.ja.slice(a + n))}`;
  }
  function questionBody(q, { mock, answered }) {
    if (q.kind === 'meaning' || q.kind === 'reading') {
      const w = q.word, loc = N3.locateInExample(w);
      if (mock && loc) return `<div class="sent" lang="ja">${esc(loc.before)}<u>${esc(loc.hit)}</u>${esc(loc.after)}</div>`;
      return `<div class="prompt" lang="ja">${esc(w.word)}</div>`;
    }
    if (q.kind === 'fill') {
      const w = q.word, loc = N3.locateInExample(w);
      return `<div class="sent" lang="ja">${esc(loc.before)}<span class="blank${answered ? ' filled' : ''}">${answered ? esc(w.word) : '（　　）'}</span>${esc(loc.after)}</div>${answered ? `<div class="qen">${esc(w.example_translation || '')}</div>` : ''}`;
    }
    if (q.kind === 'gfill') {
      return `<div class="sent" lang="ja">${blankSentence(q.ex, answered ? q.choices[q.answer] : null)}</div>${answered ? `<div class="qen">${esc(q.ex.en)}</div>` : ''}`;
    }
    if (q.kind === 'gstar') {
      const o = q.ex.order;
      const slots = [0, 1, 2, 3].map(i => `<span class="slot${i === N3.STAR ? ' star' : ''}">　</span>`).join('');
      return `<div class="sent" lang="ja">${esc(o.pre)}${slots}${esc(o.post)}</div>`;
    }
    if (q.kind === 'gorder') {
      const o = q.ex.order;
      const built = q.built.map(i => q.order[i]);
      const cls = q.done ? (okOf(q) ? ' ok' : ' ng') : '';
      const slots = q.order.map((_, i) => built[i]
        ? `<button class="slot fill" data-act="untile" data-arg="${i}"${q.done ? ' disabled' : ''} aria-label="Remove ${esc(built[i])}">${esc(built[i])}</button>`
        : '<span class="slot">＿＿</span>').join('');
      return `<div class="sent${cls}" lang="ja">${esc(o.pre)}${slots}${esc(o.post)}</div>
${q.done ? '' : `<p class="qen">${built.length ? 'Tap a placed phrase to take it back.' : 'Tap the phrases below in order.'}</p>`}
${q.done ? '' : `<div class="tiles" lang="ja">${q.order.map((t, i) => `<button class="tile${q.built.includes(i) ? ' used' : ''}" data-act="tile" data-arg="${i}">${esc(t)}</button>`).join('')}</div>`}
${q.done && !okOf(q) ? `<div class="qen">Correct order: <span lang="ja">${esc(q.tiles.join(' / '))}</span></div>` : ''}`;
    }
    if (q.kind === 'listen') {
      const it = q.item;
      const limit = mock && q.plays >= 1;
      return `<div class="player">${playBtn('listening', it.audio || it.id, 'Play the conversation', limit ? 'Played' : q.plays ? 'Play again' : 'Play', 'big', limit ? ' disabled' : '')}
  <span class="pl">${mock ? 'The audio plays once.' : q.plays ? `Played ${plural(q.plays, 'time')}` : 'Listen first, then answer.'}</span></div>
<div class="qtext">${esc(it.q)}</div>`;
    }
    if (q.kind === 'read') {
      return `${passageHtml(q.item)}<div class="qtext">${esc(q.q.q)}</div>`;
    }
    return '';
  }
  function passageHtml(p) {
    return `<div class="passage${ui.furi ? '' : ' nofuri'}" lang="ja"><div class="ttl" lang="en">${esc(p.title || '')}${p.chars ? ` · <span class="num">${p.chars}</span> characters` : ''}</div>
${(p.paras || []).map((t, i) => `<p class="${i === 0 && p.paras.length > 1 && t.length < 40 ? 'ni' : ''}">${N3.rubyHtml(t)}</p>`).join('')}</div>`;
  }
  function choicesHtml(q, { reveal, prefix = '' }) {
    if (q.kind === 'gorder') return '';
    return `<div class="choices">${q.choices.map((c, i) => {
      let cls = '', mk = '';
      const answered = q.picked !== null;
      if (reveal && answered) {
        if (i === q.answer) { cls = ' ok'; mk = `<span class="mk">${I('check')}</span>`; }
        else if (i === q.picked) { cls = ' ng'; mk = `<span class="mk">${I('cross')}</span>`; }
      } else if (!reveal && q.picked === i) cls = ' sel';
      const dis = reveal && answered ? ' disabled' : '';
      let label;
      if (q.kind === 'listen') {
        const sp = splitChoice(c);
        label = sp.ja ? `<span lang="ja">${esc(sp.ja)}</span>${reveal && answered ? `<small>${esc(sp.en)}</small>` : ''}` : esc(sp.en);
      } else label = isJa(c) ? `<span lang="ja">${esc(c)}</span>` : esc(c);
      return `<button class="choice${cls}" data-act="pick" data-arg="${prefix}${i}"${dis}><span class="ck">${i + 1}</span><span class="ct">${label}</span>${mk}</button>`;
    }).join('')}</div>`;
  }
  function feedbackHtml(q) {
    const ok = okOf(q);
    const head = `<div class="h">${I(ok ? 'check' : 'cross')}${ok ? 'Correct' : q.sec === 'lk' ? 'Incorrect — added to today’s reviews' : 'Incorrect'}</div>`;
    let d = '';
    if (q.word) {
      const w = q.word;
      d = `<div class="w" lang="ja">${esc(w.word)}<small>${esc(w.reading)}</small></div><div class="d">${esc(w.meaning)}${w.example && q.kind !== 'fill' ? `<span lang="ja" style="display:block;margin-top:4px">${N3.exampleHtml(w)}</span><span class="en">${esc(w.example_translation || '')}</span>` : ''}</div>`;
    } else if (q.g) {
      d = `<div class="w" lang="ja">${esc(q.g.pattern)}</div><div class="d">${esc(q.g.meaning)}<span lang="ja" style="display:block;margin-top:4px">${N3.rubyHtml(q.ex.ruby || q.ex.ja, { mark: q.ex.blank })}</span><span class="en">${esc(q.ex.en)}</span></div>
        ${q.ex.audio ? `<div style="margin-top:8px">${playBtn('grammar', q.ex.audio, 'Play example sentence', 'Example')}</div>` : ''}`;
    } else if (q.kind === 'listen') {
      d = transcriptHtml(q.item, true);
    }
    return `<div class="fb ${ok ? 'ok' : 'ng'}">${head}${d}</div>`;
  }
  function transcriptHtml(it, open) {
    return `<details class="tx"${open ? ' open' : ''}><summary>${I('text', 'sm')}Transcript</summary><div class="script" lang="ja">${(it.script || []).map(l => `<div class="ln"><span class="sp">${esc(l.s)}</span><span>${N3.rubyHtml(l.ruby)}</span></div>`).join('')}</div></details>`;
  }
  function runTop(act, i, n, doneN) {
    return `<div class="runtop"><button class="icon-btn" data-act="${act}" aria-label="Close">${I('close')}</button><div class="track"><i style="width:${pct(doneN, n)}%"></i></div><div class="n">${i} / ${n}</div></div>`;
  }
  function qLabel(q) {
    const L = { meaning: 'Vocabulary · meaning', reading: 'Vocabulary · reading', fill: 'Vocabulary · fill in the blank', gfill: 'Grammar · fill in the blank', gorder: 'Grammar · sentence order', gstar: 'Grammar · sentence order', listen: 'Listening', read: 'Reading' };
    const T = { meaning: 'What does this word mean?', reading: 'How is this word read?', fill: 'Which word fits the blank?', gfill: 'Which form fits the blank?', gorder: 'Put the four phrases in order to complete the sentence.', listen: '', read: '' };
    return `<div class="part">${esc(L[q.kind])}</div>${T[q.kind] ? `<div class="ins">${esc(T[q.kind])}</div>` : ''}`;
  }

  // ---------- Practice index ----------
  function mockMinutes() { return N3.MOCK_PARTS.reduce((a, p) => a + p.min, 0); }
  function viewPractice() {
    const st = S().stats;
    const lAns = Object.keys(st.listen).filter(id => N3.L_BY_ID[id]).length;
    const rAns = Object.keys(st.read).filter(id => N3.R_BY_ID[id]).length;
    const last = st.mock.filter(m => m.v === 2).slice(-1)[0];
    const lastTxt = last ? (() => { const j = N3.judge(last); return `Last: ${j.total} / 180 on ${N3.fmtShortDate(last.date)}`; })() : `3 sections, about ${mockMinutes()} minutes`;
    return `
${hd(esc(t('nav.practice')), { right: gearBtn() })}
<div class="sec">${secHead('Drills', '練習')}
<div class="rows">
  <a class="row" href="#/quiz"><span class="k" lang="ja">問</span><span class="t">Quiz<span class="sub">Vocabulary 4-choice, grammar fill-in and sentence order</span></span><span class="arr">${I('next')}</span></a>
  <a class="row" href="#/listening"><span class="k" lang="ja">聴</span><span class="t">Listening<span class="sub">${lAns} of ${N3.LISTENING.length} conversations answered · ${freeNow() ? 'all free for now' : `${N3.FREE_LISTENING} free`}</span></span><span class="arr">${I('next')}</span></a>
  <a class="row" href="#/reading"><span class="k" lang="ja">読</span><span class="t">Reading<span class="sub">${rAns} of ${N3.READING.length} passages read · ${freeNow() ? 'all free for now' : `${N3.FREE_READING} free`}</span></span><span class="arr">${I('next')}</span></a>
</div></div>
<div class="sec">${secHead('Mock test', '模試')}
<div class="rows">
  <a class="row" href="#/mock"><span class="k" lang="ja">試</span><span class="t">JLPT N3 format<span class="sub">${esc(lastTxt)}</span></span><span class="arr">${I('next')}</span></a>
</div>
<p class="note">Scored in the three official sections. Pass: 95 of 180 in total and at least 19 of 60 in every section.</p></div>`;
  }

  // ---------- Quiz ----------
  const MODES = [
    ['mixed', 'Mixed', '4 vocabulary, 3 grammar fill-in, 3 sentence order'],
    ['vocab', 'Vocabulary', 'Meaning, reading and fill-in, 4 choices'],
    ['gfill', 'Grammar fill-in', 'Choose the grammar form for the blank'],
    ['gorder', 'Sentence order', 'Put 4 phrases in order (文の組み立て)'],
  ];
  function viewQuiz() {
    const z = ui.quiz;
    if (!z) {
      const seen = N3.openWords().filter(w => N3.isSeen(w.id)).length;
      const gSeen = N3.openGrammar().filter(g => N3.isSeen(g.id)).length;
      const info = seen >= 4
        ? `Vocabulary comes from the ${plural(seen, 'word')} you have studied${gSeen >= 4 ? `, grammar from your ${plural(gSeen, 'pattern')}` : ''}.`
        : `You have studied fewer than 4 words, so questions come from all of ${unitRangeText()}.`;
      return `
${hd('Quiz', { back: true, right: 'Up to 10 questions' })}
<p class="lede">${esc(info)} Missed words and patterns go back into today's reviews.</p>
<div class="opts">${MODES.map(([k, t, d]) => `<button class="opt${ui.quizMode === k ? ' on' : ''}" data-act="mode" data-arg="${k}"><span class="rad"></span><span class="t">${t}<small>${esc(d)}</small></span></button>`).join('')}</div>
<button class="btn primary start" data-act="startQuiz">Start quiz</button>`;
    }
    if (z.finished) return resultsHtml(z, 'Quiz results', 'quizAgain', '#/quiz');
    const q = z.questions[z.idx];
    const answered = q.kind === 'gorder' ? q.done : q.picked !== null;
    let tail = '';
    if (q.kind === 'gorder' && !q.done) tail = `<div class="btns"><button class="btn" data-act="clearOrder"${q.built.length ? '' : ' disabled'}>Clear</button><button class="btn primary" data-act="checkOrder"${q.built.length === q.order.length ? '' : ' disabled'}>Check</button></div>`;
    if (answered) tail = `${feedbackHtml(q)}<div class="btns"><button class="btn primary" data-act="next">${z.idx + 1 < z.questions.length ? 'Next' : 'See results'}</button></div>`;
    return `
${runTop('exitQuiz', z.idx + 1, z.questions.length, z.idx + (answered ? 1 : 0))}
<div class="q">${qLabel(q)}${questionBody(q, { answered })}</div>
${choicesHtml(q, { reveal: true })}
${tail}`;
  }
  function qSummary(q) {
    if (q.word) return `<b lang="ja">${esc(q.word.word)}</b> <span class="muted" lang="ja">${esc(q.word.reading)}</span> — ${esc(q.word.meaning)}`;
    if (q.g) return `<b lang="ja">${esc(q.g.pattern)}</b> — ${esc(q.g.meaning)}`;
    if (q.kind === 'listen') return `Conversation ${q.item.no} — ${esc(q.item.q)}`;
    if (q.kind === 'read') return `${esc(q.item.title || 'Passage')} — ${esc(q.q.q)}`;
    return '';
  }
  function answerText(q, i) {
    if (q.kind === 'gorder') return i === q.answer ? q.tiles.join(' / ') : q.built.map(k => q.order[k]).join(' / ');
    if (i === null || i === undefined || i < 0) return '—';
    const c = q.choices[i];
    return q.kind === 'listen' ? (splitChoice(c).ja || c) : c;
  }
  function reviewRow(q) {
    const ok = okOf(q);
    return `<div class="r"><span class="mk ${ok ? 'ok' : 'ng'}">${I(ok ? 'check' : 'cross', 'sm')}</span><div class="d">${qSummary(q)}
      ${ok ? '' : `<div class="s">Your answer: <span lang="ja">${esc(answerText(q, q.picked))}</span> · Correct: <span lang="ja">${esc(answerText(q, q.answer))}</span></div>`}</div></div>`;
  }
  function resultsHtml(z, title, againAct, doneHref) {
    const right = z.questions.filter(okOf).length;
    const n = z.questions.length;
    const wrongLk = z.questions.filter(q => q.sec === 'lk' && !okOf(q)).length;
    return `
${hd(title)}
<div class="score"><span class="big">${right}<small> / ${n}</small></span><span class="lbl">correct</span></div>
${acctPrompt(z)}
<p class="lede">${wrongLk ? `${plural(wrongLk, 'missed item')} ${wrongLk === 1 ? 'is' : 'are'} back in today's reviews.` : right === n ? `All ${n} correct.` : ''}</p>
<div class="rlist">${z.questions.map(reviewRow).join('')}</div>
${planNext(`<div class="btns"><button class="btn" data-act="${againAct}">Try again</button><button class="btn primary" data-act="leaveResults" data-arg="${doneHref}">Done</button></div>`)}`;
  }

  // ---------- Listening practice ----------
  function startListen(items, fromPlan) {
    if (!items.length) return false;
    stopAudio();
    ui.listen = { questions: items.map(N3.makeListen), idx: 0, finished: false, plan: !!fromPlan };
    go('#/listening');
    return true;
  }
  function viewListening() {
    const z = ui.listen;
    const st = S().stats.listen;
    if (!z) {
      const open = N3.openListening();
      const ans = open.filter(x => st[x.id]).length;
      const okN = open.filter(x => st[x.id] && st[x.id].ok).length;
      const rows = [];
      let locked = false;
      for (const x of N3.LISTENING) {
        const o = N3.isListenOpen(x);
        if (!o && !locked) { locked = true; rows.push(`</div><button class="prem" data-go="#/paywall?listen=1">Conversations ${range(x.no, N3.LISTENING.length)} · Premium · ${esc(PRICE_ONCE())}</button><div class="toc" style="margin-top:0">`); }
        const e = st[x.id];
        rows.push(`<button class="tr${o ? '' : ' dim'}" data-act="listenOne" data-arg="${x.id}"><span class="n">${two(x.no)}</span><span class="nm">${x.type === 'response' ? 'Best reply' : 'Comprehension'}</span>${e && e.ok ? '<span class="stamp sm" lang="ja" aria-label="Answered correctly">済</span>' : ''}<span class="dots"></span><span class="rg">${e ? (e.ok ? 'correct' : 'missed') : x.script.length + ' lines'}</span></button>`);
      }
      const n = Math.min(5, open.length);
      return `
${hd('Listening', { back: true, right: '<span lang="ja">聴解</span>' })}
<p class="lede">A short conversation, then one question. Replay as often as you like; the mock test plays each one once.</p>
<p class="sess"><b>${ans}</b> of ${open.length} answered · <b>${okN}</b> correct on the last try</p>
<button class="btn primary start" data-act="listenRound">Start ${plural(n, 'conversation')}</button>
<div class="toc">${rows.join('')}</div>`;
    }
    if (z.finished) {
      const right = z.questions.filter(okOf).length;
      return `
${hd('Listening results')}
<div class="score"><span class="big">${right}<small> / ${z.questions.length}</small></span><span class="lbl">correct</span></div>
${acctPrompt(z)}
<div class="rlist">${z.questions.map(reviewRow).join('')}</div>
${planNext(`<div class="btns"><button class="btn" data-act="listenRound">Next ${plural(Math.min(5, N3.openListening().length), 'conversation')}</button><button class="btn primary" data-act="leaveListen">Done</button></div>`)}`;
    }
    const q = z.questions[z.idx];
    const answered = q.picked !== null;
    return `
${runTop('exitListen', z.idx + 1, z.questions.length, z.idx + (answered ? 1 : 0))}
<div class="q"><div class="part">Conversation <b>${q.item.no}</b> · ${q.item.type === 'response' ? 'Choose the best reply' : 'Comprehension'}</div>${questionBody(q, { answered })}</div>
${choicesHtml(q, { reveal: true })}
${answered ? `${feedbackHtml(q)}<div class="btns"><button class="btn primary" data-act="listenNext">${z.idx + 1 < z.questions.length ? 'Next' : 'See results'}</button></div>` : ''}`;
  }
  function finishListen() {
    const z = ui.listen;
    z.finished = true;
    if (z.plan) { N3.markStep('listen'); N3.save(); }
  }

  // ---------- Reading practice ----------
  function openPassage(p, fromPlan) {
    stopAudio();
    ui.read = { p, qs: p.questions.map((_, qi) => N3.makeRead(p, qi)), plan: !!fromPlan, saved: false };
    go('#/passage');
  }
  function qRange() {
    const ns = N3.READING.map(p => p.questions.length);
    return ns.length ? range(Math.min(...ns), Math.max(...ns)) : '0';
  }
  function viewReading() {
    const st = S().stats.read;
    const rows = [];
    let locked = false;
    for (const p of N3.READING) {
      const o = N3.isReadOpen(p);
      if (!o && !locked) { locked = true; rows.push(`</div><button class="prem" data-go="#/paywall?read=1">Passages ${range(p.no, N3.READING.length)} · Premium · ${esc(PRICE_ONCE())}</button><div class="toc" style="margin-top:0">`); }
      const e = st[p.id];
      rows.push(`<button class="tr${o ? '' : ' dim'}" data-act="readOne" data-arg="${p.id}"><span class="n">${two(p.no)}</span><span class="nm">${esc(p.title || 'Passage')}</span>${e ? '<span class="stamp sm" lang="ja" aria-label="Read">済</span>' : ''}<span class="dots"></span><span class="rg">${e ? `${e.r}/${e.t}` : `${p.chars}字`}</span></button>`);
    }
    const next = N3.nextReading();
    return `
${hd('Reading', { back: true, right: '<span lang="ja">読解</span>' })}
<p class="lede">Short passages (notices, emails, essays), ${qRange()} questions each, as in the N3 reading section. Furigana can be hidden.</p>
${next ? `<button class="btn primary start" data-act="readOne" data-arg="${next.id}">Read passage ${next.no}: about ${N3.MIN_PER.read} minutes</button>` : ''}
<div class="toc">${rows.join('')}</div>`;
  }
  function viewPassage() {
    const r = ui.read;
    if (!r) { setTimeout(() => go('#/reading')); return ''; }
    const done = r.qs.every(q => q.picked !== null);
    const right = r.qs.filter(okOf).length;
    return `
${hd(`Passage ${r.p.no}`, { back: true, right: `<button class="txtbtn" data-act="furi">${ui.furi ? 'Hide furigana' : 'Show furigana'}</button>` })}
${passageHtml(r.p)}
${r.qs.map((q, qi) => `<div class="rq"><div class="qn">Question ${qi + 1} of ${r.qs.length}</div><div class="qtext">${esc(q.q.q)}</div>${choicesHtml(q, { reveal: true, prefix: qi + ':' })}</div>`).join('')}
${done ? `<div class="fb ${right === r.qs.length ? 'ok' : 'ng'}"><div class="h">${right} of ${r.qs.length} correct</div></div>
${acctPrompt(r)}
${planNext(`<div class="btns"><button class="btn" data-go="#/reading">All passages</button>${N3.nextReading() && N3.nextReading().id !== r.p.id ? `<button class="btn primary" data-act="readOne" data-arg="${N3.nextReading().id}">Next passage</button>` : ''}</div>`)}` : ''}`;
  }
  function pickRead(arg) {
    const r = ui.read;
    const [qi, i] = String(arg).split(':').map(Number);
    const q = r.qs[qi];
    if (!q || q.picked !== null) return;
    q.picked = i;
    record(q, 'practice');
    if (!r.saved && r.qs.every(x => x.picked !== null)) {
      r.saved = true;
      const st = S().stats.read;
      const prev = st[r.p.id];
      st[r.p.id] = { r: r.qs.filter(okOf).length, t: r.qs.length, n: (prev ? prev.n : 0) + 1 };
      if (r.plan) N3.markStep('read');
      N3.save();
    }
    render();
  }

  // ---------- Mock test (JLPT N3 format) ----------
  function viewMock() {
    const m = ui.mock;
    if (!m) {
      const P = N3.MOCK_PLAN;
      const hist = S().stats.mock.filter(h => h.v === 2);
      const rq = N3.openReading().slice(0, P.passages).reduce((a, p) => a + p.questions.length, 0);
      const counts = [P.reading + P.fill + P.meaning, P.gfill + P.gstar + rq, P.listen];
      return `
${hd(esc(t('mock.title')), { back: true, right: '<span lang="ja">模試</span>' })}
<p class="lede">${esc(t('mock.lede'))}</p>
<div class="rows">${N3.MOCK_PARTS.map((p, i) => `<div class="row"><span class="k num" style="font-family:var(--mono);font-size:15px">${p.n}</span><span class="t">${esc(t('part.' + p.n))}<span class="sub" lang="ja">${esc(p.jp)}</span></span><span class="v">${esc(t('mock.qmin', { q: counts[i], m: p.min }))}</span></div>`).join('')}</div>
<div class="sec">${secHead(esc(t('mock.how')))}
<div class="kvs">
  ${N3.SEC_KEYS.map(k => `<div class="kv"><span>${esc(t('sec.' + k))} <span class="muted" lang="ja" style="font-size:12.5px">${esc(N3.SECTIONS[k].jp)}</span></span><b>0–60</b></div>`).join('')}
  <div class="kv"><span>${esc(t('mock.cutoff'))}</span><b>19 / 60</b></div>
  <div class="kv"><span>${esc(t('mock.passline'))}</span><b>95 / 180</b></div>
</div>
<p class="note">${esc(t('mock.note'))}</p></div>
${hist.length ? `<div class="sec">${secHead(esc(t('mock.yours')))}<div class="kvs">${hist.slice(-3).reverse().map(h => { const j = N3.judge(h); return `<div class="kv"><span>${esc(N3.fmtShortDate(h.date))}</span><b>${j.total} / 180 · ${esc(j.pass ? t('mock.passlevel') : t('mock.below'))}</b></div>`; }).join('')}</div></div>` : ''}
<button class="btn primary start" data-act="startMock">${esc(t('mock.start'))}</button>`;
    }
    if (m.finished) return mockResults(m);
    const q = m.questions[m.idx];
    const insKey = q.kind === 'listen' && q.item.type === 'response' ? 'listenResponse' : q.kind;
    const ins = N3.MOCK_INS[insKey] || ['', ''];
    const last = m.idx + 1 === m.questions.length;
    return `
${runTop('exitMock', m.idx + 1, m.questions.length, m.idx)}
<div class="part">${t('mock.part', { n: q.part, title: esc(t('part.' + q.part)) })}</div>
<div class="ins"><span lang="ja">${esc(ins[0])}</span><span class="en">${ins[1] ? esc(t('ins.' + insKey)) : ''}</span></div>
<div class="q">${questionBody(q, { mock: true })}</div>
${choicesHtml(q, { reveal: false })}
<div class="btns"><button class="btn primary" data-act="mockNext"${q.picked === null ? ' disabled' : ''}>${esc(last ? t('mock.finish') : t('mock.next'))}</button></div>`;
  }
  function finishMock() {
    stopAudio();
    const m = ui.mock;
    for (const q of m.questions) record(q, 'mock');
    const secs = N3.mockSections(m.questions);
    S().stats.mock.push(Object.assign({ v: 2, date: N3.today() }, secs));
    S().stats.mock = S().stats.mock.slice(-30);
    N3.save();
    m.secs = secs;
    m.finished = true;
  }
  function meter(score, max, cut, cls = '') {
    return `<div class="meter${cls}${score !== null && score < cut ? ' low' : ''}" role="img" aria-label="${score === null ? 'No estimate' : `${score} / ${max}; cutoff ${cut}`}"><i style="width:${score === null ? 0 : pct(score, max)}%"></i><span class="cut" style="left:${(cut / max) * 100}%"><span>${cut}</span></span></div>`;
  }
  function mockResults(m) {
    const j = N3.judge(m.secs);
    const behind = N3.PASS_TOTAL - j.total;
    const secName = k => t('sec.' + k);
    let verdict;
    if (j.pass) verdict = `<p class="verdict pass">${esc(t('res.pass', { t: j.total }))}</p>`;
    else if (j.below.length) verdict = `<p class="verdict fail">${esc(t('res.cut', { secs: j.below.map(secName).join(t('and')) }))}</p>`;
    else verdict = `<p class="verdict fail">${esc(tn('res.behind', behind))}</p>`;
    const byPart = [1, 2, 3].map(n => `<div class="ph">${esc(t('mock.partShort', { n, title: t('part.' + n) }))}</div>${m.questions.filter(q => q.part === n).map(reviewRow).join('')}`).join('');
    return `
${hd(esc(t('res.title')))}
<div class="score"><span class="big">${j.total}<small> / 180</small></span><span class="lbl">${esc(t('res.passline'))}</span></div>
${verdict}
${acctPrompt(m)}
<div class="secs">
${N3.SEC_KEYS.map(k => { const sc = j.scores[k]; const [r, tot] = m.secs[k]; return `<div class="secr" data-sec="${k}"><div class="top"><span class="nm">${esc(secName(k))}<small lang="ja">${esc(N3.SECTIONS[k].jp)}</small></span><span class="sc">${sc}<small> / 60</small></span></div>
  ${meter(sc, 60, N3.SEC_CUTOFF)}
  <div class="meta"><span>${esc(t('res.correct', { r, t: tot }))}</span>${sc < N3.SEC_CUTOFF ? `<span class="risk">${esc(t('res.below19'))}</span>` : `<span class="safe">${esc(t('res.above', { n: sc - N3.SEC_CUTOFF }))}</span>`}</div></div>`; }).join('')}
<div class="secr tot"><div class="top"><span class="nm">${esc(t('res.total'))}</span><span class="sc">${j.total}<small> / 180</small></span></div>${meter(j.total, 180, N3.PASS_TOTAL, ' total')}
  <div class="meta"><span>${esc(t('res.meta'))}</span>${j.pass ? `<span class="safe">${esc(t('res.passLevel'))}</span>` : `<span class="risk">${esc(t('res.belowPass'))}</span>`}</div></div>
</div>
<p class="note">${esc(t('mock.note'))}</p>
<div class="sec">${secHead(esc(t('res.answers')))}<div class="rlist">${byPart}</div></div>
<div class="btns"><button class="btn" data-act="startMock">${esc(t('res.new'))}</button><button class="btn primary" data-act="leaveResults" data-arg="#/mock">${esc(t('res.done'))}</button></div>`;
  }

  // ---------- Progress ----------
  function viewProgress() {
    const st = S().stats;
    const words = N3.WORDS, gram = N3.GRAMMAR;
    const wSeen = words.filter(w => N3.isSeen(w.id)).length, wMast = words.filter(w => N3.isMastered(w.id)).length;
    const gSeen = gram.filter(g => N3.isSeen(g.id)).length, gMast = gram.filter(g => N3.isMastered(g.id)).length;
    const lAns = Object.keys(st.listen).filter(id => N3.L_BY_ID[id]).length;
    const rAns = Object.keys(st.read).filter(id => N3.R_BY_ID[id]).length;
    const est = Object.fromEntries(N3.SEC_KEYS.map(k => [k, N3.sectionEstimate(k)]));
    const allEnough = N3.SEC_KEYS.every(k => est[k].enough);
    const risky = N3.SEC_KEYS.filter(k => est[k].enough && est[k].score < N3.SEC_CUTOFF);
    const total = allEnough ? N3.SEC_KEYS.reduce((a, k) => a + est[k].score, 0) : null;
    const secRows = N3.SEC_KEYS.map(k => {
      const e = est[k];
      const sc = e.enough ? e.score : null;
      const right = !e.enough ? `<span>${N3.EST_MIN_ANSWERS - e.n} more ${N3.EST_MIN_ANSWERS - e.n === 1 ? 'answer' : 'answers'} for an estimate</span>`
        : sc < N3.SEC_CUTOFF ? '<span class="risk">Cutoff risk: below 19</span>' : `<span class="safe">${sc - N3.SEC_CUTOFF} above the cutoff</span>`;
      return `<div class="secr" data-sec="${k}"><div class="top"><span class="nm">${esc(N3.SECTIONS[k].name)}<small lang="ja">${esc(N3.SECTIONS[k].jp)}</small></span><span class="sc">${sc === null ? '—' : sc}<small> / 60</small></span></div>
        ${meter(sc, 60, N3.SEC_CUTOFF)}
        <div class="meta"><span>${e.n ? `${e.right} of ${e.n} recent answers correct` : 'No answers yet'}</span>${right}</div></div>`;
    }).join('');
    let lead;
    if (risky.length) lead = `<p class="verdict fail">Cutoff risk: ${risky.map(k => N3.SECTIONS[k].name).join(' and ')} ${risky.length === 1 ? 'is' : 'are'} under 19 of 60. Today's plan gives the practice slot to the weaker of listening and reading.</p>`;
    else if (allEnough) lead = `<p class="verdict ${total >= N3.PASS_TOTAL ? 'pass' : 'fail'}">Estimated total ${total} of 180 (pass line 95), no section under 19.</p>`;
    else lead = `<p class="lede">Each estimate needs ${N3.EST_MIN_ANSWERS} answers in that section (quiz, practice or mock test).</p>`;
    const mocks = st.mock.slice(-5).reverse().map(h => {
      if (h.v === 2) { const j = N3.judge(h); return `<div class="kv"><span>${esc(N3.fmtShortDate(h.date))} · mock test</span><b>${j.total} / 180 · ${N3.SEC_KEYS.map(k => j.scores[k]).join('/')}</b></div>`; }
      return `<div class="kv"><span>${esc(N3.fmtShortDate(h.date))} · vocabulary test (old format)</span><b>${h.score} / ${h.total}</b></div>`;
    }).join('');
    const streak = N3.currentStreak();
    return `
${hd(esc(t('nav.progress')), { right: gearBtn() })}
${N3.sync.signedIn() || N3.sync.status() === 'expired' ? syncLine('under-hdr') : ''}
<div class="sec">${secHead('Exam sections', '', `last ${N3.SEC_RECENT} answers each`)}
${lead}
<div class="secs">${secRows}
${total !== null ? `<div class="secr tot"><div class="top"><span class="nm">Estimated total</span><span class="sc">${total}<small> / 180</small></span></div>${meter(total, 180, N3.PASS_TOTAL, ' total')}<div class="meta"><span>Pass line 95</span>${total >= N3.PASS_TOTAL && !risky.length ? '<span class="safe">Pass level</span>' : '<span class="risk">Below pass level</span>'}</div></div>` : ''}
</div>
<p class="note">In-app estimate from your recent answers, scaled to the 0–60 band of each JLPT section.</p></div>
<div class="sec">${secHead('Study')}
<div class="kvs">
  <div class="kv"><span>Words studied</span><b id="pg-words">${N3.num(wSeen)} / ${N3.num(words.length)}</b></div>
  <div class="kv"><span>Words mastered (3 reviews in a row)</span><b>${N3.num(wMast)}</b></div>
  <div class="kv"><span>Grammar patterns studied</span><b id="pg-grammar">${gSeen} / ${gram.length}</b></div>
  <div class="kv"><span>Grammar patterns mastered</span><b>${gMast}</b></div>
  <div class="kv"><span>Listening answered</span><b>${lAns} / ${N3.LISTENING.length}</b></div>
  <div class="kv"><span>Reading passages read</span><b>${rAns} / ${N3.READING.length}</b></div>
  <div class="kv"><span>Reviews due now</span><b>${N3.dueWords().length + N3.dueGrammar().length}</b></div>
  ${st.quizTotal ? `<div class="kv"><span>Quiz accuracy · ${st.quizTotal} answers</span><b>${pct(st.quizRight, st.quizTotal)}%</b></div>` : ''}
  ${streak > 0 ? `<div class="kv"><span>Streak</span><b>${plural(streak, 'day')}</b></div>` : ''}
</div></div>
${mocks ? `<div class="sec">${secHead('Mock tests')}<div class="kvs">${mocks}</div></div>` : ''}`;
  }

  // ---------- Settings ----------
  function viewSettings() {
    const td = N3.today();
    const cur = S().settings.examDate;
    const exams = N3.EXAM_DATES.map(d => {
      const n = N3.daysBetween(td, d);
      const past = n < 0;
      return `<button class="opt${cur === d ? ' on' : ''}" data-act="exam" data-arg="${d}"${past ? ' disabled' : ''}>
        <span class="rad"></span><span class="t">${esc(N3.fmtLongDate(d))}<small>${esc(past ? t('set.passed') : n === 0 ? t('set.today') : tn('set.in', n))}</small></span></button>`;
    }).join('');
    const langs = N3.LANGS.map(([c, name]) => `<button class="opt${N3.lang() === c ? ' on' : ''}" data-act="lang" data-arg="${c}" lang="${c}"><span class="rad"></span><span class="t">${esc(name)}</span></button>`).join('');
    return `
${hd(esc(t('title.settings')), { back: true })}
<div class="sec" id="lang">${secHead(esc(t('lang.label')), '', N3.lang() === 'en' ? '' : 'Language')}<div class="opts">${langs}</div></div>
<div class="sec">${secHead(esc(t('set.exam')))}<div class="opts">${exams}</div></div>
<div class="sec">${secHead(esc(t('set.daily')))}
  <div class="seg">${N3.DAILY_NEW_OPTIONS.map(n => `<button class="${S().settings.dailyNew === n ? 'on' : ''}" data-act="daily" data-arg="${n}">${n}</button>`).join('')}</div></div>
<div class="sec">${secHead(esc(t('set.dailyG')))}
  <div class="seg">${N3.DAILY_GRAMMAR_OPTIONS.map(n => `<button class="${S().settings.dailyGrammar === n ? 'on' : ''}" data-act="dailyG" data-arg="${n}">${n}</button>`).join('')}</div></div>
${accountSec()}
<div class="sec">${secHead(esc(t('set.backup')))}
  <p class="note">${esc(t('set.backupNote'))}</p>
  <div class="btns"><button class="btn" data-act="exportProgress">${esc(t('set.export'))}</button><button class="btn" data-act="importProgress">${esc(t('set.import'))}</button></div>
  <input type="file" id="import-file" accept="application/json,.json" hidden></div>
<div class="sec">${secHead(esc(t('set.content')))}
<div class="kvs">
  <div class="kv"><span>${esc(t('set.words'))}</span><b>${N3.num(N3.WORDS.length)} · ${esc(tn('set.units', N3.UNITS.length))}</b></div>
  <div class="kv"><span>${esc(t('set.patterns'))}</span><b>${N3.GRAMMAR.length} · ${esc(tn('set.units', N3.G_UNITS.length))}</b></div>
  <div class="kv"><span>${esc(t('set.lr'))}</span><b>${N3.LISTENING.length} · ${N3.READING.length}</b></div>
  <div class="kv"><span>${esc(t('set.free'))}</span><b class="t">${freeNow() ? esc(t('set.freeAll')) : `${unitRangeText()}, grammar units 1–${N3.FREE_G_UNITS}, ${N3.FREE_LISTENING} conversations, ${N3.FREE_READING} passages`}</b></div>
  <div class="kv"><span>${esc(t('set.premium'))}</span><b class="t" data-go="#/paywall">${S().premium ? esc(t('set.active')) : freeNow() ? `${esc(t('set.startsAfter'))}<small class="kv-sub">${esc(t('set.price'))}</small>` : `${esc(t('set.seePlans'))}<small class="kv-sub">${esc(t('set.price'))}</small>`}</b></div>
  <div class="kv"><span>${esc(t('set.voice'))}</span><b class="t" lang="ja">VOICEVOX:春日部つむぎ</b></div>
</div></div>
<div class="sec"><button class="danger" data-act="reset">${esc(t('set.reset'))}</button></div>
<p class="fine">${esc(t('set.fine'))}</p>`;
  }

  // ---------- Account (Settings) ----------
  const acctUi = { busy: false, msg: '', err: false, del: false, delErr: '' };
  function syncLine(cls = '') {
    const st = N3.sync.status();
    return `<div class="sync ${cls} s-${st}" data-sync><i></i><span>${esc(N3.sync.statusText(st))}</span></div>`;
  }
  function accountSec() {
    const msg = acctUi.msg ? `<p class="acct-msg${acctUi.err ? ' err' : ''}" role="status">${esc(acctUi.msg)}</p>` : '';
    if (N3.sync.signedIn()) {
      return `<div class="sec" id="account">${secHead(esc(t('acc.h')))}
  <div class="kvs"><div class="kv"><span>${esc(t('acc.signed'))}</span><b class="acct-email">${esc(N3.sync.email())}</b></div></div>
  ${syncLine()}
  ${msg}
  <div class="btns"><button class="btn" data-act="syncNow"${acctUi.busy ? ' disabled' : ''}>${esc(t('acc.sync'))}</button><button class="btn" data-act="logout">${esc(t('acc.logout'))}</button></div>
  ${acctUi.del ? delConfirm() : `<button class="danger acct-del" data-act="deleteAccount"${acctUi.busy ? ' disabled' : ''}>${esc(t('acc.delete'))}</button>`}
</div>`;
    }
    const expired = N3.sync.status() === 'expired';
    return `<div class="sec" id="account">${secHead(esc(t('acc.h')))}
  <p class="note">${esc(t(expired ? 'acc.expired' : 'acc.optional'))}</p>
  <form class="acct-form" id="acct-form" novalidate>
    <label><span>${esc(t('acc.email'))}</span><input type="email" name="email" id="acct-email" autocomplete="username" inputmode="email" autocapitalize="off" spellcheck="false" value="${esc(N3.sync.email())}" required></label>
    <label><span>${esc(t('acc.pw'))}</span><input type="password" name="password" id="acct-pw" autocomplete="current-password" minlength="8" required></label>
    ${msg}
    <div class="btns"><button type="button" class="btn" data-act="authSignup"${acctUi.busy ? ' disabled' : ''}>${esc(t('acc.create'))}</button><button type="submit" class="btn primary" data-act="authLogin"${acctUi.busy ? ' disabled' : ''}>${esc(t('acc.login'))}</button></div>
  </form>
  ${syncLine()}
</div>`;
  }
  // Step 2 of account deletion: an inline confirmation card (the first tap only opens it).
  function delConfirm() {
    const err = acctUi.delErr ? `<p class="acct-msg err" role="alert">${esc(acctUi.delErr)}</p>` : '';
    return `<div class="del-confirm" id="del-confirm" role="region" aria-labelledby="del-h">
    <div class="h" id="del-h">${esc(t('del.h'))}</div>
    <p>${esc(t('del.p', { email: N3.sync.email() }))}</p>
    ${S().premium ? `<p>${t('del.prem')}</p>` : ''}
    ${err}
    <div class="btns"><button class="btn" data-act="deleteCancel"${acctUi.busy ? ' disabled' : ''}>${esc(t('del.cancel'))}</button><button class="btn danger-btn" data-act="deleteConfirm"${acctUi.busy ? ' disabled' : ''}>${esc(acctUi.busy ? t('del.busy') : t('acc.delete'))}</button></div>
  </div>`;
  }
  async function doDelete() {
    if (acctUi.busy) return;
    acctUi.busy = true; acctUi.delErr = ''; render();
    try {
      await N3.sync.deleteAccount();
    } catch (e) {
      acctUi.busy = false; acctUi.delErr = N3.sync.errorText(e); render();
      return;
    }
    acctUi.busy = false; acctUi.del = false; acctUi.delErr = ''; acctUi.msg = ''; acctUi.err = false;
    // A guest again: let the "create a free account" reminder come back (the one-time end-screen card stays used).
    ap.account = false; apSave();
    ui.session = ui.quiz = ui.mock = ui.listen = ui.read = null;
    render();
    toast(t('del.done'));
  }
  async function doAuth(kind) {
    if (acctUi.busy) return;
    const email = (document.getElementById('acct-email') || {}).value || '';
    const pw = (document.getElementById('acct-pw') || {}).value || '';
    if (!email.trim() || !pw) { acctUi.msg = t('auth.need'); acctUi.err = true; return render(); }
    if (kind === 'signup' && [...pw].length < 8) { acctUi.msg = t('err.weak_password'); acctUi.err = true; return render(); }
    acctUi.busy = true; acctUi.msg = kind === 'signup' ? t('auth.creating') : t('auth.logging'); acctUi.err = false;
    render();
    try {
      if (kind === 'signup') await N3.sync.signup(email, pw); else await N3.sync.login(email, pw);
      acctUi.msg = ''; acctUi.err = false;
      toast(kind === 'signup' ? t('auth.created') : t('auth.in'));
    } catch (e) {
      acctUi.msg = N3.sync.errorText(e); acctUi.err = true;
      acctUi.busy = false; render();
      const el = document.getElementById('acct-email'); if (el) el.value = email;
      return;
    }
    acctUi.busy = false;
    render();
  }

  // ---------- Backup ----------
  function exportProgress() {
    const data = JSON.stringify(N3.backup.make(), null, 1);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `n3tango-progress-${N3.today()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast('Progress exported');
  }
  function importFile(file) {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return toast('That file is too large to be a backup.');
    const r = new FileReader();
    r.onload = () => {
      let bk;
      try { bk = N3.backup.parse(String(r.result)); } catch (e) { return toast("That file isn't an N3 Tango backup."); }
      const n = Object.keys(bk.state.srs || {}).length;
      const when = bk.exportedAt ? ` from ${new Date(bk.exportedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : '';
      if (!confirm(`Restore the backup${when} (${plural(n, 'item')} studied)? This replaces the progress on this device${N3.sync.signedIn() ? ' and in your account' : ''}.`)) return;
      N3.replaceState(bk.state, Date.now() - 1);
      ui.session = ui.quiz = ui.mock = ui.listen = ui.read = null;
      N3.save();
      render();
      toast('Progress restored');
    };
    r.onerror = () => toast("Couldn't read that file.");
    r.readAsText(file);
  }

  // ---------- Paywall ----------
  const featList = offline => `<div class="feats">
  <div>${I('check')}${esc(t('pw.f1', { w: N3.num(N3.WORDS.length), u: N3.UNITS.length }))}</div>
  <div>${I('check')}${esc(t('pw.f2', { g: N3.GRAMMAR.length }))}</div>
  <div>${I('check')}${esc(t('pw.f3', { l: N3.LISTENING.length, r: N3.READING.length }))}</div>
  <div>${I('check')}${esc(t('pw.f4'))}</div>
  ${offline ? `<div>${I('check')}${esc(t('pw.f5'))}</div>` : ''}
</div>`;
  function viewPaywall(params) {
    if (freeNow() && !S().premium) return viewPaywallFree();
    let what = '';
    if (params.get('unit')) what = t('pw.unit', { u: params.get('unit') });
    else if (params.get('gunit')) what = t('pw.gunit', { u: params.get('gunit') });
    else if (params.get('listen')) what = t('pw.listen', { a: N3.FREE_LISTENING + 1, b: N3.LISTENING.length });
    else if (params.get('read')) what = t('pw.read', { a: N3.FREE_READING + 1, b: N3.READING.length });
    return `
<div class="runtop"><button class="icon-btn" data-act="back" aria-label="${esc(t('aria.close'))}">${I('close')}</button></div>
<div class="pw"><h1>${esc(t('pw.h'))}</h1>
  <p id="pw-once">${esc(t('pw.oneTime'))}</p>
  <p>${esc(what + t('pw.free', { units: unitRangeT(), g: N3.FREE_G_UNITS, l: N3.FREE_LISTENING, r: N3.FREE_READING }))}</p></div>
${featList(true)}
${paywallPlans()}`;
  }

  // Free period: the Premium screen stays reachable but sells nothing; registration is offered only as sync.
  function viewPaywallFree() {
    const acct = N3.sync.signedIn() ? ''
      : `<button class="btn primary start" data-act="accountFirst" id="pw-account">${esc(t('pw.saveAcct'))}</button>
<p class="fine">${esc(t('pw.saveFine'))}</p>`;
    return `
<div class="runtop"><button class="icon-btn" data-act="back" aria-label="${esc(t('aria.close'))}">${I('close')}</button></div>
<div class="pw" id="pw-free"><h1>${esc(t('free.msg'))}</h1>
  <p>${esc(t('pw.freeSub'))}</p></div>
${featList(false)}
${acct}`;
  }

  const PLAN_NAME = { lifetime: 'pw.planL', monthly: 'pw.planM', yearly: 'pw.planY' };
  // Stripe Payment Link for the Lifetime purchase, tagged with the account id (client_reference_id) and email.
  function checkoutUrl() {
    const base = N3.LIFETIME_LINK || '';
    const uid = N3.sync.userId();
    if (!base || !uid) return '';
    return base + (base.includes('?') ? '&' : '?') + 'client_reference_id=' + encodeURIComponent(uid) +
      '&prefilled_email=' + encodeURIComponent(N3.sync.email());
  }
  function paywallPlans() {
    if (S().premium) {
      const p = N3.sync.plan();
      return `<div class="pw-on" id="pw-active"><b>${esc(t('pw.active'))}</b>${p && PLAN_NAME[p] ? `<span>${esc(t(PLAN_NAME[p]))}</span>` : ''}</div>
<p class="fine">${esc(t('pw.activeFine'))}</p>`;
    }
    const cards = `<div class="plans">
  <div class="plan-o on" id="pw-lifetime" data-plan="lifetime"><span class="rad"></span><span class="t">${esc(t('pw.lifetime'))}<small>${esc(t('pw.lifetimeSub'))}</small></span><span class="pr">$29.99<small>${esc(t('pw.oneTimeLbl'))}</small></span></div>
</div>`;
    if (!N3.sync.signedIn()) {
      return `${cards}
<button class="btn primary start" data-act="accountFirst" id="pw-account">${esc(t('pw.first'))}</button>
<p class="fine">${esc(t('pw.firstFine'))}</p>`;
    }
    const url = checkoutUrl();
    if (!url) {
      return `${cards}
<p class="note pw-soon" id="pw-soon">${esc(t('pw.soon'))}</p>`;
    }
    return `${cards}
<a class="btn primary start" id="pw-buy" href="${esc(url)}" rel="noopener">${esc(t('pw.continue', { plan: t('pw.lifetime'), price: t('pw.priceL') }))}</a>
<p class="fine">${esc(t('pw.stripe'))}</p>`;
  }

  // ---------- Router ----------
  const running = r => !!r && !r.finished;
  const ROUTES = {
    home: { view: viewHome, tab: 'home' },
    learn: { view: viewLearn, tab: 'learn' },
    session: { view: viewSession, tab: 'learn', nonav: () => !ui.session || !ui.session.finished },
    practice: { view: viewPractice, tab: 'practice' },
    quiz: { view: viewQuiz, tab: 'practice', nonav: () => running(ui.quiz) },
    listening: { view: viewListening, tab: 'practice', nonav: () => running(ui.listen) },
    reading: { view: viewReading, tab: 'practice' },
    passage: { view: viewPassage, tab: 'practice' },
    mock: { view: viewMock, tab: 'practice', nonav: () => running(ui.mock) },
    progress: { view: viewProgress, tab: 'progress' },
    settings: { view: viewSettings, tab: 'progress' },
    paywall: { view: viewPaywall, tab: null, nonav: true },
  };
  let lastRoute = null;
  let sheetCtl = null;

  function parse() {
    const h = location.hash.replace(/^#\/?/, '');
    const [name, q] = h.split('?');
    return { name: ROUTES[name] ? name : 'home', params: new URLSearchParams(q || '') };
  }

  function render() {
    const { name, params } = parse();
    const r = ROUTES[name];
    const key = name + '|' + params.toString();
    if (key !== lastRoute) stopAudio();
    $view.innerHTML = r.view(params);
    const nonav = typeof r.nonav === 'function' ? r.nonav() : !!r.nonav;
    $app.classList.toggle('nonav', nonav);
    for (const el of $nav.children) {
      el.classList.toggle('on', el.dataset.tab === r.tab);
      const l = el.querySelector('.l'); if (l) l.textContent = t('nav.' + el.dataset.tab);
    }
    if (key !== lastRoute) { window.scrollTo(0, 0); lastRoute = key; }
    // red sheet on the study card
    sheetCtl = null;
    const zone = $view.querySelector('.zone[data-sheet="session"]');
    if (zone) sheetCtl = N3.mountSheet(zone, () => { if (ui.session && !ui.session.revealed) { ui.session.revealed = true; render(); } });
    // "Create a free account" (paywall, account prompt, Home banner): bring the account form into view.
    if (ui.focusAcct && name === 'settings') {
      ui.focusAcct = false;
      const el = document.getElementById('account');
      if (el) el.scrollIntoView({ block: 'start' });
      const f = document.getElementById('acct-email');
      if (f) f.focus({ preventScroll: true });
    }
  }

  // ---------- Actions ----------
  const ACTIONS = {
    home() { ui.planRun = false; ui.quiz = ui.listen = ui.read = null; go('#/home'); },
    planStart() {
      const s = N3.todayPlan().left[0];
      if (!s) { ui.planRun = false; return go('#/home'); }
      ui.planRun = true;
      if (!startStep(s.key)) { N3.markStep(s.key); N3.save(); ACTIONS.planStart(); }
    },
    planStep(arg) {
      const s = N3.todayPlan().steps.find(x => x.key === arg);
      if (!s) return;
      if (s.done) {
        if (arg === 'vocab') return go('#/learn');
        if (arg === 'grammar') return go('#/learn?t=grammar');
        return go(arg === 'listen' ? '#/listening' : '#/reading');
      }
      ui.planRun = true;
      if (!startStep(arg)) toast('Nothing left in this step today.');
    },
    startToday() { if (!startSession('vocab', 'today')) toast('No words due and no new words left today.'); },
    startGrammar() { if (!startSession('grammar', 'today')) toast('No grammar due and no new patterns left today.'); },
    extra() { startSession('vocab', 'extra'); },
    unit(arg) {
      const u = Number(arg);
      if (!N3.isUnitOpen(u)) return go(`#/paywall?unit=${u}`);
      ui.planRun = false;
      if (!startSession('vocab', 'unit', u)) toast(`Every word in Unit ${u} is studied and none is due.`);
    },
    gunit(arg) {
      const u = Number(arg);
      if (!N3.isGUnitOpen(u)) return go(`#/paywall?gunit=${u}`);
      ui.planRun = false;
      if (!startSession('grammar', 'unit', u)) toast(`Every pattern in grammar unit ${u} is studied and none is due.`);
    },
    reveal() {
      if (!ui.session || ui.session.revealed) return;
      if (sheetCtl) sheetCtl.reveal(); else { ui.session.revealed = true; render(); }
    },
    grade(arg) { if (ui.session && ui.session.revealed) gradeCard(arg === '1'); },
    exitSession() { stopAudio(); const t = ui.session && ui.session.track; ui.session = null; ui.planRun = false; go(t === 'grammar' ? '#/learn?t=grammar' : '#/learn'); },
    play(arg, el) {
      const i = (arg || '').indexOf(':');
      if (i <= 0) return;
      const kind = arg.slice(0, i), id = arg.slice(i + 1);
      // listening: count plays (the mock allows one)
      const { name } = parse();
      const q = name === 'mock' && ui.mock && !ui.mock.finished ? ui.mock.questions[ui.mock.idx]
        : name === 'listening' && ui.listen && !ui.listen.finished ? ui.listen.questions[ui.listen.idx] : null;
      if (kind === 'listening' && q && q.kind === 'listen') {
        if (name === 'mock' && q.plays >= 1) return;
        q.plays++;
        render();
        el = $view.querySelector('.play.big');
      }
      playAudio(kind, id, el);
    },

    mode(arg) { ui.quizMode = arg; render(); },
    quizFrom(arg) { ui.quizMode = arg; ui.quiz = null; ui.planRun = false; go('#/quiz'); },
    startQuiz() {
      const z = N3.makeQuiz(ui.quizMode);
      if (!z.questions.length) return toast('No items available for this quiz yet.');
      ui.quiz = Object.assign(z, { idx: 0, finished: false });
      if (parse().name !== 'quiz') go('#/quiz'); else render();
    },
    pick(arg) {
      const { name } = parse();
      if (name === 'passage' && ui.read) return pickRead(arg);
      const i = Number(arg);
      if (name === 'quiz' && running(ui.quiz)) {
        const q = ui.quiz.questions[ui.quiz.idx];
        if (q.picked !== null || q.kind === 'gorder') return;
        q.picked = i; record(q, 'quiz'); render();
      } else if (name === 'listening' && running(ui.listen)) {
        const q = ui.listen.questions[ui.listen.idx];
        if (q.picked !== null) return;
        q.picked = i; record(q, 'practice'); render();
      } else if (name === 'mock' && running(ui.mock)) {
        ui.mock.questions[ui.mock.idx].picked = i; render();
      }
    },
    tile(arg) {
      const q = running(ui.quiz) && ui.quiz.questions[ui.quiz.idx];
      const i = Number(arg);
      if (!q || q.kind !== 'gorder' || q.done || q.built.includes(i)) return;
      q.built.push(i); render();
    },
    untile(arg) {
      const q = running(ui.quiz) && ui.quiz.questions[ui.quiz.idx];
      if (!q || q.kind !== 'gorder' || q.done) return;
      q.built.splice(Number(arg), 1); render();
    },
    clearOrder() { const q = running(ui.quiz) && ui.quiz.questions[ui.quiz.idx]; if (q && !q.done) { q.built = []; render(); } },
    checkOrder() {
      const q = running(ui.quiz) && ui.quiz.questions[ui.quiz.idx];
      if (!q || q.kind !== 'gorder' || q.done || q.built.length !== q.order.length) return;
      q.done = true;
      q.picked = q.built.map(i => q.order[i]).join('') === q.tiles.join('') ? 0 : 1;
      record(q, 'quiz'); render();
    },
    next() {
      const z = ui.quiz;
      stopAudio();
      if (z.idx + 1 < z.questions.length) z.idx++; else z.finished = true;
      render();
    },
    exitQuiz() { stopAudio(); ui.quiz = null; ui.planRun = false; render(); },
    quizAgain() { ui.quiz = null; ACTIONS.startQuiz(); },

    listenRound() { ui.planRun = false; if (!startListen(N3.nextListening(5), false)) toast('No conversations available.'); else render(); },
    listenOne(arg) {
      const x = N3.L_BY_ID[arg];
      if (!x) return;
      if (!N3.isListenOpen(x)) return go('#/paywall?listen=1');
      ui.planRun = false; startListen([x], false); render();
    },
    listenNext() {
      const z = ui.listen;
      stopAudio();
      if (z.idx + 1 < z.questions.length) z.idx++; else finishListen();
      render();
    },
    exitListen() { stopAudio(); ui.listen = null; ui.planRun = false; render(); },
    leaveListen() { ui.listen = null; render(); },

    readOne(arg) {
      const p = N3.R_BY_ID[arg];
      if (!p) return;
      if (!N3.isReadOpen(p)) return go('#/paywall?read=1');
      if (parse().name !== 'passage') ui.planRun = false;
      openPassage(p, false);
      render();
    },
    furi() { ui.furi = !ui.furi; render(); },

    startMock() {
      stopAudio();
      ui.planRun = false;
      ui.mock = Object.assign(N3.makeMock(), { idx: 0, finished: false });
      if (parse().name !== 'mock') go('#/mock'); else { render(); window.scrollTo(0, 0); }
    },
    mockNext() {
      const m = ui.mock;
      if (m.questions[m.idx].picked === null) return;
      stopAudio();
      if (m.idx + 1 < m.questions.length) m.idx++; else finishMock();
      render();
      window.scrollTo(0, 0);
    },
    exitMock() { if (confirm(t('mock.exit'))) { stopAudio(); ui.mock = null; render(); } },
    leaveResults(arg) {
      if (arg === '#/quiz') ui.quiz = null;
      if (arg === '#/mock') ui.mock = null;
      go(arg === '#/mock' ? '#/home' : arg);   // Home shows the weakest section after a mock
    },

    exam(arg) { S().settings.examDate = arg; N3.save(); render(); toast(t('set.examDone')); },
    daily(arg) { S().settings.dailyNew = Number(arg); N3.save(); render(); },
    dailyG(arg) { S().settings.dailyGrammar = Number(arg); N3.save(); render(); },
    reset() {
      if (confirm(t(N3.sync.signedIn() ? 'set.resetQAcct' : 'set.resetQ'))) {
        N3.resetAll(); ui.session = ui.quiz = ui.mock = ui.listen = ui.read = null; render(); toast(t('set.resetDone'));
      }
    },
    back() { if (lastNav) history.back(); else go('#/home'); },

    authLogin() { doAuth('login'); },
    authSignup() { doAuth('signup'); },
    deleteAccount() { acctUi.del = true; acctUi.delErr = ''; render(); const el = document.getElementById('del-confirm'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); },
    deleteCancel() { acctUi.del = false; acctUi.delErr = ''; render(); },
    deleteConfirm() { doDelete(); },
    logout() {
      acctUi.del = false;
      if (!confirm(t('auth.logoutQ'))) return;
      N3.sync.logout(); acctUi.msg = ''; render(); toast(t('auth.out'));
    },
    async syncNow() {
      acctUi.busy = true; render();
      await N3.sync.syncNow();
      acctUi.busy = false; render();
    },
    exportProgress() { exportProgress(); },
    importProgress() { const f = document.getElementById('import-file'); if (f) { f.value = ''; f.click(); } },

    plan(arg) { ui.plan = arg; render(); },
    apLater() { ui.apRun = null; render(); },
    apCreate() { ui.apRun = null; ACTIONS.accountFirst(); },
    // Home: one tap from the weakest mock-test section into matching practice.
    fixSec(arg) {
      ui.planRun = false;
      if (arg === 'rd') { const p = N3.nextReading(); if (p) openPassage(p, false); else go('#/reading'); return; }
      if (arg === 'ls') { if (!startListen(N3.nextListening(5), false)) go('#/listening'); return; }
      ui.quizMode = 'mixed'; ui.quiz = null; ACTIONS.startQuiz();
    },
    async install() { const ok = await N3.install.prompt(); render(); if (ok) toast(t('inst.done')); },
    installDismiss() { N3.install.dismiss(); render(); },
    lang(arg) { if (N3.setLang(arg)) render(); },
    accountFirst() {
      // Scroll + focus happen in render() once Settings is on screen: the hashchange re-render would
      // otherwise replace the form and drop the focus.
      ui.focusAcct = true;
      go('#/settings');
    },
  };
  let lastNav = false; // true once we have navigated inside the app (so history.back stays in-app)
  window.addEventListener('hashchange', () => { lastNav = true; render(); checkoutReturn(); });

  document.addEventListener('click', e => {
    const tab = e.target.closest('.nav [data-tab]');
    if (tab) {
      const t = tab.dataset.tab;
      if (ui.quiz && ui.quiz.finished) ui.quiz = null;
      if (ui.listen && ui.listen.finished) ui.listen = null;
      if (ui.mock && ui.mock.finished) ui.mock = null;
      ui.planRun = false;
      return go('#/' + t);
    }
    const a = e.target.closest('[data-act]');
    if (a && !a.disabled && ACTIONS[a.dataset.act]) { e.preventDefault(); ACTIONS[a.dataset.act](a.dataset.arg, a); return; }
    const g = e.target.closest('[data-go]');
    if (g) go(g.dataset.go);
  });

  document.addEventListener('submit', e => { if (e.target && e.target.id === 'acct-form') e.preventDefault(); });
  document.addEventListener('change', e => {
    if (e.target && e.target.id === 'import-file') importFile(e.target.files && e.target.files[0]);
    if (e.target && e.target.matches && e.target.matches('select[data-lang]')) ACTIONS.lang(e.target.value);
  });
  // Install prompt became available (or the app was installed): refresh the Home card.
  N3.onInstallChange = () => { if (parse().name === 'home') render(); };

  // Sync status changes: update the small status lines in place (no full re-render, so forms keep their input).
  N3.onSyncStatus = st => {
    document.querySelectorAll('[data-sync]').forEach(el => {
      el.className = el.className.replace(/\bs-[a-z]+\b/, 's-' + st);
      el.querySelector('span').textContent = N3.sync.statusText(st);
    });
    if (st === 'expired' && parse().name === 'settings') render();
  };
  // Premium switched on/off by the server entitlement: re-render so locks update.
  N3.onEntitlement = () => { if (!acctUi.busy) render(); };

  // Return from Stripe Checkout: success URL is #/settings?checkout=success. Pull once, then report.
  async function checkoutReturn() {
    const { name, params } = parse();
    if (params.get('checkout') !== 'success') return;
    params.delete('checkout');
    const q = params.toString();
    history.replaceState(null, '', location.pathname + location.search + '#/' + name + (q ? '?' + q : ''));
    lastRoute = null; render();
    if (!N3.sync.signedIn()) { toast(t('ck.login')); return; }
    await N3.sync.syncNow();
    if (S().premium) { render(); toast(t('ck.welcome')); return; }
    toast(t('ck.soon'));
    // The webhook may land a moment after the redirect: check a couple more times quietly.
    for (const ms of [8000, 20000]) {
      await new Promise(r => setTimeout(r, ms));
      await N3.sync.syncNow();
      if (S().premium) { render(); toast(t('ck.welcome')); return; }
    }
  }

  // A newer copy came from the cloud: show it (runs in progress keep going on the new state).
  N3.onRemoteAdopt = () => { if (!acctUi.busy) render(); };

  // Keyboard (desktop): Space/Enter reveal, ←/1 don't know, →/2 know, 1–4 pick answers.
  document.addEventListener('keydown', e => {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const { name } = parse();
    if (name === 'session' && ui.session && !ui.session.finished) {
      if (!ui.session.revealed && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); ACTIONS.reveal(); }
      else if (ui.session.revealed && (e.key === 'ArrowLeft' || e.key === '1')) gradeCard(false);
      else if (ui.session.revealed && (e.key === 'ArrowRight' || e.key === '2')) gradeCard(true);
    } else if ((name === 'quiz' || name === 'mock' || name === 'listening') && /^[1-4]$/.test(e.key)) {
      ACTIONS.pick(String(Number(e.key) - 1));
    }
  });

  // Re-render when the app returns to the foreground (the date may have rolled over).
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

  if (!N3.WORDS.length) {
    $view.innerHTML = '<div class="empty"><b>No word data found</b><p>data/words.js is missing or empty. Run <code>node tools/build-data.js</code>.</p></div>';
  } else {
    render();
    checkoutReturn();
  }
})();
