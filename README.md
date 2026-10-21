# idiBre

A very simple web app that shows live arrival times for Madrid EMT buses at the stops you save, with a map of the stop and the approaching buses.

- Add any stop by its number (shown on the sign at the stop). Saved stops are kept in your browser.
- Arrival times refresh every 30 seconds.
- Map uses OpenStreetMap (no key needed).
- Data comes from the [EMT MobilityLabs API](https://apidocs.emtmadrid.es/).

## Deploy on Vercel

1. In Vercel, **Add New → Project** and import this GitHub repository. No build settings are needed.
2. In **Settings → Environment Variables**, add your MobilityLabs credentials — either:
   - `EMT_EMAIL` and `EMT_PASSWORD` (your mobilitylabs.emtmadrid.es account), or
   - `EMT_CLIENT_ID` and `EMT_PASS_KEY` (from an app registered in the MobilityLabs portal; used first if set).
3. Redeploy. Open the site and add a stop number.

Credentials live only in Vercel's environment variables; they are never sent to the browser or stored in this repo.

## Files

- `index.html`, `style.css`, `app.js` — the page.
- `api/arrivals.js` — Vercel function that logs in to EMT and returns `{ stop, arrivals }` for `?stop=<number>`.
