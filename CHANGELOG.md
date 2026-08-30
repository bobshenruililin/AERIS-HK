# Changelog

All notable changes to AERIS-HK are documented here.

## [0.11.0] — 2026-08-30

### Added

- Multi-cluster load rebalancing in `lib/hospital-triage.ts`: when CMC or KWH exceed 120% staffed acute beds, excess inpatients board onto Princess Margaret (PMH) and Queen Elizabeth (QEH). PMH is a transfer receiver with a small primary catchment so total λ is unchanged.
- Deck.gl / TwinCanvas ambulance particles along West Kowloon Corridor and Nathan Road (WGS84 polylines, PathLayer + ScatterplotLayer; skipped at district LoD).
- Stress plates: **Super Typhoon + Post-Storm Heat Surge** (Sham Shui Po coastal flooding + post-cyclone humidity) and **Subdivided Flat Concrete Thermal Battery (3 AM Peak)**.
- One-click **Executive Briefing Mode**: population at risk (CVI ≥ 70 / indoor ≥ 32°C / indoor WBGT ≥ 28), projected HA bed deficit (post-rebalance), and ROI per intervention dollar.
- Tests: `test:triage`, `test:briefing`; scenario matrix now five plates.

### Changed

- Occupancy clamp raised to 1.45 pre-transfer so 120% overflow is reachable; policy-impact mortality/deficit averages over `hospitals.length` (four nodes).
- Control Dock labels Super TY / 3 AM; HA nowcast TARGET_CODES include Princess Margaret Hospital. Neon cluster ids remain CMC / KWH / QEH.

## [0.10.0] — 2026-08-30

### Added

- Deck.gl instanced `ColumnLayer` with Kepler-style `instancePositions` / `instanceColors` (≥20,480 extrusions). District LoD uses 4-sided disks; street LoD restores 168 true GeoJSON footprints. Particle / wind layers are memo-split from building layers so zoom/pan/scrub does not rebuild topology.
- Hour-major Arrow column store (`lib/arrow-columns.ts`) for timeline scrub queries inside a 5 ms frame budget; HUD prints `Arrow scrub` separately from DuckDB ingest.
- Named DuckDB-WASM Worker (`aeris-duckdb`) with a persistent connection; ingest is fingerprint-skipped and no longer re-runs on playbar scrub.
- Neon composite indexes: `(centroid_lon, centroid_lat)`, `(district, centroid_lon, centroid_lat)`, `(created_at, scenario_name)`, `(run_id, timestamp)`, `(timestamp, cluster_id)`.
- Client SWR cache for `/api/simulations` list and snapshot (`lib/sim-cache.ts`) — in-flight dedupe + 30 s TTL.
- TwinCanvas district LoD: 20k centroid boxes, no per-face rings / shadows / wind trails; H3 aggregation moved off the rAF hot path.
- `PERFORMANCE_AUDIT.md` before/after benches. Tests: `test:instance`, `test:arrow`, `test:cache`.

### Changed

- `runAerisAnalytics` depends on buildings / hourly cache / policy / footprints, not `queryHour`.

## [0.9.0] — 2026-08-30

### Added

- Dual-scale merge with `origin/main`: FastAPI 18-district risk index (`aeris_hk/`, port 8000) lives beside the Kowloon West Next.js twin (port 3000). `.gitignore` keeps every Node and Python ignore rule. `.cursor/environment.json` installs and runs both stacks.
- Whitepaper README and `SYSTEM_INTELLIGENCE.md` (architecture, formulas, CRS/SSR, benches).
- ENU typed-array spatial grid (`lib/spatial-grid.ts`) — bbox / kNN over 24k–50k urban vectors in sub-10 ms; HUD ticker reports live timings.
- CityJSON 2.0 HK80 solids (`lib/cityjson.ts`, `GET /api/spatial/cityjson`).
- Cinematic orbital camera (`TWIN_ORBIT_EVENT`, Control Dock globe, key `O`).
- Astronomical solar disc, ray, and ground-plane building shadows on TwinCanvas; `castGroundShadow` in `lib/solar-engine.ts`.
- Venturi alley streamlines: particle trails (amber when squeezed) plus Deck.gl `VenturiStreamExtension` GPU pulse.
- ⌘K district jumps (Sham Shui Po / Yau Tsim Mong).

### Changed

- Wind particles carry `venturi`, `stalled`, and a 6-point trail. GPU ScatterplotLayer colour-codes acceleration vs stall.

## [0.8.0] — 2026-08-30

### Added

- Decade observatory: replay 2016–2026 heat episodes against the live HKO envelope; Bishai-style RR scales cool-roof counterfactuals; cumulative Σ if today's roofs had been locked each summer.
- Neon claimable archive (`NEON_DATABASE_URL`) for episode rows and policy audit; in-session audit trail on every policy mutation.
- Knapsack ensemble band (p10–p90) on local admissions averted.
- City-scale infill (≥150 tong lau). Cinematic stills behind the twin (`public/decade`).
- Design tokens, `docs/DECADE.md` ops wiki, Gmail `AERIS-HK/Decade` label for DH drafts.

## [0.7.0] — 2026-08-30

### Added

- Always-on software Kowloon twin (Canvas2D, WGS84 → local ENU metres) with harbour fly-in, sun-lit extrusions, gold knapsack roofs, heat plumes, catchment arcs, and hospital picking — Deck.gl mounts only when a real GPU context exists.
- Causal strip: HKO heat → Gagge S → CVI → A&E λ → M/M/c → knapsack Δ, interrogable from the mission header.
- One-click briefing tour (harbour → 15:00 peak → hottest Gagge node → locked roofs → KWH catchment).
- Four additional tong-lau streets (Ki Lung, Kweilin, Portland, Reclamation). Gagge identity test `S = M − W − E − R − C` on every footprint.

## [0.6.0] — 2026-08-30

### Added

- Exact 0/1 knapsack cool-roof selector (true maximum 24-hour admissions averted under the m² budget); DuckDB window functions still rank the same table for comparison.
- Cinematic twin: harbour fly-in, sun-tracked lighting, CVI heat plumes, gold cool-roof discs, street spines, and hospital catchment arcs.
- Mission strip with 24h baseline-vs-scenario arrival sparkline; Gagge S = M − W − E − R − C inspector; sky-view factor / canyon H/W; roof absorbed shortwave.
- Click a hospital node to isolate catchment flow. Policy drawer reports knapsack vs window-greedy delta.

### Changed

- Canyon air temperature includes an Oke-style sky-view term. Confetti removed from the policy board.

## [0.5.0] — 2026-08-30

### Added

- Cool-roof targeting optimiser: given a roof-area budget (m²), DuckDB-WASM window functions (`ROW_NUMBER`, running `SUM(roof_m2) OVER`) pick the building set that maximises 24-hour catchment-weighted admissions averted.
- HK80 shoelace / PostGIS `ST_Area(geom_hk80)` roof areas on every footprint (`properties.roofAreaM2`, Arrow `roof_m2`).
- Policy drawer m² budget slider, gold map outlines for the selected set, and briefing table of targeted roofs.
- `npm run test:cool-roof` for shoelace area, window SQL, greedy prefix, and ranking vs a worst-efficiency equal-area set.

### Changed

- Cool-roof physics is per-building (targeted ids get full albedo) with district air-temperature cooling scaled as 50 × selected m² / stock (full stock matches the old 50% slider).

## [0.4.0] — 2026-08-30

### Added

- Anonymised HA A&E nowcast: live Open Data waits for CMC / KWH / QEH plus delayed CMS occupancy aggregates.
- M/M/c μ calibrated from Cat 1–3 mix and server count c from Cat 3 p50 wait.
- `GET /api/ha/nowcast`, `POST /api/ha/ingest`, and `npm run test:ha` privacy + calibration suite.

### Changed

- Hospital surge board shows calibrated μ/c, HA Cat 3 wait, and occupancy source (delayed census vs model).

## [0.3.0] — 2026-08-30

### Added

- PostGIS HK80 (EPSG:2326) authority store `aeris.buildings` with dual-write WGS84 (EPSG:4326) for Deck.gl.
- Arrow IPC footprint snapshots at `GET /api/spatial/footprints` ingested by DuckDB-WASM (`insertArrowTable` / `read_ipc`).
- GeoJSON 4326 at `GET /api/spatial/buildings` and `POST /api/spatial/ingest`.
- `scripts/ingest-hk80.sql` migration, `npm run ingest:hk80`, and `npm run test:crs` round-trip suite.

### Changed

- Client analytics join hourly CVI to PostGIS footprints over Arrow IPC instead of JSON-only ingest.

## [0.2.0] — 2026-08-30

### Added

- Live HKO Open Data ingest: `GET /api/hko/envelope` and `POST /api/hko/ingest` (pull + webhook sample).
- Rolling 24-hour observed + forecast meteorological envelope (Kowloon AWS T/RH, WHOT, 9-day FND).
- HUD ticker for Sham Shui Po / King's Park temperatures, official WHOT state, and FND max/min.

### Changed

- `lib/epidemiology-engine.ts` diurnal T/RH forcing is driven by the HKO envelope instead of a hardcoded heat-episode sinusoid.

## [0.1.0] — 2026-08-30

### Added

- Next.js 14 App Router mission-control shell with dark glassmorphism HUD.
- Synthetic Kowloon West / Yau Tsim Mong 3D tong lau twin (≥50 footprints) with bilingual names and HK80 coordinates.
- Gagge 2-node + CVI + thermal inertia epidemiology engine and HA M/M/c surge for CMC, KWH, QEH.
- Client DuckDB-WASM aggregations with in-memory columnar fallback.
- Deck.gl v9 MapLibre digital twin, canyon wind particles, policy stress-tester, and DH/WHO print briefing.
- `.cursorrules`, `ROADMAP.md`, and generative concept prompts for stakeholder stills.

### Fixed

- Header briefing control no longer overlaps the telemetry ticker; building HUD only mounts on hover/select.
