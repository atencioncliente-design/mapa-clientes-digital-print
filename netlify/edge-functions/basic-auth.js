// Puerta de acceso simple: usuario + contraseña (HTTP Basic Auth), nada más.
// Protege TODO el sitio (páginas, datos, funciones) — el navegador pide las
// credenciales con su propio cuadro de diálogo, no hace falta ninguna
// pantalla de login aparte. Se ejecuta antes que nada, en el borde de red
// de Netlify, así que ni siquiera llega a servirse un archivo sin login.

const USERS = {
  "marc": "digitalprint2026",
  "aurelio": "digitalprint2026",
  "santi": "digitalprint2026",
  "santic": "digitalprint2026",
  "vicente": "digitalprint2026",
  "juanfran": "digitalprint2026",
  "cristian": "digitalprint2026",
  "ivan": "digitalprint2026",
  "salva": "digitalprint2026",
  "javi": "digitalprint2026",
  "comercial": "digitalprint2026"
};

function unauthorized() {
  return new Response("Acceso restringido. Introduce tu usuario y contraseña de Digital Print.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Mapa de Clientes Digital Print", charset="UTF-8"',
      "content-type": "text/plain; charset=utf-8"
    }
  });
}

export default async (request, context) => {
  const auth = request.headers.get("authorization") || "";
  const [scheme, encoded] = auth.split(" ");

  if (scheme === "Basic" && encoded) {
    try {
      const decoded = atob(encoded);
      const sep = decoded.indexOf(":");
      if (sep !== -1) {
        const user = decoded.slice(0, sep).trim().toLowerCase();
        const pass = decoded.slice(sep + 1);
        if (USERS[user] && USERS[user] === pass) {
          return context.next();
        }
      }
    } catch (e) {
      // credenciales mal formadas -> tratar como no autenticado
    }
  }

  return unauthorized();
};

export const config = { path: "/*" };
