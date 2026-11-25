// Cache only the static app; customer input and generated PDFs never enter this cache.
// Paths are relative to this worker, so the app also runs below a sub path (e.g. /inkform/);
// served at "/" they are the same addresses as before.
const CACHE = "inkform-app-__BUILD_HASH__";
const BASE = new URL("./", self.location).href;
const INDEX = new URL("index.html", BASE).href;
const URLS = [
  "index.html",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "licenses/Inkform.txt",
  "licenses/jsPDF.txt",
  "licenses/NotoSans.txt",
].map((path) => new URL(path, BASE).href);
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      for (const url of URLS) {
        const response = await fetch(url, { credentials: "same-origin", cache: "reload" });
        if (!response.ok || response.redirected) throw new Error("App-Asset nicht verfügbar: " + url);
        if (url === INDEX) {
          const html = await response.clone().text();
          if (!html.includes('id="customer-app"')) throw new Error("Kein App-Dokument; Anmeldung erforderlich.");
        }
        await cache.put(url, response);
      }
    })(),
  );
});
// Updates wait until all app windows are closed, or until the app reports that it is idle (no form
// in progress, no unconfirmed consent): then the page asks this worker to take over at once, so an
// older cached version can never start again on data written by the newer one. Only „Nach Update
// suchen“ reloads the page afterwards.
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith("inkform-app-") && key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});
self.addEventListener("fetch", (event) => {
  const request = event.request,
    url = new URL(request.url);
  url.search = "";
  url.hash = "";
  if (request.method !== "GET" || !(URLS.includes(url.href) || url.href === BASE)) return;
  // The app always starts from its cache, also online: no request leaves the device, so iPadOS
  // neither waits for an unreachable network nor shows its airplane mode notice. Updates arrive
  // through a new worker (see above); the network is only asked for files not in the cache.
  const key = url.href === BASE ? INDEX : url.href;
  event.respondWith(
    (async () => (await caches.match(key, { cacheName: CACHE })) || fetch(request))(),
  );
});

// Confirm readiness only after every required static file is actually cached.
self.addEventListener("message", (event) => {
  if (event.data?.type !== "CHECK_OFFLINE") return;
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const entries = await Promise.all(URLS.map((url) => cache.match(url)));
      if (entries.every(Boolean)) event.source?.postMessage({ type: "INKFORM_OFFLINE_READY" });
    })(),
  );
});
