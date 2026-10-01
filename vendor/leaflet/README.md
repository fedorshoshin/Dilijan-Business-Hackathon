# Leaflet 1.9.4 — vendored

Unmodified, copied from `https://unpkg.com/leaflet@1.9.4/dist/` on 2026-10-01.

| File | Why it is here |
| --- | --- |
| `leaflet.js` | the library |
| `leaflet.css` | its own styles; `../../style.css` loads after it and overrides |
| `images/` | referenced by `leaflet.css`. Only the layers control and the default marker use them, and Havak uses neither — they are kept so the CSS can never 404 |
| `LICENSE` | BSD 2-Clause |

## Why vendored rather than a CDN

The site is static files on GitHub Pages and the app is an installable PWA that
has to open with no signal. A CDN would mean the map depends on a third party
being up, and `sw.js` only caches our own origin — so a CDN copy would be the
one part of the shell that vanished offline. Same origin fixes both.

## Upgrading

Replace the files, update the version here and in `js/map.js`'s header, and bump
`CACHE` in `sw.js` — installs hold the old shell until that changes.

Tiles are a separate matter: they come from OpenStreetMap at runtime, which
obliges us to show the attribution `js/map.js` puts on the map. If this ever
outgrows a pilot, the tile URL is the one line to point at a paid provider.
