/* Pizarra — v3
   Lienzo libre para apuntar ideas: notas de texto, flechas que unen notas
   y pegatinas (estrella, aviso…). Las flechas se dibujan en una capa SVG
   por DEBAJO de las notas y se recortan en el borde de cada nota, así que
   nunca tapan lo escrito.
   Se guarda igual que el tablero: localStorage al instante + almacén
   compartido de Netlify (clave "pizarra"), "última escritura gana". */

(function () {
  "use strict";

  var API_BASE = "/.netlify/functions/store";
  var LOCAL_KEY = "dp_pizarra_v1";
  var CANVAS_W = 4000, CANVAS_H = 3000;

  // bg = fondo de la nota, fg = borde de la nota y color de la flecha
  var COLORS = [
    { nombre: "Blanco", bg: "#FFFFFF", fg: "#374151" },
    { nombre: "Amarillo", bg: "#FEF3C7", fg: "#D97706" },
    { nombre: "Rojo", bg: "#FEE2E2", fg: "#DC2626" },
    { nombre: "Verde", bg: "#DCFCE7", fg: "#16A34A" },
    { nombre: "Azul", bg: "#DBEAFE", fg: "#2563EB" },
    { nombre: "Morado", bg: "#EDE9FE", fg: "#7C3AED" },
    { nombre: "Rosa", bg: "#FCE7F3", fg: "#DB2777" },
    { nombre: "Gris", bg: "#E5E7EB", fg: "#4B5563" }
  ];
  var ICONS = ["⭐", "❗", "⚠️", "✅", "❌", "🔥", "📌", "❓", "🔧", "📞"];
  var TEXT_SIZES = [13, 16, 22, 30];
  var STICKER_SIZES = [26, 38, 54, 72];

  var st = {
    built: false,
    nodes: [],
    edges: [],
    selected: null,      // { type: "node"|"edge", id }
    color: 1,            // color activo para lo nuevo
    connectMode: false,
    connectFrom: null,
    editingId: null,
    history: [],
    saveTimer: null
  };

  var els = {};

  /* ---------------- utils ---------------- */

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function byId(list, id) { return list.find(function (x) { return x.id === id; }); }
  function color(i) { return COLORS[i] || COLORS[0]; }

  function toast(msg) {
    var el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.hidden = true; }, 2400);
  }

  /* ---------------- persistencia ---------------- */

  function snapshot() { return JSON.stringify({ nodes: st.nodes, edges: st.edges }); }

  function pushHistory() {
    st.history.push(snapshot());
    if (st.history.length > 60) st.history.shift();
  }

  function undo() {
    var prev = st.history.pop();
    if (!prev) { toast("No hay nada que deshacer."); return; }
    var data = JSON.parse(prev);
    st.nodes = data.nodes; st.edges = data.edges;
    st.selected = null;
    save(); renderAll();
  }

  function save() {
    var payload = { nodes: st.nodes, edges: st.edges };
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(payload)); } catch (e) {}
    clearTimeout(st.saveTimer);
    st.saveTimer = setTimeout(function () {
      fetch(API_BASE + "?key=pizarra", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).catch(function () {});
    }, 700);
  }

  function load() {
    return fetch(API_BASE + "?key=pizarra", { headers: { Accept: "application/json" } })
      .then(function (r) { if (!r.ok) throw new Error("status " + r.status); return r.json(); })
      .catch(function () {
        try { var raw = localStorage.getItem(LOCAL_KEY); if (raw) return JSON.parse(raw); } catch (e) {}
        return null;
      });
  }

  /* ---------------- construcción ---------------- */

  function build() {
    var root = document.getElementById("pizarra-root");
    root.innerHTML =
      '<div class="pz-toolbar">' +
      '<button class="btn-primary btn-small" id="pz-add">+ Texto</button>' +
      '<button class="btn-secondary btn-small pz-toggle" id="pz-connect" title="Pulsa una nota y después otra para unirlas">➜ Unir con flecha</button>' +
      '<span class="pz-sep"></span>' +
      '<span class="pz-label">Color</span><div class="pz-colors" id="pz-colors">' +
      COLORS.map(function (c, i) {
        return '<button class="pz-color" data-i="' + i + '" title="' + c.nombre + '" style="background:' + c.bg + ';border-color:' + c.fg + '"></button>';
      }).join("") + "</div>" +
      '<span class="pz-sep"></span>' +
      '<span class="pz-label">Iconos</span><div class="pz-icons" id="pz-icons">' +
      ICONS.map(function (ic) { return '<button class="pz-icon" data-icon="' + ic + '">' + ic + "</button>"; }).join("") + "</div>" +
      '<span class="pz-sep"></span>' +
      '<button class="btn-secondary btn-small" id="pz-smaller" title="Más pequeño">A−</button>' +
      '<button class="btn-secondary btn-small" id="pz-bigger" title="Más grande">A+</button>' +
      '<button class="btn-secondary btn-small" id="pz-del" title="Borrar lo seleccionado (Supr)">🗑 Borrar</button>' +
      '<button class="btn-secondary btn-small" id="pz-undo" title="Deshacer (Ctrl+Z)">↶ Deshacer</button>' +
      "</div>" +
      '<div class="pz-hint">Doble clic en el fondo = nota nueva · doble clic en una nota = escribir · arrastra el punto <span class="pz-hint-dot"></span> de una nota hasta otra para unirlas · arrastra el fondo para moverte · con algo seleccionado, un icono se le pega como insignia</div>' +
      '<div class="pz-viewport" id="pz-viewport">' +
      '<div class="pz-canvas" id="pz-canvas" style="width:' + CANVAS_W + "px;height:" + CANVAS_H + 'px">' +
      '<svg class="pz-edges" id="pz-edges" width="' + CANVAS_W + '" height="' + CANVAS_H + '"></svg>' +
      '<div class="pz-nodes" id="pz-nodes"></div>' +
      "</div></div>";

    els.viewport = document.getElementById("pz-viewport");
    els.canvas = document.getElementById("pz-canvas");
    els.svg = document.getElementById("pz-edges");
    els.nodes = document.getElementById("pz-nodes");

    document.getElementById("pz-add").addEventListener("click", function () {
      var p = visibleCenter();
      addNote(p.x - 80, p.y - 20, true);
    });
    document.getElementById("pz-connect").addEventListener("click", function () { setConnectMode(!st.connectMode); });
    document.getElementById("pz-colors").addEventListener("click", function (e) {
      var b = e.target.closest(".pz-color"); if (b) applyColor(+b.dataset.i);
    });
    document.getElementById("pz-icons").addEventListener("click", function (e) {
      var b = e.target.closest(".pz-icon"); if (b) applyIcon(b.dataset.icon);
    });
    document.getElementById("pz-smaller").addEventListener("click", function () { resizeSelected(-1); });
    document.getElementById("pz-bigger").addEventListener("click", function () { resizeSelected(1); });
    document.getElementById("pz-del").addEventListener("click", deleteSelected);
    document.getElementById("pz-undo").addEventListener("click", undo);

    els.canvas.addEventListener("pointerdown", onPointerDown);
    els.canvas.addEventListener("dblclick", onDblClick);
    document.addEventListener("keydown", onKey);

    st.built = true;
  }

  function visibleCenter() {
    var v = els.viewport;
    return { x: v.scrollLeft + v.clientWidth / 2, y: v.scrollTop + v.clientHeight / 2 };
  }

  function canvasPoint(e) {
    var r = els.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /* ---------------- render ---------------- */

  function renderAll() {
    renderNodes();
    renderEdges();
    renderToolbarState();
  }

  function renderNodes() {
    els.nodes.innerHTML = "";
    st.nodes.forEach(function (n) { els.nodes.appendChild(renderNode(n)); });
  }

  function renderNode(n) {
    var el = document.createElement("div");
    var c = color(n.color);
    var sel = st.selected && st.selected.type === "node" && st.selected.id === n.id;
    el.className = "pz-node pz-" + n.kind + (sel ? " is-selected" : "") + (st.connectFrom === n.id ? " is-connect-from" : "");
    el.dataset.id = n.id;
    el.style.left = n.x + "px";
    el.style.top = n.y + "px";
    if (n.kind === "sticker") {
      el.style.fontSize = STICKER_SIZES[n.size] + "px";
      el.textContent = n.icon;
    } else {
      el.style.background = c.bg;
      el.style.borderColor = c.fg;
      el.style.fontSize = TEXT_SIZES[n.size] + "px";
      var text = document.createElement("div");
      text.className = "pz-text";
      text.textContent = n.text;
      el.appendChild(text);
      if (n.icon) {
        var badge = document.createElement("span");
        badge.className = "pz-badge";
        badge.textContent = n.icon;
        el.appendChild(badge);
      }
    }
    var handle = document.createElement("span");
    handle.className = "pz-handle";
    handle.title = "Arrastra hasta otra nota para unirlas con una flecha";
    el.appendChild(handle);
    return el;
  }

  function nodeRect(id) {
    var el = els.nodes.querySelector('.pz-node[data-id="' + id + '"]');
    var n = byId(st.nodes, id);
    if (!el || !n) return null;
    return { x: n.x, y: n.y, w: el.offsetWidth, h: el.offsetHeight };
  }

  // Punto donde la recta desde el centro sale por el borde del rectángulo (+ margen).
  function edgePoint(r, dx, dy, pad) {
    var hw = r.w / 2 + pad, hh = r.h / 2 + pad;
    var t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
    return { x: r.x + r.w / 2 + dx * t, y: r.y + r.h / 2 + dy * t };
  }

  function arrowSvg(a, b, stroke, extra) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len < 4) return "";
    var ux = dx / len, uy = dy / len, head = 12, wing = 6;
    var bx = b.x - ux * head, by = b.y - uy * head;
    var p1 = (bx - uy * wing) + "," + (by + ux * wing);
    var p2 = (bx + uy * wing) + "," + (by - ux * wing);
    return '<line x1="' + a.x + '" y1="' + a.y + '" x2="' + bx + '" y2="' + by + '" stroke="' + stroke + '" stroke-width="2.5" stroke-linecap="round"' + (extra || "") + "/>" +
      '<polygon points="' + b.x + "," + b.y + " " + p1 + " " + p2 + '" fill="' + stroke + '"/>';
  }

  function renderEdges() {
    var html = "";
    st.edges.forEach(function (ed) {
      var ra = nodeRect(ed.from), rb = nodeRect(ed.to);
      if (!ra || !rb) return;
      var dx = (rb.x + rb.w / 2) - (ra.x + ra.w / 2), dy = (rb.y + rb.h / 2) - (ra.y + ra.h / 2);
      if (!dx && !dy) return;
      var a = edgePoint(ra, dx, dy, 6), b = edgePoint(rb, -dx, -dy, 6);
      // si las notas se solapan no hay hueco para la flecha
      if ((b.x - a.x) * dx + (b.y - a.y) * dy <= 0) return;
      var sel = st.selected && st.selected.type === "edge" && st.selected.id === ed.id;
      var stroke = color(ed.color).fg;
      html += '<g class="pz-edge' + (sel ? " is-selected" : "") + '" data-id="' + ed.id + '">' +
        (sel ? '<line x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '" stroke="' + stroke + '" stroke-opacity=".25" stroke-width="10" stroke-linecap="round"/>' : "") +
        arrowSvg(a, b, stroke) +
        '<line class="pz-edge-hit" data-id="' + ed.id + '" x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '"/>' +
        "</g>";
    });
    if (st.tempLine) html += '<g class="pz-temp">' + arrowSvg(st.tempLine.a, st.tempLine.b, "#9CA3AF", ' stroke-dasharray="6 5"') + "</g>";
    els.svg.innerHTML = html;
  }

  function renderToolbarState() {
    document.getElementById("pz-connect").classList.toggle("active", st.connectMode);
    var cur = st.color;
    var s = selectedObj();
    if (s && s.color != null) cur = s.color;
    document.querySelectorAll(".pz-color").forEach(function (b) { b.classList.toggle("active", +b.dataset.i === cur); });
    els.canvas.classList.toggle("is-connecting", st.connectMode);
  }

  function selectedObj() {
    if (!st.selected) return null;
    return st.selected.type === "node" ? byId(st.nodes, st.selected.id) : byId(st.edges, st.selected.id);
  }

  function select(type, id) {
    st.selected = type ? { type: type, id: id } : null;
    renderAll();
  }

  /* ---------------- acciones ---------------- */

  function addNote(x, y, edit) {
    pushHistory();
    var n = { id: uid(), kind: "note", x: Math.round(x), y: Math.round(y), text: "", color: st.color, size: 1, icon: "" };
    st.nodes.push(n);
    st.selected = { type: "node", id: n.id };
    save(); renderAll();
    if (edit) startEdit(n.id);
    return n;
  }

  function addEdge(from, to) {
    if (from === to) return;
    var dup = st.edges.some(function (e) { return e.from === from && e.to === to; });
    if (dup) { toast("Esas dos ya están unidas."); return; }
    pushHistory();
    var ed = { id: uid(), from: from, to: to, color: st.color === 0 ? 7 : st.color };
    st.edges.push(ed);
    st.selected = { type: "edge", id: ed.id };
    save(); renderAll();
  }

  function applyColor(i) {
    st.color = i;
    var o = selectedObj();
    if (o) { pushHistory(); o.color = i; save(); }
    renderAll();
  }

  function applyIcon(icon) {
    var o = selectedObj();
    if (o && st.selected.type === "node") {
      pushHistory();
      if (o.kind === "sticker") o.icon = icon;
      else o.icon = o.icon === icon ? "" : icon;
      save(); renderAll();
      return;
    }
    pushHistory();
    var p = visibleCenter();
    var n = { id: uid(), kind: "sticker", x: Math.round(p.x - 20), y: Math.round(p.y - 20), text: "", color: 0, size: 1, icon: icon };
    st.nodes.push(n);
    st.selected = { type: "node", id: n.id };
    save(); renderAll();
  }

  function resizeSelected(delta) {
    var o = selectedObj();
    if (!o || st.selected.type !== "node") { toast("Selecciona primero una nota o un icono."); return; }
    var next = Math.max(0, Math.min(TEXT_SIZES.length - 1, o.size + delta));
    if (next === o.size) return;
    pushHistory();
    o.size = next;
    save(); renderAll();
  }

  function deleteSelected() {
    if (!st.selected) { toast("Selecciona primero lo que quieras borrar."); return; }
    pushHistory();
    var id = st.selected.id;
    if (st.selected.type === "node") {
      st.nodes = st.nodes.filter(function (n) { return n.id !== id; });
      st.edges = st.edges.filter(function (e) { return e.from !== id && e.to !== id; });
    } else {
      st.edges = st.edges.filter(function (e) { return e.id !== id; });
    }
    st.selected = null;
    save(); renderAll();
  }

  function setConnectMode(on) {
    st.connectMode = on;
    st.connectFrom = null;
    if (on) toast("Pulsa la nota de origen y después la de destino. Esc para salir.");
    renderAll();
  }

  /* ---------------- edición de texto ---------------- */

  function startEdit(id) {
    var n = byId(st.nodes, id);
    if (!n || n.kind !== "note") return;
    var el = els.nodes.querySelector('.pz-node[data-id="' + id + '"] .pz-text');
    if (!el) return;
    st.editingId = id;
    el.contentEditable = "true";
    el.parentNode.classList.add("is-editing");
    el.focus();
    var range = document.createRange();
    range.selectNodeContents(el);
    var sel = window.getSelection();
    sel.removeAllRanges(); sel.addRange(range);
    el.addEventListener("input", renderEdges);
    el.addEventListener("blur", function () { finishEdit(); }, { once: true });
  }

  function finishEdit() {
    var id = st.editingId;
    if (!id) return;
    st.editingId = null;
    var n = byId(st.nodes, id);
    var el = els.nodes.querySelector('.pz-node[data-id="' + id + '"] .pz-text');
    if (!n || !el) return;
    var text = el.innerText.replace(/\n+$/, "");
    if (!text.trim()) {
      // nota vacía: se descarta (sin dejar rastro en deshacer)
      st.nodes = st.nodes.filter(function (x) { return x.id !== id; });
      st.edges = st.edges.filter(function (e) { return e.from !== id && e.to !== id; });
      if (st.selected && st.selected.id === id) st.selected = null;
    } else if (text !== n.text) {
      pushHistory();
      n.text = text;
    }
    save(); renderAll();
  }

  /* ---------------- ratón / dedo ---------------- */

  function onPointerDown(e) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (st.editingId) {
      var editing = els.nodes.querySelector('.pz-node[data-id="' + st.editingId + '"]');
      if (editing && editing.contains(e.target)) return; // colocar el cursor dentro del texto
      document.activeElement.blur();
    }
    var handle = e.target.closest(".pz-handle");
    var nodeEl = e.target.closest(".pz-node");
    var edgeHit = e.target.closest(".pz-edge-hit");

    if (handle && nodeEl) { e.preventDefault(); startLink(e, nodeEl.dataset.id); return; }
    if (nodeEl) {
      var id = nodeEl.dataset.id;
      if (st.connectMode) {
        e.preventDefault();
        if (!st.connectFrom) { st.connectFrom = id; renderAll(); }
        else { var from = st.connectFrom; st.connectFrom = null; addEdge(from, id); }
        return;
      }
      e.preventDefault();
      if (!st.selected || st.selected.id !== id) select("node", id);
      startMove(e, id);
      return;
    }
    if (edgeHit) { e.preventDefault(); select("edge", edgeHit.dataset.id); return; }

    // fondo: deseleccionar y desplazar la pizarra
    if (st.selected || st.connectFrom) { st.connectFrom = null; select(null); }
    startPan(e);
  }

  function track(onMove, onUp) {
    function move(ev) { onMove(ev); }
    function up(ev) {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      onUp(ev);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  function startMove(e, id) {
    var n = byId(st.nodes, id);
    var el = els.nodes.querySelector('.pz-node[data-id="' + id + '"]');
    var sx = e.clientX, sy = e.clientY, ox = n.x, oy = n.y, moved = false, before = snapshot();
    track(function (ev) {
      var dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 3) return;
      moved = true;
      n.x = Math.max(0, Math.min(CANVAS_W - 40, Math.round(ox + dx)));
      n.y = Math.max(0, Math.min(CANVAS_H - 30, Math.round(oy + dy)));
      el.style.left = n.x + "px"; el.style.top = n.y + "px";
      renderEdges();
    }, function () {
      if (moved) { st.history.push(before); save(); }
    });
  }

  function startLink(e, fromId) {
    var ra = nodeRect(fromId);
    var start = { x: ra.x + ra.w / 2, y: ra.y + ra.h / 2 };
    track(function (ev) {
      var p = canvasPoint(ev);
      st.tempLine = { a: start, b: p };
      renderEdges();
    }, function (ev) {
      st.tempLine = null;
      var target = document.elementFromPoint(ev.clientX, ev.clientY);
      var nodeEl = target && target.closest ? target.closest(".pz-node") : null;
      if (nodeEl && nodeEl.dataset.id !== fromId) addEdge(fromId, nodeEl.dataset.id);
      else renderEdges();
    });
  }

  function startPan(e) {
    var v = els.viewport, sx = e.clientX, sy = e.clientY, sl = v.scrollLeft, stp = v.scrollTop;
    els.canvas.classList.add("is-panning");
    track(function (ev) {
      v.scrollLeft = sl - (ev.clientX - sx);
      v.scrollTop = stp - (ev.clientY - sy);
    }, function () { els.canvas.classList.remove("is-panning"); });
  }

  function onDblClick(e) {
    var nodeEl = e.target.closest(".pz-node");
    if (nodeEl) { startEdit(nodeEl.dataset.id); return; }
    if (e.target.closest(".pz-edge-hit")) return;
    var p = canvasPoint(e);
    addNote(p.x - 20, p.y - 16, true);
  }

  function onKey(e) {
    var view = document.getElementById("view-pizarra");
    if (!view || view.hidden) return;
    if (st.editingId) {
      if (e.key === "Escape") document.activeElement.blur();
      return;
    }
    var t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if (e.key === "Delete" || e.key === "Backspace") { if (st.selected) { e.preventDefault(); deleteSelected(); } }
    else if (e.key === "Escape") { if (st.connectMode) setConnectMode(false); else select(null); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
    else if (e.key === "Enter" && st.selected && st.selected.type === "node") { e.preventDefault(); startEdit(st.selected.id); }
  }

  /* ---------------- API pública ---------------- */

  window.DPPizarra = {
    show: function () {
      if (st.built) { renderEdges(); return; }
      build();
      load().then(function (data) {
        st.nodes = (data && data.nodes) || [];
        st.edges = (data && data.edges) || [];
        renderAll();
        // empezar viendo la zona donde hay contenido
        if (st.nodes.length) {
          var minX = Math.min.apply(null, st.nodes.map(function (n) { return n.x; }));
          var minY = Math.min.apply(null, st.nodes.map(function (n) { return n.y; }));
          els.viewport.scrollLeft = Math.max(0, minX - 60);
          els.viewport.scrollTop = Math.max(0, minY - 60);
        }
      });
    }
  };
})();
