# Changelog

All notable changes to AERIS-HK are documented here.

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
