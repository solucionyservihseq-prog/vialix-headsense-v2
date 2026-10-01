// Prefijo propio: solo se borran cachés de esta app, nunca los de VIALIX KEY
// ni los de la HEADSENSE original, que comparten el dominio github.io.
const CACHE_PREFIJO = "vialix-headsense-v2-";
const CACHE_NAME = CACHE_PREFIJO + "1";
const ASSETS = [
  "./",
  "./index.html",
  "./analisis.html",
  "./styles.css",
  "./config.js",
  "./analisis.js",
  "./sensor.js",
  "./almacen.js",
  "./app.js",
  "./analisis-page.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./logo-vialix.png",
  "./logo-arl-bolivar.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIJO) && k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Nunca cachear las llamadas al backend (Apps Script)
  if (req.method !== "GET" || req.url.includes("script.google.com")) {
    return;
  }

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      const fetchPromise = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const resClone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
