// Service worker: permite instalar la app y abrirla aunque falle internet.
//
// Estrategia:
//  * Archivos propios (HTML, CSS, JS): primero la red, y si no hay conexión
//    se usa la copia guardada. Así siempre se carga la versión más nueva
//    cuando hay internet.
//  * Librerías versionadas (SDK de Firebase en gstatic, assets/vendor):
//    primero la copia guardada, porque su contenido nunca cambia.
//  * Firestore y Authentication NO se interceptan nunca: los datos y la
//    validación de entradas siempre van al servidor.
//
// Al publicar cambios importantes podés subir VERSION para limpiar cachés viejas.
const VERSION = "saen-v2";

const APP_SHELL = [
  "./", "./index.html", "./login.html", "./registro.html",
  "./admin.html", "./vendedor.html", "./acceso.html", "./entrada.html",
  "./manifest.webmanifest",
  "./css/base.css", "./css/acceso.css", "./css/entrada.css",
  "./assets/icon.svg", "./assets/icon-192.png", "./assets/icon-512.png", "./assets/apple-touch-icon.png",
  "./assets/vendor/qrcode.min.js", "./assets/vendor/html5-qrcode.min.js"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(VERSION)
      .then(c => c.addAll(APP_SHELL))
      .catch(() => { /* si algo falla, la app sigue funcionando online */ })
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function esLibreriaVersionada(url) {
  return (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/"))
    || (url.origin === self.location.origin && url.pathname.includes("/assets/vendor/"));
}

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Librerías con versión fija: caché primero.
  if (esLibreriaVersionada(url)) {
    event.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok) { const copia = res.clone(); caches.open(VERSION).then(c => c.put(req, copia)); }
        return res;
      }))
    );
    return;
  }

  // Cualquier otro origen (Firestore, Auth, etc.): no se toca.
  if (url.origin !== self.location.origin) return;

  // Archivos propios: red primero, caché si no hay conexión.
  event.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) { const copia = res.clone(); caches.open(VERSION).then(c => c.put(req, copia)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })
        .then(hit => hit || (req.mode === "navigate" ? caches.match("./index.html") : undefined))
        .then(hit => hit || new Response("Sin conexión", { status: 503, statusText: "Offline" })))
  );
});
