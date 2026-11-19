// 赤シート (red sheet) for study cards. Answers (reading, meaning, translations) are printed in orange ink
// (.ink); a translucent orange sheet lies over the answer zone. Under the sheet the orange ink disappears while
// the black text stays readable, as with a real red sheet. Drag the sheet to the right (or tap it) to uncover.
//
// Implementation: the sheet is a positioned element; every .ink element in the zone is painted with a
// background-clip:text gradient whose hard stop sits at the sheet's left edge (--edge, in the element's own
// coordinates), so ink left of the edge shows and ink under the sheet is transparent.
(function () {
  'use strict';
  const N3 = window.N3;
  const REVEAL_AT = 0.35;     // drag past 35% of the width -> reveal

  function setEdge(zone, x) {
    const zr = zone.getBoundingClientRect();
    zone.style.setProperty('--sx', x + 'px');
    zone.querySelectorAll('.ink').forEach(el => {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--edge', (zr.left + x - r.left) + 'px');
    });
  }

  function animate(zone, from, to, ms, done) {
    const t0 = performance.now();
    const step = now => {
      const k = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      setEdge(zone, from + (to - from) * e);
      if (k < 1) requestAnimationFrame(step); else if (done) done();
    };
    requestAnimationFrame(step);
  }

  // mount(zone, onReveal): wire one zone. Returns {reveal()} for the "Show answer" button / keyboard.
  N3.mountSheet = (zone, onReveal) => {
    if (!zone) return null;
    const sheet = zone.querySelector('.sheet');
    const width = () => zone.getBoundingClientRect().width;
    let x = 0, revealed = zone.classList.contains('open');
    setEdge(zone, revealed ? width() + 40 : 0);
    if (revealed || !sheet) return { reveal() {} };

    const finish = () => {
      if (revealed) return;
      revealed = true;
      zone.classList.add('open');
      animate(zone, x, width() + 40, 220, () => onReveal && onReveal());
    };
    let start = null, moved = false;
    sheet.addEventListener('pointerdown', e => {
      start = { px: e.clientX, py: e.clientY, x };
      moved = false;
      try { sheet.setPointerCapture(e.pointerId); } catch (err) {}
      zone.classList.add('drag');
    });
    sheet.addEventListener('pointermove', e => {
      if (!start || revealed) return;
      const dx = e.clientX - start.px;
      if (Math.abs(dx) > 5) moved = true;
      x = Math.max(0, Math.min(width(), start.x + dx));
      setEdge(zone, x);
    });
    const up = () => {
      if (!start) return;
      start = null;
      zone.classList.remove('drag');
      if (revealed) return;
      if (!moved || x > width() * REVEAL_AT) finish();
      else { const from = x; x = 0; animate(zone, from, 0, 160); }
    };
    sheet.addEventListener('pointerup', up);
    sheet.addEventListener('pointercancel', up);
    // Keep --edge right if fonts load late or the window is resized.
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (!revealed) setEdge(zone, x); });
    return { reveal: finish };
  };
})();
