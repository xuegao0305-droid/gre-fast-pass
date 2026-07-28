const CACHE_NAME = "word-fast-pass-v6";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=6",
  "./app-v2.js?v=6",
  "./libraries.json",
  "./data/gre-equivalents.json",
  "./data/ielts-synonyms.json",
  "./data/ielts-vocabulary-bible.json",
  "./data/ielts-writing.json",
  "./data/gre-emergency-1400.json",
  "./data/gre-3000.json",
  "./og.png",
  "./manifest.webmanifest?v=6",
  "./icon-180.png?v=6",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
        ),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fresh = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached ?? fresh;
    }),
  );
});
