// Vercel serverless function: GET /api/arrivals?stop=72
// Returns the stop's details plus live bus arrival estimates and bus positions.

import { emt, toLatLng } from "./_emt.js";

export default async function handler(req, res) {
  const stop = String(req.query.stop || "").trim();
  if (!/^\d{1,6}$/.test(stop)) {
    return res.status(400).json({ error: "Stop number must be digits only" });
  }

  try {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const [arrivals, detail] = await Promise.all([
      emt(`/v2/transport/busemtmad/stops/${stop}/arrives/`, {
        method: "POST",
        body: JSON.stringify({
          cultureInfo: "EN",
          Text_StopRequired_YN: "Y",
          Text_EstimationsRequired_YN: "Y",
          Text_IncidencesRequired_YN: "N",
          DateTime_Referenced_Incidencies_YYYYMMDD: today,
        }),
      }),
      emt(`/v1/transport/busemtmad/stops/${stop}/detail/`),
    ]);

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
