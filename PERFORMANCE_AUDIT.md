# AERIS-HK performance audit

Production-style overhaul of the Kowloon West twin treated as a WebGL/WASM
engine on edge hardware. **Before** numbers are cited from
`BENCHMARK_REPORT.md` (measured 2026-08-30 on this Cloud Agent VM, Next.js
14.2.35 production). **After** numbers are re-measured on the same class of
host after the 0.10.0 changes (`npx tsc --noEmit`, `npm run bench`, unit
gates, production `PORT=3000 npm start` where noted).

Frame budget: **16.67 ms** (60 FPS). Scrub-path SQL/analytics budget: **5 ms**.
Instance target: **20,480** extrusions.

---

## 1. Requirements vs evidence

| Requirement | Authoritative evidence |
| --- | --- |
| Audit custom shaders + Deck.gl layers; no leaks on zoom/pan/scrub | `lib/thermal-shimmer-extension.ts`, `lib/venturi-stream-extension.ts`, `components/map/AERISMap.tsx` layer split |
| Instanced `instancePositions` / `instanceColors` for 20k+ extrusions without GC spikes | `lib/instance-mesh.ts`, Deck.gl `ColumnLayer` binary attributes, `scripts/instance-mesh.test.ts` |
| LoD culling at district zoom | `lodFromZoom` / `lodFromDistanceM`; district = 20,480 4-gons; street = 168 GeoJSON footprints |
| Client SQL / analytics inside < 5 ms using Arrow zero-copy | `lib/arrow-columns.ts` `hourColumnView` subarrays; `scripts/arrow-columns.test.ts` p50 < 5 ms |
| DuckDB strictly in a dedicated Worker | `new Worker(..., { name: "aeris-duckdb" })` in `lib/duckdb-engine.ts`; persistent `AsyncDuckDB` connection; ingest **not** on `queryHour` |
| Composite indexes for spatial + timestamp lookups | `lib/db/schema.ts` + `lib/db/client.ts` DDL; `scripts/db-schema.test.ts` |
| Client SWR/caching for cloud simulation runs | `lib/sim-cache.ts`; `scripts/sim-cache.test.ts` (in-flight dedupe + TTL hit) |
| `npx tsc --noEmit` | Must exit 0 |

---

## 2. Deck.gl & shader audit

### Before

- 168 extruded **GeoJSON** features rebuilt through the same `useMemo` as wind particles. Particle `setState` at rAF therefore reconstructed building topology (GC on zoom/pan and diurnal play).
- Packed GPU attributes existed (`168 × 24` RGBA / elevations) but Deck.gl still called JS accessors per footprint. No 20k instance buffer.
- `ThermalShimmerExtension` / `VenturiStreamExtension` already used instanced attributes and uniforms (good). The leak was **layer identity**, not the GLSL.
- Harbour approach (`zoom: 13.35`) still drew full footprints; district-scale overdraw.

### After

| Path | Behaviour |
| --- | --- |
| `aeris-instances` `ColumnLayer` | Binary `instancePositions` (Float32, size 3), `instanceColors` (Uint8, size 4, normalized), `instanceElevations` / `instanceAcWatts`. Hour slice is a **subarray** of the 24 h pack. |
| LoD 0 (zoom < 14.35 / distance > 1800 m) | 20,480 instances, `diskResolution: 4`, radius 18 m. Wind + spines + GeoJSON off. |
| LoD 1 (canyon) | ~5,120 instances, `diskResolution: 6`. Scatterplot wind, no PathLayer trails. |
| LoD 2 (street, Kowloon zoom 16.2) | 168 true footprints via `GeoJsonLayer` (`visible: lod === 2`). Instances hidden. |
| Layer memos | `cityLayers` independent of `particles` / `gpuTime`. Wind layers cannot force GeoJSON rebuild. |
| Particle loop | Skipped at LoD 0; throttled to 8 Hz when running. |
| Shaders | Unchanged GLSL. Extensions constructed once (`useMemo([])`). `instanceAcWatts` fed from the hour slice, not per-frame typed-array alloc. |
| TwinCanvas (software twin) | District LoD draws centroid boxes from the same instance pack; per-face rings, ground shadows, and wind trails are skipped. H3 hexes are memoized off the rAF path. |

Picking at LoD < 2 uses `info.index → parentIds[index]` (binary layers have no `info.object`).

---

## 3. DuckDB-WASM & Arrow IPC

### Before (`BENCHMARK_REPORT.md`)

| Probe | Result |
| --- | --- |
| DuckDB-WASM `GROUP BY district, hour` on 10,000 rows (Chrome Worker) | **196.8 ms** |
| DuckDB-WASM bbox + `cvi >= 70` | **35.2 ms** |
| Live HUD ingest (Arrow IPC + join, ~4,032 rows) | **176 ms** on every `queryHour` because `runAerisAnalytics` listed `queryHour` in React effect deps |
| Node object `GROUP BY` fallback | 2.70 ms (not the WASM path) |

A 176 ms main-thread wait on each playbar tick is far outside a 5 ms frame budget. DuckDB itself already ran in a Worker; the stutter was **re-ingest + SQL on every hour**.

### After

| Probe | Result | Notes |
| --- | --- | --- |
| Arrow hour-major `queryHourColumns` 12,000 rows (Node `tsx`, p50 / p95) | **see §7** | Zero-copy `Float32Array.subarray` per hour; no DuckDB, no row objects |
| DuckDB ingest | Once per buildings/hourly/policy/footprints fingerprint | Persistent `AsyncDuckDBConnection`; named Worker `aeris-duckdb` |
| HUD | `data-testid="scrub-query-ms"` vs `data-testid="duckdb-ingest-ms"` | Scrub path is Arrow; ingest path is Worker SQL / knapsack |

Honest bound: **DuckDB-WASM `GROUP BY` will not drop from 196 ms to 5 ms.** The frame-budget path is Arrow columns on the UI thread (~n/24 contiguous rows). DuckDB remains the engine for window-function knapsack and one-shot district SQL, isolated on the Worker so timeline scrubbing does not hitch the HUD.

---

## 4. Neon Postgres latency & pooling

### Before

- Schema had `buildings_district_idx` and `simulation_runs_created_idx` only.
- No stored WGS84 centroids; spatial lookups could not use a btree on lon/lat.
- `GET /api/simulations` and `GET /api/simulations/:id` were uncached; Cmd+K / share hammered Neon.

| Probe (`BENCHMARK_REPORT.md`) | Cold (ms) | Warm (ms) |
| --- | ---: | ---: |
| `COUNT(*)` buildings | 18.42 | 1.01 |
| `simulation_runs ⋉ hourly_cluster_metrics` | — | 18.95 |

### After

Indexes (`lib/db/schema.ts` + `CREATE INDEX IF NOT EXISTS` in `lib/db/client.ts`):

- `buildings_spatial_centroid_idx` `(centroid_lon, centroid_lat)`
- `buildings_district_spatial_idx` `(district, centroid_lon, centroid_lat)`
- `buildings_district_uhi_idx` `(district, uhi_vulnerability_score)`
- `simulation_runs_created_scenario_idx` `(created_at, scenario_name)`
- `hourly_cluster_run_ts_idx` `(run_id, timestamp)`
- `hourly_cluster_ts_cluster_idx` `(timestamp, cluster_id)`

Client SWR (`lib/sim-cache.ts`): 30 s TTL, in-flight promise sharing, invalidate on POST. HTTP `cache: "no-store"` remains so the browser cache does not hide Neon freshness; the in-memory SWR layer is the deduper.

Centroid bbox and timestamp aggregate timings: **see §7**.

Pooling: existing Neon serverless HTTP driver for Route Handlers + WebSocket `Pool({ max: 4 })` for seed. Unchanged on purpose — the win is indexes + fewer round-trips.

---

## 5. Frame-budget geometry

| Probe | Before | After |
| --- | --- | --- |
| CPU `projectEnu` 1080p, 90 frames | mean **0.33 ms**, p95 **0.88 ms** | same projector; district LoD avoids per-face rings |
| Headless TwinCanvas rAF | **33.1 ms ≈ 30.2 FPS** (compositor cap) | district LoD skips shadows / trails / H3-in-rAF |
| GPU instance count | 168 accessor-driven extrusions | **≥ 20,480** binary instances at district LoD |
| Instance hour slice | n/a (rebuild colours in JS) | subarray, same `ArrayBuffer` |

---

## 6. Leak model (zoom / pan / scrub)

| Event | Before | After |
| --- | --- | --- |
| Map pan/zoom | New `GeoJsonLayer` props + particle memo rebuild | `lod` toggles `visible` / instance `length`; GeoJSON feature array identity is stable (`collection` memo on `buildings`) |
| Diurnal scrub | DuckDB ingest + GeoJSON `getFillColor` closures over interpolated snapshot | `updateTriggers` on `hourFloor` only; Arrow `queryHourColumns`; DuckDB effect ignores hour |
| Playbar rAF | Wind `setState` rebuilt **all** Deck layers | Wind memo isolated; buildings layers skip the particle dependency |

Typed arrays in `InstancePack` are allocated once per `buildings`/`cache` identity (policy change), not per frame.

---

## 7. Measured after (this revision)

Captured by `node --env-file=.env.local --import tsx scripts/benchmark.ts` and `npm run test:arrow` / `test:instance` / `test:cache`.

_Placeholder filled after the local bench run in this agent environment._

| Probe | After |
| --- | ---: |
| Instance pack count | |
| Instance hour-slice p50 | |
| Arrow `queryHourColumns` 12k rows p50 | |
| Arrow `queryHourColumns` 12k rows p95 | |
| Neon centroid bbox `SELECT` | |
| Neon timestamp aggregate | |
| `npx tsc --noEmit` | |

---

## 8. What this does not claim

- Headless Chrome still cannot reliably rasterize the `?gpu=1` WebGL2 path; GPU instance fill-rate is verified by buffer layout + Deck.gl wiring, not by a GPU timestamp query.
- DuckDB-WASM full-table `GROUP BY` remains an ingest/analytics cost (Worker), not a per-frame cost.
- Software TwinCanvas drawing 20k screen-space boxes at harbour distance is a LoD stand-in, not a substitute for GPU instancing.
