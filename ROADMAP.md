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

## Phase 2 — Live sensing (`/goal` prompts)

Copy-paste these into a new agent once Phase 1 is on `main`.

### `/goal` HKO Open Data webhook

Ingest live HKO temperature, humidity, and Very Hot Weather Warning from `data.weather.gov.hk`. Replace synthetic diurnal forcing in `lib/epidemiology-engine.ts` with a rolling 24-hour observed + forecast envelope. Keep SSR-safe fetch in a Route Handler; client remains DuckDB + Deck.gl.

### `/goal` PostGIS HK80 synchronization

Stand up PostGIS (`EPSG:2326`) for authoritative footprints. Publish Arrow IPC snapshots to the client DuckDB engine. Dual-write WGS84 for Deck.gl. Add a `scripts/ingest-hk80.sql` migration and CRS round-trip tests.

### `/goal` HA CMS / A&E anonymised nowcast

Connect (or mock with realistic delays) Kowloon West A&E occupancy. Calibrate M/M/c μ and c from observed Cat 1–3 mix. Never ship patient-level identifiers.

### `/goal` Cool-roof targeting optimiser

Given a budget (m² of albedo retrofit), select the building set that maximises 24-hour admissions averted using DuckDB window functions.

## Phase 3 — Operationalisation

- [ ] Authentication and audit log for HA/DH users
- [ ] Traditional Chinese screen-reader pass and WCAG contrast on glass panels
- [ ] Automated visual regression of the Kowloon view state
- [ ] GPU particle layer (WebGPU compute) if ScatterplotLayer saturates at 60 FPS
