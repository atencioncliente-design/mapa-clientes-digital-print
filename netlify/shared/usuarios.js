// Usuarios y permisos del sitio (lo usan basic-auth.js, store.mjs y rumbo.mjs).
//
//  USERS        → entran al mapa de clientes (y a Rumbo).
//  RUMBO_USERS  → SOLO entran a Rumbo (/rumbo/). No ven el mapa ni el tablero.
//  TABLERO      → los únicos usuarios que pueden abrir el tablero (/v3/).
//  RUMBO_ADMINS → ven el listado de viajes armados en Rumbo (triple clic en el logo).
//  SOLO_MAPA    → SOLO ven el mapa y las fichas de clientes, sin poder cambiar
//                 nada (ni viajes, ni zonas, ni ocultar). Sin tablero, pizarra,
//                 Rumbo ni catálogo.

export const USERS = {
  "aurelio": "digitalprint2026",
  "victor": "digitalprint2026",
  "santi": "digitalprint2026",
  "santic": "digitalprint2026",
  "marc": "digitalprint2026",
  "salva": "digitalprint2026",
  "javi": "digitalprint2026"
};

export const RUMBO_USERS = {
  "alonso": "8j5t9bf3nb"
};

export const SOLO_MAPA = {
  "hugo": "hugo"
};

// Los únicos que pueden importar empresas nuevas desde el PDF de un viaje
export const IMPORTADORES = ["aurelio"];

export const TABLERO = ["aurelio", "victor", "salva", "javi", "santi"];

export const RUMBO_ADMINS = ["aurelio", "victor", "salva", "javi", "santi"];

// Devuelve {user, role} con role = "mapa" | "rumbo", o null si las credenciales no valen.
export function checkAuth(header) {
  const [scheme, encoded] = String(header || "").split(" ");
  if (scheme !== "Basic" || !encoded) return null;
  try {
    const decoded = atob(encoded);
    const sep = decoded.indexOf(":");
    if (sep === -1) return null;
    const user = decoded.slice(0, sep).trim().toLowerCase();
    const pass = decoded.slice(sep + 1);
    if (USERS[user] && USERS[user] === pass) return { user, role: "mapa" };
    if (RUMBO_USERS[user] && RUMBO_USERS[user] === pass) return { user, role: "rumbo" };
    if (SOLO_MAPA[user] && SOLO_MAPA[user] === pass) return { user, role: "lectura" };
  } catch (e) {}
  return null;
}
