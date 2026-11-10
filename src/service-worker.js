// Cache only the static app; customer input and generated PDFs never enter this cache.
const CACHE = "inkform-app-__BUILD_HASH__";
const PATHS = [
  "/index.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/licenses/jsPDF.txt",
  "/licenses/Tailwind.txt",
  "/licenses/NotoSans.txt",
];
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      for (const path of PATHS) {
        const response = await fetch(path, { credentials: "same-origin", cache: "reload" });
        if (!response.ok || response.redirected)
          throw new Error("App-Asset nicht verfügbar: " + path);
        if (path === "/" || path === "/index.html") {
          const html = await response.clone().text();
          if (!html.includes('id="customer-app"'))
            throw new Error("Kein App-Dokument; Anmeldung erforderlich.");
        }
        await cache.put(path, response);
      }
    })(),
  );
});
// Updates wait until all app windows are closed; never reload an active form.
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
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    !(PATHS.includes(url.pathname) || url.pathname === "/")
  )
    return;
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch (error) {
          const cached = await caches.match("/index.html", { cacheName: CACHE });
          if (cached) return cached;
          throw error;
        }
      })(),
    );
  } else
    event.respondWith(
      (async () => {
        return (await caches.match(url.pathname, { cacheName: CACHE })) || fetch(request);
      })(),
    );
});

// Confirm readiness only after every required static file is actually cached.
self.addEventListener("message", (event) => {
  if (event.data?.type !== "CHECK_OFFLINE") return;
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const entries = await Promise.all(PATHS.map((path) => cache.match(path)));
      if (entries.every(Boolean)) event.source?.postMessage({ type: "INKFORM_OFFLINE_READY" });
    })(),
  );
});
