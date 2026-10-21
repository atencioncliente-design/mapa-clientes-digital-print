// API de Rumbo (armador de viajes, /rumbo/), en Netlify Blobs (almacén "rumbo", separado del mapa).
//
//   GET  ?op=me             -> {user, admin}
//   POST ?op=guardar        -> guarda el plan en curso del usuario (mismo plan en ordenador y móvil)
//   GET  ?op=cargar         -> plan en curso del usuario
//   POST ?op=registrar      -> al imprimir: guarda el viaje y devuelve {n} (número correlativo)
//   POST ?op=cerrar         -> al cerrar el viaje: guarda qué se visitó; devuelve {visitas}
//   GET  ?op=visitas        -> historial de visitas por empresa
//   GET  ?op=listado        -> lista de viajes (solo RUMBO_ADMINS)
//   GET  ?op=viaje&n=12     -> viaje completo para reabrirlo (solo RUMBO_ADMINS)
//
// Usuarios y administradores en ../shared/usuarios.js.

import { getStore } from "@netlify/blobs";
import { checkAuth, RUMBO_ADMINS } from "../shared/usuarios.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});
const str = (x, n) => String(x == null ? "" : x).slice(0, n);

export default async (req) => {
  const auth = checkAuth(req.headers.get("authorization"));
  if (!auth) return json({ error: "sin acceso" }, 401);
  const user = auth.user, admin = RUMBO_ADMINS.includes(user);
  const url = new URL(req.url);
  const op = url.searchParams.get("op");
  const store = getStore({ name: "rumbo", consistency: "strong" });
  const body = async () => { try { return await req.json(); } catch (e) { return null; } };

  if (op === "me") return json({ user, admin });

  if (op === "guardar" && req.method === "POST") {
    const b = await body(); if (!b || !b.estado) return json({ error: "cuerpo no válido" }, 400);
    await store.setJSON("borrador-" + user, { t: +b.t || Date.now(), estado: b.estado });
    return json({ ok: true });
  }
  if (op === "cargar") return json((await store.get("borrador-" + user, { type: "json" })) || null);

  if (op === "registrar" && req.method === "POST") {
    const b = await body(); if (!b) return json({ error: "cuerpo no válido" }, 400);
    const log = (await store.get("log", { type: "json" })) || [];
    const n = (log.length ? log[log.length - 1].n : 0) + 1;
    const rec = {
      n, user, fecha: new Date().toISOString(),
      comercial: str(b.comercial, 80), zona: str(b.zona, 160), primerDia: str(b.primerDia, 10), dias: +b.dias || 1, visitas: +b.visitas || 0,
      empresas: Array.isArray(b.empresas) ? b.empresas.slice(0, 10).map(d => (d || []).slice(0, 15).map(x => str(x, 120))) : []
    };
    log.push(rec);
    await store.setJSON("log", log);
    await store.setJSON("viaje-" + n, { ...rec, estado: b.estado || null });
    return json({ n });
  }

  if (op === "cerrar" && req.method === "POST") {
    const b = await body(); if (!b || !Array.isArray(b.resultados)) return json({ error: "cuerpo no válido" }, 400);
    const f = new Date().toISOString().slice(0, 10);
    const vis = (await store.get("visitas", { type: "json" })) || {};
    for (const x of b.resultados.slice(0, 80)) {
      if (!x || !x.id || !["ok", "no"].includes(x.res)) continue;
      const id = str(x.id, 40);
      vis[id] = [{ f, u: user, r: x.res, nt: str(x.nota, 200), n: str(x.n, 120) }, ...(vis[id] || [])].slice(0, 10);
    }
    await store.setJSON("visitas", vis);
    const ok = b.resultados.filter(x => x && x.res === "ok").length, no = b.resultados.filter(x => x && x.res === "no").length;
    const resumen = { ok, no, total: b.resultados.length, cerrado: new Date().toISOString(), por: user };
    const n = parseInt(b.n, 10);
    const log = (await store.get("log", { type: "json" })) || [];
    const i = n ? log.findIndex(r => r.n === n) : -1;
    if (i >= 0) {
      log[i].resultado = resumen; await store.setJSON("log", log);
      const v = await store.get("viaje-" + n, { type: "json" }); if (v) { v.resultado = resumen; v.resultados = b.resultados; await store.setJSON("viaje-" + n, v); }
    } else {   // viaje cerrado sin haberlo impreso: también queda en el listado
      log.push({ n: (log.length ? log[log.length - 1].n : 0) + 1, user, fecha: new Date().toISOString(), comercial: "", zona: str(b.zona, 160),
        primerDia: str(b.fecha, 10), dias: 1, visitas: b.resultados.length, empresas: [b.resultados.slice(0, 15).map(x => str(x && x.n, 120))], resultado: resumen, sinImprimir: true });
      await store.setJSON("log", log);
    }
    await store.delete("borrador-" + user);
    return json({ ok: true, visitas: vis });
  }

  if (op === "visitas") return json((await store.get("visitas", { type: "json" })) || {});

  if (op === "listado" || op === "viaje") {
    if (!admin) return json({ error: "sin acceso" }, 403);
    if (op === "listado") return json((await store.get("log", { type: "json" })) || []);
    const n = parseInt(url.searchParams.get("n"), 10);
    return json((await store.get("viaje-" + n, { type: "json" })) || null);
  }

  return json({ error: "operación no válida" }, 400);
};
