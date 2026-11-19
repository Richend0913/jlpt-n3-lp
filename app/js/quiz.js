// Question generation shared by Quiz, Practice and the Mock test.
//   Vocabulary (4 choices): meaning (word -> English), reading (word -> hiragana), fill (blank in example -> word)
//   Grammar: gfill (blank in a grammar example -> grammar form, 4 choices)
//            gorder (put 4 phrases in order; Quiz) / gstar (JLPT 「★」: which phrase goes in the starred slot; Mock)
//   Listening: listen (conversation audio -> question, 3–4 choices)   Reading: read (passage -> question, 4 choices)
// Every question has {kind, sec, id, choices, answer, picked}; sec is the JLPT scoring section it counts toward.
(function () {
  'use strict';
  const N3 = window.N3;

  // ---------- vocabulary ----------
  const VALUE = { meaning: w => w.meaning, reading: w => w.reading, fill: w => w.word };
  N3.canFill = w => !!N3.locateInExample(w);

  function distractors(target, type, n = 3) {
    const val = VALUE[type];
    const seen = new Set([val(target)]);
    const cands = N3.shuffle(N3.WORDS.filter(w => w.id !== target.id));
    // Same part of speech first (fill-in must stay grammatical; plausible for the others too),
    // and for readings prefer similar length so the answer does not stand out.
    const score = w => (w.pos === target.pos ? 0 : 2) +
      (type === 'reading' ? Math.min(2, Math.abs(w.reading.length - target.reading.length)) * 0.5 : 0);
    cands.sort((a, b) => score(a) - score(b));
    const out = [];
    for (const w of cands) {
      const v = val(w);
      if (seen.has(v)) continue;
      seen.add(v);
      out.push(v);
      if (out.length === n) break;
    }
    return out;
  }

  N3.makeQuestion = (w, type) => {
    if (type === 'fill' && !N3.canFill(w)) type = 'meaning';
    const correct = VALUE[type](w);
    const choices = N3.shuffle([correct, ...distractors(w, type)]);
    return { kind: type, sec: 'lk', id: w.id, word: w, choices, answer: choices.indexOf(correct), picked: null };
  };

  // ---------- grammar ----------
  const STOP = new Set('the and that this with for not but from than into are was were has have had its his her their you your who what when where which very more most much some any one ones also just such being been something someone doing thing things way'.split(' '));
  const meaningWords = g => new Set((g.meaning.toLowerCase().replace(/\([^)]*\)/g, ' ').match(/[a-z]+/g) || []).filter(x => x.length >= 3 && !STOP.has(x)));
  const surface = ex => ex.ja.substr(ex.blank[0], ex.blank[1]);

  // All blanked grammar forms (distractor pool), built once.
  let FORMS = null;
  function forms() {
    if (FORMS) return FORMS;
    FORMS = [];
    for (const g of N3.GRAMMAR) for (const ex of g.examples) if (ex.blank) FORMS.push({ g, s: surface(ex) });
    return FORMS;
  }

  N3.makeGrammarFill = (g, ex) => {
    const answer = surface(ex);
    const mine = meaningWords(g);
    const rest = ex.ja.slice(0, ex.blank[0]) + ex.ja.slice(ex.blank[0] + ex.blank[1]);
    const seen = new Set([answer]);
    const pool = N3.shuffle(forms()).filter(f => {
      if (f.g.id === g.id || seen.has(f.s)) return false;
      if (answer.includes(f.s) || f.s.includes(answer)) return false;
      if (rest.includes(f.s)) return false;
      for (const w of meaningWords(f.g)) if (mine.has(w)) return false;   // near-synonyms would also be right
      return true;
    });
    // similar length first, so the answer does not stand out
    pool.sort((a, b) => Math.abs(a.s.length - answer.length) - Math.abs(b.s.length - answer.length));
    const ds = [];
    for (const f of pool) { if (seen.has(f.s)) continue; seen.add(f.s); ds.push(f.s); if (ds.length === 3) break; }
    const choices = N3.shuffle([answer, ...ds]);
    return { kind: 'gfill', sec: 'lk', id: g.id, g, ex, choices, answer: choices.indexOf(answer), picked: null };
  };

  N3.STAR = 2;   // the starred slot (3rd of 4), as in JLPT 文の組み立て
  N3.makeGrammarOrder = (g, ex, star) => {
    const tiles = ex.order.tiles.slice();
    if (star) {
      const choices = N3.shuffle(tiles);
      return { kind: 'gstar', sec: 'lk', id: g.id, g, ex, tiles, choices, answer: choices.indexOf(tiles[N3.STAR]), picked: null };
    }
    let order = N3.shuffle(tiles);
    for (let k = 0; k < 5 && order.join('') === tiles.join(''); k++) order = N3.shuffle(tiles);
    return { kind: 'gorder', sec: 'lk', id: g.id, g, ex, tiles, order, built: [], choices: [], answer: 0, picked: null, done: false };
  };

  const fillExamples = pool => pool.flatMap(g => g.examples.filter(ex => ex.blank).map(ex => [g, ex]));
  const orderExamples = pool => pool.flatMap(g => g.examples.filter(ex => ex.order).map(ex => [g, ex]));
  // Grammar the learner has met (open units); before any study, the open units' patterns.
  function grammarPool() {
    const open = N3.openGrammar();
    const seen = open.filter(g => N3.isSeen(g.id));
    return seen.length >= 4 ? seen : open;
  }
  function wordPool(mode) {
    const open = N3.openWords();
    const seen = open.filter(w => N3.isSeen(w.id));
    let pool = seen.length >= 4 ? seen : open;
    if (mode === 'fill') pool = pool.filter(N3.canFill);
    return pool;
  }
  function pickExamples(list, n) {
    // one example per pattern where possible
    const used = new Set(), out = [];
    for (const [g, ex] of N3.shuffle(list)) { if (used.has(g.id)) continue; used.add(g.id); out.push([g, ex]); if (out.length === n) return out; }
    for (const pair of N3.shuffle(list)) { if (out.includes(pair)) continue; out.push(pair); if (out.length === n) break; }
    return out;
  }

  // ---------- quiz rounds (10 questions) ----------
  //   mixed: 4 vocabulary + 3 grammar fill-in + 3 grammar order (any shortfall is topped up with vocabulary)
  //   vocab: meaning / reading / fill in turn;  meaning | reading | fill | gfill | gorder: that type only
  N3.QUIZ_MODES = ['mixed', 'vocab', 'meaning', 'reading', 'fill', 'gfill', 'gorder'];
  N3.makeQuiz = (mode, count = 10) => {
    const types = ['meaning', 'reading', 'fill'];
    const vocab = (n, m) => N3.shuffle(wordPool(m === 'fill' ? 'fill' : null)).slice(0, n)
      .map((w, i) => N3.makeQuestion(w, types.includes(m) ? m : types[i % 3]));
    let qs = [];
    if (mode === 'gfill') qs = pickExamples(fillExamples(grammarPool()), count).map(([g, ex]) => N3.makeGrammarFill(g, ex));
    else if (mode === 'gorder') {
      let list = orderExamples(grammarPool());
      if (list.length < 3) list = orderExamples(N3.openGrammar());
      qs = pickExamples(list, count).map(([g, ex]) => N3.makeGrammarOrder(g, ex, false));
    } else if (mode === 'mixed') {
      const gf = pickExamples(fillExamples(grammarPool()), 3).map(([g, ex]) => N3.makeGrammarFill(g, ex));
      let ol = orderExamples(grammarPool());
      if (ol.length < 3) ol = orderExamples(N3.openGrammar());
      const go = pickExamples(ol, 3).map(([g, ex]) => N3.makeGrammarOrder(g, ex, false));
      const v = vocab(count - gf.length - go.length, 'vocab');
      // interleave: vocabulary, grammar fill, grammar order
      const lists = [v, gf, go];
      while (lists.some(l => l.length)) for (const l of lists) if (l.length) qs.push(l.shift());
    } else qs = vocab(count, mode);
    const seenWords = N3.openWords().filter(w => N3.isSeen(w.id)).length;
    return { mode, fromSeen: seenWords >= 4, questions: qs };
  };

  // ---------- listening / reading questions ----------
  N3.makeListen = item => ({ kind: 'listen', sec: 'ls', id: item.id, item, choices: item.choices, answer: item.answer, picked: null, plays: 0 });
  N3.makeRead = (p, qi) => ({ kind: 'read', sec: 'rd', id: p.id, qi, item: p, q: p.questions[qi], choices: p.questions[qi].choices, answer: p.questions[qi].answer, picked: null });

  // ---------- Mock test: 3 parts in JLPT N3 test order ----------
  // Part 1 Vocabulary (言語知識・文字語彙) · Part 2 Grammar & Reading (言語知識・文法／読解) · Part 3 Listening (聴解).
  // Scored like the real test in 3 sections: Language knowledge (parts 1 + 2 grammar), Reading, Listening.
  N3.MOCK_PARTS = [
    { n: 1, title: 'Vocabulary', jp: '言語知識（文字・語彙）', min: 8 },
    { n: 2, title: 'Grammar & Reading', jp: '言語知識（文法）・読解', min: 18 },
    { n: 3, title: 'Listening', jp: '聴解', min: 10 },
  ];
  N3.MOCK_PLAN = { reading: 4, fill: 4, meaning: 4, gfill: 5, gstar: 3, passages: 2, listen: 6 };
  N3.MOCK_INS = {
    reading: ['問題1　＿＿のことばの読み方として最もよいものを、1・2・3・4から一つえらびなさい。', 'Choose the best reading for the underlined word.'],
    fill: ['問題2　（　　）に入れるのに最もよいものを、1・2・3・4から一つえらびなさい。', 'Choose the best word for the blank.'],
    meaning: ['問題3　＿＿のことばの意味として最もよいものをえらびなさい。', 'Choose the meaning of the underlined word.'],
    gfill: ['問題1　つぎの文の（　　）に入れるのに最もよいものを、1・2・3・4から一つえらびなさい。', 'Choose the best grammar form for the blank.'],
    gstar: ['問題2　つぎの文の　★　に入る最もよいものを、1・2・3・4から一つえらびなさい。', 'Put the four phrases in order. Which one goes in the ★ slot?'],
    read: ['問題4　つぎの文章を読んで、質問に答えなさい。', 'Read the passage and answer the question.'],
    listen: ['問題1　話を聞いて、質問に答えなさい。', 'Listen to the conversation, then answer. The audio plays once.'],
    listenResponse: ['問題4　話を聞いて、最もよい返事をえらびなさい。', 'Listen to the conversation and choose the best reply. The audio plays once.'],
  };

  N3.makeMock = () => {
    const P = N3.MOCK_PLAN;
    const qs = [];
    // Part 1 — vocabulary (fill-in first so it gets the words that support it)
    const words = N3.shuffle(N3.openWords());
    const used = new Set();
    const take = (n, ok) => words.filter(w => !used.has(w.id) && ok(w)).slice(0, n).map(w => { used.add(w.id); return w; });
    const fillW = take(P.fill, N3.canFill), readW = take(P.reading, () => true), meanW = take(P.meaning, () => true);
    for (const [ws, t] of [[readW, 'reading'], [fillW, 'fill'], [meanW, 'meaning']]) for (const w of ws) qs.push(Object.assign(N3.makeQuestion(w, t), { part: 1 }));
    // Part 2 — grammar, then reading
    const gOpen = N3.openGrammar();
    const star = pickExamples(orderExamples(gOpen), P.gstar);
    const starIds = new Set(star.map(([g]) => g.id));
    const fills = pickExamples(fillExamples(gOpen.filter(g => !starIds.has(g.id))), P.gfill);
    for (const [g, ex] of fills) qs.push(Object.assign(N3.makeGrammarFill(g, ex), { part: 2 }));
    for (const [g, ex] of star) qs.push(Object.assign(N3.makeGrammarOrder(g, ex, true), { part: 2 }));
    for (const p of N3.shuffle(N3.openReading()).slice(0, P.passages)) p.questions.forEach((_, qi) => qs.push(Object.assign(N3.makeRead(p, qi), { part: 2 })));
    // Part 3 — listening: comprehension first, then replies (as in the real test)
    const ls = N3.shuffle(N3.openListening());
    const comp = ls.filter(x => x.type === 'comprehension').slice(0, 4);
    const resp = ls.filter(x => x.type === 'response').slice(0, P.listen - comp.length);
    const lsq = [...comp, ...resp];
    for (const x of ls) { if (lsq.length >= P.listen) break; if (!lsq.includes(x)) lsq.push(x); }
    for (const x of lsq) qs.push(Object.assign(N3.makeListen(x), { part: 3 }));
    return { questions: qs };
  };

  // Section results of a finished mock: {lk:[right,total], rd:[...], ls:[...]}
  N3.mockSections = qs => {
    const out = { lk: [0, 0], rd: [0, 0], ls: [0, 0] };
    for (const q of qs) { out[q.sec][1]++; if (q.picked === q.answer) out[q.sec][0]++; }
    return out;
  };
  // Pass judgement on scaled scores (in-app estimate)
  N3.judge = secs => {
    const scores = {};
    for (const k of N3.SEC_KEYS) scores[k] = N3.scale60(secs[k][0], secs[k][1]);
    const total = N3.SEC_KEYS.reduce((a, k) => a + scores[k], 0);
    const below = N3.SEC_KEYS.filter(k => scores[k] < N3.SEC_CUTOFF);
    return { scores, total, below, pass: total >= N3.PASS_TOTAL && !below.length };
  };
})();
