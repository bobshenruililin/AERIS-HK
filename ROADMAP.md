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

### `/goal` HA CMS / A&E anonymised nowcast (complete)

- [x] Live HA Open Data A&E waits (`aedwtdata2-en.json`) for CMC, KWH, QEH — hospital-level only
- [x] Delayed CMS occupancy mock (15-minute census lag) with optional aggregate occupancy webhook
- [x] M/M/c μ calibrated from observed Cat 1–3 mix; c calibrated from Cat 3 p50 wait
- [x] Privacy gate rejects patient-level keys / HKID-shaped tokens (`npm run test:ha`)
- [x] `GET /api/ha/nowcast` and `POST /api/ha/ingest` never ship patient identifiers

### `/goal` Cool-roof targeting optimiser (complete)

- [x] Roof area (m²) from HK80 shoelace / PostGIS `ST_Area(geom_hk80)` on every footprint
- [x] Budget slider in m² of albedo retrofit; default 8% of roof stock
- [x] DuckDB `ROW_NUMBER` + running `SUM(roof_m2) OVER` selects the building set that maximises 24-hour admissions averted per m²
- [x] Local Gagge/CVI physics apply only to targeted ids; district cooling scales with selected area / stock
- [x] Map gold outlines, HUD, and DH/WHO briefing show the selected set
- [x] `npm run test:cool-roof` (greedy ≡ window prefix, shoelace area, ranking vs worst-set)

### `/goal` Year-grade mission control

- [x] Exact 0/1 knapsack targeting (beats prefix-greedy); DuckDB windows still rank
- [x] Sun-tracked lighting, harbour fly-in, heat plumes, cool-roof discs, catchment arcs
- [x] Mission strip + Gagge interrogation + sky-view / H/W physics
- [x] 24-hour baseline vs scenario arrival sparkline
- [x] Software ENU twin that still looks like the city when WebGL is absent
- [x] Causal strip (heat → Gagge → CVI → A&E → M/M/c → knapsack) and briefing tour
- [x] Expanded Sham Shui Po / Yau Tsim Mong street stock (Ki Lung, Kweilin, Portland, Reclamation)

## Phase 3 — Decade observatory

- [x] 2016–2026 episode replay + cumulative cool-roof counterfactual
- [x] Neon claimable archive + policy audit log
- [x] Knapsack ensemble uncertainty band
- [x] City-scale infill and cinematic stills
- [ ] Figma / Notion / Canva / Drive MCP (requires Cursor desktop authentication)
- [ ] Authentication and audit log for HA/DH users (login)
- [ ] Traditional Chinese screen-reader pass and WCAG contrast on glass panels
- [ ] Automated visual regression of the Kowloon view state
- [ ] GPU particle layer (WebGPU compute) if ScatterplotLayer saturates at 60 FPS
- [ ] Durable observation store (Postgres/Redis) for the HKO ring buffer across serverless cold starts

## Phase 4 — Planetary twin (this goal)

- [x] Merge FastAPI territory index with the Next.js twin; union `.gitignore`; whitepaper README
- [x] VisionOS Control Dock + pinned inspector + ⌘K districts/snapshots (no feature deletions)
- [x] Cinematic harbour fly-in, look-at, and orbital camera
- [x] Neon Drizzle `?sim=uuid` + DuckDB-WASM Arrow IPC + ENU spatial hash (sub-10 ms)
- [x] CityJSON 2.0 / H3 GeoJSON / Kepler-style packed GPU instances
- [x] Astronomical solar rays, canyon shadows, Tong Lau inertia, Venturi GPU streamlines, convective plumes
- [x] Monte Carlo 95% CI violins (1,000 draws) retained on the policy drawer
- [x] `SYSTEM_INTELLIGENCE.md` formulas and benches
- [x] Deck.gl 20k instanced extrusions + LoD culling; Arrow <5 ms scrub; DuckDB Worker isolation; Neon spatial/timestamp indexes + SWR
- [x] Multi-cluster CMC/KWH → PMH/QEH rebalancing at 120% beds; ambulance vectors on West Kowloon Corridor / Nathan Road
- [x] Super Typhoon + post-storm heat surge and 劏房 3 AM concrete thermal-battery stress plates
- [x] Executive Briefing Mode (population at risk, HA bed deficit, ROI/$)
- [x] Full-stack hardening: WebGL/WASM/Worker failover, error boundaries, hydration gate, keyboard 1–4/Space/⌘K/Esc, formula micro-tooltips, `tsc --noEmit` clean
- [x] Spatial Policy Copilot: Zod tool calling (`run_counterfactual` / `focus_hotspot` / `query_hospital_capacity` / `compare_scenarios`), Deck.gl + TwinCanvas fly-to + peak-hour scrub + green/red CVI diffs, click-to-highlight physics citations
- [ ] Figma / Notion / Canva / Drive MCP (requires Cursor desktop authentication)
- [ ] Authentication and audit log for HA/DH users (login)
- [ ] Traditional Chinese screen-reader pass and WCAG contrast on glass panels
- [ ] Automated visual regression of the Kowloon view state
- [ ] GPU particle layer (WebGPU compute) if ScatterplotLayer saturates at 60 FPS
