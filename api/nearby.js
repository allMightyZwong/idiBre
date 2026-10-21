// Vercel serverless function: GET /api/nearby?lat=40.42&lng=-3.69&radius=400
// Returns EMT bus stops around a point, closest first.

import { emt, toLatLng } from "./_emt.js";

export default async function handler(req, res) {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const radius = Math.min(1000, Math.max(100, Number(req.query.radius) || 400));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return res.status(400).json({ error: "Invalid location" });
  }

  try {
    const body = await emt(`/v2/transport/busemtmad/stops/arroundxy/${lng}/${lat}/${radius}/`);
    const data = Array.isArray(body.data) ? body.data : [];

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      stops: data.slice(0, 30).map((s) => ({
        id: String(s.stopId),
        name: s.stopName || `Stop ${s.stopId}`,
        distance: Number(s.metersToPoint),
        coords: toLatLng(s.geometry),
        lines: [...new Set((s.lines || []).map((l) => String(l.label)))],
      })),
    });
  } catch (err) {
    return res.status(502).json({ error: err.message });
  }
}
