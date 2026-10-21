// Shared EMT MobilityLabs helpers. Files starting with "_" are not exposed as routes by Vercel.

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

async function request(path, token, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { accessToken: token, "Content-Type": "application/json" },
  });
  return res.json().catch(() => ({}));
}

// Calls EMT; if the answer is not OK (e.g. the token expired on EMT's side), logs in again and retries once.
export async function emt(path, options) {
  const body = await request(path, await getToken(), options);
  if (body.code === "00") return body;
  return request(path, await getToken(true), options);
}

export function toLatLng(geometry) {
  const c = geometry && geometry.coordinates;
  return Array.isArray(c) && c.length === 2 ? [c[1], c[0]] : null;
}
