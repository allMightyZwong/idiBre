# idiBre

A simple app that shows live arrival times for Madrid EMT buses, with a map that tracks the approaching buses in real time.

- **Favorites** — tap ☆ on any stop to save it; your favorites are listed on the home screen to pick from.
- **Nearby** — lists the EMT stops around you (uses your location), closest first.
- **Stop number** — open any stop by the number on its sign.
- **Live map** — the stop, you, and each approaching bus at its real GPS position, updated every 15 seconds.
- Data comes from the [EMT MobilityLabs API](https://apidocs.emtmadrid.es/). Map by OpenStreetMap.

Live at **https://idibre.vercel.app**.

## Web app on Vercel

1. In Vercel, **Add New → Project** and import this GitHub repository. No build settings are needed.
2. In **Settings → Environment Variables**, add your MobilityLabs credentials — either:
   - `EMT_EMAIL` and `EMT_PASSWORD` (your mobilitylabs.emtmadrid.es account), or
   - `EMT_CLIENT_ID` and `EMT_PASS_KEY` (from an app registered in the MobilityLabs portal; used first if set).
3. Redeploy.

Credentials live only in Vercel's environment variables; they are never sent to the browser or stored in this repo.

## Android app

The `android/` folder is an Android Studio project: a full-screen app that shows the web app above, with location permission for **Nearby** and the back button wired to the app's screens.

1. Clone this repository, then in Android Studio choose **File → Open** and select the `android` folder.
2. Wait for Gradle sync to finish, pick a device or emulator, and press **Run ▶**.

The address it opens is set in `android/app/src/main/res/values/strings.xml` (`app_url`). Favorites are stored inside the app and survive restarts.

## Files

- `index.html`, `style.css`, `app.js` — the web app.
- `api/arrivals.js` — `GET /api/arrivals?stop=<number>` → stop details, arrival times and bus positions.
- `api/nearby.js` — `GET /api/nearby?lat=..&lng=..&radius=..` → stops around a point.
- `api/_emt.js` — shared EMT login and request helper.
- `android/` — Android Studio project (Java, no extra libraries, Android 8.0+).
