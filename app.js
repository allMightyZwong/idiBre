const FAV_KEY = "idibre.favorites";
const OLD_KEY = "idibre.stops";
const TAB_KEY = "idibre.tab";
const REFRESH_MS = 15000;
const NO_ESTIMATE = 999999;

const $ = (id) => document.getElementById(id);

let favorites = loadFavorites();
let tab = storageGet(TAB_KEY) === "nearby" ? "nearby" : "favorites";
let nearby = [];
let userPos = null;

let currentStop = null; // { id, name } of the stop being shown
let timer = null;
let map = null;
let stopMarker = null;
let userMarker = null;
let busMarkers = new Map();
let fitted = false;

// ---------- storage ----------

function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode: keep in memory only */ }
}

function loadFavorites() {
  try {
    const saved = JSON.parse(storageGet(FAV_KEY) || storageGet(OLD_KEY) || "[]");
    return Array.isArray(saved) ? saved.filter((s) => s && s.id) : [];
  } catch {
    return [];
  }
}

function saveFavorites() {
  storageSet(FAV_KEY, JSON.stringify(favorites));
}

const isFavorite = (id) => favorites.some((f) => f.id === id);

function toggleFavorite(stop) {
  if (isFavorite(stop.id)) favorites = favorites.filter((f) => f.id !== stop.id);
  else favorites.push({ id: stop.id, name: stop.name });
  saveFavorites();
  renderHome();
  renderFavButton();
}

// ---------- helpers ----------

async function getJson(url) {
  const res = await fetch(url);
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

function formatDistance(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// ---------- home: favorites + nearby ----------

function stopRow(stop, subtitle) {
  const li = document.createElement("li");
  const id = document.createElement("span");
  id.className = "stop-id";
  id.textContent = stop.id;

  const text = document.createElement("div");
  text.className = "stop-text";
  const name = document.createElement("div");
  name.className = "stop-name";
  name.textContent = stop.name;
  text.appendChild(name);
  if (subtitle) {
    const sub = document.createElement("div");
    sub.className = "stop-sub";
    sub.textContent = subtitle;
    text.appendChild(sub);
  }

  const star = document.createElement("button");
  star.type = "button";
  star.className = "row-star";
  const fav = isFavorite(stop.id);
  star.textContent = fav ? "★" : "☆";
  star.setAttribute("aria-pressed", String(fav));
  star.setAttribute("aria-label", fav ? "Remove from favorites" : "Save as favorite");
  star.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleFavorite(stop);
  });

  li.append(id, text, star);
  li.addEventListener("click", () => openStop(stop.id));
  return li;
}

function renderHome() {
  for (const btn of document.querySelectorAll(".tabs button")) {
    btn.setAttribute("aria-selected", String(btn.dataset.tab === tab));
  }
  $("favorites-panel").hidden = tab !== "favorites";
  $("nearby-panel").hidden = tab !== "nearby";

  const favList = $("fav-list");
  favList.innerHTML = "";
  for (const f of favorites) favList.appendChild(stopRow(f));
  $("fav-empty").hidden = favorites.length > 0;

  const nearList = $("nearby-list");
  nearList.innerHTML = "";
  for (const s of nearby) {
    const lines = s.lines.length ? `Lines ${s.lines.join(", ")}` : "";
    nearList.appendChild(stopRow(s, [formatDistance(s.distance), lines].filter(Boolean).join(" · ")));
  }
}

function findNearby() {
  if (!navigator.geolocation) {
    $("nearby-status").textContent = "Location isn't available on this device.";
    return;
  }
  $("nearby-status").textContent = "Finding your location…";
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      userPos = [pos.coords.latitude, pos.coords.longitude];
      $("nearby-status").textContent = "Loading nearby stops…";
      try {
        const data = await getJson(`/api/nearby?lat=${userPos[0]}&lng=${userPos[1]}&radius=500`);
        nearby = data.stops;
        $("nearby-status").textContent = nearby.length ? "" : "No EMT stops within 500 m.";
        showError("");
      } catch (err) {
        $("nearby-status").textContent = "";
        showError(err.message);
      }
      renderHome();
    },
    (err) => {
      $("nearby-status").textContent =
        err.code === err.PERMISSION_DENIED
          ? "Location permission was denied. Allow it to see stops near you."
          : "Couldn't get your location. Try again.";
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
  );
}

// ---------- stop view ----------

function renderFavButton() {
  const btn = $("fav-btn");
  if (!currentStop) return;
  const fav = isFavorite(currentStop.id);
  btn.innerHTML = fav ? "&#9733;" : "&#9734;";
  btn.setAttribute("aria-pressed", String(fav));
  btn.setAttribute("aria-label", fav ? "Remove from favorites" : "Save as favorite");
}

function renderArrivals(data) {
  $("title").textContent = data.stop.name;
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
    if (a.seconds < NO_ESTIMATE && a.distance >= 0) {
      const small = document.createElement("small");
      small.textContent = formatDistance(a.distance);
      eta.appendChild(small);
    }
    li.append(line, dest, eta);
    list.appendChild(li);
  }

  $("updated-text").textContent = `Live · updated ${new Date(data.updated).toLocaleTimeString()}`;
}

function ensureMap() {
  if (map) return;
  map = L.map("map");
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);
}

function renderMap(data) {
  ensureMap();
  const points = [];

  if (stopMarker) stopMarker.remove();
  stopMarker = null;
  if (data.stop.coords) {
    stopMarker = L.circleMarker(data.stop.coords, { radius: 9, color: "#d4002a", weight: 3, fillOpacity: 1, fillColor: "#fff" })
      .bindPopup(`<b>${escapeHtml(data.stop.name)}</b><br>Stop ${escapeHtml(data.stop.id)}`)
      .addTo(map);
    points.push(data.stop.coords);
  }

  if (userMarker) userMarker.remove();
  userMarker = null;
  if (userPos) {
    userMarker = L.circleMarker(userPos, { radius: 7, color: "#fff", weight: 2, fillOpacity: 1, fillColor: "#1a73e8" })
      .bindPopup("You")
      .addTo(map);
  }

  // Move existing bus markers to their new GPS position instead of recreating them.
  const seen = new Set();
  for (const a of data.arrivals) {
    if (!a.coords || a.seconds >= NO_ESTIMATE) continue;
    const key = `${a.bus}-${a.line}`;
    seen.add(key);
    const popup = `Line ${escapeHtml(a.line)} → ${escapeHtml(a.destination)}<br>${formatEta(a.seconds)} · ${formatDistance(a.distance)} away<br>Bus ${escapeHtml(a.bus)}`;
    let marker = busMarkers.get(key);
    if (marker) {
      marker.setLatLng(a.coords);
      marker.setPopupContent(popup);
    } else {
      const icon = L.divIcon({ className: "bus-icon", html: escapeHtml(a.line), iconSize: [34, 22] });
      marker = L.marker(a.coords, { icon }).bindPopup(popup).addTo(map);
      busMarkers.set(key, marker);
    }
    points.push(a.coords);
  }
  for (const [key, marker] of busMarkers) {
    if (!seen.has(key)) {
      marker.remove();
      busMarkers.delete(key);
    }
  }

  // Frame the stop and buses once per stop; after that leave the map where the user put it.
  if (!fitted && points.length) {
    if (points.length > 1) map.fitBounds(points, { padding: [30, 30], maxZoom: 17 });
    else map.setView(points[0], 16);
    fitted = true;
  }
  setTimeout(() => map.invalidateSize(), 0);
}

function clearMap() {
  for (const marker of busMarkers.values()) marker.remove();
  busMarkers.clear();
  if (stopMarker) stopMarker.remove();
  stopMarker = null;
  fitted = false;
}

async function refresh() {
  if (!currentStop) return;
  const id = currentStop.id;
  try {
    const data = await getJson(`/api/arrivals?stop=${encodeURIComponent(id)}`);
    if (!currentStop || id !== currentStop.id) return;
    currentStop.name = data.stop.name;
    // Keep a favorite's saved name in sync with EMT's.
    const fav = favorites.find((f) => f.id === id);
    if (fav && fav.name !== data.stop.name) {
      fav.name = data.stop.name;
      saveFavorites();
    }
    showError("");
    renderArrivals(data);
    renderMap(data);
  } catch (err) {
    if (currentStop && id === currentStop.id) showError(err.message);
  }
}

// ---------- routing (#stop/72) ----------

// True when the stop was opened from the home screen, so Back can return there via history.
let openedFromHome = false;

function openStop(id) {
  openedFromHome = true;
  location.hash = `#stop/${id}`;
}

function route() {
  clearInterval(timer);
  timer = null;
  showError("");
  const match = location.hash.match(/^#stop\/(\d{1,6})$/);

  if (match) {
    const id = match[1];
    const known = favorites.find((f) => f.id === id) || nearby.find((s) => s.id === id);
    currentStop = { id, name: known ? known.name : `Stop ${id}` };
    clearMap();
    $("home").hidden = true;
    $("stop-view").hidden = false;
    $("back-btn").hidden = false;
    $("fav-btn").hidden = false;
    $("title").textContent = currentStop.name;
    $("stop-meta").textContent = `Stop ${id}`;
    $("arrivals").innerHTML = "";
    $("updated-text").textContent = "Loading…";
    renderFavButton();
    refresh();
    timer = setInterval(refresh, REFRESH_MS);
  } else {
    currentStop = null;
    openedFromHome = false;
    $("home").hidden = false;
    $("stop-view").hidden = true;
    $("back-btn").hidden = true;
    $("fav-btn").hidden = true;
    $("title").textContent = "idiBre";
    renderHome();
  }
}

// ---------- events ----------

$("add-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const id = $("stop-input").value.trim();
  if (!/^\d{1,6}$/.test(id)) return showError("Enter the stop number (digits only).");
  $("stop-input").value = "";
  $("stop-input").blur();
  openStop(id);
});

for (const btn of document.querySelectorAll(".tabs button")) {
  btn.addEventListener("click", () => {
    tab = btn.dataset.tab;
    storageSet(TAB_KEY, tab);
    renderHome();
    if (tab === "nearby" && !nearby.length) findNearby();
  });
}

$("locate-btn").addEventListener("click", findNearby);
$("fav-btn").addEventListener("click", () => currentStop && toggleFavorite(currentStop));

$("back-btn").addEventListener("click", () => {
  // Opened from a direct link: go to the home screen instead of leaving the site.
  if (openedFromHome) history.back();
  else location.hash = "";
});

window.addEventListener("hashchange", route);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refresh();
});

if (!storageGet(FAV_KEY) && favorites.length) saveFavorites();
route();
