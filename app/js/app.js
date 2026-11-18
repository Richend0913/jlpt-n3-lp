// Screens + hash router. Views render HTML strings into #view; clicks are handled by delegation
// via data-go (navigate) and data-act (action) attributes.
(function () {
  'use strict';
  const N3 = window.N3;
  const S = () => N3.state;
  const esc = N3.esc;
  const $view = document.getElementById('view');
  const $app = document.getElementById('app');
  const $nav = document.getElementById('nav');

  // In-memory UI state (sessions are not persisted; SRS results are saved as they happen).
  const ui = { session: null, quiz: null, quizMode: 'mixed', mock: null, plan: 'year' };

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
  const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };
  const unitRange = () => (N3.FREE_UNITS === 1 ? 'Unit 1' : `Units 1–${N3.FREE_UNITS}`);

  function unitRow(u) {
    const ws = N3.unitWords(u);
    const open = N3.isUnitOpen(u);
    const seen = ws.filter(w => N3.isSeen(w.id)).length;
    const mast = ws.filter(w => N3.isMastered(w.id)).length;
    return `<div class="unit${open ? '' : ' locked'}" data-act="unit" data-arg="${u}">
      <div class="no">${u}</div>
      <div class="body">
        <div class="t">Unit ${u}<span>${open ? `${seen}/${ws.length} learned` : `${ws.length} words · Premium`}</span></div>
        <div class="bar"><i style="width:${pct(seen, ws.length)}%"></i><b style="width:${pct(mast, ws.length)}%"></b></div>
      </div>
      ${open ? '' : '<div class="lock">🔒</div>'}
    </div>`;
  }

  // ---------- Home (comp B) ----------
  function viewHome() {
    const t = N3.today();
    const exam = N3.examDate();
    const days = N3.daysBetween(t, exam);
    const streak = N3.currentStreak();
    const d = N3.day();
    const goal = S().settings.dailyNew;
    const due = N3.dueWords().length;
    const newLeft = Math.min(N3.newLeftToday(), N3.newWords().length);
    const done = d.newCount + d.reviewCount;
    const barPct = pct(done, done + due + newLeft);
    const learnSub = due && newLeft ? `${due} due · ${newLeft} new`
      : due ? N3.plural(due, 'review') : newLeft ? `${newLeft} new words` : 'All done ✓';
    let big, line;
    if (days > 0) { big = `${days}<small> ${days === 1 ? 'day' : 'days'}</small>`; line = 'A little every day adds up.'; }
    else if (days === 0) { big = 'Today'; line = '頑張って！ Good luck on the exam.'; }
    else { big = '—'; line = 'Pick your next exam date in Settings.'; }
    const w = N3.wordOfDay();
    return `
<div class="top"><div class="logo">N3 Tango</div><div class="streak" data-go="#/progress">🔥 ${N3.plural(streak, 'day')}</div></div>
<div class="hello">${greeting()}<b>Let's pass N3, together.</b></div>
<div class="count" data-go="#/settings"><div class="lbl">DAYS TO JLPT N3 · ${N3.fmtExamDate(exam)}</div><div class="big">${big}</div><div class="date">${line}</div></div>
<div class="goal"><h3>Today's goal</h3><div class="bar"><i style="width:${barPct}%"></i></div><div class="row"><span>New words <b>${d.newCount} / ${goal}</b></span><span>Reviews due <b>${due}</b></span></div></div>
<div class="actions"><div class="act main" data-act="learnToday">Learn<small>${esc(learnSub)}</small></div><div class="act" data-go="#/quiz">Quiz<small>4-choice drill</small></div><div class="act" data-go="#/mock">Mock test<small>Vocabulary</small></div></div>
${w ? `<div class="wotd"><div class="lbl">WORD OF THE DAY</div><div class="word">${N3.ruby(w)}</div><div class="mean">${esc(w.meaning)}</div><div class="ex">${esc(w.example)}<br>${esc(w.example_translation)}</div></div>` : ''}`;
  }

  // ---------- Learn ----------
  function viewLearn() {
    const due = N3.dueWords().length;
    const newLeft = Math.min(N3.newLeftToday(), N3.newWords().length);
    const anyNew = N3.newWords().length;
    let today;
    if (due || newLeft) {
      today = `<div class="lbl-o">Today's session</div>
        <div style="font-size:15px;margin:8px 0 14px">${N3.plural(due, 'review')} due · ${newLeft} new ${newLeft === 1 ? 'word' : 'words'}</div>
        <button class="btn orange" data-act="startToday">Start session</button>`;
    } else if (anyNew) {
      today = `<div class="lbl-o">Today's session</div>
        <div style="font-size:15px;margin:8px 0 14px">All caught up for today 🎉</div>
        <button class="btn light" data-act="extra">Learn 5 extra words</button>`;
    } else {
      today = `<div class="lbl-o">Today's session</div>
        <div style="font-size:15px;margin:8px 0 4px">All caught up 🎉</div>
        <div class="muted" style="font-size:13px">You've started every word in ${unitRange()}. Reviews will come back as they fall due.</div>`;
    }
    const sample = N3.META.source === 'sample' ? '<p class="fine">Sample word list (development build).</p>' : '';
    return `
<div class="hdr"><h1>Learn</h1><div class="sub">${N3.WORDS.length} words</div></div>
<div class="card">${today}</div>
<div class="section-t">UNITS</div>
${N3.UNITS.map(unitRow).join('')}
${sample}`;
  }

  // ---------- Learn session (flashcards + SRS) ----------
  function startSession(kind, unit) {
    let due, fresh, title;
    if (kind === 'unit') {
      const pool = N3.unitWords(unit);
      due = N3.dueWords(pool);
      fresh = N3.newWords(pool).slice(0, 10);
      title = `Unit ${unit}`;
    } else if (kind === 'extra') {
      due = [];
      fresh = N3.newWords().slice(0, 5);
      title = 'Extra words';
    } else {
      due = N3.dueWords();
      fresh = N3.newWords().slice(0, N3.newLeftToday());
      title = 'Today';
    }
    const queue = [...due.map(w => ({ id: w.id, kind: 'review' })), ...fresh.map(w => ({ id: w.id, kind: 'new' }))];
    if (!queue.length) return false;
    ui.session = { title, queue, idx: 0, revealed: false, total: queue.length, done: 0, firstKnow: 0, requeues: {}, finished: false };
    go('#/session');
    return true;
  }

  function viewSession() {
    const s = ui.session;
    if (!s) { setTimeout(() => go('#/learn')); return ''; }
    if (s.finished) {
      return `
<div class="hdr"><h1>Session complete</h1></div>
<div class="score"><div class="lbl">${esc(s.title.toUpperCase())} · ${N3.plural(s.total, 'CARD')}</div>
  <div class="big">${s.firstKnow}<small> / ${s.total}</small></div><p>known on the first try</p></div>
<div class="card"><div class="kv"><span>Reviews due now</span><b>${N3.dueWords().length}</b></div>
<div class="kv"><span>New words today</span><b>${N3.day().newCount} / ${S().settings.dailyNew}</b></div>
<div class="kv"><span>Streak</span><b>🔥 ${N3.plural(N3.currentStreak(), 'day')}</b></div></div>
<div class="btns"><button class="btn light" data-go="#/learn">Back to Learn</button><button class="btn" data-go="#/quiz">Take a quiz</button></div>`;
    }
    const item = s.queue[s.idx];
    const w = N3.BY_ID[item.id];
    const pill = item.again ? '<span class="pill">AGAIN</span>' : item.kind === 'new' ? '<span class="pill">NEW</span>' : '<span class="pill rev">REVIEW</span>';
    const reveal = s.revealed ? `
      <div class="reveal">
        <div class="m">${esc(w.meaning)}</div>
        <div class="pos">${esc(N3.POS_LABEL[w.pos] || w.pos || '')}</div>
        ${w.example ? `<div class="ex"><div class="ex-row"><div class="ex-ja">${N3.exampleHtml(w)}</div>${playBtn('example', w.id, 'Play example sentence')}</div><div class="en">${esc(w.example_translation || '')}</div></div>` : ''}
      </div>` : '<div class="tap">Tap to reveal</div>';
    const actions = s.revealed
      ? `<div class="grade"><button class="btn light" data-act="grade" data-arg="0">Don't know</button><button class="btn orange" data-act="grade" data-arg="1">Know</button></div>`
      : `<div class="pad"><button class="btn" data-act="reveal">Show answer</button></div>`;
    return `
<div class="runtop"><button class="icon-btn" data-act="exitSession" aria-label="Close">✕</button><div class="bar"><i style="width:${pct(s.done, s.total)}%"></i></div><div class="n">${s.done} / ${s.total}</div></div>
<div class="flash${s.revealed ? '' : ' hidden'}" data-act="reveal">
  <div class="tag">${pill}<span class="lbl-o">Unit ${w.unit}</span></div>
  <div class="w">${N3.ruby(w)}</div>
  ${s.revealed ? `<div class="say">${playBtn('word', w.id, 'Play word', 'Word')}</div>` : ''}
  ${reveal}
</div>
${actions}`;
  }

  // ---------- Audio (relative paths so file:// works; missing files fail silently) ----------
  let curAudio = null;
  function stopAudio() {
    if (curAudio) { try { curAudio.pause(); } catch (e) {} curAudio = null; }
    document.querySelectorAll('.play.on').forEach(el => el.classList.remove('on'));
  }
  function playAudio(kind, id, el) {
    stopAudio();
    if (!/^[a-z0-9-]+$/i.test(id || '')) return;
    let a;
    try { a = new Audio(`audio/${kind}/${id}.mp3`); } catch (e) { return; }
    curAudio = a;
    const off = () => { if (el) el.classList.remove('on'); if (curAudio === a) curAudio = null; };
    a.addEventListener('ended', off);
    a.addEventListener('error', off);
    if (el) el.classList.add('on');
    try { const p = a.play(); if (p && p.catch) p.catch(off); } catch (e) { off(); }
  }
  function playBtn(kind, id, label, text) {
    return `<button class="play${text ? ' wide' : ''}" data-act="play" data-arg="${kind}:${esc(id)}" aria-label="${esc(label)}"><span class="ic" aria-hidden="true"></span>${text ? `<span>${esc(text)}</span>` : ''}</button>`;
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
    } else {
      s.done++;
    }
    s.idx++;
    s.revealed = false;
    if (s.idx >= s.queue.length) s.finished = true;
    render();
  }

  // ---------- Question rendering (Quiz + Mock) ----------
  function questionHtml(q, { kind, ins, mock }) {
    const w = q.word;
    const loc = N3.locateInExample(w);
    let body;
    if (q.type === 'fill') {
      const answered = q.picked !== null && !mock;
      body = `<div class="sent">${esc(loc.before)}<span class="blank">${answered ? esc(w.word) : '（　　）'}</span>${esc(loc.after)}</div>
        ${answered ? `<div class="hint">${esc(w.example_translation || '')}</div>` : ''}`;
    } else if (mock && loc) {
      body = `<div class="sent">${esc(loc.before)}<u>${esc(loc.hit)}</u>${esc(loc.after)}</div>`;
    } else {
      body = `<div class="prompt">${esc(w.word)}</div>`;
    }
    return `<div class="q"><div class="kind">${esc(kind)}</div><div class="ins">${ins}</div>${body}</div>`;
  }

  function choicesHtml(q, { reveal }) {
    const ja = q.type !== 'meaning';
    return `<div class="choices">${q.choices.map((c, i) => {
      let cls = '';
      if (reveal && q.picked !== null) { if (i === q.answer) cls = ' ok'; else if (i === q.picked) cls = ' ng'; }
      else if (!reveal && q.picked === i) cls = ' sel';
      const dis = reveal && q.picked !== null ? ' disabled' : '';
      return `<button class="choice${cls}" data-act="pick" data-arg="${i}"${dis}${ja ? ' lang="ja"' : ''}><span class="k">${i + 1}</span><span>${esc(c)}</span></button>`;
    }).join('')}</div>`;
  }

  const QUIZ_TEXT = {
    meaning: ['MEANING', 'What does this word mean?'],
    reading: ['READING', 'How is this word read?'],
    fill: ['FILL IN THE BLANK', 'Which word fits the blank?'],
  };

  // ---------- Quiz ----------
  const MODES = [
    ['mixed', 'Mixed', 'Meaning, reading and fill-in'],
    ['meaning', 'Meaning', 'Word → English'],
    ['reading', 'Reading', 'Kanji → hiragana'],
    ['fill', 'Fill-in', 'Complete the sentence'],
  ];

  function viewQuiz() {
    const z = ui.quiz;
    if (!z) {
      const open = N3.openWords();
      const seen = open.filter(w => N3.isSeen(w.id)).length;
      const info = seen >= 4
        ? `Questions come from the ${N3.plural(seen, 'word')} you've studied.`
        : `You haven't studied many words yet, so this quiz uses all of ${unitRange()}.`;
      return `
<div class="hdr"><h1>Quiz</h1><div class="sub">10 questions</div></div>
<div class="lede">${info} Missed words go back into your reviews.</div>
<div class="modes">${MODES.map(([k, t, d]) => `<button class="mode${ui.quizMode === k ? ' on' : ''}" data-act="mode" data-arg="${k}"><b>${t}</b><small>${d}</small></button>`).join('')}</div>
<div class="pad"><button class="btn orange" data-act="startQuiz">Start quiz</button></div>
<div class="card" data-go="#/mock" style="display:flex;align-items:center;gap:14px">
  <div style="flex:1"><div class="lbl-o">Mock test</div><div style="font-size:15px;font-weight:700;margin-top:4px">JLPT-style vocabulary test</div><div class="muted" style="font-size:13px;margin-top:2px">10 questions · 3 sections</div></div><div style="font-size:22px;color:#e8762c">›</div>
</div>`;
    }
    if (z.finished) return resultsHtml(z, 'Quiz results', 'quizAgain', '#/quiz');
    const q = z.questions[z.idx];
    const [kind, ins] = QUIZ_TEXT[q.type];
    const answered = q.picked !== null;
    let fb = '';
    if (answered) {
      const ok = q.picked === q.answer;
      const w = q.word;
      fb = `<div class="fb ${ok ? 'ok' : 'ng'}"><div class="h">${ok ? 'Correct!' : 'Not quite — added to reviews'}</div>
        <div class="w" lang="ja">${esc(w.word)}<small>${esc(w.reading)}</small></div><div>${esc(w.meaning)}</div>
        ${w.example && q.type !== 'fill' ? `<div class="muted" style="margin-top:6px" lang="ja">${esc(w.example)}</div><div class="muted">${esc(w.example_translation || '')}</div>` : ''}</div>
        <div class="pad"><button class="btn" data-act="next">${z.idx + 1 < z.questions.length ? 'Next' : 'See results'}</button></div>`;
    }
    return `
<div class="runtop"><button class="icon-btn" data-act="exitQuiz" aria-label="Close">✕</button><div class="bar"><i style="width:${pct(z.idx + (answered ? 1 : 0), z.questions.length)}%"></i></div><div class="n">${z.idx + 1} / ${z.questions.length}</div></div>
${questionHtml(q, { kind, ins })}
${choicesHtml(q, { reveal: true })}
${fb}`;
  }

  function recordAnswer(q) {
    const ok = q.picked === q.answer;
    S().stats.quizTotal++;
    if (ok) S().stats.quizRight++;
    N3.day().answers++;
    N3.touchStreak();
    if (!ok) N3.srsMarkWrong(q.id);
    N3.save();
    return ok;
  }

  function resultsHtml(z, title, againAct, doneHref, extra = '') {
    const right = z.questions.filter(q => q.picked === q.answer).length;
    const n = z.questions.length;
    const msg = right === n ? 'Perfect! 完璧！' : right >= n * 0.7 ? 'Nice work — keep going.' : 'Missed words are back in your reviews.';
    return `
<div class="hdr"><h1>${title}</h1></div>
<div class="score"><div class="lbl">SCORE</div><div class="big">${right}<small> / ${n}</small></div><p>${msg}</p></div>
${extra}
<div class="card rlist">${z.questions.map(q => {
      const ok = q.picked === q.answer;
      const w = q.word;
      return `<div class="r"><div class="mk ${ok ? 'ok' : 'ng'}">${ok ? '✓' : '✗'}</div><div class="d"><b lang="ja">${esc(w.word)}</b> <span class="muted" lang="ja">${esc(w.reading)}</span> — ${esc(w.meaning)}
        ${ok ? '' : `<div class="s">Your answer: <span lang="ja">${esc(q.picked === null ? '—' : q.choices[q.picked])}</span> · Correct: <span lang="ja">${esc(q.choices[q.answer])}</span></div>`}</div></div>`;
    }).join('')}</div>
<div class="btns"><button class="btn light" data-act="${againAct}">Try again</button><button class="btn" data-act="leaveResults" data-arg="${doneHref}">Done</button></div>`;
  }

  // ---------- Mock test ----------
  function viewMock() {
    const m = ui.mock;
    if (!m) {
      const hist = S().stats.mock;
      const best = hist.length ? Math.max(...hist.map(h => h.score)) : null;
      return `
<div class="hdr"><button class="icon-btn" data-act="back" aria-label="Back">‹</button><h1>Mock test</h1></div>
<div class="lede">A short vocabulary test in JLPT N3 format, drawn from ${unitRange()}${S().premium ? ' and beyond' : ''}. Answers are shown at the end.</div>
<div class="card">
  ${N3.MOCK_SECTIONS.map((s, i) => `<div class="kv"><span>Section ${i + 1} · ${s.title}</span><b>${s.n} Q</b></div>`).join('')}
</div>
${hist.length ? `<div class="card"><h3>Your results</h3>
  <div class="kv"><span>Best score</span><b>${best} / 10</b></div>
  ${hist.slice(-3).reverse().map(h => `<div class="kv"><span>${N3.fmtLongDate(h.date)}</span><b>${h.score} / ${h.total}</b></div>`).join('')}</div>` : ''}
<div class="pad"><button class="btn orange" data-act="startMock">Start mock test</button></div>`;
    }
    if (m.finished) {
      const secs = N3.MOCK_SECTIONS.map((s, si) => {
        const qs = m.questions.filter(q => q.sec === si);
        return `<div><b>${qs.filter(q => q.picked === q.answer).length}/${qs.length}</b>${s.title}</div>`;
      }).join('');
      return resultsHtml(m, 'Mock test results', 'startMock', '#/mock', `<div class="card"><h3>By section</h3><div class="secs">${secs}</div></div>`);
    }
    const q = m.questions[m.idx];
    const sec = N3.MOCK_SECTIONS[q.sec];
    const en = { reading: 'Choose the best reading for the underlined word.', fill: 'Choose the best word for the blank.', meaning: 'Choose the meaning of the underlined word.' }[q.type];
    const last = m.idx + 1 === m.questions.length;
    return `
<div class="runtop"><button class="icon-btn" data-act="exitMock" aria-label="Close">✕</button><div class="bar"><i style="width:${pct(m.idx, m.questions.length)}%"></i></div><div class="n">${m.idx + 1} / ${m.questions.length}</div></div>
${questionHtml(q, { kind: `SECTION ${q.sec + 1} · ${sec.title.toUpperCase()}`, ins: `<span lang="ja">${esc(sec.jp)}</span><br>${en}`, mock: true })}
${choicesHtml(q, { reveal: false })}
<div class="pad"><button class="btn" data-act="mockNext"${q.picked === null ? ' disabled' : ''}>${last ? 'Finish' : 'Next'}</button></div>`;
  }

  function finishMock() {
    const m = ui.mock;
    for (const q of m.questions) recordAnswer(q);
    const score = m.questions.filter(q => q.picked === q.answer).length;
    S().stats.mock.push({ date: N3.today(), score, total: m.questions.length });
    S().stats.mock = S().stats.mock.slice(-30);
    N3.save();
    m.finished = true;
  }

  // ---------- Progress ----------
  function viewProgress() {
    const all = N3.WORDS;
    const mastered = all.filter(w => N3.isMastered(w.id)).length;
    const learning = all.filter(w => N3.isSeen(w.id) && !N3.isMastered(w.id)).length;
    const st = S().stats;
    const acc = st.quizTotal ? `${pct(st.quizRight, st.quizTotal)}<small>%</small>` : '—';
    const hist = st.mock;
    return `
<div class="hdr"><h1>Progress</h1><button class="icon-btn" data-go="#/settings" aria-label="Settings">⚙︎</button></div>
<div class="stats">
  <div class="stat hero"><div class="v">${mastered}<small> / ${all.length} words</small></div><div class="k">Mastered (3+ successful reviews in a row)</div><div class="bar"><i style="width:${pct(mastered, all.length)}%;background:#e8762c"></i></div></div>
  <div class="stat"><div class="v">${learning}</div><div class="k">Learning</div></div>
  <div class="stat"><div class="v">${acc}</div><div class="k">Quiz accuracy${st.quizTotal ? ` · ${st.quizTotal} answers` : ''}</div></div>
  <div class="stat"><div class="v">🔥 ${N3.currentStreak()}</div><div class="k">Day streak</div></div>
  <div class="stat"><div class="v">${N3.dueWords().length}</div><div class="k">Reviews due</div></div>
</div>
${hist.length ? `<div class="card"><h3>Mock tests</h3>${hist.slice(-3).reverse().map(h => `<div class="kv"><span>${N3.fmtLongDate(h.date)}</span><b>${h.score} / ${h.total}</b></div>`).join('')}</div>` : ''}
<div class="section-t">BY UNIT</div>
<div class="legend"><span><i style="background:#ffb340"></i>Learned</span><span><i style="background:#e8762c"></i>Mastered</span></div>
${N3.UNITS.map(unitRow).join('')}`;
  }

  // ---------- Settings ----------
  function viewSettings() {
    const t = N3.today();
    const cur = S().settings.examDate;
    const exams = N3.EXAM_DATES.map(d => {
      const n = N3.daysBetween(t, d);
      const past = n < 0;
      return `<button class="opt${cur === d ? ' on' : ''}" data-act="exam" data-arg="${d}"${past ? ' disabled style="opacity:.45"' : ''}>
        <span class="rad"></span><span class="tx"><b>${N3.fmtLongDate(d)}</b><small>${past ? 'Already passed' : n === 0 ? 'Today' : `in ${N3.plural(n, 'day')}`}</small></span></button>`;
    }).join('');
    const meta = N3.META;
    const src = meta.source === 'sample' ? 'Sample list (development)' : meta.source === 'data' ? 'Bundled word list' : 'Missing';
    return `
<div class="hdr"><button class="icon-btn" data-act="back" aria-label="Back">‹</button><h1>Settings</h1></div>
<div class="card"><h3>JLPT exam date</h3>${exams}</div>
<div class="card"><h3>New words per day</h3>
  <div class="seg">${N3.DAILY_NEW_OPTIONS.map(n => `<button class="${S().settings.dailyNew === n ? 'on' : ''}" data-act="daily" data-arg="${n}">${n}</button>`).join('')}</div>
</div>
<div class="card"><h3>Reminders</h3><div class="kv"><span>Daily study reminder</span><b class="muted">Coming soon</b></div></div>
<div class="card"><h3>Word list</h3>
  <div class="kv"><span>Words</span><b>${N3.WORDS.length} · ${N3.plural(N3.UNITS.length, 'unit')}</b></div>
  <div class="kv"><span>Source</span><b>${src}</b></div>
  <div class="kv"><span>Free</span><b>${unitRange()}</b></div>
  <div class="kv"><span>Premium</span><b data-go="#/paywall">${S().premium ? 'Active' : 'See plans ›'}</b></div>
  <div class="kv"><span>Voice</span><b>VOICEVOX:春日部つむぎ</b></div>
</div>
<div class="card"><button class="danger" data-act="reset">Reset all progress</button></div>
<p class="fine">N3 Tango · v0.1 (MVP) · works offline</p>`;
  }

  // ---------- Paywall ----------
  function viewPaywall(params) {
    const u = params.get('unit');
    const yr = ui.plan === 'year';
    return `
<div class="pw-top"><button class="icon-btn" data-act="back" aria-label="Close">✕</button></div>
<div class="pw-hero"><div class="ic">🔓</div><h1>Unlock every N3 unit</h1>
  <p>${u ? `Unit ${esc(u)} is part of N3 Tango Premium. ` : ''}${unitRange()} are free to study.</p></div>
<div class="feats">
  <div>Every N3 vocabulary unit, with example sentences</div>
  <div>Quizzes and mock tests across all units</div>
  <div>Spaced-repetition reviews for the whole list</div>
  <div>Works fully offline</div>
</div>
<div class="plans">
  <button class="plan${yr ? ' on' : ''}" data-act="plan" data-arg="year"><span class="save">SAVE 61%</span><span class="rad"></span><span class="tx"><b>Yearly</b><small>$5.00 / month, billed yearly</small></span><span class="pr">$59.99<small>per year</small></span></button>
  <button class="plan${yr ? '' : ' on'}" data-act="plan" data-arg="month"><span class="rad"></span><span class="tx"><b>Monthly</b><small>Billed monthly</small></span><span class="pr">$12.99<small>per month</small></span></button>
</div>
<div class="pad"><button class="btn orange" data-act="buy">Coming soon</button></div>
<p class="fine">Purchases are not available in this preview build yet. Nothing will be charged.</p>`;
  }

  // ---------- Router ----------
  const ROUTES = {
    home: { view: viewHome, tab: 'home' },
    learn: { view: viewLearn, tab: 'learn' },
    session: { view: viewSession, tab: 'learn', nonav: () => !ui.session || !ui.session.finished },
    quiz: { view: viewQuiz, tab: 'quiz', nonav: () => !!ui.quiz && !ui.quiz.finished },
    mock: { view: viewMock, tab: 'home', nonav: () => !!ui.mock && !ui.mock.finished },
    progress: { view: viewProgress, tab: 'progress' },
    settings: { view: viewSettings, tab: 'progress' },
    paywall: { view: viewPaywall, tab: null, nonav: true },
  };
  let lastRoute = null;

  function parse() {
    const h = location.hash.replace(/^#\/?/, '');
    const [name, q] = h.split('?');
    return { name: ROUTES[name] ? name : 'home', params: new URLSearchParams(q || '') };
  }

  function render() {
    const { name, params } = parse();
    const r = ROUTES[name];
    $view.innerHTML = r.view(params);
    const nonav = typeof r.nonav === 'function' ? r.nonav() : !!r.nonav;
    $app.classList.toggle('nonav', nonav);
    for (const el of $nav.children) el.classList.toggle('on', el.dataset.tab === r.tab);
    const key = name + '|' + (params.toString());
    if (key !== lastRoute) { window.scrollTo(0, 0); lastRoute = key; }
  }

  // ---------- Actions ----------
  const ACTIONS = {
    learnToday() { if (!startSession('today')) go('#/learn'); },
    startToday() { startSession('today'); },
    extra() { startSession('extra'); },
    unit(arg) {
      const u = Number(arg);
      if (!N3.isUnitOpen(u)) return go(`#/paywall?unit=${u}`);
      if (!startSession('unit', u)) toast(`Nothing due in Unit ${u} right now — nice!`);
    },
    reveal() { if (ui.session && !ui.session.revealed) { ui.session.revealed = true; render(); } },
    grade(arg) { if (ui.session && ui.session.revealed) gradeCard(arg === '1'); },
    exitSession() { stopAudio(); ui.session = null; go('#/learn'); },
    play(arg, el) { const i = (arg || '').indexOf(':'); if (i > 0) playAudio(arg.slice(0, i), arg.slice(i + 1), el); },

    mode(arg) { ui.quizMode = arg; render(); },
    startQuiz() {
      const z = N3.makeQuiz(ui.quizMode);
      if (!z.questions.length) return toast('No words available for this quiz yet.');
      ui.quiz = Object.assign(z, { idx: 0, finished: false });
      render();
    },
    pick(arg, el) {
      const i = Number(arg);
      const { name } = parse();
      if (name === 'quiz' && ui.quiz && !ui.quiz.finished) {
        const q = ui.quiz.questions[ui.quiz.idx];
        if (q.picked !== null) return;
        q.picked = i;
        recordAnswer(q);
        render();
      } else if (name === 'mock' && ui.mock && !ui.mock.finished) {
        ui.mock.questions[ui.mock.idx].picked = i;
        render();
      }
    },
    next() {
      const z = ui.quiz;
      if (z.idx + 1 < z.questions.length) z.idx++; else z.finished = true;
      render();
    },
    exitQuiz() { ui.quiz = null; render(); },
    quizAgain() { ui.quiz = null; ACTIONS.startQuiz(); },

    startMock() {
      ui.mock = Object.assign(N3.makeMock(), { idx: 0, finished: false });
      go('#/mock');
    },
    mockNext() {
      const m = ui.mock;
      if (m.questions[m.idx].picked === null) return;
      if (m.idx + 1 < m.questions.length) m.idx++; else finishMock();
      render();
    },
    exitMock() {
      if (confirm('Leave the mock test? Your answers will not be saved.')) { ui.mock = null; render(); }
    },
    leaveResults(arg) {
      if (arg === '#/quiz') ui.quiz = null;
      if (arg === '#/mock') ui.mock = null;
      go(arg === '#/mock' ? '#/home' : arg);
    },

    exam(arg) { S().settings.examDate = arg; N3.save(); render(); toast('Exam date updated'); },
    daily(arg) { S().settings.dailyNew = Number(arg); N3.save(); render(); },
    reset() {
      if (confirm('Reset all progress? This deletes your SRS history, streak and scores on this device.')) {
        N3.resetAll(); ui.session = ui.quiz = ui.mock = null; render(); toast('Progress reset');
      }
    },
    back() { if (lastNav) history.back(); else go('#/home'); },

    plan(arg) { ui.plan = arg; render(); },
    buy() { toast("Purchases aren't available yet — coming soon."); },
  };
  let lastNav = false; // true once we have navigated inside the app (so history.back stays in-app)
  window.addEventListener('hashchange', () => { lastNav = true; render(); });

  document.addEventListener('click', e => {
    const tab = e.target.closest('.nav [data-tab]');
    if (tab) {
      const t = tab.dataset.tab;
      if (t === 'quiz' && ui.quiz && ui.quiz.finished) ui.quiz = null;
      return go('#/' + t);
    }
    const a = e.target.closest('[data-act]');
    if (a && !a.disabled && ACTIONS[a.dataset.act]) { ACTIONS[a.dataset.act](a.dataset.arg, a); return; }
    const g = e.target.closest('[data-go]');
    if (g) go(g.dataset.go);
  });

  // Keyboard (desktop): Space/Enter reveal, ←/1 don't know, →/2 know, 1–4 pick answers.
  document.addEventListener('keydown', e => {
    const { name } = parse();
    if (name === 'session' && ui.session && !ui.session.finished) {
      if (!ui.session.revealed && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); ACTIONS.reveal(); }
      else if (ui.session.revealed && (e.key === 'ArrowLeft' || e.key === '1')) gradeCard(false);
      else if (ui.session.revealed && (e.key === 'ArrowRight' || e.key === '2')) gradeCard(true);
    } else if ((name === 'quiz' || name === 'mock') && /^[1-4]$/.test(e.key)) {
      ACTIONS.pick(String(Number(e.key) - 1));
    }
  });

  // Re-render when the app returns to the foreground (date may have rolled over).
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

  if (!N3.WORDS.length) {
    $view.innerHTML = '<div class="empty"><div class="big">📭</div><b>No word data found</b><p>data/words.js is missing or empty. Run <code>node tools/build-data.js</code>.</p></div>';
  } else {
    render();
  }
})();
