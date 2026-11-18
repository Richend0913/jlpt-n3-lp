// Persistent state in localStorage (progress, SRS, streak, settings). One JSON blob, versioned.
(function () {
  'use strict';
  const N3 = window.N3;
  const KEY = 'n3tango.state.v1';

  N3.EXAM_DATES = ['2026-12-06', '2027-07-04']; // JLPT first Sundays (SPEC.md)
  N3.DAILY_NEW_OPTIONS = [5, 10, 15, 20];
  N3.FREE_UNITS = 2; // SPEC.md: first 2 units free, paywall after

  function defaults() {
    return {
      v: 1,
      settings: { examDate: '2027-07-04', dailyNew: 10 },
      srs: {},            // wordId -> {reps, interval, ease, due, lapses, last, seen}
      days: {},           // 'YYYY-MM-DD' -> {newCount, reviewCount, answers}
      streak: { count: 0, last: null },
      stats: { quizRight: 0, quizTotal: 0, mock: [] }, // mock: [{date, score, total}]
      premium: false,     // no real purchase is wired up in v1
    };
  }

  let memoryOnly = false;
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaults();
      const s = JSON.parse(raw);
      const d = defaults();
      return Object.assign(d, s, {
        settings: Object.assign(d.settings, s.settings),
        streak: Object.assign(d.streak, s.streak),
        stats: Object.assign(d.stats, s.stats),
      });
    } catch (e) {
      memoryOnly = true;
      return defaults();
    }
  }

  N3.state = load();

  N3.save = () => {
    if (memoryOnly) return;
    try {
      // Keep the per-day log small.
      const keys = Object.keys(N3.state.days).sort();
      for (const k of keys.slice(0, Math.max(0, keys.length - 90))) delete N3.state.days[k];
      localStorage.setItem(KEY, JSON.stringify(N3.state));
    } catch (e) { /* storage full / disabled: keep running in memory */ }
  };

  N3.resetAll = () => {
    N3.state = defaults();
    N3.save();
  };

  N3.day = (k = N3.today()) => (N3.state.days[k] = N3.state.days[k] || { newCount: 0, reviewCount: 0, answers: 0 });

  // Streak: a day counts once the learner grades a card or answers a question.
  N3.touchStreak = () => {
    const t = N3.today();
    const st = N3.state.streak;
    if (st.last === t) return;
    st.count = st.last === N3.addDays(t, -1) ? st.count + 1 : 1;
    st.last = t;
  };
  N3.currentStreak = () => {
    const st = N3.state.streak;
    const t = N3.today();
    return st.last === t || st.last === N3.addDays(t, -1) ? st.count : 0;
  };

  // Exam date: a date in the past is never shown as a countdown; fall forward to the next one.
  N3.examDate = () => {
    const t = N3.today();
    const sel = N3.state.settings.examDate;
    if (sel >= t) return sel;
    return N3.EXAM_DATES.find(d => d >= t) || sel;
  };
})();
