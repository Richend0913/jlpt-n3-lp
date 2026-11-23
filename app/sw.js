// N3 Tango service worker: makes the installed (Home Screen) app open offline.
// - App shell (HTML, CSS, JS, data): network first with a short timeout, cached copy when offline or slow.
//   Network first means a new deploy (e.g. the free-period switch) shows up on the next launch, not the one after.
// - Audio, fonts, icons: cache first. Audio is cached the first time it is played (24 MB total is too much to
//   download up front). Range requests (Safari audio) are answered from the cached full file.
// Only same-origin GETs inside this scope are handled; the account API and the beacon go straight to the network.
'use strict';
const VERSION = 'n3-2026-11-23c';
const SHELL = `shell-${VERSION}`;
const MEDIA = 'media-v1';            // audio does not change between deploys: keep it across versions
const PRECACHE = [
  './', 'index.html', 'manifest.webmanifest',
  'css/fonts.css', 'css/app.css',
  'data/words.js', 'data/content.js',
  'js/util.js', 'js/i18n.js', 'js/store.js', 'js/words.js', 'js/content.js', 'js/srs.js', 'js/quiz.js',
  'js/plan.js', 'js/sheet.js', 'js/sync.js', 'js/install.js', 'js/app.js',
  'fonts/zen-kaku-gothic-new-400.woff2', 'fonts/zen-kaku-gothic-new-500.woff2', 'fonts/zen-kaku-gothic-new-700.woff2',
  'fonts/shippori-mincho-700.woff2', 'fonts/ibm-plex-mono-400.woff2', 'fonts/ibm-plex-mono-500.woff2',
  'icons/icon-192.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    // One failed file must not block installation: cache what we can.
    await Promise.all(PRECACHE.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('shell-') && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

const SCOPE = new URL(self.registration.scope);
const isMedia = p => /\/(audio|fonts|icons)\//.test(p);

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return;
  if (isMedia(url.pathname)) e.respondWith(media(req, url));
  else e.respondWith(shell(req, url));
});

async function shell(req, url) {
  const c = await caches.open(SHELL);
  // Navigations (any ?ref= / #route) share one cached index.html.
  const key = req.mode === 'navigate' ? new URL('index.html', SCOPE).href : url.origin + url.pathname;
  const net = fetch(req).then(res => {
    if (res.ok && res.type === 'basic') c.put(key, res.clone()).catch(() => {});
    return res;
  });
  const timeout = new Promise(r => setTimeout(r, 4000, null));
  try {
    const res = await Promise.race([net, timeout]);
    if (res) return res;
  } catch (err) { /* offline: fall through to the cache */ }
  const hit = await c.match(key);
  if (hit) return hit;
  return net;   // nothing cached: keep waiting for the network (or fail like a normal page would)
}

async function media(req, url) {
  const c = await caches.open(MEDIA);
  const key = url.origin + url.pathname;
  let full = await c.match(key);
  if (!full) {
    let res;
    try { res = await fetch(key); } catch (err) { return Response.error(); }
    if (!res.ok || res.status !== 200) return res;
    c.put(key, res.clone()).catch(() => {});
    full = res;
  }
  const range = req.headers.get('range');
  if (!range) return full;
  return partial(full, range);
}

// Build a 206 from a cached 200 (Safari plays <audio> only with byte-range responses).
async function partial(res, range) {
  const buf = await res.arrayBuffer();
  const size = buf.byteLength;
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  let start = m && m[1] !== '' ? Number(m[1]) : 0;
  let end = m && m[2] !== '' ? Number(m[2]) : size - 1;
  if (m && m[1] === '' && m[2] !== '') { start = Math.max(0, size - Number(m[2])); end = size - 1; }
  end = Math.min(end, size - 1);
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'audio/mpeg',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}
