// Devuelve el usuario que ha entrado (según las credenciales que ya mandó
// el navegador para el login de basic-auth), para poder mostrar "quién
// creó este viaje" en la app. No es una sesión de verdad, solo lee la
// misma cabecera Authorization que ya usa el login.

export default async (req) => {
  const auth = req.headers.get("authorization") || "";
  const [scheme, encoded] = auth.split(" ");
  var username = null;

  if (scheme === "Basic" && encoded) {
    try {
      const decoded = atob(encoded);
      const sep = decoded.indexOf(":");
      if (sep !== -1) username = decoded.slice(0, sep).trim();
    } catch (e) {}
  }

  return new Response(JSON.stringify({ username: username }), {
    headers: { "content-type": "application/json; charset=utf-8" }
  });
};
