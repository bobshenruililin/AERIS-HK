# AERIS-HK night benchmark report

Measured 2026-08-30 on this Cloud Agent VM (Next.js 14.2.35 production, `PORT=3000 npm start`, Neon pooled endpoint already awake). Commands: `npx tsc --noEmit` (zero errors), `npm run build` (green), `node --env-file=.env.local --import tsx scripts/benchmark.ts`, `GET /api/simulations/bench`, headless Chrome against `http://127.0.0.1:3000/`.

## 1. Neon query execution latency (cold vs warm)

Driver: `@neondatabase/serverless` HTTP against the `-pooler` connection string. Schema `buildings` / `simulation_runs` / `hourly_cluster_metrics` created with Drizzle-compatible DDL.

| Probe | Cold (ms) | Warm (ms) | Notes |
| --- | ---: | ---: | --- |
| `GET /api/simulations/bench` `SELECT COUNT(*) FROM buildings` | **18.42** | **1.01** | First statement in that request vs immediate repeat |
| Same request, `simulation_runs ⋉ hourly_cluster_metrics` aggregate | — | **18.95** | Join after the warm COUNT |
| CLI `scripts/benchmark.ts` COUNT + district AVG | **23.31** | **17.48** (p50 of 8) | After `ensure` + seed in the same process |
| Live seed + insert + snapshot round-trip (`scripts/db-schema.test.ts`) | **1733** | — | DDL + 168-row upsert + run + 3 hourly rows |

The compute endpoint was **not** scaled to zero for these samples (schema seed had just run). Neon scale-to-zero cold starts are typically hundreds of milliseconds to ~1 s after idle; the 18 ms → 1 ms step here is HTTP-driver / plan-cache warm-up on an already-awake endpoint. Persistence proof: shareable snapshot `973686da-486c-47f7-a0c1-65c9beb1c671` (`July 2022 Historic Heatwave`, 72 hourly cluster rows, 336.8 averted ED visits) loaded via `GET /api/simulations/:id` and `?sim=` URL.

## 2. DuckDB-WASM query speeds for 10,000 spatial records

Headless Chrome, `@duckdb/duckdb-wasm@1.29.0` instantiated the same way as `lib/duckdb-engine.ts` (jsDelivr bundle + Worker). Query over `range(10000)` with lon/lat/CVI columns:

| Query | Rows | Time (ms) |
| --- | ---: | ---: |
| `GROUP BY district, hour` + `avg(cvi)` | **10,000** | **196.8** |
| BBox + `cvi >= 70` count | **10,000** | **35.2** |

Live HUD (Arrow IPC footprints + hourly CVI table, ~168 × 24 ≈ 4,032 rows) showed **`duckdb-wasm IPC 176 ms`** in the mission strip — same engine, richer join.

Node columnar equivalent of the same `GROUP BY` (WASM workers unavailable in `tsx`): **2.70 ms** / **0.58 ms** filter. That is the fallback path, not WASM.

## 3. Deck.gl / twin frame budget (60 FPS @ 1080p)

Target: **16.67 ms/frame**.

| Probe | Result |
| --- | --- |
| CPU `projectEnu` of every footprint vertex at 1920×1080, 90 frames (`scripts/benchmark.ts`) | mean **0.33 ms**, p95 **0.88 ms** |
| Headless Chrome rAF on the software ENU twin (`TwinCanvas`) | mean **33.1 ms** ≈ **30.2 FPS** |
| Remaining 1080p budget after CPU projection | **~15.8 ms** for fill/stroke / GPU shade |

The software twin is the default verified picture (WGS84 → ENU metres). Deck.gl extrusions (`instanceColors` / `instanceElevations` packed per hour, `updateTriggers` on `Math.floor(hour)` only) mount only with `?gpu=1` **and** a healthy WebGL2 probe. Headless Chrome does not rasterize that GPU path reliably; the 0.33 ms projection cost shows the 60 FPS budget is CPU-feasible. The 30 FPS headless cap is the compositor, not the twin math.

Packed GPU buffers for the live twin: `168 × 24 × 4` RGBA bytes + `168 × 24` elevations + AC-watt attributes, swapped by hour floor without rebuilding GeoJSON.

## 4. Gates

| Gate | Evidence |
| --- | --- |
| `npx tsc --noEmit` | exit 0 |
| `npm run build` | compiled, linted, `/api/simulations` routes in the manifest |
| Unit tests (`test:bio`, `test:h3`, `test:db`, plus existing CRS/HA/cool-roof/twin/decade/solar/MC/scenarios) | all pass; Gagge `S = M − W − E − R − C` still holds at 15:00 |
| 劏房 battery | dense Pei Ho tong lau, July 2022, **03:00 indoor > 34°C**; 15:00 cool-roof indoor drop unchanged |
| `?sim=uuid` | POST `/api/simulations` → URL replace → reload restores the run |
