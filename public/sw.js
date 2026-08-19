// Offline support for the static export. Images are served from cache and
// refreshed in the background; everything else (HTML/JS/CSS/data) is
// network-first, so a redeploy is picked up immediately while still working
// offline once something has been fetched at least once.
//
// Images used to be plain cache-first, on the reasoning that they are
// "immutable per deploy — a re-scrape ships as a new deploy, not a mutated
// URL". The second half of that is true and is exactly the problem: the URL
// does *not* change, so a cached copy is never reconsidered. When a perk's
// icon was corrected (afcc144 replaced two "?" placeholders with the real
// art), every browser that had already cached the placeholder kept showing
// it — permanently, across any number of deploys. That was reported as an
// icon "still missing" long after the file itself was fixed.
//
// Stale-while-revalidate keeps what cache-first was for — an instant paint
// and full offline use — while letting a corrected file actually arrive.
// The only cost is that a fix appears one load later than it could.
//
// Bump CACHE_VERSION on any change to this file's caching *behavior* (not
// needed for app code changes — those are covered by network-first already).
// The old cache is deleted on activate so a bump can't accumulate stale
// versions forever — which also clears any placeholder pinned by the old
// cache-first behaviour.
const CACHE_VERSION = "v2";
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

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  // Started regardless of a cache hit — this is the part that lets a
  // corrected image replace one that was cached when it was still wrong.
  const network = fetch(request)
    .then(async (response) => {
      await cachePut(request, response.clone());
      return response;
    })
    // Offline, or the asset is gone: the cached copy below is the answer.
    .catch(() => null);

  if (cached) return cached;
  const response = await network;
  if (response) return response;
  throw new Error(`Not cached and unreachable: ${request.url}`);
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

  const isImage =
    /\/(perks|characters|icons|loadout)\//.test(url.pathname) ||
    /\.(webp|png|svg|ico)$/.test(url.pathname);

  event.respondWith(isImage ? staleWhileRevalidate(request) : networkFirst(request));
});
