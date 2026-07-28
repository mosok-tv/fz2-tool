/* Service Worker – macht die App offline nutzbar. Version bei Änderungen erhöhen. */
const CACHE = "schichtuebergabe-v1";
const DATEIEN = [
  "./", "index.html", "style.css", "app.js", "manifest.json",
  "icon-180.png", "icon-192.png", "icon-512.png",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(DATEIEN)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then(treffer => treffer || fetch(e.request).catch(() =>
      // Bei Navigations-Anfragen offline auf die App-Startseite zurückfallen
      e.request.mode === "navigate" ? caches.match("index.html") : undefined
    ))
  );
});
