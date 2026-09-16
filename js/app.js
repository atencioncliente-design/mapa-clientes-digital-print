/* Mapa de Clientes — Digital Print Maquinaria Gráfica
   App vanilla JS + Leaflet. Sin backend: los datos viven en data/data.json
   (generado desde el Excel) y las zonas se guardan en localStorage,
   con opción de exportar/importar para compartirlas con el equipo. */

(function () {
  "use strict";

  var CLASS_COLORS = {
    "CLIENTE": "#A6192E",
    "PROVEEDOR": "#1A1A1A",
    "CARTERA (contactada)": "#8C8C8C",
    "CARTERA (sin contacto)": "#C9C9C9",
    "SIN CLASIFICAR": "#C9C9C9",
    "GRUPO PROPIO": "#3B3B3B"
  };
  var DEFAULT_COLOR = "#A6192E";

  var ZONE_PALETTE = [
    "#A6192E", "#1A1A1A", "#2E7D32", "#1565C0", "#EF6C00",
    "#6A1B9A", "#00838F", "#AD1457", "#5D4037", "#616161"
  ];

  var PARTICIPANT_OPTIONS = ["Juanfran", "Cristian", "Ivan", "Vicente", "Traductor", "Técnico de Fábrica"];

  var state = {
    clients: [],
    zones: [],
    trips: [],
    filtered: [],
    activeClassifications: new Set(),
    zonaFiltro: "",
    provinciaFiltro: "",
    soloConMapa: false,
    searchTerm: "",
    activeClientId: null,
    drawing: false,
    drawPoints: [],
    drawPreviewLayer: null,
    drawVertexLayers: [],
    tripMode: false,
    tripSelection: new Set(),
    pickTarget: null,
    tripHighlight: null,
    manualGeo: {},
    hiddenIds: new Set(),
    currentUser: null,
    estadoFiltro: "",
    myLocation: null,
    locating: false,
    radiusMode: false,
    radiusPendingKm: 10,
    radiusFilter: null,
    tripEstadoFiltro: "",
    checkins: []
  };

  var CHECKIN_RADIUS_KM = 0.15;
  var CHECKIN_COOLDOWN_MS = 3 * 60 * 60 * 1000;

  var map, clusterGroup, markersById = {}, zonePolygons = {};
  var selectionLayerGroup, highlightLayerGroup, selectionRings = {};
  var meLocationLayerGroup, radiusLayerGroup, geoWatchId = null;

  function ringMarker(latlng, color) {
    return L.circleMarker(latlng, { radius: 16, color: color, weight: 3, fillColor: color, fillOpacity: 0.15, interactive: false });
  }

  /* ---------------- utils ---------------- */

  function normalize(s) {
    if (!s) return "";
    return s.toString().normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }

  function haversineKm(a, b) {
    var R = 6371;
    var dLat = (b[0] - a[0]) * Math.PI / 180;
    var dLon = (b[1] - a[1]) * Math.PI / 180;
    var lat1 = a[0] * Math.PI / 180, lat2 = b[0] * Math.PI / 180;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
    return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }

  function pointInPolygon(point, vs) {
    // ray casting, point = [lat,lng], vs = [[lat,lng],...]
    var x = point[1], y = point[0];
    var inside = false;
    for (var i = 0, j = vs.length - 1; i < vs.length; j = i++) {
      var xi = vs[i][1], yi = vs[i][0];
      var xj = vs[j][1], yj = vs[j][0];
      var intersect = ((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function classColor(c) { return CLASS_COLORS[c] || DEFAULT_COLOR; }

  var PROVINCE_ALIASES = [
    [/alicante|alacant/, "Alicante/Alacant"],
    [/castellon|castello/, "Castellón/Castelló"],
    [/valencia|val.ncia/, "Valencia/València"],
    [/coruna/, "A Coruña"],
    [/vizcaya|bizkaia/, "Bizkaia"],
    [/guipuzcoa|gipuzkoa|guipuzkoa/, "Gipuzkoa"],
    [/alava|araba/, "Araba/Álava"],
    [/gerona|girona/, "Girona"],
    [/lerida|lleida/, "Lleida"],
    [/orense|ourense/, "Ourense"],
    [/baleares|illes balears/, "Illes Balears"]
  ];

  // La provincia viene del Excel con variantes ("Madrid" / "Madrid (ES)" /
  // nombres dobles cooficiales...). Para el filtro las agrupamos; el texto
  // original de cada ficha no se toca en ningún otro sitio.
  function normalizeProvincia(raw) {
    if (!raw) return "";
    var s = raw.trim().replace(/\s*\([A-Z]{2}\)\s*$/, "");
    var n = normalize(s);
    for (var i = 0; i < PROVINCE_ALIASES.length; i++) {
      if (PROVINCE_ALIASES[i][0].test(n)) return PROVINCE_ALIASES[i][1];
    }
    return s;
  }

  function escapeHtml(s) {
    if (s === null || s === undefined) return "";
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function telHref(t) { return "tel:" + String(t).replace(/[^\d+]/g, ""); }

  function toast(msg) {
    var el = document.getElementById("toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.hidden = true; }, 2600);
  }

  /* ---------------- data load ----------------
     Todo se guarda en dos sitios a la vez:
     1) localStorage, al instante, para que la app responda ya y funcione
        sin conexión.
     2) el almacén compartido de Netlify (funciones + Blobs), en segundo
        plano, para que todo el equipo vea lo mismo. Si esa llamada falla
        (por ejemplo, probando en local con el .bat, donde esa API no
        existe), la app sigue funcionando solo con localStorage, como antes. */

  var API_BASE = "/.netlify/functions/store";

  function apiGet(key) {
    return fetch(API_BASE + "?key=" + key, { headers: { Accept: "application/json" } })
      .then(function (r) { if (!r.ok) throw new Error("bad status " + r.status); return r.json(); });
  }

  function apiSet(key, value) {
    fetch(API_BASE + "?key=" + key, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value)
    }).catch(function () {});
  }

  function loadZonesLocal() {
    try {
      var raw = localStorage.getItem("dp_zones_v1");
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return null;
  }

  function saveZones() {
    try { localStorage.setItem("dp_zones_v1", JSON.stringify(state.zones)); } catch (e) {}
    apiSet("zones", state.zones);
  }

  function loadTripsLocal() {
    try {
      var raw = localStorage.getItem("dp_trips_v1");
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return [];
  }

  function saveTrips() {
    try { localStorage.setItem("dp_trips_v1", JSON.stringify(state.trips)); } catch (e) {}
    apiSet("trips", state.trips);
  }

  function loadManualGeoLocal() {
    try {
      var raw = localStorage.getItem("dp_manual_geo_v1");
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return {};
  }

  function saveManualGeo() {
    try { localStorage.setItem("dp_manual_geo_v1", JSON.stringify(state.manualGeo)); } catch (e) {}
    apiSet("manualGeo", state.manualGeo);
  }

  function loadHiddenLocal() {
    try {
      var raw = localStorage.getItem("dp_hidden_v1");
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return [];
  }

  function saveHidden() {
    try { localStorage.setItem("dp_hidden_v1", JSON.stringify(Array.from(state.hiddenIds))); } catch (e) {}
    apiSet("hidden", Array.from(state.hiddenIds));
  }

  function loadCheckinsLocal() {
    try {
      var raw = localStorage.getItem("dp_checkins_v1");
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return [];
  }

  function saveCheckins() {
    try { localStorage.setItem("dp_checkins_v1", JSON.stringify(state.checkins)); } catch (e) {}
    apiSet("checkins", state.checkins);
  }

  function parseLatLng(text) {
    if (!text) return null;
    text = text.trim();
    var patterns = [
      /@(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,
      /!3d(-?\d{1,3}\.\d+)!4d(-?\d{1,3}\.\d+)/,
      /[?&]q=(-?\d{1,3}\.\d+),(-?\d{1,3}\.\d+)/,
      /^(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)$/
    ];
    for (var i = 0; i < patterns.length; i++) {
      var m = text.match(patterns[i]);
      if (m) {
        var lat = parseFloat(m[1]), lng = parseFloat(m[2]);
        if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat: lat, lng: lng };
      }
    }
    return null;
  }

  function init() {
    initMap();

    Promise.all([
      fetch("data/data.json").then(function (r) { return r.json(); }),
      apiGet("trips").catch(function () { return null; }),
      apiGet("manualGeo").catch(function () { return null; }),
      apiGet("hidden").catch(function () { return null; }),
      apiGet("zones").catch(function () { return null; }),
      fetch("/.netlify/functions/whoami").then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
      apiGet("checkins").catch(function () { return null; })
    ]).then(function (results) {
      var clients = results[0];
      state.trips = results[1] != null ? results[1] : loadTripsLocal();
      state.manualGeo = results[2] != null ? results[2] : loadManualGeoLocal();
      state.hiddenIds = new Set(results[3] != null ? results[3] : loadHiddenLocal());
      var remoteZones = results[4];
      state.currentUser = results[5] && results[5].username ? results[5].username : null;
      state.checkins = results[6] != null ? results[6] : loadCheckinsLocal();

      clients.forEach(function (c) {
        var ov = state.manualGeo[c.id];
        if (ov) { c.lat = ov.lat; c.lng = ov.lng; c._manual = true; }
      });
      state.clients = clients;
      state.activeClassifications = new Set(uniqueValues(clients, "clasificacion"));

      if (remoteZones != null) {
        state.zones = remoteZones;
        afterZonesReady();
      } else {
        var localZones = loadZonesLocal();
        if (localZones) {
          state.zones = localZones;
          afterZonesReady();
        } else {
          fetch("data/zones.json").then(function (r) { return r.ok ? r.json() : []; })
            .catch(function () { return []; })
            .then(function (z) { state.zones = z || []; afterZonesReady(); });
        }
      }
    }).catch(function (err) {
      console.error(err);
      toast("No se pudieron cargar los datos (data/data.json).");
    });
  }

  function afterZonesReady() {
    recomputeZoneAssignment();
    buildFilterUI();
    renderAll();
    updateManualGeoFooter();
    registerServiceWorker();
  }

  function uniqueValues(arr, key) {
    var set = new Set();
    arr.forEach(function (o) { if (o[key]) set.add(o[key]); });
    return Array.from(set);
  }

  /* ---------------- map ---------------- */

  function initMap() {
    map = L.map("map", { zoomControl: false, minZoom: 5, maxZoom: 19 })
      .setView([40.2, -3.7], 6);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
    }).addTo(map);

    L.control.zoom({ position: "bottomright" }).addTo(map);

    clusterGroup = L.markerClusterGroup({
      maxClusterRadius: 50,
      iconCreateFunction: function (cluster) {
        var count = cluster.getChildCount();
        return L.divIcon({
          html: "<div>" + count + "</div>",
          className: "marker-cluster marker-cluster-dp",
          iconSize: L.point(38, 38)
        });
      }
    });
    map.addLayer(clusterGroup);
    selectionLayerGroup = L.layerGroup().addTo(map);
    highlightLayerGroup = L.layerGroup().addTo(map);
    meLocationLayerGroup = L.layerGroup().addTo(map);
    radiusLayerGroup = L.layerGroup().addTo(map);

    map.on("click", onMapClick);

    document.getElementById("btn-draw-zone").addEventListener("click", startDrawZone);
    document.getElementById("btn-cancel-zone").addEventListener("click", cancelDrawZone);
    document.getElementById("btn-finish-zone").addEventListener("click", finishDrawZone);
    document.getElementById("btn-manage-zones").addEventListener("click", openZoneManager);

    document.getElementById("btn-new-trip").addEventListener("click", function () { startPickMode("trip"); });
    document.getElementById("btn-new-trip-2").addEventListener("click", function () { startPickMode("trip"); });
    document.getElementById("btn-trip-cancel").addEventListener("click", cancelTripMode);
    document.getElementById("btn-trip-create").addEventListener("click", function () {
      if (state.pickTarget === "hide") confirmHideSelection();
      else openTripFormModal();
    });
    document.getElementById("btn-hide-start").addEventListener("click", function () { startPickMode("hide"); });
    document.getElementById("btn-hide-manage").addEventListener("click", openHiddenManager);
    document.getElementById("btn-trip-history").addEventListener("click", function () {
      switchSidebarTab("viajes");
      if (window.innerWidth < 860) {
        document.getElementById("sidebar").classList.add("open");
        document.getElementById("sidebar-backdrop").classList.add("open");
      }
    });
    document.getElementById("btn-clear-highlight").addEventListener("click", clearTripHighlight);

    document.getElementById("btn-locate").addEventListener("click", toggleLocate);
    document.getElementById("btn-radius").addEventListener("click", toggleRadiusMode);
    document.getElementById("btn-cancel-radius").addEventListener("click", cancelRadiusMode);
    document.getElementById("btn-clear-radius").addEventListener("click", clearRadiusFilter);
    document.querySelectorAll("#radius-hint [data-km]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.radiusPendingKm = Number(btn.dataset.km);
        document.querySelectorAll("#radius-hint [data-km]").forEach(function (b) { b.classList.toggle("active", b === btn); });
      });
    });

    document.querySelectorAll("#filter-estado .chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        document.querySelectorAll("#filter-estado .chip").forEach(function (c) { c.classList.remove("active"); });
        chip.classList.add("active");
        state.estadoFiltro = chip.dataset.estado;
        renderAll();
      });
    });

    document.querySelectorAll("#filter-viaje-estado .chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        document.querySelectorAll("#filter-viaje-estado .chip").forEach(function (c) { c.classList.remove("active"); });
        chip.classList.add("active");
        state.tripEstadoFiltro = chip.dataset.vestado;
        renderTripsList();
      });
    });
    document.getElementById("manual-geo-export").addEventListener("click", function () {
      var rows = Object.keys(state.manualGeo).map(function (id) {
        var c = state.clients.find(function (x) { return x.id === Number(id); });
        return { id: Number(id), nombre: c ? c.nombre : "", lat: state.manualGeo[id].lat, lng: state.manualGeo[id].lng };
      });
      var blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "ubicaciones-manuales.json";
      a.click();
    });

    document.querySelectorAll(".sidebar-tab").forEach(function (btn) {
      btn.addEventListener("click", function () { switchSidebarTab(btn.dataset.tab); });
    });

    initTripsTabIO();
  }

  function switchSidebarTab(tab) {
    document.querySelectorAll(".sidebar-tab").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.tab === tab);
    });
    document.getElementById("tab-clientes").hidden = tab !== "clientes";
    document.getElementById("tab-viajes").hidden = tab !== "viajes";
    if (tab === "viajes") renderTripsList();
  }

  function markerIcon(color) {
    var html = '<div class="dp-pin" style="background:' + color + '"><div class="dp-pin-dot"></div></div>';
    return L.divIcon({ html: html, className: "dp-marker", iconSize: [30, 30], iconAnchor: [15, 28], popupAnchor: [0, -26] });
  }

  function buildMarkers() {
    clusterGroup.clearLayers();
    markersById = {};
    state.clients.forEach(function (c) {
      if (c.lat == null || c.lng == null) return;
      var m = L.marker([c.lat, c.lng], { icon: markerIcon(classColor(c.clasificacion)) });
      m.on("click", function () { onMarkerClick(c.id); });
      markersById[c.id] = m;
    });
  }

  function popupHtml(c) {
    return '<div class="popup-card">' +
      '<div class="p-name">' + escapeHtml(c.nombre) + "</div>" +
      '<div class="p-addr">' + escapeHtml(c.ciudad || "") + (c.provincia ? " · " + escapeHtml(c.provincia) : "") + "</div>" +
      '<div class="p-actions">' +
      '<button class="btn-primary btn-small" onclick="DPMap.openDetail(' + c.id + ')">Ver ficha</button>' +
      '<button class="btn-secondary btn-small" onclick="DPMap.directions(' + c.id + ')">Cómo llegar</button>' +
      "</div></div>";
  }

  /* ---------------- filters / search / list ---------------- */

  function buildFilterUI() {
    var box = document.getElementById("filter-clasificacion");
    box.innerHTML = "";
    Array.from(state.activeClassifications).sort().forEach(function (c) {
      var chip = document.createElement("div");
      chip.className = "chip active";
      chip.innerHTML = '<span class="dot" style="background:' + classColor(c) + '"></span>' + escapeHtml(c);
      chip.dataset.value = c;
      chip.addEventListener("click", function () {
        if (state.activeClassifications.has(c)) { state.activeClassifications.delete(c); chip.classList.remove("active"); }
        else { state.activeClassifications.add(c); chip.classList.add("active"); }
        renderAll();
      });
      box.appendChild(chip);
    });

    var provSel = document.getElementById("filter-provincia");
    var provs = Array.from(new Set(uniqueValues(state.clients, "provincia").map(normalizeProvincia).filter(Boolean)))
      .sort(function (a, b) { return a.localeCompare(b, "es"); });
    provs.forEach(function (p) {
      var o = document.createElement("option"); o.value = p; o.textContent = p; provSel.appendChild(o);
    });
    provSel.addEventListener("change", function () { state.provinciaFiltro = provSel.value; renderAll(); });

    document.getElementById("filter-zona").addEventListener("change", function (e) {
      state.zonaFiltro = e.target.value; renderAll();
    });

    document.getElementById("filter-solo-mapa").addEventListener("change", function (e) {
      state.soloConMapa = e.target.checked; renderAll();
    });

    var search = document.getElementById("search-input");
    var clearBtn = document.getElementById("search-clear");
    var debounce;
    search.addEventListener("input", function () {
      clearTimeout(debounce);
      clearBtn.hidden = search.value.length === 0;
      debounce = setTimeout(function () {
        state.searchTerm = normalize(search.value.trim());
        renderAll();
      }, 120);
    });
    clearBtn.addEventListener("click", function () {
      search.value = ""; clearBtn.hidden = true; state.searchTerm = ""; renderAll(); search.focus();
    });

    document.getElementById("btn-toggle-sidebar").addEventListener("click", toggleSidebar);
    document.getElementById("sidebar-backdrop").addEventListener("click", toggleSidebar);
    document.getElementById("detail-close").addEventListener("click", closeDetail);
  }

  function toggleSidebar() {
    document.getElementById("sidebar").classList.toggle("open");
    document.getElementById("sidebar-backdrop").classList.toggle("open");
  }

  function refreshZoneSelect() {
    var sel = document.getElementById("filter-zona");
    var current = sel.value;
    sel.innerHTML = '<option value="">Todas las zonas</option>';
    state.zones.forEach(function (z) {
      var o = document.createElement("option");
      o.value = z.id; o.textContent = z.name; sel.appendChild(o);
    });
    sel.value = current && state.zones.some(function (z) { return z.id === current; }) ? current : "";
    state.zonaFiltro = sel.value;
  }

  function matchesFilters(c) {
    if (state.hiddenIds.has(c.id)) return false;
    if (!state.activeClassifications.has(c.clasificacion)) return false;
    if (state.provinciaFiltro && normalizeProvincia(c.provincia) !== state.provinciaFiltro) return false;
    if (state.zonaFiltro && c.zonaId !== state.zonaFiltro) return false;
    if (state.soloConMapa && (c.lat == null || c.lng == null)) return false;
    if (state.estadoFiltro && c.estado !== state.estadoFiltro) return false;
    if (state.radiusFilter) {
      if (c.lat == null) return false;
      if (haversineKm([state.radiusFilter.lat, state.radiusFilter.lng], [c.lat, c.lng]) > state.radiusFilter.km) return false;
    }
    if (state.searchTerm) {
      var hay = normalize(c.nombre).indexOf(state.searchTerm) !== -1;
      if (!hay && c.personas) {
        hay = c.personas.some(function (p) { return normalize(p.nombre).indexOf(state.searchTerm) !== -1; });
      }
      if (!hay) return false;
    }
    return true;
  }

  function renderAll() {
    state.filtered = state.clients.filter(matchesFilters);
    renderMapLayer();
    renderResultsList();
  }

  function renderMapLayer() {
    if (!clusterGroup._dpBuilt) { buildMarkers(); clusterGroup._dpBuilt = true; }
    clusterGroup.clearLayers();
    var toAdd = [];
    state.filtered.forEach(function (c) {
      var m = markersById[c.id];
      if (m) toAdd.push(m);
    });
    clusterGroup.addLayers(toAdd);

    var shouldFit = state.searchTerm || state.zonaFiltro || state.provinciaFiltro;
    if (shouldFit && toAdd.length > 0 && toAdd.length <= 400) {
      var group = L.featureGroup(toAdd);
      try { map.fitBounds(group.getBounds().pad(0.25), { maxZoom: 15 }); } catch (e) {}
    }
  }

  function renderResultsList() {
    var list = document.getElementById("results-list");
    var countEl = document.getElementById("results-count");
    countEl.textContent = state.filtered.length + (state.filtered.length === 1 ? " resultado" : " resultados");

    if (state.filtered.length === 0) {
      list.innerHTML = '<div class="no-results">No hay resultados con estos filtros.</div>';
      return;
    }

    var sorted;
    if (state.myLocation) {
      var withLoc = state.filtered.filter(function (c) { return c.lat != null; });
      var withoutLoc = state.filtered.filter(function (c) { return c.lat == null; });
      withLoc.forEach(function (c) { c._distMe = haversineKm([state.myLocation.lat, state.myLocation.lng], [c.lat, c.lng]); });
      withLoc.sort(function (a, b) { return a._distMe - b._distMe; });
      withoutLoc.sort(function (a, b) { return a.nombre.localeCompare(b.nombre, "es"); });
      sorted = withLoc.concat(withoutLoc);
    } else {
      sorted = state.filtered.slice().sort(function (a, b) { return a.nombre.localeCompare(b.nombre, "es"); });
    }
    var frag = document.createDocumentFragment();
    sorted.slice(0, 300).forEach(function (c) {
      var item = document.createElement("div");
      var isSelected = state.tripMode && state.tripSelection.has(c.id);
      item.className = "result-item" + (c.id === state.activeClientId ? " active" : "") + (isSelected ? " trip-selected" : "");
      item.dataset.id = c.id;
      var zone = state.zones.find(function (z) { return z.id === c.zonaId; });
      var html = "";
      if (state.tripMode) html += '<div class="r-check">' + (isSelected ? "✓" : "") + "</div>";
      html += '<div class="r-main">' +
        '<div class="r-name">' + escapeHtml(c.nombre) + "</div>" +
        '<div class="r-meta">' +
        '<span class="r-badge">' + escapeHtml(c.clasificacion || "—") + "</span>" +
        (c.ciudad ? "<span>" + escapeHtml(c.ciudad) + "</span>" : "") +
        (zone ? '<span style="color:' + zone.color + '">● ' + escapeHtml(zone.name) + "</span>" : "") +
        (c._distMe != null ? '<span class="r-dist">📍 ' + c._distMe.toFixed(1) + " km</span>" : "") +
        (c.lat == null ? '<span class="r-nogeo" data-assign="' + c.id + '">sin ubicar</span>' : "") +
        "</div></div>";
      item.innerHTML = html;
      item.addEventListener("click", function () {
        if (state.tripMode) { toggleTripSelection(c.id); return; }
        selectClient(c.id, true);
      });
      var nogeo = item.querySelector(".r-nogeo");
      if (nogeo) {
        nogeo.addEventListener("click", function (ev) {
          ev.stopPropagation();
          openAssignLocationModal(c.id);
        });
      }
      frag.appendChild(item);
    });
    list.innerHTML = "";
    list.appendChild(frag);
  }

  /* ---------------- selection / detail ---------------- */

  function openMarkerPopup(c) {
    L.popup({ closeButton: false, offset: [0, -4] })
      .setLatLng([c.lat, c.lng])
      .setContent(popupHtml(c))
      .openOn(map);
  }

  function onMarkerClick(id) {
    if (state.tripMode) { toggleTripSelection(id); return; }
    state.activeClientId = id;
    document.querySelectorAll(".result-item").forEach(function (el) {
      el.classList.toggle("active", Number(el.dataset.id) === id);
    });
    var c = state.clients.find(function (x) { return x.id === id; });
    if (c && c.lat != null) {
      map.panTo([c.lat, c.lng]);
      openMarkerPopup(c);
    }
  }

  function selectClient(id, fly) {
    state.activeClientId = id;
    var c = state.clients.find(function (x) { return x.id === id; });
    if (!c) return;

    document.querySelectorAll(".result-item").forEach(function (el) {
      el.classList.toggle("active", Number(el.dataset.id) === id);
    });

    if (fly && c.lat != null) {
      map.flyTo([c.lat, c.lng], Math.max(map.getZoom(), 15), { duration: 0.6 });
      setTimeout(function () { openMarkerPopup(c); }, 350);
    }
    openDetail(id);
  }

  function openDetail(id) {
    var c = state.clients.find(function (x) { return x.id === id; });
    if (!c) return;
    state.activeClientId = id;

    var zone = state.zones.find(function (z) { return z.id === c.zonaId; });
    var html = "";
    html += '<span class="d-badge" style="background:' + classColor(c.clasificacion) + "22;color:" + classColor(c.clasificacion) + '">' + escapeHtml(c.clasificacion || "Sin clasificar") + "</span>";
    html += '<h2 class="d-name">' + escapeHtml(c.nombre) + "</h2>";
    if (c.direccion) html += '<div class="d-addr">' + escapeHtml(c.direccion) + "</div>";
    if (zone) html += '<div class="d-zone">● Zona: ' + escapeHtml(zone.name) + "</div>";

    var clientCheckins = checkinsForClient(c.id);
    if (clientCheckins.length) {
      var last = clientCheckins[0];
      html += '<div class="checkin-badge">✓ Visitado por ' + escapeHtml(last.usuario) + " · " + timeAgo(last.fecha) + "</div>";
    }

    if (c.lat == null) {
      html += '<div class="d-zone" style="color:#767676">Sin ubicación exacta en el mapa (dirección incompleta). Usa el teléfono o el email para contactar.</div>';
      html += '<button class="assign-loc-btn" style="display:block;margin-bottom:10px" onclick="DPMap.assignLocation(' + c.id + ')">📍 Buscarla y asignarla a mano</button>';
    } else {
      html += '<button class="assign-loc-btn" style="display:block;margin-bottom:10px" onclick="DPMap.assignLocation(' + c.id + ')">✎ Corregir esta ubicación</button>';
    }

    html += '<div class="d-actions">';
    if (c.lat != null) html += '<button class="btn-primary" onclick="DPMap.directions(' + c.id + ')">Cómo llegar</button>';
    if (c.telefono) html += '<a class="btn-secondary" href="' + telHref(c.telefono) + '">Llamar</a>';
    if (c.email) html += '<a class="btn-secondary" href="mailto:' + escapeHtml(c.email) + '">Email</a>';
    if (c.web) html += '<a class="btn-secondary" href="' + escapeHtml(c.web) + '" target="_blank" rel="noopener">Web</a>';
    html += '<button class="btn-secondary" onclick="DPMap.shareClient(' + c.id + ')">Compartir</button>';
    html += "</div>";

    html += '<div class="d-section-title">Datos de la empresa</div>';
    if (c.telefono) html += rowHtml("tel", telHref(c.telefono), c.telefono);
    if (c.email) html += rowHtml("mail", "mailto:" + c.email, c.email);
    if (c.cp || c.ciudad) html += rowHtml("pin", null, [c.cp, c.ciudad, c.provincia].filter(Boolean).join(", "));
    if (c.nif) html += rowHtml("id", null, "NIF: " + c.nif);

    if (c.personas && c.personas.length) {
      html += '<div class="d-section-title">Personas de contacto (' + c.personas.length + ")</div>";
      c.personas.forEach(function (p) {
        html += '<div class="person-card"><div class="pc-name">' + escapeHtml(p.nombre || "—") + "</div>";
        if (p.cargo) html += '<div class="pc-role">' + escapeHtml(p.cargo) + "</div>";
        html += '<div class="pc-links">';
        if (p.telefono) html += '<a href="' + telHref(p.telefono) + '">📞 ' + escapeHtml(p.telefono) + "</a>";
        if (p.email) html += '<a href="mailto:' + escapeHtml(p.email) + '">✉️ ' + escapeHtml(p.email) + "</a>";
        html += "</div></div>";
      });
    }

    var pastTrips = state.trips.filter(function (t) { return t.clienteIds.indexOf(c.id) !== -1; })
      .sort(function (a, b) { return (b.fecha || "").localeCompare(a.fecha || ""); });
    if (pastTrips.length) {
      html += '<div class="d-section-title">Visitas / viajes anteriores (' + pastTrips.length + ")</div>";
      pastTrips.forEach(function (t) {
        html += '<div class="visit-card">' +
          '<div class="visit-top"><strong>' + escapeHtml(t.nombre) + "</strong><span>" + escapeHtml(t.fecha || "") + "</span></div>" +
          (t.participantes && t.participantes.length ? '<div class="visit-people">' + escapeHtml(t.participantes.join(", ")) + "</div>" : "") +
          (t.descripcion ? '<div class="visit-desc">' + escapeHtml(t.descripcion) + "</div>" : "") +
          "</div>";
      });
    }

    if (clientCheckins.length) {
      html += '<div class="d-section-title">Check-ins automáticos (' + clientCheckins.length + ")</div>";
      clientCheckins.slice(0, 8).forEach(function (ci) {
        html += '<div class="checkin-row"><span>' + escapeHtml(ci.usuario) + '</span><span class="checkin-time">' + timeAgo(ci.fecha) + "</span></div>";
      });
    }

    if (c.lat != null) {
      var nearby = nearbyClients(c, 6);
      if (nearby.length) {
        html += '<div class="d-section-title">Clientes cercanos</div>';
        nearby.forEach(function (n) {
          html += '<div class="nearby-item" onclick="DPMap.selectClient(' + n.c.id + ')"><span>' + escapeHtml(n.c.nombre) + '</span><span class="n-dist">' + n.dist.toFixed(1) + " km</span></div>";
        });
      }
    }

    document.getElementById("detail-content").innerHTML = html;
    document.getElementById("detail-sheet").hidden = false;
  }

  function rowHtml(icon, href, text) {
    var iconMap = { tel: "📞", mail: "✉️", pin: "📍", id: "🏷️" };
    var inner = href ? '<a href="' + href + '">' + escapeHtml(text) + "</a>" : escapeHtml(text);
    return '<div class="d-row"><span class="d-icon">' + iconMap[icon] + "</span>" + inner + "</div>";
  }

  function closeDetail() {
    document.getElementById("detail-sheet").hidden = true;
    state.activeClientId = null;
    document.querySelectorAll(".result-item.active").forEach(function (el) { el.classList.remove("active"); });
  }

  function nearbyClients(c, n) {
    var others = state.clients.filter(function (x) { return x.id !== c.id && x.lat != null; });
    others.forEach(function (x) { x._dist = haversineKm([c.lat, c.lng], [x.lat, x.lng]); });
    others.sort(function (a, b) { return a._dist - b._dist; });
    return others.slice(0, n).map(function (x) { return { c: x, dist: x._dist }; });
  }

  function directions(id) {
    var c = state.clients.find(function (x) { return x.id === id; });
    if (!c || c.lat == null) return;
    var url = "https://www.google.com/maps/dir/?api=1&destination=" + c.lat + "," + c.lng;
    window.open(url, "_blank", "noopener");
  }

  function shareClient(id) {
    var c = state.clients.find(function (x) { return x.id === id; });
    if (!c) return;
    var lines = [c.nombre];
    if (c.direccion) lines.push(c.direccion);
    if (c.telefono) lines.push("Tel: " + c.telefono);
    if (c.email) lines.push(c.email);
    if (c.lat != null) lines.push("Cómo llegar: https://www.google.com/maps/dir/?api=1&destination=" + c.lat + "," + c.lng);
    var text = lines.join("\n");

    if (navigator.share) {
      navigator.share({ title: c.nombre, text: text }).catch(function () {});
    } else {
      window.open("https://wa.me/?text=" + encodeURIComponent(text), "_blank", "noopener");
    }
  }

  /* ---------------- mi ubicación (GPS) y búsqueda por radio ---------------- */

  function meIcon() {
    return L.divIcon({ html: '<div class="dp-me-dot"></div>', className: "dp-me-marker", iconSize: [18, 18], iconAnchor: [9, 9] });
  }

  function toggleLocate() {
    if (state.locating) { stopLocate(); return; }
    if (!navigator.geolocation) { toast("Tu navegador no permite compartir ubicación."); return; }
    state.locating = true;
    document.getElementById("btn-locate").classList.add("active");
    toast("Buscando tu ubicación…");
    geoWatchId = navigator.geolocation.watchPosition(onLocationUpdate, onLocationError, {
      enableHighAccuracy: true, maximumAge: 10000, timeout: 20000
    });
  }

  function stopLocate() {
    state.locating = false;
    state.myLocation = null;
    document.getElementById("btn-locate").classList.remove("active");
    if (geoWatchId != null && navigator.geolocation) { navigator.geolocation.clearWatch(geoWatchId); geoWatchId = null; }
    meLocationLayerGroup.clearLayers();
    renderResultsList();
  }

  function onLocationUpdate(pos) {
    var first = state.myLocation == null;
    state.myLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    meLocationLayerGroup.clearLayers();
    L.marker([state.myLocation.lat, state.myLocation.lng], { icon: meIcon(), interactive: false, zIndexOffset: 2000 }).addTo(meLocationLayerGroup);
    renderResultsList();
    if (first) { map.flyTo([state.myLocation.lat, state.myLocation.lng], Math.max(map.getZoom(), 12)); toast("Ubicación encontrada."); }
    checkAutoCheckin();
  }

  /* ---------------- check-in automático (solo "cerca de un cliente conocido") ---------------- */

  function checkAutoCheckin() {
    if (!state.myLocation || !state.currentUser) return;
    var now = Date.now();
    state.clients.forEach(function (c) {
      if (c.lat == null) return;
      var d = haversineKm([state.myLocation.lat, state.myLocation.lng], [c.lat, c.lng]);
      if (d > CHECKIN_RADIUS_KM) return;

      var recent = state.checkins.some(function (ci) {
        return ci.clienteId === c.id && ci.usuario === state.currentUser && (now - new Date(ci.fecha).getTime()) < CHECKIN_COOLDOWN_MS;
      });
      if (recent) return;

      state.checkins.push({
        id: "ci" + now + "_" + c.id,
        clienteId: c.id,
        clienteNombre: c.nombre,
        usuario: state.currentUser,
        fecha: new Date().toISOString()
      });
      saveCheckins();
      if (state.activeClientId === c.id) openDetail(c.id);
    });
  }

  function checkinsForClient(clientId) {
    return state.checkins.filter(function (ci) { return ci.clienteId === clientId; })
      .sort(function (a, b) { return new Date(b.fecha) - new Date(a.fecha); });
  }

  function timeAgo(isoDate) {
    var diffMs = Date.now() - new Date(isoDate).getTime();
    var mins = Math.round(diffMs / 60000);
    if (mins < 1) return "ahora mismo";
    if (mins < 60) return "hace " + mins + (mins === 1 ? " minuto" : " minutos");
    var hours = Math.round(mins / 60);
    if (hours < 24) return "hace " + hours + (hours === 1 ? " hora" : " horas");
    var days = Math.round(hours / 24);
    return "hace " + days + (days === 1 ? " día" : " días");
  }

  function onLocationError() {
    state.locating = false;
    document.getElementById("btn-locate").classList.remove("active");
    toast("No se pudo obtener tu ubicación (¿diste permiso al navegador?).");
  }

  function toggleRadiusMode() {
    if (state.radiusMode) { cancelRadiusMode(); return; }
    cancelDrawZone();
    cancelTripMode();
    state.radiusMode = true;
    state.radiusPendingKm = 10;
    document.querySelectorAll("#radius-hint [data-km]").forEach(function (b) { b.classList.toggle("active", Number(b.dataset.km) === 10); });
    document.getElementById("btn-radius").classList.add("active");
    document.getElementById("radius-hint").hidden = false;
    map.getContainer().style.cursor = "crosshair";
    toast("Elige un radio y toca el mapa para buscar alrededor.");
  }

  function cancelRadiusMode() {
    state.radiusMode = false;
    document.getElementById("btn-radius").classList.remove("active");
    document.getElementById("radius-hint").hidden = true;
    map.getContainer().style.cursor = "";
  }

  function applyRadiusFilter(lat, lng, km) {
    state.radiusFilter = { lat: lat, lng: lng, km: km };
    radiusLayerGroup.clearLayers();
    L.circle([lat, lng], { radius: km * 1000, color: "#1565C0", weight: 2, fillOpacity: 0.07 }).addTo(radiusLayerGroup);
    L.circleMarker([lat, lng], { radius: 5, color: "#1565C0", fillColor: "#1565C0", fillOpacity: 1 }).addTo(radiusLayerGroup);
    document.getElementById("radius-active-row").hidden = false;
    document.getElementById("radius-active-label").textContent = "Radio de " + km + " km";
    cancelRadiusMode();
    renderAll();
    try { map.fitBounds(L.circle([lat, lng], { radius: km * 1000 }).getBounds(), { maxZoom: 13 }); } catch (e) {}
  }

  function clearRadiusFilter() {
    state.radiusFilter = null;
    radiusLayerGroup.clearLayers();
    document.getElementById("radius-active-row").hidden = true;
    renderAll();
  }

  /* ---------------- ubicación manual (para fichas sin geocodificar) ---------------- */

  function openAssignLocationModal(clientId) {
    var c = state.clients.find(function (x) { return x.id === clientId; });
    if (!c) return;

    var query = encodeURIComponent([c.nombre, c.direccion || [c.ciudad, c.provincia].filter(Boolean).join(", ")].filter(Boolean).join(" "));
    var gmapsUrl = "https://www.google.com/maps/search/?api=1&query=" + query;

    var box = document.getElementById("modal-box");
    box.innerHTML =
      "<h3>" + (c.lat == null ? "Asignar ubicación" : "Corregir ubicación") + "</h3>" +
      '<div style="font-size:13.5px;font-weight:700;margin-bottom:2px;">' + escapeHtml(c.nombre) + "</div>" +
      (c.direccion ? '<div style="font-size:12.5px;color:var(--gray-500);margin-bottom:14px;">' + escapeHtml(c.direccion) + "</div>" : '<div style="margin-bottom:14px;"></div>') +
      '<a class="gmaps-search-link" href="' + gmapsUrl + '" target="_blank" rel="noopener">🔍 Buscarla en Google Maps</a>' +
      '<div style="font-size:12.5px;color:var(--gray-700);margin-bottom:12px;">Ábrela, haz clic derecho sobre el punto exacto → copia las coordenadas (o simplemente copia la URL de la pestaña) y pégalo aquí abajo.</div>' +
      '<label class="field-label">Enlace o coordenadas de Google Maps</label>' +
      '<input type="text" id="geo-input" placeholder="Ej: 40.4168, -3.7038">' +
      '<div class="modal-actions">' +
      '<button class="btn-secondary" id="geo-modal-cancel">Cancelar</button>' +
      '<button class="btn-primary" id="geo-modal-save">Guardar ubicación</button>' +
      "</div>";

    document.getElementById("modal-backdrop").hidden = false;
    var input = document.getElementById("geo-input");
    input.focus();

    document.getElementById("geo-modal-cancel").addEventListener("click", closeModal);
    document.getElementById("geo-modal-save").addEventListener("click", function () {
      var parsed = parseLatLng(input.value);
      if (!parsed) {
        toast('No he podido leer coordenadas ahí. Pega la URL completa de Google Maps (con "@lat,lng") o escribe "lat, lng".');
        return;
      }
      c.lat = parsed.lat; c.lng = parsed.lng; c._manual = true;
      state.manualGeo[c.id] = { lat: parsed.lat, lng: parsed.lng };
      saveManualGeo();
      clusterGroup._dpBuilt = false;
      recomputeZoneAssignment();
      renderAll();
      updateManualGeoFooter();
      closeModal();
      toast("Ubicación guardada para " + c.nombre + ".");
      if (state.activeClientId === c.id) openDetail(c.id);
    });
  }

  function updateManualGeoFooter() {
    var footer = document.getElementById("manual-geo-footer");
    if (!footer) return;
    var n = Object.keys(state.manualGeo).length;
    footer.hidden = n === 0;
    if (n > 0) {
      document.getElementById("manual-geo-count").textContent = n + " ubicación" + (n === 1 ? "" : "es") + " añadida" + (n === 1 ? "" : "s") + " a mano";
    }
  }

  /* ---------------- zone drawing ---------------- */

  function onMapClick(e) {
    if (state.radiusMode) {
      applyRadiusFilter(e.latlng.lat, e.latlng.lng, state.radiusPendingKm);
      return;
    }
    if (!state.drawing) return;
    state.drawPoints.push([e.latlng.lat, e.latlng.lng]);
    var v = L.circleMarker(e.latlng, { radius: 5, color: "#A6192E", fillColor: "#A6192E", fillOpacity: 1 }).addTo(map);
    state.drawVertexLayers.push(v);
    updateDrawPreview();
  }

  function updateDrawPreview() {
    if (state.drawPreviewLayer) map.removeLayer(state.drawPreviewLayer);
    if (state.drawPoints.length < 2) return;
    state.drawPreviewLayer = L.polygon(state.drawPoints, { color: "#A6192E", weight: 2, dashArray: "6 4", fillOpacity: 0.08 }).addTo(map);
  }

  function startDrawZone() {
    cancelRadiusMode();
    state.drawing = true;
    state.drawPoints = [];
    document.getElementById("draw-hint").hidden = false;
    document.getElementById("zone-toolbar").hidden = true;
    map.getContainer().style.cursor = "crosshair";
    toast("Toca el mapa para marcar los vértices de la zona.");
  }

  function cancelDrawZone() {
    state.drawing = false;
    state.drawPoints = [];
    state.drawVertexLayers.forEach(function (v) { map.removeLayer(v); });
    state.drawVertexLayers = [];
    if (state.drawPreviewLayer) { map.removeLayer(state.drawPreviewLayer); state.drawPreviewLayer = null; }
    document.getElementById("draw-hint").hidden = true;
    document.getElementById("zone-toolbar").hidden = false;
    map.getContainer().style.cursor = "";
  }

  function finishDrawZone() {
    if (state.drawPoints.length < 3) { toast("Marca al menos 3 puntos para cerrar la zona."); return; }
    var points = state.drawPoints.slice();
    cancelDrawZone();
    openZoneNameModal(points);
  }

  function openZoneNameModal(points, existingZone) {
    var usedColors = state.zones.map(function (z) { return z.color; });
    var suggested = ZONE_PALETTE.find(function (c) { return usedColors.indexOf(c) === -1; }) || ZONE_PALETTE[0];
    var chosenColor = (existingZone && existingZone.color) || suggested;

    var box = document.getElementById("modal-box");
    box.innerHTML =
      "<h3>" + (existingZone ? "Editar zona" : "Nueva zona") + "</h3>" +
      '<input type="text" id="zone-name-input" placeholder="Ej: Madrid Centro, Madrid Sur…" value="' + (existingZone ? escapeHtml(existingZone.name) : "") + '">' +
      '<div class="color-swatches" id="zone-color-swatches"></div>' +
      '<div class="modal-actions">' +
      '<button class="btn-secondary" id="zone-modal-cancel">Cancelar</button>' +
      '<button class="btn-primary" id="zone-modal-save">Guardar</button>' +
      "</div>";

    var sw = document.getElementById("zone-color-swatches");
    ZONE_PALETTE.forEach(function (color) {
      var d = document.createElement("div");
      d.className = "color-swatch" + (color === chosenColor ? " active" : "");
      d.style.background = color;
      d.addEventListener("click", function () {
        sw.querySelectorAll(".color-swatch").forEach(function (s) { s.classList.remove("active"); });
        d.classList.add("active");
        chosenColor = color;
      });
      sw.appendChild(d);
    });

    document.getElementById("modal-backdrop").hidden = false;
    var input = document.getElementById("zone-name-input");
    input.focus();

    document.getElementById("zone-modal-cancel").addEventListener("click", closeModal);
    document.getElementById("zone-modal-save").addEventListener("click", function () {
      var name = input.value.trim();
      if (!name) { toast("Ponle un nombre a la zona."); return; }
      if (existingZone) {
        existingZone.name = name;
        existingZone.color = chosenColor;
      } else {
        state.zones.push({ id: "z" + Date.now(), name: name, color: chosenColor, points: points });
      }
      saveZones();
      recomputeZoneAssignment();
      refreshZoneSelect();
      redrawZonePolygons();
      renderAll();
      closeModal();
      toast("Zona guardada.");
    });
  }

  function recomputeZoneAssignment() {
    state.clients.forEach(function (c) {
      c.zonaId = null;
      if (c.lat == null) return;
      for (var i = 0; i < state.zones.length; i++) {
        var z = state.zones[i];
        if (pointInPolygon([c.lat, c.lng], z.points)) { c.zonaId = z.id; break; }
      }
    });
    refreshZoneSelect();
    redrawZonePolygons();
  }

  function redrawZonePolygons() {
    Object.keys(zonePolygons).forEach(function (id) { map.removeLayer(zonePolygons[id]); });
    zonePolygons = {};
    state.zones.forEach(function (z) {
      var poly = L.polygon(z.points, { color: z.color, weight: 2, fillOpacity: 0.07 }).addTo(map);
      poly.bindTooltip(z.name, { sticky: true });
      zonePolygons[z.id] = poly;
    });
  }

  function closeModal() { document.getElementById("modal-backdrop").hidden = true; }

  function openZoneManager() {
    var box = document.getElementById("modal-box");
    var rows = state.zones.map(function (z) {
      var count = state.clients.filter(function (c) { return c.zonaId === z.id; }).length;
      return '<div class="zone-row">' +
        '<div class="zone-swatch" style="background:' + z.color + '"></div>' +
        '<div class="zone-name">' + escapeHtml(z.name) + '<div class="zone-count">' + count + " empresas</div></div>" +
        '<button class="zone-del" data-edit="' + z.id + '" title="Editar">✎</button>' +
        '<button class="zone-del" data-del="' + z.id + '" title="Eliminar">🗑</button>' +
        "</div>";
    }).join("");

    box.innerHTML =
      "<h3>Gestionar zonas</h3>" +
      (state.zones.length ? rows : '<div class="empty-note">Todavía no has creado ninguna zona. Usa "Dibujar zona" sobre el mapa.</div>') +
      '<div class="modal-actions">' +
      '<button class="btn-secondary" id="zones-export">Exportar</button>' +
      '<button class="btn-secondary" id="zones-import-btn">Importar</button>' +
      '<input type="file" id="zones-import-file" accept="application/json" hidden>' +
      '<button class="btn-primary" id="zones-close">Cerrar</button>' +
      "</div>";

    document.getElementById("modal-backdrop").hidden = false;
    document.getElementById("zones-close").addEventListener("click", closeModal);

    box.querySelectorAll("[data-del]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.dataset.del;
        state.zones = state.zones.filter(function (z) { return z.id !== id; });
        saveZones(); recomputeZoneAssignment(); renderAll(); openZoneManager();
      });
    });
    box.querySelectorAll("[data-edit]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var z = state.zones.find(function (zz) { return zz.id === btn.dataset.edit; });
        closeModal();
        openZoneNameModal(z.points, z);
      });
    });

    document.getElementById("zones-export").addEventListener("click", function () {
      var blob = new Blob([JSON.stringify(state.zones, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "zones.json";
      a.click();
    });
    document.getElementById("zones-import-btn").addEventListener("click", function () {
      document.getElementById("zones-import-file").click();
    });
    document.getElementById("zones-import-file").addEventListener("change", function (e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var imported = JSON.parse(reader.result);
          if (!Array.isArray(imported)) throw new Error("formato inválido");
          state.zones = imported;
          saveZones(); recomputeZoneAssignment(); renderAll(); closeModal();
          toast("Zonas importadas correctamente.");
        } catch (err) { toast("El archivo no es un JSON de zonas válido."); }
      };
      reader.readAsText(file);
    });
  }

  /* ---------------- viajes (selección de clientes + historial) ---------------- */

  function startPickMode(target) {
    state.pickTarget = target;
    state.tripMode = true;
    state.tripSelection = new Set();
    cancelDrawZone();
    cancelRadiusMode();
    clearTripHighlight();
    switchSidebarTab("clientes");
    document.getElementById("zone-toolbar").hidden = true;
    document.getElementById("trip-bar").hidden = false;
    document.getElementById("btn-trip-create").textContent = target === "hide" ? "Ocultar" : "Crear viaje";
    updateTripBar();
    renderResultsList();
    toast(target === "hide" ? "Toca los clientes que quieras ocultar." : "Toca los clientes que quieras incluir en el viaje.");
  }

  function cancelTripMode() {
    state.tripMode = false;
    state.pickTarget = null;
    state.tripSelection = new Set();
    document.getElementById("trip-bar").hidden = true;
    document.getElementById("zone-toolbar").hidden = false;
    selectionLayerGroup.clearLayers();
    selectionRings = {};
    renderResultsList();
  }

  function confirmHideSelection() {
    if (state.tripSelection.size === 0) { toast("Selecciona al menos un cliente para ocultar."); return; }
    var n = state.tripSelection.size;
    state.tripSelection.forEach(function (id) { state.hiddenIds.add(id); });
    saveHidden();
    cancelTripMode();
    renderAll();
    toast(n + (n === 1 ? " cliente ocultado." : " clientes ocultados."));
  }

  function openHiddenManager() {
    var box = document.getElementById("modal-box");
    var ids = Array.from(state.hiddenIds);
    var rows = ids.map(function (id) {
      var c = state.clients.find(function (x) { return x.id === id; });
      if (!c) return "";
      return '<div class="zone-row">' +
        '<div class="zone-name">' + escapeHtml(c.nombre) + (c.ciudad ? '<div class="zone-count">' + escapeHtml(c.ciudad) + "</div>" : "") + "</div>" +
        '<button class="btn-secondary btn-small" data-revive="' + id + '">Revivir</button>' +
        "</div>";
    }).join("");

    box.innerHTML =
      "<h3>Clientes ocultos (" + ids.length + ")</h3>" +
      (ids.length ? rows : '<div class="empty-note">No tienes ningún cliente oculto ahora mismo.</div>') +
      '<div class="modal-actions">' +
      (ids.length ? '<button class="btn-secondary" id="hidden-revive-all">Revivir todos</button>' : "") +
      '<button class="btn-primary" id="hidden-close">Cerrar</button>' +
      "</div>";

    document.getElementById("modal-backdrop").hidden = false;
    document.getElementById("hidden-close").addEventListener("click", closeModal);

    box.querySelectorAll("[data-revive]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.hiddenIds.delete(Number(btn.dataset.revive));
        saveHidden();
        renderAll();
        openHiddenManager();
      });
    });
    var reviveAll = document.getElementById("hidden-revive-all");
    if (reviveAll) {
      reviveAll.addEventListener("click", function () {
        state.hiddenIds.clear();
        saveHidden();
        renderAll();
        closeModal();
        toast("Todos los clientes ocultos han vuelto a aparecer.");
      });
    }
  }

  function updateTripBar() {
    var n = state.tripSelection.size;
    document.getElementById("trip-bar-count").textContent = n + (n === 1 ? " cliente seleccionado" : " clientes seleccionados");
  }

  function toggleTripSelection(id) {
    if (state.tripSelection.has(id)) {
      state.tripSelection.delete(id);
      if (selectionRings[id]) { selectionLayerGroup.removeLayer(selectionRings[id]); delete selectionRings[id]; }
    } else {
      state.tripSelection.add(id);
      var c = state.clients.find(function (x) { return x.id === id; });
      if (c && c.lat != null) {
        selectionRings[id] = ringMarker([c.lat, c.lng], "#1A1A1A");
        selectionLayerGroup.addLayer(selectionRings[id]);
      }
    }
    updateTripBar();
    renderResultsList();
  }

  function openTripFormModal(existingTrip) {
    var selection = existingTrip ? existingTrip.clienteIds.slice() : Array.from(state.tripSelection);
    if (selection.length === 0) { toast("Selecciona al menos un cliente para el viaje."); return; }

    var chosenParticipants = existingTrip ? existingTrip.participantes.slice() : [];
    var today = new Date().toISOString().slice(0, 10);

    var usedColors = state.trips.map(function (t) { return t.color; }).filter(Boolean);
    var suggestedColor = ZONE_PALETTE.find(function (c) { return usedColors.indexOf(c) === -1; }) || ZONE_PALETTE[0];
    var chosenColor = (existingTrip && existingTrip.color) || suggestedColor;
    var chosenEstado = (existingTrip && existingTrip.estado) || "planificado";

    var box = document.getElementById("modal-box");
    box.innerHTML =
      "<h3>" + (existingTrip ? "Editar viaje" : "Nuevo viaje") + "</h3>" +
      '<label class="field-label">Nombre del viaje</label>' +
      '<input type="text" id="trip-name-input" placeholder="Ej: Ruta Madrid Norte" value="' + (existingTrip ? escapeHtml(existingTrip.nombre) : "") + '">' +
      '<label class="field-label">Fecha</label>' +
      '<input type="date" id="trip-date-input" value="' + (existingTrip ? existingTrip.fecha : today) + '">' +
      '<label class="field-label">Estado</label>' +
      '<div class="participant-grid" id="trip-estado-toggle">' +
      '<div class="participant-chip' + (chosenEstado === "planificado" ? " active" : "") + '" data-estado="planificado">Planificado</div>' +
      '<div class="participant-chip' + (chosenEstado === "hecho" ? " active" : "") + '" data-estado="hecho">Hecho</div>' +
      "</div>" +
      '<label class="field-label">Color en el mapa</label>' +
      '<div class="color-swatches" id="trip-color-swatches"></div>' +
      '<label class="field-label">Quién viaja</label>' +
      '<div class="participant-grid" id="trip-participants"></div>' +
      '<label class="field-label">Descripción (qué se va a hacer)</label>' +
      '<textarea id="trip-desc-input" placeholder="Ej: revisar la troqueladora, instalar la nueva plastificadora…">' + (existingTrip ? escapeHtml(existingTrip.descripcion) : "") + "</textarea>" +
      '<label class="field-label" id="trip-clients-label">Clientes en este viaje (' + selection.length + ")</label>" +
      '<div class="trip-clients-box" id="trip-clients-box"></div>' +
      '<div class="modal-actions">' +
      '<button class="btn-secondary" id="trip-modal-cancel">Cancelar</button>' +
      '<button class="btn-primary" id="trip-modal-save">Guardar</button>' +
      "</div>";

    var csw = document.getElementById("trip-color-swatches");
    ZONE_PALETTE.forEach(function (color) {
      var d = document.createElement("div");
      d.className = "color-swatch" + (color === chosenColor ? " active" : "");
      d.style.background = color;
      d.addEventListener("click", function () {
        csw.querySelectorAll(".color-swatch").forEach(function (s) { s.classList.remove("active"); });
        d.classList.add("active");
        chosenColor = color;
      });
      csw.appendChild(d);
    });

    document.querySelectorAll("#trip-estado-toggle .participant-chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        document.querySelectorAll("#trip-estado-toggle .participant-chip").forEach(function (c) { c.classList.remove("active"); });
        chip.classList.add("active");
        chosenEstado = chip.dataset.estado;
      });
    });

    var pgrid = document.getElementById("trip-participants");
    PARTICIPANT_OPTIONS.forEach(function (p) {
      var chip = document.createElement("div");
      chip.className = "participant-chip" + (chosenParticipants.indexOf(p) !== -1 ? " active" : "");
      chip.textContent = p;
      chip.addEventListener("click", function () {
        var i = chosenParticipants.indexOf(p);
        if (i === -1) { chosenParticipants.push(p); chip.classList.add("active"); }
        else { chosenParticipants.splice(i, 1); chip.classList.remove("active"); }
      });
      pgrid.appendChild(chip);
    });

    function renderClientsBox() {
      var cbox = document.getElementById("trip-clients-box");
      document.getElementById("trip-clients-label").textContent = "Clientes en este viaje (" + selection.length + ")";
      cbox.innerHTML = "";
      selection.forEach(function (id) {
        var c = state.clients.find(function (x) { return x.id === id; });
        if (!c) return;
        var row = document.createElement("div");
        row.className = "trip-client-row";
        row.innerHTML = "<span>" + escapeHtml(c.nombre) + (c.ciudad ? " · " + escapeHtml(c.ciudad) : "") + "</span><button title=\"Quitar\">&times;</button>";
        row.querySelector("button").addEventListener("click", function () {
          selection = selection.filter(function (x) { return x !== id; });
          renderClientsBox();
        });
        cbox.appendChild(row);
      });
    }
    renderClientsBox();

    document.getElementById("modal-backdrop").hidden = false;
    document.getElementById("trip-name-input").focus();

    document.getElementById("trip-modal-cancel").addEventListener("click", closeModal);
    document.getElementById("trip-modal-save").addEventListener("click", function () {
      var name = document.getElementById("trip-name-input").value.trim();
      var fecha = document.getElementById("trip-date-input").value;
      var desc = document.getElementById("trip-desc-input").value.trim();
      if (!name) { toast("Ponle un nombre al viaje."); return; }
      if (selection.length === 0) { toast("El viaje necesita al menos un cliente."); return; }

      if (existingTrip) {
        existingTrip.nombre = name;
        existingTrip.fecha = fecha;
        existingTrip.estado = chosenEstado;
        existingTrip.color = chosenColor;
        existingTrip.participantes = chosenParticipants;
        existingTrip.descripcion = desc;
        existingTrip.clienteIds = selection;
      } else {
        state.trips.push({
          id: "v" + Date.now(),
          nombre: name,
          fecha: fecha,
          estado: chosenEstado,
          color: chosenColor,
          participantes: chosenParticipants,
          descripcion: desc,
          clienteIds: selection,
          creadoPor: state.currentUser,
          creado: new Date().toISOString()
        });
      }
      saveTrips();
      closeModal();
      cancelTripMode();
      renderTripsList();
      toast("Viaje guardado.");
    });
  }

  function numberedRouteMarker(latlng, color, number) {
    var icon = L.divIcon({
      className: "dp-route-number",
      html: '<div style="background:' + color + '">' + number + "</div>",
      iconSize: [26, 26],
      iconAnchor: [13, 13]
    });
    return L.marker(latlng, { icon: icon, interactive: false, zIndexOffset: 3000 });
  }

  function applyTripHighlightVisuals() {
    highlightLayerGroup.clearLayers();
    if (!state.tripHighlight) return;
    var color = state.tripHighlight.color;
    var pts = state.tripHighlight.points;

    if (pts.length > 1) {
      var latlngs = pts.map(function (p) { return [p.lat, p.lng]; });
      L.polyline(latlngs, { color: color, weight: 3, dashArray: "8 8", opacity: 0.85 }).addTo(highlightLayerGroup);
    }
    pts.forEach(function (p, i) {
      numberedRouteMarker([p.lat, p.lng], color, i + 1).addTo(highlightLayerGroup);
    });
  }

  function clearTripHighlight() {
    highlightLayerGroup.clearLayers();
    state.tripHighlight = null;
    document.getElementById("highlight-chip").hidden = true;
  }

  function viewTripOnMap(trip) {
    var pts = trip.clienteIds
      .map(function (id) { return state.clients.find(function (x) { return x.id === id; }); })
      .filter(function (c) { return c && c.lat != null; });
    if (pts.length === 0) { toast("Ninguno de los clientes de este viaje tiene ubicación en el mapa."); return; }

    clearTripHighlight();
    state.tripHighlight = {
      tripId: trip.id,
      color: trip.color || DEFAULT_COLOR,
      points: pts.map(function (c) { return { id: c.id, lat: c.lat, lng: c.lng, nombre: c.nombre }; })
    };
    applyTripHighlightVisuals();
    document.getElementById("highlight-chip-label").textContent = "Viaje: " + trip.nombre;
    document.getElementById("highlight-chip").hidden = false;

    if (pts.length === 1) {
      map.flyTo([pts[0].lat, pts[0].lng], 15);
    } else {
      var bounds = L.latLngBounds(pts.map(function (c) { return [c.lat, c.lng]; }));
      try { map.fitBounds(bounds.pad(0.2), { maxZoom: 15 }); } catch (e) {}
    }
    var missing = trip.clienteIds.length - pts.length;
    toast(pts.length + " cliente" + (pts.length === 1 ? "" : "s") + " de \"" + trip.nombre + "\" resaltado" + (pts.length === 1 ? "" : "s") + " en el mapa" + (missing > 0 ? " (" + missing + " sin ubicación)" : "") + ".");
  }

  function deleteTrip(id) {
    if (!window.confirm("¿Borrar este viaje del historial? No se puede deshacer.")) return;
    if (state.tripHighlight && state.tripHighlight.tripId === id) clearTripHighlight();
    state.trips = state.trips.filter(function (t) { return t.id !== id; });
    saveTrips();
    renderTripsList();
  }

  function tripCardHtml(t) {
    var validClients = t.clienteIds.map(function (id) { return state.clients.find(function (x) { return x.id === id; }); }).filter(Boolean);
    var color = t.color || DEFAULT_COLOR;
    var esHecho = t.estado === "hecho";
    return '<div class="trip-card" style="border-left:4px solid ' + color + '">' +
      '<div class="tc-top"><span class="tc-name">' + escapeHtml(t.nombre) + '</span><span class="tc-date">' + escapeHtml(t.fecha || "") + "</span></div>" +
      '<span class="tc-status ' + (esHecho ? "tc-status-done" : "tc-status-planned") + '">' + (esHecho ? "Hecho" : "Planificado") + "</span>" +
      (t.creadoPor ? '<div class="tc-creator">Creado por ' + escapeHtml(t.creadoPor) + "</div>" : "") +
      '<div class="tc-participants">' + t.participantes.map(function (p) { return "<span>" + escapeHtml(p) + "</span>"; }).join("") + "</div>" +
      (t.descripcion ? '<div class="tc-desc">' + escapeHtml(t.descripcion) + "</div>" : "") +
      '<div class="tc-clients">' + validClients.length + " cliente" + (validClients.length === 1 ? "" : "s") + ": " + validClients.map(function (c) { return escapeHtml(c.nombre); }).join(", ") + "</div>" +
      '<div class="tc-actions">' +
      '<button class="btn-secondary btn-small" data-view="' + t.id + '">Ver en el mapa</button>' +
      '<button class="btn-secondary btn-small" data-edit="' + t.id + '">Editar</button>' +
      '<button class="btn-secondary btn-small" data-print="' + t.id + '">Hoja de ruta</button>' +
      '<button class="btn-secondary btn-small" data-toggle-estado="' + t.id + '">' + (esHecho ? "Marcar planificado" : "Marcar hecho") + "</button>" +
      '<button class="btn-secondary btn-small" data-del="' + t.id + '">Eliminar</button>' +
      "</div></div>";
  }

  function renderTripsList() {
    var list = document.getElementById("trips-list");
    var filtered = state.tripEstadoFiltro
      ? state.trips.filter(function (t) { return (t.estado || "planificado") === state.tripEstadoFiltro; })
      : state.trips;
    var sorted = filtered.slice().sort(function (a, b) { return (b.fecha || "").localeCompare(a.fecha || ""); });

    list.innerHTML = sorted.length
      ? sorted.map(tripCardHtml).join("")
      : '<div class="empty-note">No hay viajes con este filtro. Usa "+ Nuevo viaje" para crear uno.</div>';

    list.querySelectorAll("[data-view]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var t = state.trips.find(function (x) { return x.id === btn.dataset.view; });
        if (t) viewTripOnMap(t);
      });
    });
    list.querySelectorAll("[data-edit]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var t = state.trips.find(function (x) { return x.id === btn.dataset.edit; });
        if (t) openTripFormModal(t);
      });
    });
    list.querySelectorAll("[data-print]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var t = state.trips.find(function (x) { return x.id === btn.dataset.print; });
        if (t) printTripSheet(t);
      });
    });
    list.querySelectorAll("[data-toggle-estado]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var t = state.trips.find(function (x) { return x.id === btn.dataset.toggleEstado; });
        if (!t) return;
        t.estado = t.estado === "hecho" ? "planificado" : "hecho";
        saveTrips();
        renderTripsList();
      });
    });
    list.querySelectorAll("[data-del]").forEach(function (btn) {
      btn.addEventListener("click", function () { deleteTrip(btn.dataset.del); });
    });
  }

  function printTripSheet(trip) {
    var clients = trip.clienteIds.map(function (id) { return state.clients.find(function (x) { return x.id === id; }); }).filter(Boolean);
    var rows = clients.map(function (c) {
      var personas = (c.personas || []).map(function (p) {
        return escapeHtml(p.nombre || "") + (p.cargo ? " (" + escapeHtml(p.cargo) + ")" : "") + (p.telefono ? " — " + escapeHtml(p.telefono) : "");
      }).join("<br>");
      return "<tr><td>" + escapeHtml(c.nombre) + "</td><td>" + escapeHtml(c.direccion || "") + "</td><td>" +
        escapeHtml(c.telefono || "") + "</td><td>" + personas + "</td></tr>";
    }).join("");

    var html =
      "<h1>" + escapeHtml(trip.nombre) + "</h1>" +
      '<div class="meta">Fecha: ' + escapeHtml(trip.fecha || "") + " &nbsp;·&nbsp; Participantes: " + escapeHtml((trip.participantes || []).join(", ") || "—") + "</div>" +
      (trip.descripcion ? '<div class="desc">' + escapeHtml(trip.descripcion) + "</div>" : "") +
      "<table><thead><tr><th>Empresa</th><th>Dirección</th><th>Teléfono</th><th>Personas de contacto</th></tr></thead><tbody>" + rows + "</tbody></table>";

    // Imprime dentro de la propia página (en vez de abrir una ventana nueva)
    // para que funcione aunque el navegador bloquee ventanas emergentes.
    var area = document.getElementById("print-area");
    if (!area) {
      area = document.createElement("div");
      area.id = "print-area";
      document.body.appendChild(area);
    }
    area.innerHTML = html;
    window.print();
  }

  function initTripsTabIO() {
    document.getElementById("trips-export").addEventListener("click", function () {
      var blob = new Blob([JSON.stringify(state.trips, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "viajes.json";
      a.click();
    });
    document.getElementById("trips-import-btn").addEventListener("click", function () {
      document.getElementById("trips-import-file").click();
    });
    document.getElementById("trips-import-file").addEventListener("change", function (e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var imported = JSON.parse(reader.result);
          if (!Array.isArray(imported)) throw new Error("formato inválido");
          var existingIds = new Set(state.trips.map(function (t) { return t.id; }));
          var added = 0;
          imported.forEach(function (t) {
            if (t && t.id && !existingIds.has(t.id)) { state.trips.push(t); added++; }
          });
          saveTrips();
          renderTripsList();
          toast(added + " viaje(s) importado(s).");
        } catch (err) { toast("El archivo no es un JSON de viajes válido."); }
      };
      reader.readAsText(file);
    });
  }

  document.getElementById("modal-backdrop").addEventListener("click", function (e) {
    if (e.target.id === "modal-backdrop") closeModal();
  });

  /* ---------------- PWA ---------------- */

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    var isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
    if (isLocal) {
      // En pruebas locales no registramos el service worker: así cada recarga
      // ve siempre los archivos tal cual están en disco, sin caché de por medio.
      // Si quedó uno registrado de una sesión anterior, lo quitamos.
      navigator.serviceWorker.getRegistrations().then(function (regs) {
        regs.forEach(function (r) { r.unregister(); });
      });
      if (window.caches) {
        caches.keys().then(function (keys) { keys.forEach(function (k) { caches.delete(k); }); });
      }
      return;
    }
    navigator.serviceWorker.register("service-worker.js").catch(function () {});
    navigator.serviceWorker.addEventListener("message", function (e) {
      if (e.data && e.data.type === "DP_SW_UPDATED") location.reload();
    });
  }

  /* ---------------- public API (used from inline HTML) ---------------- */

  window.DPMap = {
    openDetail: openDetail,
    selectClient: selectClient,
    directions: directions,
    assignLocation: openAssignLocationModal,
    shareClient: shareClient
  };

  document.addEventListener("DOMContentLoaded", init);
})();
