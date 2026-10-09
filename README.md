# Cleaner Armenia

Report polluted spots in Dilijan, clean them up and get paid, or fund the work
and see exactly what your money paid for.

Live at <https://fedorshoshin.github.io/Dilijan-Business-Hackathon/>.

This repo is the app: plain HTML, CSS and JS, published as-is by GitHub Pages,
with no build step. The API it talks to lives in
[cleaner-armenia-back](https://github.com/fedorshoshin/cleaner-armenia-back)
(private); comments here that mention `BACKEND.md`, `server/` or `sql/` mean
files in that repo.

| Path | Holds |
| --- | --- |
| `index.html` | the landing page |
| `app.html`, `js/`, `style.css` | the installable app (PWA) |
| `sw.js`, `manifest.webmanifest`, `icons/` | offline and install; bump `CACHE` in `sw.js` on every change |
| `vendor/leaflet/` | the map library |
| `hackathon/` | the original hackathon demo, pitch and pitch PDF |
| `DESIGN.md` | what is being built, phase by phase |
| `WALKTHROUGH.md` | the real-phone test checklist |
