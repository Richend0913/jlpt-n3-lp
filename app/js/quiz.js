// 4-choice question generation shared by Quiz and Mock test.
//   meaning : show the word, pick the English meaning
//   reading : show the word (in its example sentence when possible), pick the reading
//   fill    : example sentence with the word blanked, pick the word (only words whose example
//             contains the dictionary form — see N3.locateInExample)
(function () {
  'use strict';
  const N3 = window.N3;

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
    return { id: w.id, word: w, type, choices, answer: choices.indexOf(correct), picked: null };
  };

  // Quiz round: 10 questions from the words the learner has met (open units);
  // before any study, from the open units' word list.
  N3.makeQuiz = (mode, count = 10) => {
    const open = N3.openWords();
    const seen = open.filter(w => N3.isSeen(w.id));
    let pool = seen.length >= 4 ? seen : open;
    if (mode === 'fill') pool = pool.filter(N3.canFill);
    const picks = N3.shuffle(pool).slice(0, count);
    const types = ['meaning', 'reading', 'fill'];
    return {
      fromSeen: seen.length >= 4,
      questions: picks.map((w, i) => N3.makeQuestion(w, mode === 'mixed' ? types[i % 3] : mode)),
    };
  };

  // Mock test: 10 questions in JLPT vocabulary-section order.
  N3.MOCK_SECTIONS = [
    { type: 'reading', n: 3, title: 'Kanji reading', jp: '問題1　＿＿の言葉の読み方として最もよいものを選びなさい。' },
    { type: 'fill', n: 4, title: 'Context', jp: '問題2　（　　）に入れるのに最もよいものを選びなさい。' },
    { type: 'meaning', n: 3, title: 'Meaning', jp: '問題3　＿＿の言葉の意味として最もよいものを選びなさい。' },
  ];
  N3.makeMock = () => {
    const open = N3.shuffle(N3.openWords());
    const used = new Set();
    const qs = [];
    // Fill-in first so it gets the words that support it.
    const order = [1, 0, 2];
    const bySec = {};
    for (const si of order) {
      const sec = N3.MOCK_SECTIONS[si];
      const pool = open.filter(w => !used.has(w.id) && (sec.type !== 'fill' || N3.canFill(w)));
      bySec[si] = pool.slice(0, sec.n).map(w => { used.add(w.id); return Object.assign(N3.makeQuestion(w, sec.type), { sec: si }); });
    }
    for (let si = 0; si < N3.MOCK_SECTIONS.length; si++) qs.push(...bySec[si]);
    return { questions: qs };
  };
})();
