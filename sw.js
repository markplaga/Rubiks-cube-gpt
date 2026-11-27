// PWA-UPDATE-SYSTEM v2: auto-update, version banner, Check for updates. Do not remove this line.
// CUBED service worker.
// PWA-UPDATE-SYSTEM v2 notes:
// - One cache per release, named pwa::markplaga/Rubiks-cube-gpt::<release>.
//   Cache Storage is origin-wide, so only caches under that exact
//   namespace are ever deleted, and only in activate, and only when
//   they are not the current release's cache. The legacy cache
//   (cubed-v2) is deliberately RETAINED: it may still serve clients
//   on the old worker.
// - Version-consistent shell: a navigation is served from this
//   release's own cache; the network is only a fallback and its
//   response is never written into this cache, so a new index.html
//   can never land in an old release's cache.
// - Only the precached shell files are ever served from cache. The
//   shell covers BOTH pages of this app: the small loader index.html
//   and the real app legacy.html, plus the theme-patches the loader
//   fetches to build the app (matched ignoring the loader's ?v=
//   query, so an offline boot still works). CDN libraries (Three.js,
//   Google Fonts) are network-only and never cached. version.json is
//   never intercepted. Non-GET requests are never intercepted.
// - This app keeps no saved state: CUBED intentionally uses no local
//   or session storage (see legacy.html). A reload restores a solved
//   cube, so an in-progress cube — any unsolved moves, queued moves,
//   a turn animating, or a solve/reset in flight — is unsaved work.
//   The page reports it through window.__cubedUpdate.isDirty() (see
//   the bridge on the let hudTimer line of legacy.html's main script)
//   and Update now is refused while this tab, or any other CUBED tab,
//   reports it.
const RELEASE = '1.0.0-20261127-1';
const DISPLAY_VERSION = '1.0.0';
const NAMESPACE = 'pwa::markplaga/Rubiks-cube-gpt::';
const CACHE = NAMESPACE + RELEASE;
const SHELL = [
  './', 'index.html', 'legacy.html', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
  'theme-patches/index-01.part', 'theme-patches/index-02.part',
  'theme-patches/index-03.part', 'theme-patches/index-04.part',
  'theme-patches/index-05.part', 'theme-patches/index-06.part',
  'theme-patches/index-07.part',
  'theme-patches/environment-runtime-v7.patch'
];
// Shell paths relative to the app base (the worker's scope). The
// worker lives at the app base, so a request path is the base path
// plus one of these; at the site root the base path is empty.
const SHELL_PATHS = new Set([
  '/Rubiks-cube-gpt/', '/Rubiks-cube-gpt/index.html',
  '/Rubiks-cube-gpt/legacy.html', '/Rubiks-cube-gpt/manifest.webmanifest',
  '/Rubiks-cube-gpt/icons/icon.svg', '/Rubiks-cube-gpt/icons/icon-192.png',
  '/Rubiks-cube-gpt/icons/icon-512.png',
  '/Rubiks-cube-gpt/icons/icon-maskable-512.png',
  '/Rubiks-cube-gpt/icons/apple-touch-icon.png',
  '/Rubiks-cube-gpt/theme-patches/index-01.part',
  '/Rubiks-cube-gpt/theme-patches/index-02.part',
  '/Rubiks-cube-gpt/theme-patches/index-03.part',
  '/Rubiks-cube-gpt/theme-patches/index-04.part',
  '/Rubiks-cube-gpt/theme-patches/index-05.part',
  '/Rubiks-cube-gpt/theme-patches/index-06.part',
  '/Rubiks-cube-gpt/theme-patches/index-07.part',
  '/Rubiks-cube-gpt/theme-patches/environment-runtime-v7.patch',
  '/', '/index.html', '/legacy.html', '/manifest.webmanifest',
  '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png',
  '/icons/icon-maskable-512.png', '/icons/apple-touch-icon.png',
  '/theme-patches/index-01.part', '/theme-patches/index-02.part',
  '/theme-patches/index-03.part', '/theme-patches/index-04.part',
  '/theme-patches/index-05.part', '/theme-patches/index-06.part',
  '/theme-patches/index-07.part',
  '/theme-patches/environment-runtime-v7.patch'
]);

self.addEventListener('install', e => {
  // cache:'reload' skips the browser's HTTP cache, so a new version
  // never installs stale files. Install fails if any required shell
  // file is missing or does not belong to this release, so a broken
  // deploy can never replace the working release.
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const u of SHELL) {
      const r = await fetch(new Request(u, { cache: 'reload' }));
      if (!r.ok) throw new Error('precache failed: ' + u + ' ' + r.status);
      if (u === './' || u === 'index.html' || u === 'legacy.html') {
        const text = await r.clone().text();
        if (!text.includes(RELEASE)) throw new Error('precache mismatch: ' + u + ' is not release ' + RELEASE);
      }
      await cache.put(u, r);
    }
  })());
  // No skipWaiting here: the page asks the user first.
});

self.addEventListener('message', e => {
  const port = e.ports && e.ports[0];
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (e.data && e.data.type === 'GET_VERSION' && port) {
    port.postMessage({ release: RELEASE, displayVersion: DISPLAY_VERSION });
  }
  if (e.data && e.data.type === 'GET_CLIENTS' && port) {
    // includeUncontrolled: a waiting worker controls no clients yet,
    // but the pages it is about to take over are in its scope and
    // must be counted. Without this the count would always be 0.
    self.clients.matchAll({ includeUncontrolled: true })
      .then(cs => port.postMessage({ count: cs.length }));
  }
});

self.addEventListener('activate', e => {
  // Delete ONLY caches under this app's exact namespace that are not
  // the current release. Legacy caches outside the namespace are
  // retained on purpose (see header comment).
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys
      .filter(k => k.startsWith(NAMESPACE) && k !== CACHE)
      .map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // The version file is always fetched live so update checks are
  // never fooled by a cache.
  if (url.origin === location.origin && url.pathname.endsWith('/version.json')) return;
  // CDN libraries are network-only: never cached, never intercepted.
  // (Three.js, Google Fonts — all cross-origin.)
  if (url.origin !== location.origin) return;

  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      // Version-consistent shell: this release's own cached page.
      // A navigation to /?anything still gets this release's page.
      const cached = await caches.match(req, { cacheName: CACHE })
        || await caches.match('./index.html', { cacheName: CACHE });
      if (cached) return cached;
      try {
        // Network is a fallback only; the response is NOT cached,
        // so a newer page can never be written into this cache.
        return await fetch(req);
      } catch (err) {
        return caches.match('./index.html', { cacheName: CACHE });
      }
    })());
    return;
  }

  // Same-origin static files: only the precached shell may be
  // served from cache. Anything else is left to the browser.
  // Accept the shell path with or without the app-base prefix.
  // ignoreSearch: the loader fetches legacy.html and the
  // theme-patches with a ?v= query; the precached copy is the same
  // file for this release.
  const stripped = url.pathname.replace(/^\/[^/]+(\/.*)$/, '$1');
  const shellPath = SHELL_PATHS.has(url.pathname) ? url.pathname
    : (SHELL_PATHS.has(stripped) ? stripped : null);
  if (!shellPath) return;
  e.respondWith((async () => {
    const cached = await caches.match(req, { cacheName: CACHE, ignoreSearch: true });
    if (cached) return cached;
    // Network fallback, never cached: only this release's precache
    // populates the cache, at install time.
    return fetch(req);
  })());
});
