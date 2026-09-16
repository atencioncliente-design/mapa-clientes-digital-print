/* Service worker: cachea el "app shell" para que el mapa cargue offline
   tras la primera visita. Los datos (data/data.json) se intentan refrescar
   por red primero y si no hay conexión se sirve la última copia guardada. */

var CACHE_NAME = "dp-mapa-v2";
var APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/style.css",
  "./js/app.js",
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
  var isData = url.pathname.indexOf("/data/") !== -1;

  if (isData) {
    // network-first para datos, con fallback a cache
    event.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
        return res;
      }).catch(function () { return caches.match(req); })
    );
    return;
  }

  // cache-first para el resto del app shell
  event.respondWith(
    caches.match(req).then(function (cached) {
      return cached || fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
        return res;
      });
    })
  );
});
