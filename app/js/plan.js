// Today's study plan (Home): vocabulary + grammar every day, plus one practice block that alternates between
// listening and reading. When one of the two is clearly weaker (estimate under the 19/60 cutoff while the other
// is not, or fewer answers so far), that one is chosen instead. The choice is made once per app session and day
// (held in memory, never written during rendering), and a finished step is recorded in days[today].steps.
(function () {
  'use strict';
  const N3 = window.N3;

  // Minutes per item (rough, used for the "about N minutes" line).
  N3.MIN_PER = { newWord: 0.5, reviewWord: 0.25, newGrammar: 1.5, reviewGrammar: 0.5, listen: 1.5, read: 6 };
  N3.PLAN_LISTEN = 3;   // listening questions per plan
  N3.PLAN_READ = 1;     // reading passages per plan

  let pickMemo = null;  // {date, kind}
  function practiceKind() {
    const t = N3.today();
    const steps = N3.peekDay().steps;
    if (steps.includes('listen')) return 'listen';
    if (steps.includes('read')) return 'read';
    if (pickMemo && pickMemo.date === t) return pickMemo.kind;
    const L = N3.sectionEstimate('ls'), R = N3.sectionEstimate('rd');
    let kind;
    const lowL = L.enough && L.score < N3.SEC_CUTOFF, lowR = R.enough && R.score < N3.SEC_CUTOFF;
    if (lowL !== lowR) kind = lowL ? 'listen' : 'read';
    else if (L.enough && R.enough && Math.abs(L.score - R.score) >= 10) kind = L.score < R.score ? 'listen' : 'read';
    else kind = N3.daysBetween('2026-01-01', t) % 2 === 0 ? 'listen' : 'read';
    // fall back when one side has no open content left to do
    if (kind === 'listen' && !N3.openListening().length) kind = 'read';
    if (kind === 'read' && !N3.openReading().length) kind = 'listen';
    pickMemo = { date: t, kind };
    return kind;
  }

  N3.todayPlan = () => {
    const d = N3.peekDay();
    const done = new Set(d.steps);
    const steps = [];
    // vocabulary
    const vDue = N3.dueWords().length;
    const vNew = Math.min(N3.newLeftToday(), N3.newWords().length);
    if (vDue + vNew > 0 || done.has('vocab')) {
      const parts = [];
      if (vNew) parts.push(N3.plural(vNew, 'new word'));
      if (vDue) parts.push(N3.plural(vDue, 'review'));
      const fin = done.has('vocab');
      steps.push({ key: 'vocab', title: 'Vocabulary', jp: '語彙',
        detail: fin ? `${N3.plural(d.newCount, 'new word')} · ${N3.plural(d.reviewCount, 'review')} done` : parts.join(' · '),
        min: Math.ceil(vNew * N3.MIN_PER.newWord + vDue * N3.MIN_PER.reviewWord), n: vNew + vDue, done: fin });
    }
    // grammar
    const gDue = N3.dueGrammar().length;
    const gNew = Math.min(N3.newGrammarLeftToday(), N3.newGrammar().length);
    if (gDue + gNew > 0 || done.has('grammar')) {
      const parts = [];
      if (gNew) parts.push(N3.plural(gNew, 'new pattern'));
      if (gDue) parts.push(N3.plural(gDue, 'review'));
      const fin = done.has('grammar');
      steps.push({ key: 'grammar', title: 'Grammar', jp: '文法',
        detail: fin ? `${N3.plural(d.gNew, 'new pattern')} · ${N3.plural(d.gReview, 'review')} done` : parts.join(' · '),
        min: Math.ceil(gNew * N3.MIN_PER.newGrammar + gDue * N3.MIN_PER.reviewGrammar), n: gNew + gDue, done: fin });
    }
    // listening or reading
    const kind = practiceKind();
    if (kind === 'listen' && N3.openListening().length) {
      const n = Math.min(N3.PLAN_LISTEN, N3.openListening().length);
      steps.push({ key: 'listen', title: 'Listening', jp: '聴解', detail: done.has('listen') ? `${N3.plural(n, 'conversation')} done` : `${N3.plural(n, 'conversation')} with questions`,
        min: Math.ceil(n * N3.MIN_PER.listen), n, done: done.has('listen') });
    } else if (kind === 'read' && N3.openReading().length) {
      const p = N3.nextReading();
      steps.push({ key: 'read', title: 'Reading', jp: '読解', detail: p ? `1 passage, ${p.chars} characters · ${N3.plural(p.questions.length, 'question')}` : '1 passage',
        min: Math.ceil(N3.MIN_PER.read), n: 1, done: done.has('read') });
    }
    const left = steps.filter(s => !s.done);
    return { steps, left, totalMin: left.reduce((a, s) => a + s.min, 0), allDone: steps.length > 0 && !left.length };
  };

  // Mark a plan step finished (called from the step's own flow, which already saves state).
  N3.markStep = key => {
    const d = N3.day();
    if (!d.steps.includes(key)) d.steps.push(key);
  };
})();
