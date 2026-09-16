// API mínima para guardar zonas / viajes / clientes ocultos / ubicaciones
// manuales en un almacén compartido (Netlify Blobs), para que todo el
// equipo vea lo mismo sin depender del navegador de cada uno.
//
//   GET  /.netlify/functions/store?key=zones      -> devuelve el JSON guardado (o null)
//   POST /.netlify/functions/store?key=zones      -> guarda el JSON del body
//
// "Última escritura gana": si dos personas guardan casi a la vez, se queda
// la última. Para el ritmo de uso de este equipo (unas pocas ediciones al
// día) es más que suficiente; no hay fusión de cambios en paralelo.

import { getStore } from "@netlify/blobs";

const ALLOWED_KEYS = new Set(["zones", "trips", "hidden", "manualGeo", "checkins", "board"]);

export default async (req) => {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");

  if (!key || !ALLOWED_KEYS.has(key)) {
    return new Response(JSON.stringify({ error: "clave no válida" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }

  const store = getStore("dp-mapa");

  if (req.method === "GET") {
    const data = await store.get(key, { type: "json" });
    return new Response(JSON.stringify(data === undefined ? null : data), {
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }

  if (req.method === "POST" || req.method === "PUT") {
    let body;
    try {
      body = await req.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: "cuerpo no es JSON válido" }), {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8" }
      });
    }
    await store.setJSON(key, body);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }

  return new Response("Method not allowed", { status: 405 });
};
