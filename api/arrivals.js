// Vercel serverless function: GET /api/arrivals?stop=72
// Logs in to EMT MobilityLabs with credentials from environment variables
// and returns the stop's details plus live bus arrival estimates.

const BASE = "https://openapi.emtmadrid.es";

let cached = { token: null, expires: 0 };

async function getToken(force = false) {
  if (!force && cached.token && Date.now() < cached.expires) return cached.token;

  // Prefer app credentials (X-ClientId + passKey); fall back to account email + password.
  let headers;
  if (process.env.EMT_CLIENT_ID && process.env.EMT_PASS_KEY) {
    headers = { "X-ClientId": process.env.EMT_CLIENT_ID, passKey: process.env.EMT_PASS_KEY };
  } else if (process.env.EMT_EMAIL && process.env.EMT_PASSWORD) {
    headers = { email: process.env.EMT_EMAIL, password: process.env.EMT_PASSWORD };
  } else {
    throw new Error("EMT credentials are not configured on the server");
  }

  const res = await fetch(`${BASE}/v2/mobilitylabs/user/login/`, { headers });
  const body = await res.json().catch(() => ({}));
  const data = body.data && body.data[0];
  if (!data || !data.accessToken) {
    throw new Error(`EMT login failed: ${body.description || res.status}`);
  }

  const ttl = Math.max(60, (Number(data.tokenSecExpiration) || 3600) - 60);
  cached = { token: data.accessToken, expires: Date.now() + ttl * 1000 };
  return cached.token;
}

async function emt(path, token, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { accessToken: token, "Content-Type": "application/json" },
  });
  return res.json().catch(() => ({}));
}

async function fetchStop(stop, token) {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const [arrivals, detail] = await Promise.all([
    emt(`/v2/transport/busemtmad/stops/${stop}/arrives/`, token, {
      method: "POST",
      body: JSON.stringify({
        cultureInfo: "EN",
        Text_StopRequired_YN: "Y",
        Text_EstimationsRequired_YN: "Y",
        Text_IncidencesRequired_YN: "N",
        DateTime_Referenced_Incidencies_YYYYMMDD: today,
      }),
    }),
    emt(`/v1/transport/busemtmad/stops/${stop}/detail/`, token),
  ]);
  return { arrivals, detail };
}

function toLatLng(geometry) {
  const c = geometry && geometry.coordinates;
  return Array.isArray(c) && c.length === 2 ? [c[1], c[0]] : null;
}

export default async function handler(req, res) {
  const stop = String(req.query.stop || "").trim();
  if (!/^\d{1,6}$/.test(stop)) {
    return res.status(400).json({ error: "Stop number must be digits only" });
  }

  try {
    let token = await getToken();
    let { arrivals, detail } = await fetchStop(stop, token);

    // Token may have expired on EMT's side; log in again once and retry.
    if (arrivals.code !== "00" && detail.code !== "00") {
      token = await getToken(true);
      ({ arrivals, detail } = await fetchStop(stop, token));
    }

    const info = detail.data && detail.data[0] && detail.data[0].stops && detail.data[0].stops[0];
    const arrive = (arrivals.data && arrivals.data[0] && arrivals.data[0].Arrive) || [];

    if (!info && arrive.length === 0 && arrivals.code !== "00") {
      return res.status(404).json({ error: arrivals.description || "Stop not found" });
    }

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      stop: {
        id: stop,
        name: info ? info.name : `Stop ${stop}`,
        address: info ? info.postalAddress || "" : "",
        coords: info ? toLatLng(info.geometry) : null,
      },
      arrivals: arrive
        .map((a) => ({
          line: String(a.line),
          destination: a.destination,
          seconds: Number(a.estimateArrive),
          distance: Number(a.DistanceBus),
          bus: a.bus,
          coords: toLatLng(a.geometry),
        }))
        .sort((a, b) => a.seconds - b.seconds),
      updated: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
}
