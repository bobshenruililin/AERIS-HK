# AERIS-HK System Intelligence

Architecture, first-principles formulas, CRS/SSR invariants, and measured
performance for the dual-scale Hong Kong platform. This file is the
authoritative engineering companion to `README.md`. Numbers in §7 were
measured on this Cloud Agent VM (Next.js 14.2.35, Node 20, Chrome headless)
unless a later `BENCHMARK_REPORT.md` revision supersedes them.

---

## 1. Dual-scale system

```
Territory index (FastAPI :8000)          Kowloon West twin (Next.js :3000)
18 District Council units                168 CityJSON footprints
PM2.5 · NO₂ · O₃ · ILI · respiratory     Gagge · Fanger · WBGT · 劏房 battery
susceptibility amplifier                 CVI · M/M/c · Monte Carlo 95% CI
static/ choropleth                       TwinCanvas ENU + optional Deck.gl GPU
                                         Neon Drizzle ?sim=uuid
                                         DuckDB-WASM Arrow IPC
                                         SpatialGrid ENU hash (sub-10 ms)
```

The FastAPI service is the territory-scale **risk index**. The Next.js app is
the street-canyon **planetary twin**. Neither replaces the other.

---

## 2. Coordinate reference systems

| Layer | CRS | Rule |
| --- | --- | --- |
| Storage / CityJSON vertices | HK1980 Grid **EPSG:2326** | `properties.hk80`, PostGIS `geom_hk80` |
| Deck.gl / MapLibre `getPosition` | WGS84 **EPSG:4326** | Never pass HK80 eastings |
| Software twin projector | Local ENU metres | Origin 114.1628°E, 22.3307°N (`lib/twin-camera.ts`) |
| Conversion | `lib/crs.ts` | International 1924 TM + Helmert TOWGS84 |

CityJSON interchange (`GET /api/spatial/cityjson`) emits version 2.0 Solids with
`metadata.referenceSystem = urn:ogc:def:crs:EPSG::2326` and a transform
translate equal to the first vertex’s HK80 easting/northing.

---

## 3. SSR / GPU safety

- `"use client"` on every Deck.gl, MapLibre, DuckDB-WASM, TwinCanvas module.
- Map entry: `components/map/MapViewport.tsx` via `next/dynamic(..., { ssr: false })`.
- GPU Deck.gl mounts only with `?gpu=1` **and** a healthy WebGL2 probe.
- Never import `lib/postgis/*`, `lib/neon-archive.ts`, `lib/db/client.ts`, or `pg`
  from client components.
- DuckDB is guarded with `typeof window` / `Worker` (`lib/duckdb-engine.ts`).

---

## 4. Territory risk index (`aeris_hk/model.py`)

Air (0–1), WHO-order references PM2.5 25, NO₂ 40, O₃ 60 µg/m³:

\[
\mathrm{air} = \mathrm{clamp}(0.55\,\mathrm{pm} + 0.25\,\mathrm{no2} + 0.20\,\mathrm{o3})
\]

Epi (ILI 9 / 1,000; respiratory 6 / 100,000):

\[
\mathrm{epi} = \mathrm{clamp}(0.6\,\mathrm{ili} + 0.4\,\mathrm{resp})
\]

Susceptibility is log₁₀ density between 10³ and 6×10⁴ people/km².
Amplifier \(1 + 0.2\cdot\mathrm{suscept}\). Composite:

\[
\mathrm{risk} = 100\cdot\mathrm{clamp}\bigl((1+0.2 s)\,(0.50\,\mathrm{air}+0.35\,\mathrm{epi}+0.15 s)\bigr)
\]

Bands: Low `[0,25)`, Moderate `[25,50)`, High `[50,75)`, Very High `[75,100]`.

---

## 5. Twin biophysics

### 5.1 Gagge two-node (`lib/epidemiology-engine.ts`)

\[
S = M - W - E - R - C
\]

Identity is asserted on every footprint at 15:00 HKT (`npm run test:twin`).
Do not collapse to a single temperature proxy.

### 5.2 CVI

\[
\mathrm{CVI}(t)=100\bigl(0.35\,\mathrm{MicroWBGT}(t)/35 + 0.28\,\rho_{\mathrm{sub}} + 0.22\,e + 0.15\,V_{\mathrm{block}}\bigr)
\]

### 5.3 Fanger PMV–PPD (ISO 7730) and WBGT (`lib/biophysics.ts`)

Clothing temperature \(T_{cl}\) is Newton-iterated. PPD follows Fanger’s
logistic of PMV. WBGT uses a Liljegren-class wet-bulb / globe iteration.
Indoor − outdoor WBGT differential is retained on the inspector.

### 5.4 劏房 4-hour concrete battery

Night-only Euler with \(\tau = 4\,\mathrm{h}\). Dense Pei Ho tong lau under
July 2022 forcing must keep indoor \(T > 34^\circ\mathrm{C}\) at 03:00 HKT
without flooring the 15:00 cool-roof indoor delta.

### 5.5 Street canyon / Tong Lau

Aspect \(H/W = H / \sqrt{A_{\mathrm{roof}}}\). Oke sky-view
\(\mathrm{SVF} = (1+ (H/W)^2)^{-1/2}\). Direct beam on the canyon floor is
sunlit when \(\tan\gamma_s \ge (H/W)\,|\sin(\alpha_s - \psi_{\mathrm{street}})|\).
Pei Ho Street uses \(H/W = 3.5\), axis \(8^\circ\) (`lib/solar-engine.ts`).

### 5.6 Astronomical solar position

NOAA-style SPA at **22.3193°N, 114.1694°E**, HKT (UTC+8), day-of-year 200
(19 July 2022). Elevation / azimuth drive:

- Deck.gl `DirectionalLight` via `sunDirectionVec` (`lib/solar.ts`, Kowloon look-at)
- TwinCanvas sun disc + ground-plane shadows via `castGroundShadow`
- Canyon insolation DNI (Ineichen-lite)

Ground shadow of a roof vertex along the incoming solar travel vector
\((s_e, s_n, s_u)\) with \(s_u < 0\):

\[
t = -u / s_u,\quad (e', n', 0) = (e, n, u) + t\,(s_e, s_n, s_u)
\]

### 5.7 Venturi wind (`lib/wind-field.ts`)

Sea-breeze from solar elevation. Corridor squeeze:

\[
\mathrm{venturi} = 1 + 1.35\cdot\min(L,R)\cdot(0.35 + 0.65\,\mathrm{narrow})
\]

Stalled alleys drop to 0.22. TwinCanvas draws amber streaks when
\(\mathrm{venturi} > 1.25\); Deck.gl PathLayer uses `VenturiStreamExtension`
(GPU `DECKGL_FILTER_COLOR` pulse). 920 particles, trails of length 6.

### 5.8 M/M/c (CMC, KWH, QEH)

Erlang-C wait from HA Cat 1–3 mix. \(\mu\) calibrated from triage mix;
\(c\) from Cat 3 p50 wait. Utilisation saturates safely (\(\rho < 1\)
handling). QEH is regional overflow, not a KWC hospital.

### 5.9 Monte Carlo 95% CI (`lib/monte-carlo.ts`)

1,000 draws. Micro-climate spike \(\pm 1.8^\circ\mathrm{C}\) (truncated
normal) and Bernoulli AC-grid failures. Bishai-style RR \(0.22/^\circ\mathrm{C}\).
Admissions and bed-deficit bands report p2.5 / p50 / p97.5 plus violin
density. Worker + DuckDB `QUANTILE_CONT` when WASM is available.

### 5.10 Cool-roof knapsack

Exact 0/1 DP on 24-hour admissions averted under an m² budget. DuckDB
`ROW_NUMBER` + running `SUM(roof_m2) OVER` ranks the same table. District
air cooling scales as \(50 \times A_{\mathrm{selected}} / A_{\mathrm{stock}}\).

---

## 6. Client compute pipeline

| Engine | Job | Module |
| --- | --- | --- |
| Neon Postgres + Drizzle | Footprints, `simulation_runs`, hourly cluster metrics, `?sim=uuid` | `lib/db/*` |
| DuckDB-WASM + Arrow IPC | Window SQL, knapsack rank, district hourly CVI | `lib/duckdb-engine.ts` |
| SpatialGrid (typed arrays) | Sub-10 ms bbox / kNN over 24k–50k ENU vectors | `lib/spatial-grid.ts` |
| H3 res 9/10 | Hex aggregation drawn as GeoJSON (no `@deck.gl/geo-layers` barrel) | `lib/h3-index.ts` |
| Packed GPU attributes | 168 × 24 colours / elevations / AC watts | `lib/gpu-attributes.ts` |

SpatialGrid cell size is 40 m. Densification jitter-samples alley edges so
the index is not only 168 centroids. HUD ticker reports live bbox / kNN
milliseconds (`data-testid="spatial-grid-stats"`).

---

## 7. Progressive disclosure HUD (zero deletions)

Presets **1–4**, every slider, Gagge fluxes, Cat 1–3 surge, knapsack,
decade observatory, Monte Carlo violins, and the Control Dock pill remain
mounted. Density is solved with VisionOS glass, pinned inspector cards
(`inspectorAnchor`), ⌘K (streets, **districts**, DB snapshots), harbour
fly-in, look-at, and cinematic **orbit** (`TWIN_ORBIT_EVENT`, key `O`).

---

## 8. Measured performance

Prior night (`BENCHMARK_REPORT.md`, Neon pooler awake):

| Probe | Result |
| --- | --- |
| Neon `COUNT(*)` cold / warm | 18.42 ms / 1.01 ms |
| DuckDB-WASM 10k `GROUP BY` (Chrome) | 196.8 ms (SQL path; not the spatial hash) |
| DuckDB-WASM 10k bbox filter | 35.2 ms |
| Node columnar GROUP BY / filter | 2.70 ms / 0.58 ms |
| `projectEnu` 1080p, 90 frames | mean 0.33 ms, p95 0.88 ms |
| Headless TwinCanvas rAF | ~30 FPS (compositor cap) |

SpatialGrid 50,000 ENU vectors (this revision, Node `tsx` on the Cloud Agent VM):

| Probe | p50 | Min |
| --- | ---: | ---: |
| bbox (−700…900 E, −1100…700 N, CVI ≥ 70) | **6.34 ms** | 2.81 ms |
| kNN k=16 at origin | **0.11 ms** | 0.09 ms |
| cells | 238 | — |

Live HUD uses 24,000 vectors (`URBAN_VECTOR_TARGET`). Both probes are under the 10 ms north-star.

Gates: `npx tsc --noEmit`, `npm run build`, the `test:*` scripts including
`test:spatial`, and `python3 -m pytest tests/` for the territory index.

---

## 9. Shareable scenario URLs

`POST /api/simulations` writes `simulation_runs`. The client replaces the
query with `?sim=<uuid>`. Reload hydrates HUD state from
`simulation_runs.config`. Example snapshot from the persistence leaf:
`973686da-486c-47f7-a0c1-65c9beb1c671`.
