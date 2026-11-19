// Spaced repetition: simplified SM-2. Shared by vocabulary words (n3-xxxx) and grammar patterns (g-xxxx).
//   Know  -> quality 4,  Don't know -> quality 1.
//   correct: interval 1 day, then 3 days, then interval * ease (rounded)
//   wrong:   reps reset, due again today (it re-enters the review queue)
//   ease:    SM-2 update, floor 1.3, start 2.5
// "Mastered" = 3+ consecutive successful reviews (interval >= ~7 days).
(function () {
  'use strict';
  const N3 = window.N3;
  const Q_KNOW = 4, Q_FORGOT = 1;
  N3.MASTER_REPS = 3;

  const card = id => N3.state.srs[id];

  N3.srsGrade = (id, know) => {
    const t = N3.today();
    const d = N3.day();
    let c = card(id);
    if (!c) {
      c = N3.state.srs[id] = { reps: 0, interval: 0, ease: 2.5, due: t, lapses: 0, last: null, seen: t };
      if (N3.isGrammarId(id)) d.gNew++; else d.newCount++;
    } else if (N3.isGrammarId(id)) d.gReview++;
    else d.reviewCount++;
    const q = know ? Q_KNOW : Q_FORGOT;
    if (know) {
      c.interval = c.reps === 0 ? 1 : c.reps === 1 ? 3 : Math.max(c.interval + 1, Math.round(c.interval * c.ease));
      c.reps++;
    } else {
      c.reps = 0;
      c.interval = 0;
      c.lapses++;
    }
    c.ease = Math.max(1.3, c.ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
    c.due = N3.addDays(t, c.interval);
    c.last = t;
    N3.touchStreak();
    N3.save();
    return c;
  };

  // Second look inside the same session after "Don't know": do not touch ease again,
  // just schedule tomorrow if they now know it (otherwise it stays due today).
  N3.srsRelearn = (id, know) => {
    const c = card(id);
    if (!c) return;
    if (know) { c.interval = 1; c.due = N3.addDays(N3.today(), 1); }
    N3.save();
  };

  // Quiz / mock mistake: send the word or grammar pattern back to review (due today), reset its streak of reps.
  N3.srsMarkWrong = id => {
    const t = N3.today();
    let c = card(id);
    if (!c) c = N3.state.srs[id] = { reps: 0, interval: 0, ease: 2.5, due: t, lapses: 0, last: null, seen: t };
    c.reps = 0;
    c.interval = 0;
    c.lapses++;
    c.ease = Math.max(1.3, c.ease - 0.2);
    c.due = t;
    N3.save();
  };

  N3.isMastered = id => { const c = card(id); return !!c && c.reps >= N3.MASTER_REPS; };
  N3.isSeen = id => !!card(id);

  N3.isGrammarId = id => /^g-/.test(id);

  // Due / new items of a pool (words or grammar patterns; both share the SRS map, ids never collide).
  N3.dueItems = pool => {
    const t = N3.today();
    return pool.filter(w => { const c = card(w.id); return c && c.due <= t; })
      .sort((a, b) => card(a.id).due.localeCompare(card(b.id).due) || a._i - b._i);
  };
  N3.newItems = pool => pool.filter(w => !card(w.id));
  N3.dueWords = (pool = N3.openWords()) => N3.dueItems(pool);
  N3.newWords = (pool = N3.openWords()) => N3.newItems(pool);
  N3.newLeftToday = () => Math.max(0, N3.state.settings.dailyNew - N3.peekDay().newCount);
  N3.dueGrammar = (pool = N3.openGrammar()) => N3.dueItems(pool);
  N3.newGrammar = (pool = N3.openGrammar()) => N3.newItems(pool);
  N3.newGrammarLeftToday = () => Math.max(0, N3.state.settings.dailyGrammar - N3.peekDay().gNew);
})();
