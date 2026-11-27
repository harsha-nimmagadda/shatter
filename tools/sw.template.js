// Shatter service worker (template). The build plugin in tools/swPlugin.ts fills in PRECACHE and CACHE.
// Everything is precached on install, so the game starts offline right after the first visit.
const CACHE = /*CACHE*/ 'shatter-dev';
const PRECACHE = /*PRECACHE*/ [];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(req.mode === 'navigate' ? networkFirst(req) : cacheFirst(req));
});

// Pages: network first (always the newest index.html online), cached copy when offline.
async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return (
      (await cache.match(req, { ignoreSearch: true })) ??
      (await cache.match(self.registration.scope)) ??
      (await cache.match(new URL('index.html', self.registration.scope)))
    );
  }
}

// Everything else: cache first (the precache holds every build file; hashed names never go stale).
async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}
