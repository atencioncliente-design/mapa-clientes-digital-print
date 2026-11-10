/* Actualización automática: cuando se publica una versión nueva, la página
   se recarga sola (en el ordenador y en el móvil), sin borrar caché a mano.

   Cómo: al abrir la página se apunta la "huella" (ETag) de sus propios
   archivos (la página y sus .js/.css, sin las librerías). Cada pocos minutos,
   y cada vez que se vuelve a la app (desbloquear el móvil, cambiar de
   pestaña), pregunta al servidor si ha cambiado alguna. Si cambió, recarga
   en cuanto no haya nada a medias (ventana abierta o escribiendo). */
(function () {
  "use strict";
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") return;

  var CADA_MS = 5 * 60 * 1000;
  var files = [location.pathname];
  Array.prototype.forEach.call(document.querySelectorAll("script[src], link[rel=stylesheet][href]"), function (el) {
    var u = new URL(el.src || el.href, location.href);
    if (u.origin !== location.origin || u.pathname.indexOf("/vendor/") !== -1) return;
    files.push(u.pathname);
  });

  var base = null, pending = false, checking = false;

  function fingerprint() {
    return Promise.all(files.map(function (p) {
      return fetch(p, { method: "HEAD", cache: "no-store", credentials: "same-origin" })
        .then(function (r) { return r.ok ? (r.headers.get("etag") || r.headers.get("last-modified") || "") : null; })
        .catch(function () { return null; });
    })).then(function (tags) {
      return tags.indexOf(null) !== -1 ? null : tags.join("|");   // sin red: no decidir nada
    });
  }

  function busy() {
    var a = document.activeElement;
    if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.isContentEditable)) return true;
    var mb = document.getElementById("modal-backdrop");
    if (mb && !mb.hidden) return true;
    if (document.querySelector(".modal.on")) return true;
    var tb = document.getElementById("trip-bar");
    if (tb && !tb.hidden) return true;
    return false;
  }

  function maybeReload() {
    if (!pending) return;
    if (document.visibilityState === "visible" && busy()) return;   // ya se hará en la próxima comprobación
    location.reload();
  }

  function check() {
    if (checking) return;
    checking = true;
    // que el navegador mire también si hay service worker nuevo
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
      navigator.serviceWorker.getRegistration().then(function (r) { if (r) r.update().catch(function () {}); }).catch(function () {});
    }
    fingerprint().then(function (fp) {
      checking = false;
      if (!fp) return;
      if (base === null) { base = fp; return; }
      if (fp !== base) pending = true;
      maybeReload();
    });
  }

  check();
  setInterval(check, CADA_MS);
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") check(); });
  window.addEventListener("focus", check);
  window.addEventListener("online", check);
})();
