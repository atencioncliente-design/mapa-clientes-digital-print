/* Service worker: guarda copia de la app para que el mapa cargue sin conexión.
   Todo lo nuestro (páginas, js, css, datos) va SIEMPRE primero por red, así
   cada vez que se abre se ve la última versión publicada sin borrar caché;
   la copia guardada solo se usa si no hay conexión. Las librerías e iconos
   (que no cambian nunca) sí salen de la copia, para que cargue rápido.
   La recarga automática de pestañas ya abiertas la hace js/actualizar.js. */

var CACHE_NAME = "dp-mapa-v5";
var APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/style.css",
  "./js/app.js",
  "./js/actualizar.js",
  "./js/vendor/leaflet.js",
  "./js/vendor/leaflet.css",
  "./js/vendor/leaflet.markercluster.js",
  "./js/vendor/MarkerCluster.css",
  "./js/vendor/MarkerCluster.Default.css",
  "./js/vendor/images/marker-icon.png",
  "./js/vendor/images/marker-icon-2x.png",
  "./js/vendor/images/marker-shadow.png",
  "./js/vendor/images/layers.png",
  "./js/vendor/images/layers-2x.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/favicon-32.png",
  "./icons/apple-touch-icon.png",
  "./icons/logo-original.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) { return cache.addAll(APP_SHELL); })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.filter(function (n) { return n !== CACHE_NAME; }).map(function (n) { return caches.delete(n); }));
    }).then(function () {
      return self.clients.claim();
    }).then(function () {
      return self.clients.matchAll({ type: "window" });
    }).then(function (clients) {
      // Avisa a las pestañas abiertas de que hay versión nueva, para que se
      // recarguen solas y no se queden viendo el mapa desactualizado.
      clients.forEach(function (c) { c.postMessage({ type: "DP_SW_UPDATED" }); });
    })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Rumbo (armador de viajes) y las funciones de Netlify van siempre por red
  if (url.pathname.indexOf("/rumbo") === 0 || url.pathname.indexOf("/.netlify/") === 0) return;

  function guardar(res) {
    if (res && res.ok) {   // nunca guardar errores (401/403/404) como si fueran la app
      var copy = res.clone();
      caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
    }
    return res;
  }

  var fijo = url.pathname.indexOf("/js/vendor/") !== -1 || url.pathname.indexOf("/icons/") === 0 || url.pathname.indexOf("/images/") === 0;
  if (fijo) {
    // librerías, iconos e imágenes: de la copia (no cambian)
    event.respondWith(caches.match(req).then(function (cached) { return cached || fetch(req).then(guardar); }));
    return;
  }

  // todo lo demás: red primero (siempre la versión publicada), copia solo sin conexión
  event.respondWith(
    fetch(req).then(guardar).catch(function () {
      return caches.match(req).then(function (cached) {
        return cached || (req.mode === "navigate" ? caches.match("./index.html") : undefined) || Response.error();
      });
    })
  );
});
