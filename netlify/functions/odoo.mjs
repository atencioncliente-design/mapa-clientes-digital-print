// Conexión de Rumbo con Odoo — ESQUELETO, APAGADO hasta que se configure.
//
// Para encenderlo (cuando gerencia lo apruebe), en Netlify → Site configuration → Environment variables:
//   ODOO_URL   p. ej. https://digitalprint.odoo.com   (sin barra final)
//   ODOO_DB    nombre de la base de datos de Odoo
//   ODOO_USER  usuario de Odoo SOLO DE LECTURA (mejor uno creado para esto)
//   ODOO_KEY   clave API de ese usuario (Preferencias → Seguridad de la cuenta → Claves API)
// Sin esas variables, Rumbo sigue con el campo manual «Odoo / CRM» como hasta ahora.
//
//   GET ?op=estado                      -> {configurado}
//   GET ?op=buscar&nombre=X&tel=Y       -> {oportunidades:[{nombre, etapa, comercial, actualizado, proxima}]}
//
// Solo lee oportunidades abiertas (crm.lead) de la empresa; sin importes.

import { checkAuth } from "../shared/usuarios.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});
const CFG = () => ({ url: process.env.ODOO_URL, db: process.env.ODOO_DB, user: process.env.ODOO_USER, key: process.env.ODOO_KEY });

async function rpc(url, service, method, args) {
  const r = await fetch(url + "/jsonrpc", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: { service, method, args }, id: Date.now() }) });
  const j = await r.json(); if (j.error) throw new Error(j.error.data && j.error.data.message || "odoo");
  return j.result;
}

// nombre "limpio" para buscar: sin S.L., paréntesis, etc.
const limpio = s => String(s || "").replace(/\(.*?\)/g, " ").replace(/\b(S\.?\s?L\.?U?|S\.?\s?A\.?U?|C\.?B\.?|SLL)\b\.?/gi, " ").replace(/\s+/g, " ").trim();

export default async (req) => {
  if (!checkAuth(req.headers.get("authorization"))) return json({ error: "sin acceso" }, 401);
  const c = CFG(), on = !!(c.url && c.db && c.user && c.key);
  const url = new URL(req.url), op = url.searchParams.get("op");
  if (op === "estado") return json({ configurado: on });
  if (!on) return json({ configurado: false, oportunidades: null });

  if (op === "buscar") {
    const nombre = limpio(url.searchParams.get("nombre")).slice(0, 60);
    const tel = String(url.searchParams.get("tel") || "").replace(/\D/g, "").slice(-9);
    if (nombre.length < 3 && tel.length < 9) return json({ oportunidades: [] });
    try {
      const uid = await rpc(c.url, "common", "login", [c.db, c.user, c.key]);
      if (!uid) return json({ error: "login Odoo" }, 502);
      const dom = ["&", ["stage_id.is_won", "=", false], "|", "|", ["partner_id.name", "ilike", nombre], ["partner_name", "ilike", nombre], ["phone", "ilike", tel || "@@@"]];
      const rows = await rpc(c.url, "object", "execute_kw", [c.db, uid, c.key, "crm.lead", "search_read", [dom],
        { fields: ["name", "stage_id", "user_id", "write_date", "activity_date_deadline"], limit: 10, order: "write_date desc" }]);
      return json({ oportunidades: rows.map(r => ({ nombre: r.name, etapa: r.stage_id && r.stage_id[1], comercial: r.user_id && r.user_id[1],
        actualizado: r.write_date, proxima: r.activity_date_deadline || "" })) });
    } catch (e) { return json({ error: "no se pudo consultar Odoo" }, 502); }
  }
  return json({ error: "operación no válida" }, 400);
};
