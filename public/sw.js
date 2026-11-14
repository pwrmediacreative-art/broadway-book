// Broadway Book service worker. Hand-written, no build step, no libraries.
//
// What it does:
//  - Saves the app itself on the phone: a few whole pages (SHELLS) and every script, style
//    and font file they use. Charts are NOT stored here; the app keeps them in IndexedDB
//    (lib/offline) and the saved pages draw from that copy.
//  - Online, pages always come from the network, so a new version shows up at the next page
//    load. The saved copy is replaced in the background, all at once, only after every file
//    of the new version has downloaded: nobody is left on a half-updated or stale app.
//  - Offline (or when a page takes too long), a saved page is shown instead. Song and
//    setlist addresses are sent to the saved pages that draw from the phone's copy.
//
// The route table below mirrors lib/offline/routes.ts; lib/offline/offline.test.ts checks
// that the two agree.

const PAGES = "bb-pages-v1";
const ASSETS = "bb-assets-v1";
const SLOW_MS = 4000; // a page slower than this falls back to the saved copy

const SHELLS = [
  "/",
  "/setlists",
  "/setlists/device",
  "/setlists/device/play",
  "/setlists/snapshot",
  "/offline",
  "/offline/song",
  "/offline/setlist",
];
const EXTRAS = ["/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png"];

const enc = encodeURIComponent;

function offlineTarget(pathname) {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (SHELLS.includes(path)) return { serve: path };
  let m = /^\/songs\/([^/]+)(\/stage)?$/.exec(path);
  if (m) return { redirect: `/offline/song?s=${enc(decodeURIComponent(m[1]))}${m[2] ? "&stage=1" : ""}` };
  m = /^\/setlists\/([^/]+)(\/play)?$/.exec(path);
  if (m) return { redirect: `/offline/setlist?id=${enc(decodeURIComponent(m[1]))}${m[2] ? "&play=1" : ""}` };
  m = /^\/s\/([^/]+)(\/play)?$/.exec(path);
  if (m) return { redirect: `/offline/setlist?code=${enc(decodeURIComponent(m[1]))}${m[2] ? "&play=1" : ""}` };
  return { redirect: `/offline?from=${enc(path)}` };
}

/** Every /_next/static file a page mentions (script tags, styles, fonts, lazy chunks). */
function assetUrls(html) {
  const out = new Set();
  const re = /\/_next\/static\/[^"'\\\s<>)]+/g;
  let m;
  while ((m = re.exec(html))) out.add(m[0].replace(/&amp;/g, "&"));
  return [...out];
}

/** Files a stylesheet pulls in (fonts), as absolute paths. */
function cssUrls(css, base) {
  const out = new Set();
  const re = /url\(\s*['"]?([^'")\s]+)['"]?\s*\)/g;
  let m;
  while ((m = re.exec(css))) {
    if (m[1].startsWith("data:")) continue;
    try {
      const u = new URL(m[1], base);
      if (u.origin === new URL(base).origin) out.add(u.pathname + u.search);
    } catch {
      // not a URL
    }
  }
  return [...out];
}

// Exposed for the tests (lib/offline/offline.test.ts).
self.__bb = { SHELLS, offlineTarget, assetUrls, cssUrls };

async function saveAsset(cache, path) {
  if (await cache.match(path)) return;
  const res = await fetch(path, { cache: "no-cache" });
  if (!res.ok) throw new Error(`asset ${path}: ${res.status}`);
  await cache.put(path, res);
}

async function inBatches(items, size, fn) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

let refreshing = null;

/** Bring the saved app up to date. Replaces the saved pages only when everything downloaded. */
function refresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const pages = await caches.open(PAGES);
    const assets = await caches.open(ASSETS);

    // Cheap check first: if the home page is unchanged and nothing is missing, we're current.
    const home = await fetch("/", { cache: "no-store" });
    if (!home.ok || home.redirected) throw new Error("home page not available");
    const homeHtml = await home.text();
    const savedHome = await pages.match("/");
    const complete = (await pages.keys()).length >= SHELLS.length;
    if (complete && savedHome && (await savedHome.text()) === homeHtml) return;

    const html = new Map([["/", homeHtml]]);
    for (const path of SHELLS.slice(1)) {
      const res = await fetch(path, { cache: "no-store" });
      if (!res.ok || res.redirected) throw new Error(`page ${path}: ${res.status}`);
      html.set(path, await res.text());
    }

    const need = new Set(EXTRAS);
    for (const text of html.values()) assetUrls(text).forEach((u) => need.add(u));
    await inBatches([...need], 6, (u) => saveAsset(assets, u));

    // Fonts are named inside the stylesheets.
    const fonts = new Set();
    for (const u of need) {
      if (!/\.css(\?|$)/.test(u)) continue;
      const css = await (await assets.match(u)).text();
      cssUrls(css, new URL(u, self.location.origin).href).forEach((f) => fonts.add(f));
    }
    await inBatches([...fonts], 6, (u) => saveAsset(assets, u));
    fonts.forEach((f) => need.add(f));

    // Everything is here: switch the saved pages to the new version.
    for (const [path, text] of html) {
      await pages.put(path, new Response(text, { headers: { "content-type": "text/html; charset=utf-8" } }));
    }

    // Drop files from older versions once they pile up.
    const keys = await assets.keys();
    if (keys.length > need.size + 150) {
      for (const req of keys) {
        const u = new URL(req.url);
        if (!need.has(u.pathname + u.search)) await assets.delete(req);
      }
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  // Offline at install time is fine: the app asks for a refresh each time it opens.
  event.waitUntil(refresh().catch(() => {}));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith("bb-") && name !== PAGES && name !== ASSETS) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "refresh") event.waitUntil(refresh().catch(() => {}));
});

async function fromAssets(request) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(request, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone()).catch(() => {});
  return res;
}

async function savedPage(target) {
  const pages = await caches.open(PAGES);
  if (target.serve) return pages.match(target.serve, { ignoreVary: true });
  // Only send the player on if the page we're sending them to is saved.
  const dest = new URL(target.redirect, self.location.origin);
  return (await pages.match(dest.pathname)) ? Response.redirect(dest.href, 302) : undefined;
}

async function page(request, url) {
  const target = offlineTarget(url.pathname);
  // Pages with a real saved version get a time limit; the rest wait for the network.
  const real = target.serve ? target.serve !== "/offline" : !target.redirect.startsWith("/offline?");
  let timer;
  try {
    const net = fetch(request);
    if (!real) return await net;
    const slow = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("slow")), SLOW_MS);
    });
    net.catch(() => {});
    return await Promise.race([net, slow]);
  } catch (e) {
    const saved = await savedPage(target);
    if (saved) return saved;
    if (e && e.message === "slow") return fetch(request); // nothing saved yet: keep waiting
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/_next/static/") || EXTRAS.includes(url.pathname)) {
    event.respondWith(fromAssets(request));
  } else if (request.mode === "navigate") {
    event.respondWith(page(request, url));
  }
  // Everything else (page data, the search index, sign-in) goes straight to the network.
});
