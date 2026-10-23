const FAV_KEY = "idibre.favorites";
const OLD_KEY = "idibre.stops";
const TAB_KEY = "idibre.tab";
const REFRESH_MS = 15000;
const NO_ESTIMATE = 999999;
const SOON_SECONDS = 180;

const $ = (id) => document.getElementById(id);

const CHEVRON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9AA2AD" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
const BUS_GLYPH = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0B7A04" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><rect x="5" y="4" width="14" height="13" rx="2.5"/><path d="M8 20v-3M16 20v-3"/></svg>';

let favorites = loadFavorites();
let tab = storageGet(TAB_KEY) === "nearby" ? "nearby" : "favorites";
let editing = false;
let nearby = [];
let userPos = null;

let currentStop = null; // { id, name } of the stop being shown
let openedFromHome = false; // so Back can return via history instead of leaving the site
let stopTimer = null;
let heroTimer = null;

let map = null;
let stopMarker = null;
let userMarker = null;
const busMarkers = new Map();
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
  else favorites.push({ id: stop.id, name: stop.name, coords: stop.coords || null });
  saveFavorites();
  renderFavButton();
}

// Remember a favorite's name and position from fresh EMT data (older favorites were saved without a position).
function syncFavorite(stop) {
  const fav = favorites.find((f) => f.id === stop.id);
  if (!fav) return false;
  const changed = fav.name !== stop.name || (stop.coords && !fav.coords);
  if (changed) {
    fav.name = stop.name;
    if (stop.coords) fav.coords = stop.coords;
    saveFavorites();
  }
  return changed;
}

// ---------- location ----------

let locating = null;
let locationError = null;

function locate() {
  if (!navigator.geolocation) return Promise.resolve(null);
  if (!locating) {
    locating = new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          userPos = [pos.coords.latitude, pos.coords.longitude];
          locationError = null;
          resolve(userPos);
        },
        (err) => {
          locationError = err;
          resolve(null);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
      );
    }).finally(() => { locating = null; });
  }
  return locating;
}

function distanceMeters(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad;
  const dLng = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

// Favorites closest to you first; ones without a known position keep their saved order at the end.
function orderedFavorites() {
  return favorites
    .map((f, i) => ({ ...f, i, dist: userPos && f.coords ? distanceMeters(userPos, f.coords) : null }))
    .sort((a, b) => (a.dist ?? Infinity) - (b.dist ?? Infinity) || a.i - b.i);
}

let backfilling = false;

// Looks up the position of favorites saved before positions were stored, so they can be sorted.
async function backfillCoords() {
  if (backfilling || !userPos) return;
  const missing = favorites.filter((f) => !f.coords);
  if (!missing.length) return;
  backfilling = true;
  let changed = false;
  for (const f of missing) {
    try {
      const data = await fetchArrivals(f.id);
      changed = syncFavorite(data.stop) || changed;
    } catch {
      // Skip this one; it stays at the end of the list.
    }
  }
  backfilling = false;
  if (changed && !currentStop) {
    renderHome();
    refreshHero();
  }
}

// ---------- helpers ----------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

async function getJson(url) {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body;
}

let errorTimer = null;
function showError(message) {
  $("error").textContent = message || "";
  $("error").hidden = !message;
  clearTimeout(errorTimer);
  if (message) errorTimer = setTimeout(() => showError(""), 6000);
}

function formatEta(seconds) {
  if (seconds >= NO_ESTIMATE) return "45+ min";
  if (seconds < 60) return "Now";
  return `${Math.round(seconds / 60)} min`;
}

function formatDistance(m) {
  if (!(m >= 0)) return "";
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

function formatAway(m) {
  if (!(m >= 0)) return "";
  return m < 30 ? "At the stop" : `${formatDistance(m)} away`;
}

const SMALL_WORDS = new Set(["de", "del", "la", "las", "el", "los", "y", "a", "en"]);

// EMT sends destinations in capitals ("PUERTA DE TOLEDO"); show them as "Puerta de Toledo".
function titleCase(s) {
  return String(s || "")
    .toLowerCase()
    .split(" ")
    .map((w, i) => {
      if (i && SMALL_WORDS.has(w)) return w;
      if (/^[ivx]{2,}$/.test(w)) return w.toUpperCase(); // roman numerals: "Pio XII"
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(" ");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// One entry per line + destination, each with its buses in arrival order (next, then the one after).
function groupByLine(arrivals) {
  const groups = new Map();
  for (const a of arrivals) {
    const key = `${a.line}|${a.destination}`;
    if (!groups.has(key)) groups.set(key, { line: a.line, destination: titleCase(a.destination), buses: [] });
    groups.get(key).buses.push(a);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, buses: g.buses.sort((x, y) => x.seconds - y.seconds) }))
    .sort((x, y) => x.buses[0].seconds - y.buses[0].seconds);
}

const fetchArrivals = (id) => getJson(`/api/arrivals?stop=${encodeURIComponent(id)}`);

// ---------- home ----------

function stopRow(stop, { subtitle, tall, removable } = {}) {
  const li = document.createElement("li");
  const row = el("a", "stop-row" + (tall || subtitle ? " tall" : ""));
  row.href = `#stop/${stop.id}`;
  row.addEventListener("click", () => { openedFromHome = true; });

  const text = el("span", "stop-text");
  text.appendChild(el("span", "stop-name", stop.name));
  if (subtitle) text.appendChild(el("span", "stop-sub", subtitle));
  row.append(el("span", "stop-id", stop.id), text);

  if (removable && editing) {
    const remove = el("button", "remove-btn", "Remove");
    remove.type = "button";
    remove.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      favorites = favorites.filter((f) => f.id !== stop.id);
      saveFavorites();
      if (!favorites.length) editing = false;
      renderHome();
      refreshHero();
    });
    row.appendChild(remove);
  } else {
    row.insertAdjacentHTML("beforeend", CHEVRON);
  }

  li.appendChild(row);
  return li;
}

function renderHome() {
  for (const btn of document.querySelectorAll(".segmented button")) {
    btn.setAttribute("aria-selected", String(btn.dataset.tab === tab));
  }
  $("favorites-panel").hidden = tab !== "favorites";
  $("nearby-panel").hidden = tab !== "nearby";

  const favList = $("fav-list");
  favList.innerHTML = "";
  for (const f of orderedFavorites()) {
    favList.appendChild(stopRow(f, { subtitle: f.dist != null ? `${formatDistance(f.dist)} from you` : "", removable: true }));
  }
  $("saved-label").textContent = userPos ? "Saved stops · closest first" : "Saved stops";
  $("saved-section").hidden = favorites.length === 0;
  $("fav-empty").hidden = favorites.length > 0;
  $("edit-btn").textContent = editing ? "Done" : "Edit";
  if (!favorites.length) $("hero").hidden = true;

  const nearList = $("nearby-list");
  nearList.innerHTML = "";
  for (const s of nearby) {
    const lines = s.lines.join(", ");
    nearList.appendChild(stopRow(s, { subtitle: [formatDistance(s.distance), lines].filter(Boolean).join(" · "), tall: true }));
  }
  $("locate-btn").textContent = nearby.length ? "Refresh location" : "Find stops near me";
}

// The dark card on the home screen: live next bus at the closest favorite.
function renderHero(stop, data) {
  const hero = $("hero");
  hero.href = `#stop/${stop.id}`;
  hero.innerHTML = "";

  const head = el("div", "hero-head");
  head.appendChild(el("span", "hero-stop", `${data ? data.stop.name : stop.name} · ${stop.id}`));
  const live = el("span", "hero-live");
  live.append(el("span", "dot"), document.createTextNode("Live"));
  head.appendChild(live);
  hero.appendChild(head);

  const groups = data ? groupByLine(data.arrivals) : [];
  if (!data || !groups.length) {
    hero.appendChild(el("div", "hero-note", data ? "No buses expected right now." : "Loading…"));
    hero.hidden = false;
    return;
  }

  const [first, ...rest] = groups;
  const bus = first.buses[0];
  const main = el("div", "hero-main");
  const left = el("div", "hero-line");
  left.append(el("span", "line-badge", first.line), el("span", "hero-dest", `to ${first.destination}`));
  const right = el("div", "hero-eta");
  right.append(
    el("div", "big" + (bus.seconds < SOON_SECONDS ? " soon" : ""), formatEta(bus.seconds)),
    el("div", "small", bus.seconds < NO_ESTIMATE ? formatAway(bus.distance) : "")
  );
  main.append(left, right);
  hero.append(main, el("div", "hero-divider"));

  const chips = el("div", "hero-chips");
  for (const g of rest.slice(0, 2)) {
    const chip = el("span", "chip");
    chip.append(el("b", null, g.line), document.createTextNode(formatEta(g.buses[0].seconds)));
    chips.appendChild(chip);
  }
  const all = el("span", "hero-all", "All");
  all.insertAdjacentHTML("beforeend", '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>');
  chips.appendChild(all);
  hero.appendChild(chips);
  hero.hidden = false;
}

async function refreshHero() {
  const stop = orderedFavorites()[0];
  if (!stop || currentStop) {
    if (!stop) $("hero").hidden = true;
    return;
  }
  if ($("hero").hidden || $("hero").dataset.stop !== stop.id) {
    $("hero").dataset.stop = stop.id;
    renderHero(stop, null);
  }
  try {
    const data = await fetchArrivals(stop.id);
    syncFavorite(data.stop);
    if (!currentStop && $("hero").dataset.stop === stop.id) renderHero(stop, data);
  } catch (err) {
    showError(err.message);
  }
}

async function findNearby() {
  if (!navigator.geolocation) {
    $("nearby-status").textContent = "Location isn't available on this device.";
    return;
  }
  $("nearby-status").textContent = "Finding your location…";
  if (!(await locate())) {
    $("nearby-status").textContent =
      locationError && locationError.code === locationError.PERMISSION_DENIED
        ? "Location permission was denied. Allow it to see stops near you."
        : "Couldn't get your location. Try again.";
    return;
  }
  $("nearby-status").textContent = "Loading nearby stops…";
  try {
    const data = await getJson(`/api/nearby?lat=${userPos[0]}&lng=${userPos[1]}&radius=500`);
    nearby = data.stops;
    $("nearby-status").textContent = nearby.length ? "" : "No EMT stops within 500 m.";
  } catch (err) {
    $("nearby-status").textContent = "";
    showError(err.message);
  }
  renderHome();
}

// Re-reads your location, then re-sorts favorites and refreshes the live card (and nearby list if open).
async function refreshHome() {
  await locate();
  if (currentStop) return;
  renderHome();
  backfillCoords();
  await Promise.all([refreshHero(), tab === "nearby" ? findNearby() : null]);
}

// ---------- stop page ----------

function renderFavButton() {
  if (!currentStop) return;
  const fav = isFavorite(currentStop.id);
  $("fav-btn").setAttribute("aria-pressed", String(fav));
  $("fav-btn").setAttribute("aria-label", fav ? "Remove from favorites" : "Add to favorites");
}

function renderNextCard(groups) {
  const card = $("next-card");
  card.innerHTML = "";
  if (!groups.length) {
    card.appendChild(el("span", "eyebrow", "Next bus"));
    card.appendChild(el("div", "dest", "No buses expected right now."));
    return;
  }

  const first = groups[0];
  const bus = first.buses[0];
  const after = first.buses[1];
  const hasEstimate = bus.seconds < NO_ESTIMATE;

  const head = el("div", "row-between");
  head.append(el("span", "eyebrow", "Next bus"), el("span", "away", hasEstimate ? formatAway(bus.distance) : ""));

  const main = el("div", "hero-main");
  const left = el("div", "hero-line");
  left.append(el("span", "line-badge", first.line), el("span", "dest", first.destination));
  if (after) left.appendChild(el("span", "then", `then ${formatEta(after.seconds)}`));
  main.append(left, el("div", "big", formatEta(bus.seconds)));

  card.append(head, main);

  // How far along its approach the bus is: closer to the stop = further right.
  if (hasEstimate) {
    const pct = Math.round(Math.max(0.06, Math.min(0.94, 1 - bus.distance / 1500)) * 100);
    const progress = el("div", "progress");
    const rail = el("div", "rail");
    const fill = el("div", "fill");
    fill.style.width = `${pct}%`;
    const marker = el("div", "bus");
    marker.style.left = `${pct}%`;
    marker.innerHTML = BUS_GLYPH;
    progress.append(rail, fill, marker, el("div", "stop"));
    card.appendChild(progress);
  }
}

function renderLines(groups) {
  const list = $("lines");
  list.innerHTML = "";
  for (const g of groups) {
    const [bus, after] = g.buses;
    const li = document.createElement("li");
    const row = el("div", "line-row");

    const text = el("span", "stop-text");
    text.append(
      el("span", "stop-name", g.destination),
      el("span", "stop-sub", bus.seconds < NO_ESTIMATE ? formatAway(bus.distance) : "No estimate yet")
    );

    const eta = el("span", "eta-col");
    eta.appendChild(el("span", "first" + (bus.seconds < SOON_SECONDS ? " soon" : ""), formatEta(bus.seconds)));
    eta.appendChild(el("span", "next", after ? `then ${formatEta(after.seconds)}` : "no later bus yet"));

    row.append(el("span", "badge", g.line), text, eta);
    li.appendChild(row);
    list.appendChild(li);
  }
}

function renderStop(data) {
  const groups = groupByLine(data.arrivals);
  $("stop-name").textContent = data.stop.name;
  $("stop-badge").textContent = `Stop ${data.stop.id}`;
  $("stop-address").textContent = data.stop.address || "";
  $("live-text").textContent = `Live · ${new Date(data.updated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
  renderNextCard(groups);
  renderLines(groups);
  renderMap(data);
}

function ensureMap() {
  if (map) return;
  map = L.map("map", { zoomControl: false, attributionControl: true });
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap",
  }).addTo(map);
}

function renderMap(data) {
  ensureMap();
  const points = [];

  if (stopMarker) stopMarker.remove();
  stopMarker = null;
  if (data.stop.coords) {
    stopMarker = L.marker(data.stop.coords, {
      icon: L.divIcon({ className: "map-stop", iconSize: [26, 26] }),
      zIndexOffset: 500,
    })
      .bindPopup(`<b>${escapeHtml(data.stop.name)}</b><br>Stop ${escapeHtml(data.stop.id)}`)
      .addTo(map);
    points.push(data.stop.coords);
  }

  if (userMarker) userMarker.remove();
  userMarker = null;
  if (userPos) {
    userMarker = L.marker(userPos, { icon: L.divIcon({ className: "map-you", iconSize: [16, 16] }) })
      .bindPopup("You")
      .addTo(map);
  }

  // Move existing bus markers to their new GPS position instead of recreating them.
  const seen = new Set();
  for (const a of data.arrivals) {
    if (!a.coords || a.seconds >= NO_ESTIMATE) continue;
    const key = `${a.bus}-${a.line}`;
    seen.add(key);
    const popup = `Line ${escapeHtml(a.line)} → ${escapeHtml(titleCase(a.destination))}<br>${formatEta(a.seconds)} · ${formatAway(a.distance)}`;
    let marker = busMarkers.get(key);
    if (marker) {
      marker.setLatLng(a.coords);
      marker.setPopupContent(popup);
    } else {
      const icon = L.divIcon({ className: "", html: `<span class="map-bus">${escapeHtml(a.line)}</span>`, iconSize: [0, 0] });
      marker = L.marker(a.coords, { icon }).bindPopup(popup).addTo(map);
      busMarkers.set(key, marker);
    }
    // Only frame buses that are close, so far-away ones don't zoom the map out to the whole city.
    if (a.distance <= 1200) points.push(a.coords);
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

function setFullscreen(on) {
  $("map-wrap").classList.toggle("fullscreen", on);
  $("map-close").hidden = !on;
  document.body.style.overflow = on ? "hidden" : "";
  if (map) setTimeout(() => map.invalidateSize(), 0);
}

async function refreshStop() {
  if (!currentStop) return;
  const id = currentStop.id;
  try {
    const data = await fetchArrivals(id);
    if (!currentStop || id !== currentStop.id) return;
    currentStop.name = data.stop.name;
    currentStop.coords = data.stop.coords;
    syncFavorite(data.stop);
    renderStop(data);
  } catch (err) {
    if (currentStop && id === currentStop.id) showError(err.message);
  }
}

// ---------- routing (#stop/72) ----------

function route() {
  clearInterval(stopTimer);
  clearInterval(heroTimer);
  stopTimer = heroTimer = null;
  setFullscreen(false);
  const match = location.hash.match(/^#stop\/(\d{1,6})$/);

  if (match) {
    const id = match[1];
    const known = favorites.find((f) => f.id === id) || nearby.find((s) => s.id === id);
    currentStop = { id, name: known ? known.name : `Stop ${id}`, coords: known ? known.coords : null };
    clearMap();
    $("home").hidden = true;
    $("stop-view").hidden = false;
    $("stop-name").textContent = currentStop.name;
    $("stop-badge").textContent = `Stop ${id}`;
    $("stop-address").textContent = "";
    $("live-text").textContent = "Loading…";
    $("next-card").innerHTML = '<span class="eyebrow">Next bus</span>';
    $("lines").innerHTML = "";
    renderFavButton();
    window.scrollTo(0, 0);
    refreshStop();
    stopTimer = setInterval(refreshStop, REFRESH_MS);
  } else {
    currentStop = null;
    openedFromHome = false;
    $("home").hidden = false;
    $("stop-view").hidden = true;
    renderHome();
    refreshHero();
    refreshHome();
    heroTimer = setInterval(refreshHero, REFRESH_MS);
  }
}

// ---------- events ----------

$("search").addEventListener("submit", (e) => {
  e.preventDefault();
  const id = $("stop-input").value.trim();
  if (!/^\d{1,6}$/.test(id)) return showError("Enter the stop number (digits only).");
  $("stop-input").value = "";
  $("stop-input").blur();
  openedFromHome = true;
  location.hash = `#stop/${id}`;
});

for (const btn of document.querySelectorAll(".segmented button")) {
  btn.addEventListener("click", () => {
    tab = btn.dataset.tab;
    storageSet(TAB_KEY, tab);
    renderHome();
    if (tab === "nearby" && !nearby.length) findNearby();
  });
}

$("hero").addEventListener("click", () => { openedFromHome = true; });

$("edit-btn").addEventListener("click", () => {
  editing = !editing;
  renderHome();
});

$("locate-btn").addEventListener("click", findNearby);
$("fav-btn").addEventListener("click", () => currentStop && toggleFavorite(currentStop));
$("fullscreen-btn").addEventListener("click", () => setFullscreen(true));
$("map-close").addEventListener("click", () => setFullscreen(false));

$("back-btn").addEventListener("click", () => {
  // Opened from a direct link: go to the home screen instead of leaving the site.
  if (openedFromHome) history.back();
  else location.hash = "";
});

window.addEventListener("hashchange", route);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (currentStop) refreshStop();
  else refreshHome();
});

// ---------- pull to refresh ----------

const PTR_TRIGGER = 64; // px the indicator must be pulled down to refresh
let ptrStartY = null;
let ptrPull = 0;
let ptrBusy = false;

function setPtr(pull, spinning) {
  const ptr = $("ptr");
  ptr.classList.toggle("spinning", spinning);
  ptr.classList.toggle("ready", pull >= PTR_TRIGGER);
  ptr.style.transform = `translate(-50%, ${pull - 56}px) rotate(${spinning ? 0 : pull * 4}deg)`;
  ptr.style.opacity = String(Math.min(1, pull / 40));
}

document.addEventListener("touchstart", (e) => {
  if (ptrBusy || window.scrollY > 0 || e.touches.length !== 1) return;
  if (e.target.closest("#map-wrap") || $("map-wrap").classList.contains("fullscreen")) return;
  ptrStartY = e.touches[0].clientY;
  ptrPull = 0;
  $("ptr").classList.add("dragging");
}, { passive: true });

document.addEventListener("touchmove", (e) => {
  if (ptrStartY == null) return;
  const dy = e.touches[0].clientY - ptrStartY;
  if (dy <= 0 || window.scrollY > 0) {
    ptrPull = 0;
    setPtr(0, false);
    return;
  }
  e.preventDefault(); // stop the page itself from scrolling or bouncing while pulling
  ptrPull = Math.min(110, dy * 0.5);
  setPtr(ptrPull, false);
}, { passive: false });

document.addEventListener("touchend", async () => {
  if (ptrStartY == null) return;
  ptrStartY = null;
  $("ptr").classList.remove("dragging");
  if (ptrPull < PTR_TRIGGER) {
    setPtr(0, false);
    return;
  }
  ptrBusy = true;
  setPtr(PTR_TRIGGER, true);
  const minSpin = new Promise((r) => setTimeout(r, 600));
  await Promise.all([currentStop ? refreshStop() : refreshHome(), minSpin]);
  setPtr(0, false);
  ptrBusy = false;
});

if (!storageGet(FAV_KEY) && favorites.length) saveFavorites();
route();
