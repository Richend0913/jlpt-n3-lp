// "Add to Home Screen": service worker registration + install prompt state for the Home card.
// - Chrome/Android/desktop Chrome & Edge: the beforeinstallprompt event is kept and fired from our button.
// - iOS/iPadOS: no prompt API; the card shows the Share → Add to Home Screen instruction.
// - Other mobile browsers: a one-line browser-menu instruction.
// Nothing shows when already running as an installed app, on file://, or inside the native (Capacitor) shell.
(function () {
  'use strict';
  const N3 = window.N3;
  const DKEY = 'n3_install_dismissed';
  const web = /^https?:$/.test(location.protocol) && !window.Capacitor;

  if (web && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline cache is a bonus; the app works without it */ });
    });
  }

  let deferred = null;
  let installed = false;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferred = e;
    if (typeof N3.onInstallChange === 'function') N3.onInstallChange();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    if (typeof N3.onInstallChange === 'function') N3.onInstallChange(true);
  });

  const ua = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isMobile = isIOS || /Android|Mobi/i.test(ua);
  const standalone = () => {
    try { if (window.matchMedia('(display-mode: standalone)').matches) return true; } catch (e) {}
    return navigator.standalone === true;
  };
  const dismissed = () => { try { return localStorage.getItem(DKEY) === '1'; } catch (e) { return false; } };

  N3.install = {
    // 'prompt' | 'ios' | 'menu' | null
    mode() {
      if (!web || installed || standalone() || dismissed()) return null;
      if (deferred) return 'prompt';
      if (isIOS) return 'ios';
      if (isMobile) return 'menu';
      return null;   // desktop browser without an install prompt: nothing useful to say
    },
    async prompt() {
      if (!deferred) return false;
      const e = deferred;
      deferred = null;
      try {
        e.prompt();
        const r = await e.userChoice;
        return !!r && r.outcome === 'accepted';
      } catch (err) { return false; }
    },
    dismiss() { try { localStorage.setItem(DKEY, '1'); } catch (e) {} },
    standalone,
  };
})();
