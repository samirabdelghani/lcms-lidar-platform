# Runway Core — PGR Multi-Sensor Analytics Platform

Enterprise survey workspace for pavement (LCMS) and mobile-mapping (LiDAR) field data.
Web port of `pgr_viewer_pro_v7_unified.py`, with all parsing running fully in the browser.

## Features

- **Dual-mode launcher** — LCMS Mode or LiDAR Geospatial Mode.
- **LCMS parser** — ingests raw JSON-per-line `.TXT` logs, decodes NMEA `GGA` / `RMC`
  sentences, and extracts chainage / odometer / speed telemetry.
- **LiDAR parser** — `.KML` and compressed `.KMZ` (unzipped client-side) into one or more
  trajectory runs.
- **PGR binary scanner** — locates `0xFFFFFFFF` sync flags inside `.PGR` laser streams.
- **Interactive map** — Leaflet + Esri World Imagery / OSM / CARTO Dark basemaps with
  polyline track overlay, start/end markers, and toggleable structural layers.
- **Telemetry dashboard** — strict two-decimal formatting on chainage, speed,
  displacement, and acquisition rate.
- **Engineering console** — timestamped, level-coloured log stream.

## Local development

```bash
bun install
bun run dev
```

## Deploy to GitHub Pages

1. Push to GitHub.
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. The workflow in `.github/workflows/deploy.yml` builds the client bundle and
   publishes `dist/client` on every push to `main`.

The site is a static SPA — no server, no uploads. All file parsing happens locally.

## Credits

Original desktop platform: **Eng. Samir Abozahra** (v7.0 Unified).
