// Puerta de acceso simple: usuario + contraseña (HTTP Basic Auth), nada más.
// Protege TODO el sitio (páginas, datos, funciones) — el navegador pide las
// credenciales con su propio cuadro de diálogo, no hace falta ninguna
// pantalla de login aparte. Se ejecuta antes que nada, en el borde de red
// de Netlify, así que ni siquiera llega a servirse un archivo sin login.
//
// Permisos (usuarios en ../shared/usuarios.js):
//  - usuarios del mapa: todo, salvo el tablero (/v3/), que es solo de TABLERO.
//  - usuarios solo-Rumbo: únicamente /rumbo/ y lo que Rumbo necesita leer.

import { checkAuth, TABLERO } from "../shared/usuarios.js";

function unauthorized() {
  return new Response("Acceso restringido. Introduce tu usuario y contraseña de Digital Print.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Mapa de Clientes Digital Print", charset="UTF-8"',
      "content-type": "text/plain; charset=utf-8"
    }
  });
}

function forbidden() {
  return new Response("No tienes acceso a esta parte.", { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
}

// Lo único que puede pedir un usuario solo-Rumbo
function rumboAllowed(url, method) {
  const p = url.pathname;
  if (p === "/rumbo" || p.startsWith("/rumbo/")) return true;
  if (p === "/.netlify/functions/rumbo" || p === "/.netlify/functions/odoo") return true;
  if (method === "GET" && p === "/data/data.json") return true;
  if (method === "GET" && p === "/.netlify/functions/store" && url.searchParams.get("key") === "hidden") return true;
  return false;
}

export default async (request, context) => {
  const auth = checkAuth(request.headers.get("authorization"));
  if (!auth) return unauthorized();

  const url = new URL(request.url);
  if (auth.role === "rumbo") {
    if (rumboAllowed(url, request.method)) return context.next();
    if (url.pathname === "/" || url.pathname === "/index.html") return Response.redirect(new URL("/rumbo/", url), 302);
    return forbidden();
  }

  // el tablero de control (v3) es privado
  if ((url.pathname === "/v3" || url.pathname.startsWith("/v3/")) && !TABLERO.includes(auth.user)) return forbidden();

  return context.next();
};

export const config = { path: "/*" };
