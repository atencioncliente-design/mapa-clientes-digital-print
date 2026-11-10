// Devuelve el usuario que ha entrado (según las credenciales que ya mandó
// el navegador para el login de basic-auth), para poder mostrar "quién
// creó este viaje" en la app. No es una sesión de verdad, solo lee la
// misma cabecera Authorization que ya usa el login.
// "soloLectura" = true para usuarios SOLO_MAPA: la app esconde lo que edita.

import { checkAuth, IMPORTADORES } from "../shared/usuarios.js";

export default async (req) => {
  const header = req.headers.get("authorization") || "";
  const auth = checkAuth(header);
  // el nombre tal cual lo escribió (como antes), para no cambiar "creadoPor"/check-ins
  var username = null;
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    try {
      const decoded = atob(encoded);
      const sep = decoded.indexOf(":");
      if (sep !== -1) username = decoded.slice(0, sep).trim();
    } catch (e) {}
  }
  return new Response(JSON.stringify({
    username: username,
    soloLectura: !!(auth && auth.role === "lectura"),
    puedeImportar: !!(auth && auth.role === "mapa" && IMPORTADORES.includes(auth.user))
  }), {
    headers: { "content-type": "application/json; charset=utf-8" }
  });
};
