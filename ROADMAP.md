# AERIS-HK Roadmap

Living plan for the Atmospheric & Epidemiological Risk Inference System — Hong Kong.

## Phase 1 — Foundation (complete)

- [x] Next.js 14 App Router + TypeScript + Tailwind glassmorphism mission control
- [x] `.cursorrules` with `/goal` decomposition, EPSG:2326/4326 safety, WebGL SSR guards
- [x] Synthetic 50+ building GeoJSON twin for Sham Shui Po (Pei Ho, Fuk Wa, Tai Nan, Yu Chau, Apliu) and Yau Tsim Mong (Temple, Shanghai, Nathan)
- [x] HK80 (EPSG:2326) ↔ WGS84 (EPSG:4326) via LandsD/EPSG Helmert + TM
- [x] Gagge 2-node thermoregulation, Bishai-style strain, CVI 0–100, 6-hour thermal inertia
- [x] HA M/M/c surge for CMC, KWH, QEH overflow
- [x] DuckDB-WASM analytics (district hourly CVI, top-10 critical, policy deltas) with columnar fallback
- [x] Glassmorphism mission control, policy stress-tester, DH/WHO briefing, and browser-verified 3D twin

## Phase 2 — Live sensing

### `/goal` HKO Open Data webhook (complete)

- [x] SSR-safe Route Handlers `GET /api/hko/envelope` and `POST /api/hko/ingest`
- [x] Pull HKO rhrread (T/RH), 1-minute AWS CSV (Sham Shui Po / King's Park), warnsum WHOT, 9-day FND
- [x] Rolling 24-hour observed + forecast envelope replaces synthetic T/RH sinusoids in `lib/epidemiology-engine.ts`
- [x] Client remains DuckDB-WASM + Deck.gl; meteorology arrives as JSON from the Route Handler
- [x] Official WHOT drives the HUD badge; canyon WBGT remains an AERIS overlay

### `/goal` PostGIS HK80 synchronization (complete)

- [x] PostGIS `aeris.buildings.geom_hk80` (EPSG:2326) as the authoritative footprint store
- [x] Dual-write `geom_wgs84` (EPSG:4326) via `ST_Transform` trigger for Deck.gl
- [x] Arrow IPC snapshot `GET /api/spatial/footprints` loaded by client DuckDB-WASM
- [x] GeoJSON 4326 `GET /api/spatial/buildings` for the map
- [x] `scripts/ingest-hk80.sql` migration + `npm run ingest:hk80`
- [x] CRS round-trip tests (`npm run test:crs`) for JS Helmert/TM and PostGIS `ST_Transform`

### `/goal` HA CMS / A&E anonymised nowcast

Connect (or mock with realistic delays) Kowloon West A&E occupancy. Calibrate M/M/c μ and c from observed Cat 1–3 mix. Never ship patient-level identifiers.

### `/goal` Cool-roof targeting optimiser

Given a budget (m² of albedo retrofit), select the building set that maximises 24-hour admissions averted using DuckDB window functions.

## Phase 3 — Operationalisation

- [ ] Authentication and audit log for HA/DH users
- [ ] Traditional Chinese screen-reader pass and WCAG contrast on glass panels
- [ ] Automated visual regression of the Kowloon view state
- [ ] GPU particle layer (WebGPU compute) if ScatterplotLayer saturates at 60 FPS
- [ ] Durable observation store (Postgres/Redis) for the HKO ring buffer across serverless cold starts
