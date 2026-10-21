const STORAGE_KEY = "idibre.stops";
const REFRESH_MS = 30000;
const NO_ESTIMATE = 999999;

const $ = (id) => document.getElementById(id);

let stops = loadStops();
let current = stops.length ? stops[0].id : null;
let timer = null;
let map = null;
let markers = null;

function loadStops() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveStops() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stops));
  } catch {
    // Storage unavailable (private mode); stops last for this visit only.
  }
}

async function fetchStop(id) {
  const res = await fetch(`/api/arrivals?stop=${encodeURIComponent(id)}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

function showError(message) {
  $("error").textContent = message || "";
  $("error").hidden = !message;
}

function formatEta(seconds) {
  if (seconds >= NO_ESTIMATE) return "45+ min";
  if (seconds < 60) return "Now";
  return `${Math.round(seconds / 60)} min`;
}

function renderSaved() {
  const nav = $("saved");
  nav.innerHTML = "";
  for (const stop of stops) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = `${stop.id} · ${stop.name}`;
    btn.setAttribute("aria-current", String(stop.id === current));
    btn.addEventListener("click", () => select(stop.id));
    nav.appendChild(btn);
  }
  $("empty").hidden = stops.length > 0;
  $("stop-panel").hidden = !current;
}

function renderArrivals(data) {
  $("stop-name").textContent = data.stop.name;
  $("stop-meta").textContent = [`Stop ${data.stop.id}`, data.stop.address].filter(Boolean).join(" · ");

  const list = $("arrivals");
  list.innerHTML = "";
  if (!data.arrivals.length) {
    const li = document.createElement("li");
    li.textContent = "No buses expected right now.";
    list.appendChild(li);
  }
  for (const a of data.arrivals) {
    const li = document.createElement("li");
    const line = document.createElement("span");
    line.className = "line";
    line.textContent = a.line;
    const dest = document.createElement("span");
    dest.className = "dest";
    dest.textContent = a.destination;
    const eta = document.createElement("span");
    eta.className = "eta" + (a.seconds < 180 ? " soon" : "");
    eta.textContent = formatEta(a.seconds);
    li.append(line, dest, eta);
    list.appendChild(li);
  }

  $("updated").textContent = `Updated ${new Date(data.updated).toLocaleTimeString()} · refreshes every 30 s`;
}

function renderMap(data) {
  if (!map) {
    map = L.map("map", { zoomControl: true });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);
    markers = L.layerGroup().addTo(map);
  }
  markers.clearLayers();

  const points = [];
  if (data.stop.coords) {
    L.circleMarker(data.stop.coords, { radius: 9, color: "#d4002a", weight: 3, fillOpacity: 0.9, fillColor: "#fff" })
      .bindPopup(`<b>${escapeHtml(data.stop.name)}</b><br>Stop ${escapeHtml(data.stop.id)}`)
      .addTo(markers);
    points.push(data.stop.coords);
  }
  for (const a of data.arrivals) {
    if (!a.coords || a.seconds >= NO_ESTIMATE) continue;
    const icon = L.divIcon({ className: "bus-icon", html: escapeHtml(a.line), iconSize: [34, 22] });
    L.marker(a.coords, { icon })
      .bindPopup(`Line ${escapeHtml(a.line)} → ${escapeHtml(a.destination)}<br>${formatEta(a.seconds)} · ${a.distance} m`)
      .addTo(markers);
    points.push(a.coords);
  }

  if (points.length > 1) map.fitBounds(points, { padding: [30, 30], maxZoom: 17 });
  else if (points.length === 1) map.setView(points[0], 16);
  // The map container may have been hidden when Leaflet measured it.
  setTimeout(() => map.invalidateSize(), 0);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

async function refresh() {
  if (!current) return;
  const id = current;
  try {
    const data = await fetchStop(id);
    if (id !== current) return;
    showError("");
    renderArrivals(data);
    renderMap(data);
  } catch (err) {
    if (id === current) showError(err.message);
  }
}

function select(id) {
  current = id;
  renderSaved();
  $("arrivals").innerHTML = "";
  $("updated").textContent = "Loading…";
  clearInterval(timer);
  if (current) {
    refresh();
    timer = setInterval(refresh, REFRESH_MS);
  }
}

$("add-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("stop-input").value.trim();
  if (!/^\d{1,6}$/.test(id)) return showError("Enter the stop number (digits only).");
  if (stops.some((s) => s.id === id)) {
    $("stop-input").value = "";
    return select(id);
  }
  try {
    const data = await fetchStop(id);
    stops.push({ id, name: data.stop.name });
    saveStops();
    $("stop-input").value = "";
    showError("");
    select(id);
  } catch (err) {
    showError(err.message);
  }
});

$("remove-btn").addEventListener("click", () => {
  stops = stops.filter((s) => s.id !== current);
  saveStops();
  select(stops.length ? stops[0].id : null);
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refresh();
});

select(current);
