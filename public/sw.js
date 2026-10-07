// Service worker: permite instalar la app y abrirla más rápido
const CACHE = "ap-v1";
const SHELL = ["/", "/admin", "/js/photo.js", "/assets/logo.jpg", "/assets/banner.jpg", "/assets/icon-192.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith("/api/")) return; // datos siempre frescos
  // red primero, copia en caché como respaldo
  e.respondWith(fetch(req).then(res => { const c = res.clone(); caches.open(CACHE).then(ca => ca.put(req, c)); return res; }).catch(() => caches.match(req)));
});
