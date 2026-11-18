// Shared helpers. Everything hangs off window.N3 (plain scripts, no modules, so file:// works).
(function () {
  'use strict';
  const N3 = (window.N3 = window.N3 || {});
  const pad = n => String(n).padStart(2, '0');

  // Local calendar dates as 'YYYY-MM-DD' keys (study days roll over at local midnight).
  N3.dateKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  N3.today = () => N3.dateKey(new Date());
  N3.parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  N3.addDays = (k, n) => { const d = N3.parseKey(k); d.setDate(d.getDate() + n); return N3.dateKey(d); };
  N3.daysBetween = (a, b) => Math.round((N3.parseKey(b) - N3.parseKey(a)) / 864e5);

  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  N3.fmtExamDate = k => { const d = N3.parseKey(k); return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`; };
  N3.fmtLongDate = k => N3.parseKey(k).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

  N3.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  N3.shuffle = arr => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };

  // Small deterministic hash (word of the day).
  N3.hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

  N3.plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
})();
