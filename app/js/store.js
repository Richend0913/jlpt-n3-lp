// Persistent state in localStorage (progress, SRS, streak, settings, practice stats). One JSON blob, versioned.
(function () {
  'use strict';
  const N3 = window.N3;
  const KEY = 'n3tango.state.v1';

  N3.EXAM_DATES = ['2026-12-06', '2027-07-04']; // JLPT first Sundays (SPEC.md)
  N3.DAILY_NEW_OPTIONS = [5, 10, 15, 20];
  N3.FREE_UNITS = 2; // SPEC.md: first 2 units free, paywall after

  // Exam launch promo (owner decision 2026-11-23): everything is open to everyone until the end of the
  // Dec 6 exam day in Japan. The paywall returns by itself after this instant; every gate goes through
  // N3.hasAccess(), so this constant is the only switch.
  N3.FREE_UNTIL = '2026-12-06T23:59:59+09:00';
  N3.isFreePeriod = (now = Date.now()) => now < Date.parse(N3.FREE_UNTIL) + 1000;
  N3.hasAccess = () => !!(N3.state && N3.state.premium) || N3.isFreePeriod();

  N3.DAILY_GRAMMAR_OPTIONS = [2, 3, 5];
  N3.SEC_KEYS = ['lk', 'rd', 'ls'];       // JLPT N3 scoring sections: language knowledge, reading, listening
  N3.SEC_RECENT = 50;                      // answers kept per section for the score estimate

  function defaults() {
    return {
      v: 1,
      settings: { examDate: '2027-07-04', dailyNew: 10, dailyGrammar: 3 },
      srs: {},            // itemId (n3-xxxx word / g-xxxx grammar) -> {reps, interval, ease, due, lapses, last, seen}
      days: {},           // 'YYYY-MM-DD' -> {newCount, reviewCount, gNew, gReview, answers, steps[]}
      streak: { count: 0, last: null },
      stats: {
        quizRight: 0, quizTotal: 0,
        mock: [],         // v1: {date, score, total} (vocabulary-only test); v2: {v:2, date, lk:[r,t], rd:[r,t], ls:[r,t]}
        listen: {},       // listening id -> {ok: 0|1 (last answer), n: attempts, r: correct}
        read: {},         // reading id -> {r: correct (last attempt), t: questions, n: attempts}
        sec: { lk: '', rd: '', ls: '' },  // recent answers per scoring section, '1' right / '0' wrong, newest last
      },
      premium: false,     // mirror of the account's server-side entitlement (sync.js applies it after each pull)
      updatedAt: 0,       // ms timestamp of the last local change (cloud sync: newer copy wins)
    };
  }

  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

  // Merge a stored / imported / downloaded blob onto defaults and drop anything malformed, so a bad
  // backup file or cloud copy can never break rendering (e.g. srs entries without a 'due' date).
  function normalize(s) {
    const d = defaults();
    if (!isObj(s)) return d;
    const out = Object.assign(d, s, {
      settings: Object.assign(d.settings, isObj(s.settings) ? s.settings : {}),
      streak: Object.assign(d.streak, isObj(s.streak) ? s.streak : {}),
      stats: Object.assign(d.stats, isObj(s.stats) ? s.stats : {}),
      srs: {},
      days: {},
    });
    if (isObj(s.srs)) {
      for (const [id, c] of Object.entries(s.srs)) {
        if (!isObj(c) || typeof c.due !== 'string' || !DATE_RE.test(c.due)) continue;
        out.srs[id] = {
          reps: num(c.reps, 0), interval: num(c.interval, 0), ease: num(c.ease, 2.5), due: c.due,
          lapses: num(c.lapses, 0), last: typeof c.last === 'string' ? c.last : null,
          seen: typeof c.seen === 'string' ? c.seen : c.due,
        };
      }
    }
    if (isObj(s.days)) {
      for (const [k, v] of Object.entries(s.days)) {
        if (DATE_RE.test(k) && isObj(v)) {
          out.days[k] = {
            newCount: num(v.newCount, 0), reviewCount: num(v.reviewCount, 0), gNew: num(v.gNew, 0), gReview: num(v.gReview, 0),
            answers: num(v.answers, 0),
            steps: Array.isArray(v.steps) ? v.steps.filter(x => typeof x === 'string' && x.length < 20).slice(0, 10) : [],
          };
        }
      }
    }
    // stats: drop anything malformed (cloud copies and backup files come through here too)
    const st = isObj(s.stats) ? s.stats : {};
    out.stats.mock = (Array.isArray(st.mock) ? st.mock : []).filter(m => isObj(m) && typeof m.date === 'string' && DATE_RE.test(m.date)).map(m => {
      if (m.v === 2) {
        const pair = p => (Array.isArray(p) && p.length === 2 ? [num(p[0], 0), num(p[1], 0)] : [0, 0]);
        return { v: 2, date: m.date, lk: pair(m.lk), rd: pair(m.rd), ls: pair(m.ls) };
      }
      return { date: m.date, score: num(m.score, 0), total: num(m.total, 0) };
    }).slice(-30);
    out.stats.listen = {};
    if (isObj(st.listen)) for (const [id, v] of Object.entries(st.listen)) if (isObj(v)) out.stats.listen[id] = { ok: v.ok ? 1 : 0, n: num(v.n, 1), r: num(v.r, v.ok ? 1 : 0) };
    out.stats.read = {};
    if (isObj(st.read)) for (const [id, v] of Object.entries(st.read)) if (isObj(v)) out.stats.read[id] = { r: num(v.r, 0), t: num(v.t, 0), n: num(v.n, 1) };
    out.stats.sec = { lk: '', rd: '', ls: '' };
    if (isObj(st.sec)) for (const k of N3.SEC_KEYS) if (typeof st.sec[k] === 'string') out.stats.sec[k] = st.sec[k].replace(/[^01]/g, '').slice(-N3.SEC_RECENT);
    out.stats.quizRight = num(out.stats.quizRight, 0);
    out.stats.quizTotal = num(out.stats.quizTotal, 0);
    if (!N3.DAILY_NEW_OPTIONS.includes(out.settings.dailyNew)) out.settings.dailyNew = d.settings.dailyNew;
    if (!N3.DAILY_GRAMMAR_OPTIONS.includes(out.settings.dailyGrammar)) out.settings.dailyGrammar = d.settings.dailyGrammar;
    if (typeof out.settings.examDate !== 'string' || !DATE_RE.test(out.settings.examDate)) out.settings.examDate = d.settings.examDate;
    out.streak.count = num(out.streak.count, 0);
    out.updatedAt = num(out.updatedAt, 0);
    out.v = 1;
    return out;
  }
  N3.normalizeState = normalize;
  // Does this look like an N3 Tango progress blob at all? (used by Import)
  N3.looksLikeState = s => isObj(s) && isObj(s.srs) && (isObj(s.settings) || isObj(s.stats));

  let memoryOnly = false;
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaults();
      return normalize(JSON.parse(raw));
    } catch (e) {
      memoryOnly = true;
      return defaults();
    }
  }

  N3.state = load();

  function write() {
    if (memoryOnly) return;
    try {
      // Keep the per-day log small.
      const keys = Object.keys(N3.state.days).sort();
      for (const k of keys.slice(0, Math.max(0, keys.length - 90))) delete N3.state.days[k];
      localStorage.setItem(KEY, JSON.stringify(N3.state));
    } catch (e) { /* storage full / disabled: keep running in memory */ }
  }

  // Every local change goes through here: stamp it, persist it, and tell the sync layer.
  N3.save = () => {
    N3.state.updatedAt = Date.now();
    write();
    if (typeof N3.onLocalChange === 'function') { try { N3.onLocalChange(); } catch (e) {} }
  };

  // Replace the whole state (cloud copy adopted, backup imported). Keeps the given updatedAt.
  // Entitlements are not progress: never take 'premium' from a file or another device.
  N3.replaceState = (obj, updatedAt) => {
    const premium = N3.state.premium;
    N3.state = normalize(obj);
    N3.state.premium = premium;
    N3.state.updatedAt = num(updatedAt, N3.state.updatedAt);
    write();
  };

  N3.resetAll = () => {
    const premium = N3.state.premium;   // resetting progress does not cancel a subscription
    N3.state = defaults();
    N3.state.premium = premium;
    N3.save();
  };

  // Server entitlement -> local mirror. Not a progress change: no updatedAt bump, no sync push.
  N3.setPremium = active => {
    if (N3.state.premium === !!active) return false;
    N3.state.premium = !!active;
    write();
    return true;
  };

  N3.day = (k = N3.today()) => (N3.state.days[k] = N3.state.days[k] || { newCount: 0, reviewCount: 0, gNew: 0, gReview: 0, answers: 0, steps: [] });
  // Read-only view of a day (rendering must never write state: a write bumps updatedAt and would win a sync).
  N3.peekDay = (k = N3.today()) => N3.state.days[k] || { newCount: 0, reviewCount: 0, gNew: 0, gReview: 0, answers: 0, steps: [] };

  // One answer in a JLPT scoring section ('lk' | 'rd' | 'ls'): feeds the Progress estimate.
  N3.recordSection = (sec, ok) => {
    const st = N3.state.stats;
    st.sec[sec] = (st.sec[sec] + (ok ? '1' : '0')).slice(-N3.SEC_RECENT);
  };

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
