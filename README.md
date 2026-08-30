# AERIS-HK

**Atmospheric & Epidemiological Risk Inference System — Hong Kong**  
氣候與流行病空間推演系統

Aerospace-grade urban microclimate digital twin and Hospital Authority cardiovascular surge engine for Sham Shui Po and Yau Tsim Mong subdivided-flat (*tong lau*) districts.

## Stack

- Next.js 14 App Router, TypeScript, Tailwind CSS
- Deck.gl v9 + MapLibre (Carto Dark Matter) — WGS84 display CRS
- DuckDB-WASM + Apache Arrow for client-side diurnal analytics
- First-principles Gagge 2-node + CVI + M/M/c (CMC, KWH, QEH)
- Live HKO Open Data (`/api/hko/envelope`) for Kowloon T/RH, WHOT, and 9-day forecast anchors

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The map mounts client-side only (`ssr: false`).

```bash
npm run build
```

## CRS

Building footprints render in **EPSG:4326**. Each feature also carries Hong Kong 1980 Grid **EPSG:2326** easting/northing (`properties.hk80`). Conversions live in `lib/crs.ts`.

## Disclaimer

Phase 1 uses synthetic morphology and a calibrated July heat-episode forcing. It is **not** an official Hong Kong Observatory or Hospital Authority product.
