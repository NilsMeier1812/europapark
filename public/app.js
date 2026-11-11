// EP Wartezeiten – Frontend
// Holt alle Daten von /api/waits (unser eigener Worker) – keine Proxys, kein Firebase.

const $ = (sel) => document.querySelector(sel);
const REFRESH_MS = 60_000;
const PARK_CENTER = [48.2655, 7.7212];

// ---------- Zustand ----------
const store = {
  get(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return v ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
};

const state = {
  data: null,
  favs: new Set(store.get("ep_favs", []).map(Number)),
  alerts: (() => {
    const a = store.get("ep_alerts", {});
    return a && !Array.isArray(a) ? a : {};
  })(),
  sort: store.get("ep_sort", "land"),
  onlyFavs: store.get("ep_only_favs", false),
  onlyOpen: store.get("ep_only_open", false),
  pos: null,
  view: "list",
};

let deviceId = store.get("ep_device", null);
if (!deviceId) {
  deviceId = crypto.randomUUID();
  store.set("ep_device", deviceId);
}

// ---------- Hilfsfunktionen ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmtTime = (t) => new Date(t).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

function toast(msg, isError = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.toggle("error", isError);
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 3000);
}

function distanceM(a, b) {
  const R = 6371e3;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function distanceOf(ride) {
  if (!state.pos || ride.lat == null) return null;
  return distanceM(state.pos, ride);
}

function fmtDistance(m) {
  if (m == null) return "";
  if (m > 5000) return `${(m / 1000).toFixed(0)} km`;
  const walk = Math.max(1, Math.round((m * 1.3) / 75)); // Umwege, ~4,5 km/h
  return m < 1000 ? `${Math.round(m / 10) * 10} m · ${walk} Min` : `${(m / 1000).toFixed(1)} km · ${walk} Min`;
}

function waitClass(r) {
  if (!r.open) return "shut";
  if (r.wait <= 10) return "low";
  if (r.wait <= 30) return "mid";
  if (r.wait <= 50) return "high";
  return "veryhigh";
}

const isGood = (r) => r.open && !r.virtual && r.wait <= r.good;

function seriesFor(id) {
  const h = state.data?.history;
  if (!h) return [];
  return h.waits.map((w, i) => ({ t: h.t[i], v: w[id] ?? null }));
}

function sparkline(series) {
  const pts = series.filter((p) => p.v != null);
  if (pts.length < 2) return "";
  const W = 72, H = 32, P = 3;
  const t0 = series[0].t, t1 = series[series.length - 1].t || t0 + 1;
  const max = Math.max(...pts.map((p) => p.v), 10);
  const x = (t) => P + ((t - t0) / (t1 - t0 || 1)) * (W - 2 * P);
  const y = (v) => H - P - (v / max) * (H - 2 * P);
  // Lücken (Bahn geschlossen) unterbrechen die Linie
  let d = "", pen = false;
  for (const p of series) {
    if (p.v == null) { pen = false; continue; }
    d += `${pen ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`;
    pen = true;
  }
  // Trend der letzten ~30 Minuten: grün = sinkt, rot = steigt
  const last = pts[pts.length - 1];
  const ref = pts.find((p) => p.t >= last.t - 30 * 60_000) ?? pts[0];
  const color = last.v < ref.v ? "var(--green)" : last.v > ref.v ? "var(--red)" : "var(--accent)";
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" aria-hidden="true">
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${x(last.t).toFixed(1)}" cy="${y(last.v).toFixed(1)}" r="2.5" fill="${color}"/>
  </svg>`;
}

function todayRange(series) {
  const v = series.map((p) => p.v).filter((x) => x != null);
  if (v.length < 3) return "";
  return `heute ${Math.min(...v)}–${Math.max(...v)}`;
}

// ---------- Daten laden ----------
async function load(manual = false) {
  const btn = $("#refresh-btn");
  btn.classList.add("spinning");
  try {
    const res = await fetch("/api/waits", { cache: "no-store" });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || `Fehler ${res.status}`);
    state.data = body;
    render();
    if (manual) toast("Aktualisiert");
  } catch (e) {
    console.error(e);
    setStatus(`Keine Verbindung (${e.message})`, "error");
    if (manual) toast("Laden fehlgeschlagen", true);
  } finally {
    btn.classList.remove("spinning");
  }
}

function setStatus(text, cls = "") {
  const s = $("#status");
  s.textContent = text;
  s.className = `status ${cls}`;
}

// ---------- Darstellung ----------
function visibleRides() {
  let rides = state.data?.rides ?? [];
  if (state.onlyFavs && state.favs.size) rides = rides.filter((r) => state.favs.has(r.id));
  if (state.onlyOpen) rides = rides.filter((r) => r.open);
  return rides;
}

function render() {
  const d = state.data;
  if (!d) return;

  const age = Date.now() - d.updated;
  const anyOpen = d.rides.some((r) => r.open);
  if (d.error) setStatus(`Stand ${fmtTime(d.updated)} · Abruf fehlgeschlagen`, "error");
  else setStatus(`Stand ${fmtTime(d.updated)} Uhr`, anyOpen && age > 15 * 60_000 ? "stale" : "");

  const banner = $("#banner");
  banner.hidden = anyOpen;
  if (!anyOpen) banner.textContent = "Gerade ist alles geschlossen – die Wartezeiten erscheinen, sobald der Park öffnet.";

  $("#chip-favs").classList.toggle("active", state.onlyFavs);
  $("#chip-favs").hidden = state.favs.size === 0;
  $("#chip-open").classList.toggle("active", state.onlyOpen);
  $("#sort").value = state.sort;

  const rides = visibleRides();
  const html = [];
  if (state.sort === "land") {
    const lands = new Map();
    for (const r of rides) {
      if (!lands.has(r.land)) lands.set(r.land, []);
      lands.get(r.land).push(r);
    }
    for (const [land, list] of [...lands].sort((a, b) => a[0].localeCompare(b[0], "de"))) {
      list.sort((a, b) => a.name.localeCompare(b.name, "de"));
      html.push(`<section class="land"><h2>${esc(land)}</h2><div class="grid">${list.map(card).join("")}</div></section>`);
    }
  } else {
    const key =
      state.sort === "dist" && state.pos
        ? (r) => distanceOf(r) ?? Infinity
        : (r) => r.wait;
    const sorted = [...rides].sort((a, b) => (b.open - a.open) || key(a) - key(b));
    html.push(`<div class="grid flat">${sorted.map(card).join("")}</div>`);
  }
  if (!rides.length) html.push(`<p class="hint">Keine Bahnen für diesen Filter.</p>`);
  $("#content").innerHTML = html.join("");

  if (map) updateMarkers();
}

function card(r) {
  const series = seriesFor(r.id);
  const alertMax = state.alerts[r.id];
  const hasAlert = alertMax != null;
  const fav = state.favs.has(r.id);
  const badges = [
    r.sr ? `<span class="badge sr">SR</span>` : "",
    isGood(r) ? `<span class="badge good">Gute Zeit</span>` : "",
    r.virtual ? `<span class="badge vl">VirtualLine</span>` : "",
  ].join("");
  return `<article class="card ${isGood(r) ? "good" : ""} ${r.open ? "" : "closed"}">
    <div class="card-actions">
      <button class="${fav ? "on" : ""}" data-fav="${r.id}" aria-label="Favorit">★</button>
      <button class="${hasAlert ? "on" : ""}" data-alert="${r.id}" aria-label="Alarm">🔔${hasAlert ? `<span class="alert-max">≤${alertMax}</span>` : ""}</button>
    </div>
    <div class="badges">${badges}</div>
    <div class="name">${esc(r.name)}</div>
    <div class="wait-row">
      <div class="wait ${waitClass(r)}">${r.open ? `${r.wait}<small>min</small>` : "geschlossen"}</div>
      ${sparkline(series)}
    </div>
    <div class="meta"><span class="dist">${fmtDistance(distanceOf(r))}</span><span>${todayRange(series)}</span></div>
  </article>`;
}

// ---------- Karte ----------
let map = null;
let markerLayer = null;
let userMarker = null;

function initMap() {
  map = L.map("map", { zoomControl: false }).setView(PARK_CENTER, 17);
  const osm = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap",
  });
  const sat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    maxZoom: 19,
    attribution: "© Esri",
  });
  osm.addTo(map);
  L.control.layers({ Karte: osm, Satellit: sat }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
}

function updateMarkers() {
  markerLayer.clearLayers();
  const seen = new Set();
  for (const r of visibleRides()) {
    if (r.lat == null || r.virtual) continue;
    const key = `${r.lat},${r.lon}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const color = !r.open ? "#475569" : r.wait <= 10 ? "#16a34a" : r.wait <= 30 ? "#0284c7" : r.wait <= 50 ? "#d97706" : "#dc2626";
    const icon = L.divIcon({
      className: "",
      html: `<div class="marker ${isGood(r) ? "good" : ""}" style="background:${color}">${r.open ? r.wait : "✕"}</div>`,
      iconSize: [32, 32],
    });
    const nav = `https://www.google.com/maps/dir/?api=1&travelmode=walking&destination=${r.lat},${r.lon}`;
    L.marker([r.lat, r.lon], { icon })
      .bindPopup(
        `<b>${esc(r.name)}</b><br>${r.open ? `${r.wait} Min Wartezeit` : "Geschlossen"}` +
          `${distanceOf(r) != null ? `<br>${fmtDistance(distanceOf(r))}` : ""}` +
          `<br><a class="popup-nav" href="${nav}" target="_blank" rel="noopener">🚶 Hinlaufen</a>`,
      )
      .addTo(markerLayer);
  }
  if (state.pos) {
    const ll = [state.pos.lat, state.pos.lon];
    if (!userMarker) {
      userMarker = L.circleMarker(ll, { radius: 9, color: "#fff", weight: 3, fillColor: "#38bdf8", fillOpacity: 1 })
        .bindPopup("Du bist hier")
        .addTo(map);
    } else userMarker.setLatLng(ll);
  }
}

function switchView(view) {
  state.view = view;
  $("#list-view").hidden = view !== "list";
  $("#map-view").hidden = view !== "map";
  $("#tab-list").classList.toggle("active", view === "list");
  $("#tab-map").classList.toggle("active", view === "map");
  if (view === "map") {
    if (!map) initMap();
    setTimeout(() => {
      map.invalidateSize();
      updateMarkers();
    }, 50);
  }
}

// ---------- Standort ----------
if ("geolocation" in navigator) {
  navigator.geolocation.watchPosition(
    (p) => {
      state.pos = { lat: p.coords.latitude, lon: p.coords.longitude };
      render();
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 15_000 },
  );
}

// ---------- Push & Alarme ----------
const pushSupported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

async function getSubscription() {
  if (!pushSupported) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

async function syncDevice() {
  const sub = await getSubscription().catch(() => null);
  const res = await fetch(`/api/devices/${deviceId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: sub ? sub.toJSON() : null, alerts: state.alerts }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Fehler ${res.status}`);
}

function urlBase64ToUint8Array(base64) {
  const b64 = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function enablePush() {
  if (!pushSupported) {
    toast(isIOS && !isStandalone ? "Erst zum Home-Bildschirm hinzufügen" : "Push wird hier nicht unterstützt", true);
    return false;
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    toast("Benachrichtigungen wurden nicht erlaubt", true);
    return false;
  }
  try {
    const { publicKey } = await (await fetch("/api/push-key")).json();
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    const key = urlBase64ToUint8Array(publicKey);
    if (sub && sub.options?.applicationServerKey) {
      const current = new Uint8Array(sub.options.applicationServerKey);
      if (current.length !== key.length || current.some((b, i) => b !== key[i])) {
        await sub.unsubscribe();
        sub = null;
      }
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await syncDevice();
    toast("Push aktiviert 🎉");
    return true;
  } catch (e) {
    console.error(e);
    toast(`Push-Fehler: ${e.message}`, true);
    return false;
  } finally {
    updatePushUI();
  }
}

async function updatePushUI() {
  const status = $("#push-status");
  const enableBtn = $("#push-enable");
  const testBtn = $("#push-test");
  const sub = await getSubscription().catch(() => null);
  testBtn.hidden = !sub;
  enableBtn.hidden = Boolean(sub);
  status.classList.remove("warn");
  if (!pushSupported) {
    status.textContent =
      isIOS && !isStandalone
        ? "Auf dem iPhone: Teilen → „Zum Home-Bildschirm“, dann die App von dort öffnen. Erst dann sind Push-Nachrichten möglich."
        : "Dieser Browser unterstützt keine Push-Nachrichten.";
    status.classList.add("warn");
    enableBtn.hidden = true;
  } else if (Notification.permission === "denied") {
    status.textContent = "Benachrichtigungen sind blockiert – bitte in den Systemeinstellungen für diese App erlauben.";
    status.classList.add("warn");
  } else {
    status.textContent = sub
      ? "✅ Aktiv. Der Server prüft alle 5 Minuten deine Alarme – auch wenn die App geschlossen ist."
      : "Noch nicht aktiviert. Ohne Push gibt es keine Alarme.";
  }
}

let editingRide = null;

function openAlertDialog(id) {
  const ride = state.data.rides.find((r) => r.id === id);
  if (!ride) return;
  editingRide = ride;
  $("#alert-title").textContent = ride.name;
  const suggestion = Math.round(Math.min(ride.good, ride.open ? ride.wait - 5 : ride.good) / 5) * 5;
  $("#alert-max").value = state.alerts[id] ?? Math.max(5, suggestion);
  $("#alert-delete").hidden = state.alerts[id] == null;
  const hint = $("#alert-push-hint");
  hint.hidden = true;
  getSubscription()
    .catch(() => null)
    .then((sub) => {
      if (!sub) {
        hint.hidden = false;
        hint.className = "hint warn";
        hint.textContent = "Push ist auf diesem Gerät noch nicht aktiviert – beim Speichern wirst du gefragt.";
      }
    });
  $("#alert-dialog").showModal();
}

async function saveAlerts(message) {
  store.set("ep_alerts", state.alerts);
  render();
  renderAlertList();
  try {
    await syncDevice();
    if (message) toast(message);
  } catch (e) {
    toast(`Speichern auf dem Server fehlgeschlagen: ${e.message}`, true);
  }
}

function renderAlertList() {
  const list = $("#alert-list");
  const entries = Object.entries(state.alerts);
  if (!entries.length) {
    list.innerHTML = `<p class="hint">Noch keine Alarme. Tippe bei einer Bahn auf 🔔.</p>`;
    return;
  }
  const names = new Map((state.data?.rides ?? []).map((r) => [String(r.id), r.name]));
  list.innerHTML = entries
    .map(
      ([id, max]) =>
        `<div class="row"><span>${esc(names.get(id) ?? `Bahn ${id}`)} · ≤ ${max} Min</span><button type="button" data-remove-alert="${id}" aria-label="Löschen">✕</button></div>`,
    )
    .join("");
}

// ---------- Events ----------
$("#tab-list").onclick = () => switchView("list");
$("#tab-map").onclick = () => switchView("map");
$("#refresh-btn").onclick = () => load(true);
$("#locate-btn").onclick = () => map?.flyTo(state.pos ? [state.pos.lat, state.pos.lon] : PARK_CENTER, 18);

$("#sort").onchange = (e) => {
  state.sort = e.target.value;
  store.set("ep_sort", state.sort);
  if (state.sort === "dist" && !state.pos) toast("Standort noch unbekannt – bitte Ortung erlauben");
  render();
};
$("#chip-favs").onclick = () => {
  state.onlyFavs = !state.onlyFavs;
  store.set("ep_only_favs", state.onlyFavs);
  render();
};
$("#chip-open").onclick = () => {
  state.onlyOpen = !state.onlyOpen;
  store.set("ep_only_open", state.onlyOpen);
  render();
};

$("#content").addEventListener("click", (e) => {
  const fav = e.target.closest("[data-fav]");
  if (fav) {
    const id = Number(fav.dataset.fav);
    state.favs.has(id) ? state.favs.delete(id) : state.favs.add(id);
    store.set("ep_favs", [...state.favs]);
    if (!state.favs.size) state.onlyFavs = false;
    render();
    return;
  }
  const alertBtn = e.target.closest("[data-alert]");
  if (alertBtn) openAlertDialog(Number(alertBtn.dataset.alert));
});

$("#alert-dialog").querySelectorAll("[data-step]").forEach((b) => {
  b.onclick = () => {
    const input = $("#alert-max");
    input.value = Math.max(0, Math.min(300, (Number(input.value) || 0) + Number(b.dataset.step)));
  };
});

$("#alert-dialog").addEventListener("close", async () => {
  const action = $("#alert-dialog").returnValue;
  $("#alert-dialog").returnValue = "";
  const ride = editingRide;
  editingRide = null;
  if (!ride) return;
  if (action === "delete") {
    delete state.alerts[ride.id];
    await saveAlerts("Alarm gelöscht");
  } else if (action === "save") {
    const max = Math.round(Number($("#alert-max").value));
    if (!Number.isFinite(max) || max < 0) return toast("Bitte eine Minutenzahl eingeben", true);
    state.alerts[ride.id] = max;
    const hasPush = await getSubscription().catch(() => null);
    if (!hasPush) await enablePush();
    await saveAlerts(`Alarm: ${ride.name} ≤ ${max} Min`);
  }
});

$("#settings-btn").onclick = () => {
  updatePushUI();
  renderAlertList();
  $("#settings-dialog").showModal();
};
$("#push-enable").onclick = () => enablePush();
$("#push-test").onclick = async () => {
  const btn = $("#push-test");
  btn.disabled = true;
  try {
    await syncDevice(); // falls sich das Abo geändert hat
    const res = await fetch(`/api/devices/${deviceId}/test`, { method: "POST" });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error);
    toast("Test-Push verschickt – kommt gleich an");
  } catch (e) {
    toast(`Test fehlgeschlagen: ${e.message}`, true);
  } finally {
    btn.disabled = false;
  }
};
$("#alert-list").addEventListener("click", (e) => {
  const b = e.target.closest("[data-remove-alert]");
  if (!b) return;
  delete state.alerts[b.dataset.removeAlert];
  saveAlerts("Alarm gelöscht");
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") load();
});

// ---------- Start ----------
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch((e) => console.error("Service Worker:", e));
}
load();
setInterval(() => document.visibilityState === "visible" && load(), REFRESH_MS);
// Alarme/Abo beim Start einmal abgleichen (z. B. wenn das Handy das Abo erneuert hat)
if (Object.keys(state.alerts).length) getSubscription().then((s) => s && syncDevice()).catch(() => {});
document.querySelectorAll("dialog [data-close]").forEach((b) => (b.onclick = () => b.closest("dialog").close("cancel")));
