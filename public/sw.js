// Offline support for the static export. Cache-first for perk/character
// icons and PWA icons (immutable per deploy — a re-scrape ships as a new
// deploy, not a mutated URL), network-first for everything else (HTML/JS/CSS
// data) so a redeploy is picked up immediately while still working offline
// once something has been fetched at least once.
//
// Bump CACHE_VERSION on any change to this file's caching *behavior* (not
// needed for app code changes — those are covered by network-first already).
// The old cache is deleted on activate so a bump can't accumulate stale
// versions forever.
const CACHE_VERSION = "v1";
const CACHE_NAME = `dbd-perk-randomizer-${CACHE_VERSION}`;

// self.registration.scope already includes this deploy's base path (e.g.
// "https://flexeykindev.github.io/dbd-perk-randomizer/") — deriving it here
// instead of hardcoding means this file needs no build-time templating even
// though it's served as-is from public/.
const SCOPE = self.registration.scope;
const PRECACHE_URLS = [SCOPE, `${SCOPE}manifest.webmanifest`];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function cachePut(request, response) {
  // Never cache an error response, or a redirected one (caches.match can't
  // reliably serve those back offline anyway).
  if (!response || !response.ok) return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response);
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  await cachePut(request, response.clone());
  return response;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    await cachePut(request, response.clone());
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // leave cross-origin requests alone

  const isImmutableAsset =
    /\/(perks|characters|icons)\//.test(url.pathname) || /\.(webp|png|svg|ico)$/.test(url.pathname);

  event.respondWith(isImmutableAsset ? cacheFirst(request) : networkFirst(request));
});
