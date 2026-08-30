# AERIS-HK

**Atmospheric & Epidemiological Risk Inference System — Hong Kong**  
氣候與流行病空間推演系統

Aerospace-grade urban microclimate digital twin and Hospital Authority cardiovascular surge engine for Sham Shui Po and Yau Tsim Mong subdivided-flat (*tong lau*) districts.

## Stack

- Next.js 14 App Router, TypeScript, Tailwind CSS
- Deck.gl v9 + MapLibre (Carto Dark Matter) — WGS84 display CRS
- PostGIS (EPSG:2326 authority, dual-write EPSG:4326) with Arrow IPC snapshots for DuckDB-WASM
- First-principles Gagge 2-node + CVI + M/M/c (CMC, KWH, QEH)
- Live HKO Open Data (`/api/hko/envelope`) for Kowloon T/RH, WHOT, and 9-day forecast anchors
- Anonymised HA A&E nowcast (`/api/ha/nowcast`) — hospital aggregates only; M/M/c μ/c from Cat 1–3 mix

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The map mounts client-side only (`ssr: false`).

```bash
npm run build
npm run ingest:hk80
npm run test:crs
npm run test:ha
```

PostGIS (HK80 / EPSG:2326) is the footprint authority. Either run a local cluster or:

```bash
docker compose up -d postgis
npm run ingest:hk80
```

Default `DATABASE_URL` is `postgres://aeris:aeris@127.0.0.1:5432/aeris`. The app publishes GeoJSON 4326 at `/api/spatial/buildings` (Deck.gl) and Arrow IPC at `/api/spatial/footprints` (DuckDB-WASM).

The wait board is [HA Open Data](https://www.ha.org.hk/opendata/aed/aedwtdata2-en.json) (updated ~15 min). Occupancy is a delayed CMS-style aggregate mock (plus optional `POST /api/ha/ingest` webhook of hospital-level rates). **No patient identifiers.**

## CRS

**Store** building polygons in PostGIS as `geom_hk80 geometry(Polygon, 2326)`. A trigger dual-writes `geom_wgs84 geometry(Polygon, 4326)` via `ST_Transform` for Deck.gl. Client conversions also live in `lib/crs.ts` (International 1924 TM + EPSG:2326 Helmert). Never pass eastings to Deck.gl `getPosition`.

Migration: `scripts/ingest-hk80.sql`. Round-trip tests: `npm run test:crs`.

## Disclaimer

Phase 1–2 morphology is a synthetic tong lau twin stored in PostGIS (HK80). Meteorology is live HKO Open Data. A&E waits are HA Open Data hospital aggregates. It is **not** an official Hong Kong Observatory or Hospital Authority product.
