/* Tablero de control — v3
   Panel semanal de tareas/incidencias por zona, alineado por día.
   Usa la misma base de clientes (data/data.json) para autocompletar
   ciudad/provincia (o CP si no hay ciudad), pero permite escribir
   libremente cuando el cliente no está en la base.
   Se guarda en localStorage al instante y en el almacén compartido de
   Netlify (misma clave "board" que zonas/viajes), con el mismo patrón
   de "última escritura gana" que ya usa el resto de la app. */

(function () {
  "use strict";

  var API_BASE = "/.netlify/functions/store";
  var LOCAL_KEY = "dp_board_v1";

  var DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
  var MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  var KNOWN_TECHS = ["Marc", "Aurelio", "Santi", "SantiC", "Vicente", "Juanfran", "Cristian", "Ivan", "Salva", "Javi", "Comercial"];
  var TECH_COLORS = {
    "marc": "#2563EB", "aurelio": "#059669", "santi": "#D97706", "santic": "#7C3AED",
    "vicente": "#0891B2", "juanfran": "#DB2777", "cristian": "#65A30D", "ivan": "#EA580C",
    "salva": "#4338CA", "javi": "#0D9488", "comercial": "#6B7280"
  };
  var PALETTE = ["#2563EB", "#059669", "#D97706", "#7C3AED", "#0891B2", "#DB2777", "#65A30D", "#EA580C", "#4338CA", "#0D9488"];

  var DEFAULT_COLUMNS = [
    { id: "centro", nombre: "Madrid" },
    { id: "resto", nombre: "Resto de España" },
    { id: "catalunya", nombre: "Cataluña" }
  ];

  var state = {
    clients: [],
    columns: [],
    entries: [],
    backlog: [],
    weekStart: getMonday(new Date()),
    currentUser: null,
    techFilter: new Set(),
    searchTerm: "",
    modalCtx: null
  };

  /* ---------------- utils ---------------- */

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  function normalize(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function techColor(name) {
    var key = normalize(name);
    if (TECH_COLORS[key]) return TECH_COLORS[key];
    var h = 0;
    for (var i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    return PALETTE[h % PALETTE.length];
  }

  function techTags(tecnicos) {
    var names = String(tecnicos || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    if (!names.length) return "";
    return '<div class="bc-tec">' + names.map(function (n) {
      return '<span class="tec-tag" style="--tc:' + techColor(n) + '">' + escapeHtml(n) + "</span>";
    }).join("") + "</div>";
  }

  function getMonday(d) {
    var date = new Date(d);
    var day = date.getDay();
    var diff = day === 0 ? -6 : 1 - day;
    date.setDate(date.getDate() + diff);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function addDays(d, n) { var r = new Date(d); r.setDate(r.getDate() + n); return r; }

  function isoDate(d) {
    var y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function todayIso() { return isoDate(new Date()); }

  function shortLabel(d) {
    return DIAS[(d.getDay() + 6) % 7] + " " + String(d.getDate()).padStart(2, "0") + "-" + String(d.getMonth() + 1).padStart(2, "0");
  }

  function weekLabel(monday) {
    var sunday = addDays(monday, 6);
    var sameMonth = monday.getMonth() === sunday.getMonth();
    var m1 = MESES[monday.getMonth()], m2 = MESES[sunday.getMonth()];
    return "Semana del " + monday.getDate() + (sameMonth ? "" : " " + m1) + " al " + sunday.getDate() + " de " + m2 + " " + sunday.getFullYear();
  }

  function clientLocality(c) {
    if (!c) return "";
    if (c.ciudad && String(c.ciudad).trim()) {
      return c.ciudad + (c.provincia ? " (" + c.provincia + ")" : "");
    }
    if (c.cp && String(c.cp).trim()) return "CP " + c.cp;
    return "";
  }

  function toast(msg) {
    var el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.hidden = true; }, 2400);
  }

  /* ---------------- persistencia ---------------- */

  function apiGet(key) {
    return fetch(API_BASE + "?key=" + key, { headers: { Accept: "application/json" } })
      .then(function (r) { if (!r.ok) throw new Error("status " + r.status); return r.json(); });
  }

  function apiSet(key, value) {
    fetch(API_BASE + "?key=" + key, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value)
    }).catch(function () {});
  }

  function loadLocal() {
    try {
      var raw = localStorage.getItem(LOCAL_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
  }

  function persist() {
    var payload = { columns: state.columns, entries: state.entries, backlog: state.backlog };
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(payload)); } catch (e) {}
    apiSet("board", payload);
  }

  /* ---------------- init ---------------- */

  function init() {
    Promise.all([
      fetch("/data/data.json").then(function (r) { return r.json(); }).catch(function () { return []; }),
      apiGet("board").catch(function () { return null; }),
      fetch("/.netlify/functions/whoami").then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (res) {
      state.clients = res[0] || [];
      var remote = res[1] != null ? res[1] : loadLocal();
      state.columns = (remote && remote.columns && remote.columns.length) ? remote.columns : DEFAULT_COLUMNS.slice();
      state.entries = (remote && remote.entries) || [];
      state.backlog = (remote && remote.backlog) || [];
      state.currentUser = res[2] && res[2].username ? res[2].username : null;
      buildSkeleton();
      renderAll();
    }).catch(function (err) {
      console.error(err);
      toast("No se pudo cargar el tablero.");
    });

    initViewSwitch();
  }

  /* ---------------- vista Mapa/Tablero ---------------- */

  function initViewSwitch() {
    var btns = document.querySelectorAll(".view-switch-btn");
    btns.forEach(function (b) {
      b.addEventListener("click", function () { setView(b.dataset.view); });
    });
    setView("tablero");
  }

  function setView(view) {
    document.querySelectorAll(".view-switch-btn").forEach(function (b) {
      b.classList.toggle("active", b.dataset.view === view);
    });
    document.getElementById("view-tablero").hidden = view !== "tablero";
    document.getElementById("view-mapa").hidden = view !== "mapa";
    var searchWrap = document.getElementById("mapa-search-wrap");
    if (searchWrap) searchWrap.style.display = view === "mapa" ? "" : "none";
    if (view === "mapa") {
      // El mapa de Leaflet se inicializa aunque esté oculto; al mostrarlo
      // disparamos "resize" para que recalcule su tamaño (trackResize por
      // defecto llama a invalidateSize solo).
      setTimeout(function () { window.dispatchEvent(new Event("resize")); }, 30);
    }
  }

  /* ---------------- render ---------------- */

  function buildSkeleton() {
    var root = document.getElementById("board-root");
    root.innerHTML =
      '<div class="board-print-header">' +
      '<img src="/icons/logo-original.png" alt=""><div><strong>Tablero de control</strong><span id="board-print-week"></span></div>' +
      "</div>" +
      '<div class="board-toolbar">' +
      '<div class="board-week-nav">' +
      '<button id="board-prev" class="btn-icon-only-alt" aria-label="Semana anterior">&lsaquo;</button>' +
      '<div id="board-week-label" class="board-week-label"></div>' +
      '<button id="board-next" class="btn-icon-only-alt" aria-label="Semana siguiente">&rsaquo;</button>' +
      '<button id="board-today" class="btn-secondary btn-small">Hoy</button>' +
      "</div>" +
      '<div class="board-toolbar-actions">' +
      '<input id="board-search" type="search" placeholder="Buscar cliente, técnico, localidad…">' +
      '<div id="board-tech-filter" class="chip-group"></div>' +
      '<button id="board-add-col" class="btn-secondary btn-small">+ Columna</button>' +
      '<button id="board-print" class="btn-primary btn-small">🖨️ Imprimir semana</button>' +
      "</div>" +
      "</div>" +
      '<div class="board-grid" id="board-grid"></div>' +
      '<div id="board-print-table"></div>' +
      '<div class="board-backlog">' +
      '<h3>Pendientes <span class="board-backlog-hint">sin fecha asignada</span></h3>' +
      '<div class="board-backlog-table" id="board-backlog-table"></div>' +
      '<button id="board-backlog-add" class="btn-secondary btn-small">+ Añadir pendiente</button>' +
      "</div>" +
      '<datalist id="board-tech-list">' + KNOWN_TECHS.map(function (t) { return '<option value="' + t + '">'; }).join("") + "</datalist>";

    document.getElementById("board-prev").addEventListener("click", function () { state.weekStart = addDays(state.weekStart, -7); renderAll(); });
    document.getElementById("board-next").addEventListener("click", function () { state.weekStart = addDays(state.weekStart, 7); renderAll(); });
    document.getElementById("board-today").addEventListener("click", function () { state.weekStart = getMonday(new Date()); renderAll(); });
    document.getElementById("board-add-col").addEventListener("click", addColumn);
    document.getElementById("board-print").addEventListener("click", printWeek);
    document.getElementById("board-backlog-add").addEventListener("click", function () { openBacklogModal(null); });

    var search = document.getElementById("board-search");
    var deb;
    search.addEventListener("input", function () {
      clearTimeout(deb);
      deb = setTimeout(function () { state.searchTerm = normalize(search.value); applyFilters(); }, 120);
    });
  }

  function renderAll() {
    document.getElementById("board-week-label").textContent = weekLabel(state.weekStart);
    document.getElementById("board-print-week").textContent = weekLabel(state.weekStart);
    renderTechFilter();
    renderGrid();
    renderBacklog();
    applyFilters();
  }

  function renderTechFilter() {
    var used = new Set();
    state.entries.forEach(function (e) {
      String(e.tecnicos || "").split(",").forEach(function (t) { t = t.trim(); if (t) used.add(t); });
    });
    KNOWN_TECHS.forEach(function (t) { used.add(t); });
    var box = document.getElementById("board-tech-filter");
    box.innerHTML = "";
    Array.from(used).sort().forEach(function (t) {
      var chip = document.createElement("div");
      chip.className = "chip chip-tiny" + (state.techFilter.has(t) ? " active" : "");
      chip.innerHTML = '<span class="dot" style="background:' + techColor(t) + '"></span>' + escapeHtml(t);
      chip.addEventListener("click", function () {
        if (state.techFilter.has(t)) state.techFilter.delete(t); else state.techFilter.add(t);
        chip.classList.toggle("active");
        applyFilters();
      });
      box.appendChild(chip);
    });
  }

  function renderGrid() {
    var grid = document.getElementById("board-grid");
    var cols = state.columns;
    grid.style.gridTemplateColumns = "96px repeat(" + cols.length + ", minmax(190px, 1fr))";
    grid.innerHTML = "";

    // fila de cabecera
    var spacer = document.createElement("div");
    spacer.className = "board-head-cell board-head-spacer";
    grid.appendChild(spacer);
    cols.forEach(function (col) {
      var h = document.createElement("div");
      h.className = "board-head-cell";
      h.innerHTML = '<span class="board-col-name">' + escapeHtml(col.nombre) + '</span>' +
        '<span class="board-col-actions">' +
        '<button class="board-col-btn" data-act="rename" data-col="' + col.id + '" title="Renombrar">✎</button>' +
        '<button class="board-col-btn" data-act="del" data-col="' + col.id + '" title="Eliminar columna">×</button>' +
        "</span>";
      grid.appendChild(h);
    });

    for (var i = 0; i < 7; i++) {
      var date = addDays(state.weekStart, i);
      var iso = isoDate(date);
      var isToday = iso === todayIso();
      var label = document.createElement("div");
      label.className = "board-day-label" + (isToday ? " is-today" : "");
      label.innerHTML = shortLabel(date).replace(" ", "<br>");
      grid.appendChild(label);

      cols.forEach(function (col) {
        var cell = document.createElement("div");
        cell.className = "board-day-cell" + (isToday ? " is-today" : "");
        cell.dataset.date = iso;
        cell.dataset.col = col.id;

        var entries = state.entries.filter(function (e) { return e.date === iso && e.colId === col.id; });
        entries.forEach(function (e) { cell.appendChild(renderCard(e)); });

        var addBtn = document.createElement("button");
        addBtn.className = "board-add-card";
        addBtn.textContent = "+ añadir";
        addBtn.addEventListener("click", function () { openEntryModal({ date: iso, colId: col.id }); });
        cell.appendChild(addBtn);

        grid.appendChild(cell);
      });
    }

    grid.querySelectorAll('[data-act="rename"]').forEach(function (b) {
      b.addEventListener("click", function () { renameColumn(b.dataset.col); });
    });
    grid.querySelectorAll('[data-act="del"]').forEach(function (b) {
      b.addEventListener("click", function () { deleteColumn(b.dataset.col); });
    });
  }

  function renderCard(entry) {
    var card = document.createElement("div");
    card.className = "board-card" + (entry.hecho ? " is-done" : "");
    card.dataset.id = entry.id;
    var searchBlob = normalize([entry.cliente, entry.localidad, entry.tecnicos, entry.observacion].join(" "));
    card.dataset.search = searchBlob;
    card.dataset.tecnicos = normalize(entry.tecnicos || "");

    card.innerHTML =
      '<div class="bc-top">' +
      '<label class="bc-check" title="Marcar como hecho"><input type="checkbox" ' + (entry.hecho ? "checked" : "") + "></label>" +
      '<div class="bc-client">' + escapeHtml(entry.cliente || "(sin cliente)") + "</div>" +
      '<button class="bc-del" title="Eliminar">×</button>' +
      "</div>" +
      (entry.localidad ? '<div class="bc-loc">' + escapeHtml(entry.localidad) + "</div>" : "") +
      techTags(entry.tecnicos) +
      (entry.observacion ? '<div class="bc-obs">' + escapeHtml(entry.observacion) + "</div>" : "") +
      (entry.nota ? '<div class="bc-nota">' + escapeHtml(entry.nota) + "</div>" : "");

    card.querySelector(".bc-check input").addEventListener("click", function (e) {
      e.stopPropagation();
      entry.hecho = !entry.hecho;
      persist();
      renderAll();
    });
    card.querySelector(".bc-del").addEventListener("click", function (e) {
      e.stopPropagation();
      if (!confirm("¿Eliminar esta entrada del tablero?")) return;
      state.entries = state.entries.filter(function (x) { return x.id !== entry.id; });
      persist();
      renderAll();
    });
    card.addEventListener("click", function () { openEntryModal({ entry: entry }); });
    return card;
  }

  function renderBacklog() {
    var box = document.getElementById("board-backlog-table");
    if (!state.backlog.length) {
      box.innerHTML = '<div class="board-backlog-empty">Sin pendientes sueltos. Usa "+ Añadir pendiente" para apuntar algo sin fecha todavía.</div>';
      return;
    }
    box.innerHTML = "";
    var head = document.createElement("div");
    head.className = "board-backlog-row board-backlog-head";
    head.innerHTML = "<div></div><div>Localidad</div><div>Cliente</div><div>Observación</div><div></div>";
    box.appendChild(head);

    state.backlog.forEach(function (item) {
      var row = document.createElement("div");
      row.className = "board-backlog-row" + (item.hecho ? " is-done" : "");
      row.dataset.search = normalize([item.cliente, item.localidad, item.observacion].join(" "));
      row.innerHTML =
        '<label class="bc-check"><input type="checkbox" ' + (item.hecho ? "checked" : "") + "></label>" +
        '<div>' + escapeHtml(item.localidad || "") + "</div>" +
        '<div>' + escapeHtml(item.cliente || "") + "</div>" +
        '<div>' + escapeHtml(item.observacion || "") + "</div>" +
        '<div class="board-backlog-actions"><button class="btn-secondary btn-tiny" data-act="assign">Asignar a semana</button><button class="bc-del" data-act="del" title="Eliminar">×</button></div>';

      row.querySelector('input[type=checkbox]').addEventListener("click", function () {
        item.hecho = !item.hecho; persist(); renderBacklog();
      });
      row.querySelector('[data-act="assign"]').addEventListener("click", function () { assignBacklogToWeek(item); });
      row.querySelector('[data-act="del"]').addEventListener("click", function () {
        if (!confirm("¿Eliminar este pendiente?")) return;
        state.backlog = state.backlog.filter(function (x) { return x.id !== item.id; });
        persist(); renderBacklog();
      });
      row.addEventListener("click", function (e) {
        if (e.target.closest("button") || e.target.closest("label")) return;
        openBacklogModal(item);
      });
      box.appendChild(row);
    });
  }

  function applyFilters() {
    var term = state.searchTerm;
    var techs = state.techFilter;
    document.querySelectorAll(".board-card").forEach(function (card) {
      var matchesText = !term || card.dataset.search.indexOf(term) !== -1;
      var matchesTech = !techs.size || Array.from(techs).some(function (t) { return card.dataset.tecnicos.indexOf(normalize(t)) !== -1; });
      card.style.display = matchesText && matchesTech ? "" : "none";
    });
    document.querySelectorAll(".board-backlog-row:not(.board-backlog-head)").forEach(function (row) {
      var matches = !term || row.dataset.search.indexOf(term) !== -1;
      row.style.display = matches ? "" : "none";
    });
  }

  /* ---------------- columnas ---------------- */

  function addColumn() {
    var name = prompt("Nombre de la nueva columna (zona/grupo):");
    if (!name || !name.trim()) return;
    state.columns.push({ id: uid(), nombre: name.trim() });
    persist();
    renderAll();
  }

  function renameColumn(id) {
    var col = state.columns.find(function (c) { return c.id === id; });
    if (!col) return;
    var name = prompt("Nuevo nombre para la columna:", col.nombre);
    if (!name || !name.trim()) return;
    col.nombre = name.trim();
    persist();
    renderAll();
  }

  function deleteColumn(id) {
    var count = state.entries.filter(function (e) { return e.colId === id; }).length;
    var msg = count ? "Esta columna tiene " + count + " entrada(s). ¿Eliminarla igualmente? Se borrarán también sus entradas." : "¿Eliminar esta columna?";
    if (!confirm(msg)) return;
    state.columns = state.columns.filter(function (c) { return c.id !== id; });
    state.entries = state.entries.filter(function (e) { return e.colId !== id; });
    persist();
    renderAll();
  }

  /* ---------------- autocompletar cliente ---------------- */

  function attachClientAutocomplete(input, suggestBox, onPick) {
    input.addEventListener("input", function () {
      var term = normalize(input.value);
      suggestBox.innerHTML = "";
      if (term.length < 2) { suggestBox.hidden = true; return; }
      var matches = state.clients.filter(function (c) { return normalize(c.nombre).indexOf(term) !== -1; }).slice(0, 8);
      if (!matches.length) { suggestBox.hidden = true; return; }
      matches.forEach(function (c) {
        var opt = document.createElement("div");
        opt.className = "board-suggest-item";
        var loc = clientLocality(c);
        opt.innerHTML = "<strong>" + escapeHtml(c.nombre) + "</strong>" + (loc ? '<span>' + escapeHtml(loc) + "</span>" : "");
        opt.addEventListener("mousedown", function (e) {
          e.preventDefault();
          onPick(c);
          suggestBox.hidden = true;
        });
        suggestBox.appendChild(opt);
      });
      suggestBox.hidden = false;
    });
    input.addEventListener("blur", function () { setTimeout(function () { suggestBox.hidden = true; }, 150); });
  }

  /* ---------------- modal: entrada del tablero ---------------- */

  function openEntryModal(ctx) {
    var entry = ctx.entry || null;
    var pre = entry || ctx.prefill || {};
    var date = entry ? entry.date : ctx.date;
    var colId = entry ? entry.colId : ctx.colId;
    state.modalCtx = { entry: entry, backlogSourceId: ctx.backlogSourceId || null };

    var colOptions = state.columns.map(function (c) {
      return '<option value="' + c.id + '"' + (c.id === colId ? " selected" : "") + ">" + escapeHtml(c.nombre) + "</option>";
    }).join("");

    var box = document.getElementById("modal-box");
    box.innerHTML =
      "<h3>" + (entry ? "Editar entrada" : "Nueva entrada") + "</h3>" +
      '<div class="board-form-row"><label>Día</label><input type="date" id="bf-date" value="' + (date || todayIso()) + '"></div>' +
      '<div class="board-form-row"><label>Columna</label><select id="bf-col">' + colOptions + "</select></div>" +
      '<div class="board-form-row board-autocomplete"><label>Cliente</label>' +
      '<input type="text" id="bf-cliente" placeholder="Escribe 2-3 letras o el nombre libre…" value="' + escapeHtml(pre.cliente || "") + '" autocomplete="off">' +
      '<div class="board-suggest-list" id="bf-suggest" hidden></div></div>' +
      '<div class="board-form-row"><label>Localidad</label><input type="text" id="bf-loc" placeholder="Ciudad (provincia) o CP" value="' + escapeHtml(pre.localidad || "") + '"></div>' +
      '<div class="board-form-row"><label>Técnico(s)</label><input type="text" id="bf-tec" list="board-tech-list" placeholder="Ej: Juanfran, Cristian" value="' + escapeHtml(pre.tecnicos || "") + '"></div>' +
      '<div class="board-form-row"><label>Observación</label><textarea id="bf-obs" placeholder="Qué hay que hacer…">' + escapeHtml(pre.observacion || "") + "</textarea></div>" +
      '<div class="board-form-row"><label>Nota extra <span class="board-form-hint">(opcional, para después)</span></label><textarea id="bf-nota" placeholder="Resultado, incidencias, seguimiento…">' + escapeHtml(pre.nota || "") + "</textarea></div>" +
      '<div class="board-form-row checkbox-row"><label><input type="checkbox" id="bf-hecho" ' + (pre.hecho ? "checked" : "") + "> Hecho</label></div>" +
      '<div class="modal-actions">' +
      (entry ? '<button id="bf-delete" class="btn-secondary" style="margin-right:auto">Eliminar</button>' : "") +
      '<button id="bf-cancel" class="btn-secondary">Cancelar</button>' +
      '<button id="bf-save" class="btn-primary">Guardar</button>' +
      "</div>";

    var clienteId = pre.clienteId != null ? pre.clienteId : null;
    attachClientAutocomplete(document.getElementById("bf-cliente"), document.getElementById("bf-suggest"), function (c) {
      document.getElementById("bf-cliente").value = c.nombre;
      document.getElementById("bf-loc").value = clientLocality(c);
      clienteId = c.id;
    });
    document.getElementById("bf-cliente").addEventListener("input", function () { clienteId = null; });

    document.getElementById("bf-cancel").addEventListener("click", closeModal);
    if (entry) {
      document.getElementById("bf-delete").addEventListener("click", function () {
        if (!confirm("¿Eliminar esta entrada?")) return;
        state.entries = state.entries.filter(function (x) { return x.id !== entry.id; });
        persist(); closeModal(); renderAll();
      });
    }
    document.getElementById("bf-save").addEventListener("click", function () {
      var data = {
        date: document.getElementById("bf-date").value || todayIso(),
        colId: document.getElementById("bf-col").value,
        clienteId: clienteId,
        cliente: document.getElementById("bf-cliente").value.trim(),
        localidad: document.getElementById("bf-loc").value.trim(),
        tecnicos: document.getElementById("bf-tec").value.trim(),
        observacion: document.getElementById("bf-obs").value.trim(),
        nota: document.getElementById("bf-nota").value.trim(),
        hecho: document.getElementById("bf-hecho").checked
      };
      if (!data.cliente && !data.observacion) { toast("Escribe al menos un cliente o una observación."); return; }
      if (entry) {
        Object.assign(entry, data);
      } else {
        data.id = uid();
        data.creadoPor = state.currentUser;
        data.ts = Date.now();
        state.entries.push(data);
      }
      if (state.modalCtx.backlogSourceId) {
        state.backlog = state.backlog.filter(function (x) { return x.id !== state.modalCtx.backlogSourceId; });
      }
      persist();
      closeModal();
      renderAll();
    });

    document.getElementById("modal-backdrop").hidden = false;
  }

  /* ---------------- modal: pendiente (backlog) ---------------- */

  function openBacklogModal(item) {
    var box = document.getElementById("modal-box");
    box.innerHTML =
      "<h3>" + (item ? "Editar pendiente" : "Nuevo pendiente") + "</h3>" +
      '<div class="board-form-row board-autocomplete"><label>Cliente</label>' +
      '<input type="text" id="pf-cliente" placeholder="Escribe 2-3 letras o el nombre libre…" value="' + escapeHtml(item ? item.cliente : "") + '" autocomplete="off">' +
      '<div class="board-suggest-list" id="pf-suggest" hidden></div></div>' +
      '<div class="board-form-row"><label>Localidad</label><input type="text" id="pf-loc" placeholder="Ciudad (provincia) o CP" value="' + escapeHtml(item ? item.localidad : "") + '"></div>' +
      '<div class="board-form-row"><label>Observación</label><textarea id="pf-obs" placeholder="Qué hay pendiente…">' + escapeHtml(item ? item.observacion : "") + "</textarea></div>" +
      '<div class="modal-actions">' +
      (item ? '<button id="pf-delete" class="btn-secondary" style="margin-right:auto">Eliminar</button>' : "") +
      '<button id="pf-cancel" class="btn-secondary">Cancelar</button>' +
      '<button id="pf-save" class="btn-primary">Guardar</button>' +
      "</div>";

    var clienteId = item ? item.clienteId : null;
    attachClientAutocomplete(document.getElementById("pf-cliente"), document.getElementById("pf-suggest"), function (c) {
      document.getElementById("pf-cliente").value = c.nombre;
      document.getElementById("pf-loc").value = clientLocality(c);
      clienteId = c.id;
    });
    document.getElementById("pf-cliente").addEventListener("input", function () { clienteId = null; });

    document.getElementById("pf-cancel").addEventListener("click", closeModal);
    if (item) {
      document.getElementById("pf-delete").addEventListener("click", function () {
        if (!confirm("¿Eliminar este pendiente?")) return;
        state.backlog = state.backlog.filter(function (x) { return x.id !== item.id; });
        persist(); closeModal(); renderBacklog();
      });
    }
    document.getElementById("pf-save").addEventListener("click", function () {
      var data = {
        clienteId: clienteId,
        cliente: document.getElementById("pf-cliente").value.trim(),
        localidad: document.getElementById("pf-loc").value.trim(),
        observacion: document.getElementById("pf-obs").value.trim()
      };
      if (!data.cliente && !data.observacion) { toast("Escribe al menos un cliente o una observación."); return; }
      if (item) {
        Object.assign(item, data);
      } else {
        data.id = uid(); data.hecho = false; data.ts = Date.now();
        state.backlog.push(data);
      }
      persist();
      closeModal();
      renderBacklog();
    });

    document.getElementById("modal-backdrop").hidden = false;
  }

  function assignBacklogToWeek(item) {
    openEntryModal({
      date: isoDate(state.weekStart),
      colId: state.columns[0] ? state.columns[0].id : null,
      backlogSourceId: item.id,
      prefill: { cliente: item.cliente, localidad: item.localidad, observacion: item.observacion, clienteId: item.clienteId }
    });
  }

  function closeModal() {
    document.getElementById("modal-backdrop").hidden = true;
    document.getElementById("modal-box").innerHTML = "";
    state.modalCtx = null;
  }

  document.addEventListener("click", function (e) {
    if (e.target && e.target.id === "modal-backdrop") closeModal();
  });

  /* ---------------- imprimir ---------------- */

  function entryLineHtml(e) {
    var bits = [];
    bits.push("<strong>" + escapeHtml(e.cliente || "(sin cliente)") + "</strong>");
    if (e.localidad) bits.push(escapeHtml(e.localidad));
    if (e.tecnicos) {
      var names = e.tecnicos.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
      bits.push(names.map(function (n) {
        return '<span style="color:' + techColor(n) + '">' + escapeHtml(n) + "</span>";
      }).join(", "));
    }
    if (e.observacion) bits.push(escapeHtml(e.observacion));
    return '<div class="ppt-entry' + (e.hecho ? " ppt-done" : "") + '">' +
      '<span class="ppt-check">' + (e.hecho ? "☑" : "☐") + "</span> " +
      bits.join(" — ") +
      "</div>";
  }

  function renderPrintTable() {
    var box = document.getElementById("board-print-table");
    var cols = state.columns;
    var head = "<tr><th></th>" + cols.map(function (c) { return "<th>" + escapeHtml(c.nombre) + "</th>"; }).join("") + "</tr>";

    var rows = "";
    for (var i = 0; i < 7; i++) {
      var date = addDays(state.weekStart, i);
      var iso = isoDate(date);
      rows += "<tr><td class=\"ppt-day\">" + shortLabel(date).replace(" ", "<br>") + "</td>";
      cols.forEach(function (col) {
        var entries = state.entries.filter(function (e) { return e.date === iso && e.colId === col.id; });
        rows += "<td>" + entries.map(entryLineHtml).join("") + "</td>";
      });
      rows += "</tr>";
    }

    box.innerHTML = '<table class="board-print-table"><thead>' + head + "</thead><tbody>" + rows + "</tbody></table>";
  }

  function printWeek() {
    renderPrintTable();
    window.print();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
