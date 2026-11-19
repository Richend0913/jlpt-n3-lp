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

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  N3.monthName = k => MONTHS[N3.parseKey(k).getMonth()];
  N3.fmtExamDate = k => N3.parseKey(k).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  N3.fmtLongDate = k => N3.parseKey(k).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  N3.fmtShortDate = k => N3.parseKey(k).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  N3.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  N3.shuffle = arr => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };

  // Small deterministic hash (word of the day).
  N3.hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

  N3.plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;
  N3.num = n => Number(n).toLocaleString('en-US');

  // Ruby strings from tools/build-content.py: "{規則|きそく}に{関|かん}して" -> <ruby> markup.
  // opts.mark = [start, length] in the plain text to wrap in <span class="hl"> (marker highlight).
  N3.rubyHtml = (src, opts = {}) => {
    const esc = N3.esc;
    const parts = [];
    const re = /\{([^|{}]+)\|([^{}]+)\}|([^{]+)/g;
    let m;
    while ((m = re.exec(String(src || '')))) parts.push(m[3] !== undefined ? { t: m[3] } : { t: m[1], r: m[2] });
    const mark = opts.mark;
    let pos = 0;
    let out = '';
    const open = () => '<span class="hl">';
    for (const p of parts) {
      const a = pos, b = pos + p.t.length;
      pos = b;
      const piece = p.r !== undefined ? `<ruby>${esc(p.t)}<rt>${esc(p.r)}</rt></ruby>` : esc(p.t);
      if (!mark || b <= mark[0] || a >= mark[0] + mark[1]) { out += piece; continue; }
      if (p.r !== undefined) { out += open() + piece + '</span>'; continue; }  // a ruby group is marked whole
      const s = Math.max(0, mark[0] - a), e = Math.min(p.t.length, mark[0] + mark[1] - a);
      out += esc(p.t.slice(0, s)) + open() + esc(p.t.slice(s, e)) + '</span>' + esc(p.t.slice(e));
    }
    return out;
  };
  N3.rubyPlain = src => String(src || '').replace(/\{([^|{}]+)\|[^{}]+\}/g, '$1');

  // Line icons: 24px grid, 1.75px stroke, currentColor (one family for every non-nav icon).
  const P = {
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    back: '<path d="M15 18l-6-6 6-6"/>',
    next: '<path d="M9 18l6-6-6-6"/>',
    close: '<path d="M18 6L6 18M6 6l12 12"/>',
    play: '<path d="M8 5.5v13l10.5-6.5z"/>',
    pause: '<path d="M9 5.5v13M15 5.5v13"/>',
    replay: '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3.5 4v4.5H8"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    cross: '<path d="M17 7L7 17M7 7l10 10"/>',
    lock: '<rect x="5" y="11" width="14" height="9.5" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    sound: '<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
    text: '<path d="M5 6h14M5 12h14M5 18h9"/>',
  };
  N3.icon = (name, cls = '') => `<svg class="ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${P[name] || ''}</svg>`;
})();
