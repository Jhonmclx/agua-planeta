// Service worker: app instalable + carga rápida con internet lento
const SHELL_CACHE = "ap-shell-v2";
const IMG_CACHE = "ap-img-v1";
const SHELL = ["/", "/admin", "/js/photo.js", "/assets/logo.jpg", "/assets/banner.jpg", "/assets/icon-192.png", "/manifest.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SHELL_CACHE && k !== IMG_CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

const isImage = (url) => url.pathname.startsWith("/api/img/") || url.pathname.startsWith("/.netlify/images") || url.pathname.startsWith("/seed/");

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Fotos: primero lo guardado (no cambian nunca), si no, de internet
  if (isImage(url)) {
    e.respondWith(caches.open(IMG_CACHE).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  // Panel y pedidos: siempre en vivo
  if (url.pathname.startsWith("/api/") && url.pathname !== "/api/catalog") return;

  // Páginas y catálogo: internet primero, copia guardada si no hay señal
  e.respondWith(
    fetch(req)
      .then((res) => { if (res.ok) { const copy = res.clone(); caches.open(SHELL_CACHE).then((c) => c.put(req, copy)); } return res; })
      .catch(() => caches.match(req))
  );
});
