// Usuarios y permisos del sitio (lo usan basic-auth.js, store.mjs y rumbo.mjs).
//
//  USERS        → entran al mapa de clientes (y a Rumbo).
//  RUMBO_USERS  → SOLO entran a Rumbo (/rumbo/). No ven el mapa ni el tablero.
//  TABLERO      → los únicos usuarios que pueden abrir el tablero (/v3/).
//  RUMBO_ADMINS → ven el listado de viajes armados en Rumbo (triple clic en el logo).

export const USERS = {
  "aurelio": "digitalprint2026",
  "victor": "digitalprint2026"
};

export const RUMBO_USERS = {
  "alonso": "8j5t9bf3nb"
};

export const TABLERO = ["aurelio"];

export const RUMBO_ADMINS = ["aurelio"];

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
  } catch (e) {}
  return null;
}
