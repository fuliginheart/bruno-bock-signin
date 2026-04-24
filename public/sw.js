/**
 * Bruno Bock kiosk service worker.
 *
 * Goals:
 *   1. App-shell offline: cache the document, JS chunks, and CSS so the UI
 *      still renders if the local server is briefly unreachable (e.g. service
 *      restart, transient network glitch on a follower).
 *   2. Best-effort cache for visitor portrait/signature media so admin views
 *      don't blank out on flaky connections.
 *   3. Network-first for API routes and the SSE stream — never serve stale
 *      JSON because that would mislead the kiosk operator.
 *
 * Versioning: bump CACHE_VERSION whenever cache strategy changes.
 */
const CACHE_VERSION = "v1";
const SHELL_CACHE = `bb-shell-${CACHE_VERSION}`;
const MEDIA_CACHE = `bb-media-${CACHE_VERSION}`;
const SHELL_PRECACHE = ["/", "/visitor"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_PRECACHE))
      .catch(() => {
        // Pre-cache failures are non-fatal: we still install.
      }),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== MEDIA_CACHE)
          .map((k) => caches.delete(k)),
      ),
    ),
  );
  self.clients.claim();
});

function isApi(url) {
  return url.pathname.startsWith("/api/");
}
function isMedia(url) {
  return url.pathname.startsWith("/api/media/");
}
function isShellAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".woff2")
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Same-origin only — never cache cross-origin requests.
  if (url.origin !== self.location.origin) return;

  // Skip the SSE stream entirely.
  if (url.pathname === "/api/stream") return;

  if (isMedia(url)) {
    event.respondWith(cacheFirst(req, MEDIA_CACHE));
    return;
  }

  if (isApi(url)) {
    // API: network-first with no fallback (we don't want stale JSON).
    return; // pass through to network
  }

  if (isShellAsset(url) || req.mode === "navigate") {
    event.respondWith(staleWhileRevalidate(req, SHELL_CACHE));
    return;
  }
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    if (cached) return cached;
    throw err;
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const network = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => cached);
  return cached || network;
}
