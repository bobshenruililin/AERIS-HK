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
- GPU Deck.gl / MapLibre mounts only with `?gpu=1` **and** a healthy WebGL2 probe
  (`lib/runtime-guards.ts` `probeHealthyWebGL2`). Failures, `webglcontextlost`, and
  Deck/MapLibre `onError` demote to the software ENU twin (`data-testid="gpu-failover"`).
  `webglcontextlost` calls `preventDefault`; `webglcontextrestored` remounts Deck.gl (`lib/gpu/context-lifecycle.ts`).
  Mapbox GL JS is never constructed; MapLibre is the Mapbox-compatible basemap.
- DuckDB instantiates only when `canUseDuckDbWasm()` (window + Worker +
  `WebAssembly.validate`). Otherwise columnar/Arrow fallback — no throw.
- Monte Carlo uses a Worker when `Worker` exists; `onerror` / timeout / constructor
  failure fall back to `engine: "sync-js"`.
- HUD is gated by `ClientOnly` + `MissionShell` so the first paint matches SSR.
  Route `app/error.tsx` and `app/global-error.tsx` contain the rest of the tree.
- Never import `lib/postgis/*`, `lib/neon-archive.ts`, `lib/db/client.ts`, or `pg`
  from client components.

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
| Instanced ColumnLayer | 20,480 `instancePositions` / `instanceColors`, LoD 0/1/2 | `lib/instance-mesh.ts` |
| Arrow hour columns | < 5 ms scrub, hour-major subarrays | `lib/arrow-columns.ts` |
| Simulation SWR | 30 s TTL + in-flight dedupe for Neon runs | `lib/sim-cache.ts` |

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

---

## 10. Delivery ledger — full-stack hardening (0.12.0)

Requirement-by-requirement evidence for the hardening goal. Paths are from the
repo root. Gates: `npx tsc --noEmit`, `npm run test:hardening`.

### 10.1 Defensive error boundaries & hydration

| Requirement | Evidence |
| --- | --- |
| Audit client/server boundaries | GPU overlay is `next/dynamic(..., { ssr: false })` in `components/map/MapViewport.tsx`. DuckDB/MC/Deck/MapLibre are `"use client"`. PostGIS/`pg`/Neon archive stay on Route Handlers. |
| Mapbox / Deck.gl fail over if WebGL disabled | Mapbox GL JS is not instantiated. MapLibre + Deck.gl mount only after `probeHealthyWebGL2()`. `ErrorBoundary` around the GPU overlay; `AERIS_GPU_FAILED_EVENT` + `webglcontextlost` demote to TwinCanvas. Banner `data-testid="gpu-failover"` when `?gpu=1` fails. TwinCanvas has its own `ErrorBoundary` over `CinematicPlate`. |
| Web Worker / WASM fail over | `lib/runtime-guards.ts`: `wasmSupported()` validates a 8-byte magic module; `canUseDuckDbWasm()` must be true before `new Worker` / `db.instantiate`. Else `instantiateDuckDb()` returns `null` (columnar path). Monte Carlo: `canUseMonteCarloWorker()`; constructor/`onerror`/12 s timeout → `engine: "sync-js"`. |
| React hydration mismatches | `ClientOnly` (`components/system/ClientOnly.tsx`) renders `MissionShell` on SSR and first client paint; `SimulationProvider` mounts after `useEffect`. `suppressHydrationWarning` on `<html>`/`<body>`. Inspector pin uses `useLayoutEffect` (no `window` during render). Briefing `generatedAt` is empty until open. |
| Tree containment | `ErrorBoundary` around HUD; `app/error.tsx`; `app/global-error.tsx`. |

### 10.2 Accessibility, tooltips & keyboard

| Binding | Handler | Evidence |
| --- | --- | --- |
| `1`–`4` | Dock presets | `lib/hotkeys.ts` `interpretHudKey` → `HudHotkeys` → `setHudPreset` |
| `Space` | Timeline toggle | same; `preventDefault`; Control Dock / TimeScrubber `title="Space"` |
| `Cmd+K` / `Ctrl+K` | Search | works while typing; toggles `commandPaletteOpen` |
| `Esc` | Dismiss cascade | palette → `aeris-escape` (ExportReport, ExecutiveBriefing, BriefingTour) → clear `selectedId` / `inspectorAnchor` / `focusedHospital` |

Formula micro-tooltips (`components/ui/FormulaTooltip.tsx`, `data-testid="formula-tip-<id>"`) quote **exact** engine identities from `lib/formulas.ts`:

| Name in the goal | Identity actually run |
| --- | --- |
| **UTCI** | Not Fiala UTCI. Operational outdoor heat is ISO 7243 `WBGT = 0.7 Tw + 0.2 Tg + 0.1 Ta` (`lib/biophysics.ts`). |
| **PMV** | ISO 7730 Fanger `fangerPmvPpd` with Newton \(T_{cl}\); PPD logistic. |
| **DLNM Relative Risk** | Not a Gasparrini spline. Bishai-style `RR = max(0.55, 1 + 0.22·ΔT)` (decade) and `exp(0.22·ΔT_spike)` (Monte Carlo). |

Attached to: Header 24h spark + Micro-WBGT hero, TimeScrubber bars (UTCI + PMV + DLNM), CausalStrip stages, HudPill sparklines (hospital M/M/c, policy DLNM, decade DLNM, knapsack), Decade observatory, Monte Carlo violins, inspector Gagge/PMV/WBGT, Executive Briefing charts. Hover **and** keyboard focus (`tabIndex={0}` / parent pill button).

### 10.3 Repo cleanup

| Item | Action |
| --- | --- |
| Duplicate `spatial-data` imports | Merged in `SimulationProvider.tsx` |
| Dead `k` no-op in `HudHotkeys` | Removed; grammar lives in `lib/hotkeys.ts` |
| `lib/tokens.ts` unused | Wired into `GlassPanel` (`AERIS_TOKENS.color.glass`) |
| `canvas-confetti` unused | **Kept** — reserved by `.cursorrules` for material admissions-averted, not load decoration |
| `mapbox-gl` unused in source | **Kept** as react-map-gl peer; never constructed. MapLibre is the basemap. |
| `npx tsc --noEmit` | Gate: zero errors (`npm run typecheck`) |
| Tests | `npm run test:hardening` — WASM probe, keyboard grammar, formula identities vs WBGT/Fanger/RR coefficients |

Zero-deletion invariant unchanged: presets 1–4, Gagge identity, knapsack, Monte Carlo, decade observatory, Control Dock, Cmd+K, Fanger/WBGT, 劏房 battery, H3, Neon `?sim=`, FastAPI `aeris_hk/` + `static/`.

---

## 11. Delivery ledger — Spatial Policy Copilot (0.13.0)

Requirement-by-requirement evidence. Gates: `npx tsc --noEmit`, `npm run test:agent`.

### 11.1 Structured tool calling & intent parser (`lib/agent/tools.ts`)

| Tool | Arguments | Evidence |
| --- | --- | --- |
| `run_counterfactual` | `district`, `ac_reduction_pct`, `cool_roof_penetration`, `ambient_delta` | Zod `RunCounterfactualArgsSchema`; JSON Schema in `TOOL_DEFINITIONS`; AI SDK `tool()` in `lib/agent/runtime.ts`; apply path sets AC bylaw, cool-roof m², envelope ΔT |
| `focus_hotspot` | `threshold_cvi`, `triage_tier`, `metric` | Filters snapshot CVI/tier, ranks `cvi\|wbgt\|indoor\|pmv\|occupancy`, flies to the hottest canyon |
| `query_hospital_capacity` | `cluster_id`, `hour_of_day` | Scrubs the diurnal slider; flies to CMC/KWH/QEH/PMH or KWC midpoint; catchment highlight |
| `compare_scenarios` | `scenario_a_id`, `scenario_b_id` | Applies plate A live; `compareScenarioDiff` = CVI(B)−CVI(A); green if B cooler |

Runtime order: Neon AI Gateway (`NEON_AI_GATEWAY_*`) → Anthropic → OpenAI → deterministic `parseIntent` (`lib/agent/intent.ts`). Every LLM plan is re-validated with `AgentPlanSchema.parse`. `POST /api/agent` is the only client entry; `runtime.ts` is `server-only` and is **not** re-exported from `lib/agent/index.ts`.

### 11.2 Real-time map synchronization

| Action | TwinCanvas (default) | Deck.gl (`?gpu=1`) |
| --- | --- | --- |
| Pan/fly | Existing `TWIN_LOOKAT_EVENT` look-at lerp | `AERISMap` listens and `FlyToInterpolator` to lon/lat, zoom ≥ 16.75 |
| Peak thermal hour | `planToPatch` sets `hour` via `peakThermalHour` (default 15; 3 AM for 劏房 battery) | Same HUD `setHour` — TimeScrubber / Control Dock playbar |
| Green/red diffs | Ground polygons before extrusions (`delta < 0` emerald, `> 0` crimson) | `GeoJsonLayer` id `copilot-diff`, WGS84 rings only |

### 11.3 Agentic citation & audit trail

Chat sentences include square-bracket citations. Click sets `copilot.citationId` / `citationHighlight` and pulses HUD nodes with `data-citation` (`aeris-cite-hit`): roofs, Gagge inspector, WBGT/PMV, DuckDB ticker, ENU grid, Neon episode, M/M/c board, knapsack. Labels use **live** footprint/vector counts (`formatDuckDbCitation`) and the real Neon `simId` (`formatNeonCitation`) — never a fake 12,400.

Sol-Air Eq. 3 is `q_abs = I_peak · sin^{1.15}(γ_s) · (1 − ρ)` in `lib/solar.ts`. Outdoor heat remains ISO 7243 WBGT (not Fiala UTCI).

### 11.4 SSR / TypeScript

| Gate | Evidence |
| --- | --- |
| SSR | PolicyAgent / maps are `"use client"`. Agent LLM SDK stays on the Route Handler. `flyTo` no-ops without `window`. |
| `npx tsc --noEmit` | `npm run typecheck` |
| Tests | `npm run test:agent` — four tools, Zod round-trip, compare sign, CMC 15:00, july vs blackout, citation split, SSR barrel |

Zero-deletion invariant unchanged from §10.

---

## 12. Delivery ledger — Pareto frontier solver (0.14.0)

Requirement-by-requirement evidence. Gates: `npx tsc --noEmit`, `npm run test:pareto`.

### 12.1 Pareto objective matrix

| Objective | Direction | Identity | Module |
| --- | --- | --- | --- |
| Total municipal + household cost (HKD) | Minimize | Cool roof 480/m² + shelters 18k + DHC 2.4k/% + canopy 92k/% + AC grant 3.6k municipal + 1.2k household per 劏房 unit | `lib/executive-briefing.ts` `interventionSpend` |
| Cat 1–3 ED visits averted (KWC) | Maximize | 24 h Σ λ_cat13(baseline) − Σ λ_cat13(scenario); GA samples hours 03/15/21 then scales ×8 | `evaluateBuildingCat13Lite` → `hourlyArrivalsForBuilding` |
| Thermal inequity reduction (tenement / 劏房) | Maximize | ΔG = G_baseline − G_scenario; weighted Gini of indoor T_a, ρ_sub ≥ 0.4, mass = residents, 15:00 HKT | `lib/optimization/gini.ts` |
| Grid peak HVAC strain (MW) | Minimize | P = Σ_b (q_AC,b · A_roof,b) / 10⁶ at 15:00; q_AC = `effectiveAcHeat` (W/m²) | `peakHvacLoadMw` |

Search uses the same canyon / indoor lag / ISO 7243 WBGT / CVI / Bishai path as the HUD. Fanger PMV and astronomical insolation are skipped inside the GA; clicking a front point runs the full `precomputeHourlyCache` + knapsack + M/M/c recompute.

### 12.2 Client-side Web Worker (`lib/optimization/pareto-worker.ts`)

NSGA-II (non-dominated sorting, crowding distance, binary tournament, SBX ηc=15, polynomial mutation ηm=20) for **500 generations**, population 32. Levers: cool-roof rebate % of roof stock, canopy %, AC grant %, night shelters 0–30. Cool-roof genomes apply a window-greedy prefix of the live η-ranked candidate table; HUD click writes `coolRoofBudgetM2` so DuckDB/exact knapsack retargets.

`canUseParetoWorker()` is the Monte Carlo Worker probe. Timeout 180 s or `onerror` falls back to yielded `sync-js` (`setTimeout(0)` every 10 generations) so the genetic loop never blocks Arrow scrub (< 5 ms) or rAF playback.

### 12.3 Interactive 2D/3D chart (`components/ui/ParetoFrontierView.tsx`)

SVG Cost vs averted-hospitalizations curve; 3D isometric uses ΔGini as the third axis; marker size inverse to MW. `data-testid="pareto-frontier"` / `pareto-point-*`. The chart consumes `ParetoSolverContext` (not `hour`) so diurnal scrub does not redraw the frontier. Click → `applyParetoPoint` → `setPolicy` of the four levers → 3D map CVI and Hospital Board recompute.

### 12.4 SSR / TypeScript

| Gate | Evidence |
| --- | --- |
| SSR | Pareto view and `pareto-client.ts` are `"use client"`. Worker file has `/// <reference lib="webworker" />`. |
| `npx tsc --noEmit` | `npm run typecheck` |
| Tests | `npm run test:pareto` — Gini, dominance, canopy cooling, AC MW cut, 12-gen front, **500-gen** tiny run |
| 60 FPS scrub | NSGA-II is not on the TimeScrubber / Arrow column path; solver starts only from the Run button, dock, or ⌘K |

Zero-deletion invariant unchanged from §11.

---

## 13. Delivery ledger — live telemetry pipeline (0.15.0)

Requirement-by-requirement evidence. Gates: `npx tsc --noEmit`, `npm run test:telemetry`.

### 13.1 Meteorological ingestion (`lib/telemetry/hko-feed.ts`)

Edge-safe Fetch pollers (no `node:fs`) hit HKO Open Data CSVs:

| Variable | Endpoint | Stations |
| --- | --- | --- |
| Air temperature | `latest_1min_temperature.csv` | Sham Shui Po, King's Park, Kai Tak Runway Park |
| Relative humidity | `latest_1min_humidity.csv` | King's Park, Kai Tak (SSP neighbor-filled) |
| Wind vector | `latest_10min_wind.csv` | King's Park, Kai Tak (`Calm` → 0 m/s) |
| Solar radiation | `latest_1min_solar.csv` | King's Park global W/m², broadcast to SSP / Kai Tak |

Route `GET /api/telemetry/live` uses `export const runtime = "edge"` with a 45 s in-isolate memo. Existing `GET /api/hko/envelope` (Node ring buffer) is unchanged.

IDW identity, \(p=2\), \(d_i\) haversine kilometres:

\[
\hat z(\mathbf x)=\frac{\sum_i d_i^{-p} z_i}{\sum_i d_i^{-p}}
\]

Collocated queries collapse to the station value (\(d < 10^{-6}\) km). Temperature, RH, solar, and wind \(u,v\) are interpolated independently so a missing Sham Shui Po RH row does not drop the temperature field. Grid: 12×8 over lon 114.155–114.22, lat 22.297–22.338.

### 13.2 Synthetic LoRaWAN mesh (`lib/telemetry/sensor-network.ts`)

250 sensors (`LRN-0001`…`LRN-0250`) jittered inside Sham Shui Po footprints with \(\rho_{sub}\ge 0.35\). Placement uses `mulberry32(hashString(id))` — no `Date.now()` on the random path.

\[
T_{\mathrm{in}}^{t+\Delta t}=T_{\mathrm{in}}^{t}+\frac{\Delta t}{\tau}(T_{\mathrm{eq}}-T_{\mathrm{in}}^{t}),\quad
\tau=4\,\mathrm{h}\cdot(0.5+0.5\rho_{\mathrm{sub}}),\quad
T_{\mathrm{eq}}=(1-\alpha)T_{\mathrm{idw}}+\alpha T_{\mathrm{AC}}
\]

\(T_{\mathrm{AC}}=27.4^\circ\mathrm{C}\), \(\alpha=0.82\) when the window unit is on. Night 劏房 battery is `applySubdividedFlatThermalLag` (same \(\tau=4\,\mathrm{h}\)). TwinCanvas draws every 6th sensor (LoD) so 250 points never sit on the rAF particle budget.

### 13.3 LIVE MONITORING vs PREDICTIVE TWIN

| Mode | `opsMode` | Envelope | Spatial field |
| --- | --- | --- | --- |
| LIVE MONITORING | `"live"` (default literal) | Current HKO rolling envelope | IDW residual on every footprint |
| PREDICTIVE TWIN | `"predictive"` | July 2022 plate, peak 37.4°C | Synthetic three-station field |

HUD: `data-testid="live-ops-toggle"` / `ops-mode-live` / `ops-mode-predictive`. Scenario chips and ⌘K “Live monitoring” / “Predictive twin” flip the same state. Policy-drawer “live envelope” calls `enterLiveMonitoring`.

### 13.4 SSR / hydration

| Gate | Evidence |
| --- | --- |
| First paint | `MissionControl` remains behind `ClientOnly` + `MissionShell` (`data-hydrating="1"`). Toggle is not in the SSR fallback. |
| Default | `DEFAULT_OPS_MODE = "live"` compile-time literal. No `window` / `localStorage` / `Date.now()` in `ops-mode.ts` or `sensor-network.ts`. |
| `layout.tsx` | `suppressHydrationWarning` on `<html>` / `<body>` unchanged. |
| Edge vs Node | Telemetry route does not import `lib/hko/ingest.ts`. |
| Tests | `npm run test:telemetry` — IDW identity, 250 sensors, bit-stability, AC lag, live CSV poll, hydration source audit |

Zero-deletion invariant unchanged from §12.

## 14. Delivery ledger — Executive Presentation Suite (0.16.0)

Requirement-by-requirement evidence. Gates: `npx tsc --noEmit`, `npm run test:presentation`.

### 14.1 Cinematic briefing director (`components/presentation/CinematicDirector.tsx`)

Four beats in `lib/presentation/beats.ts`. TwinCanvas listens for `aeris-twin-keyframe` and lerps `TwinView` (ENU metres) over `KEYFRAME_MS = 2600`. Diurnal hour uses `lerpHourForward` so 23:00 → 02:00 wraps midnight forward.

| Beat | Title | Hour (HKT) | Look-at | Notes |
| --- | --- | --- | --- | --- |
| 1 | The Regional Heatwave Overview | 14:00 | Kowloon West 114.1685, 22.322 | July 2022 plate |
| 2 | The Street Canyon Trap | 23:00 | Fuk Wa St 114.16307, 22.33102 | Highest \(\rho_{sub}\) on Fuk Wa |
| 3 | The Hospital Triage Deficit | 02:00 | Midpoint CMC/KWH | Focus KWH; Caritas in frame |
| 4 | The Optimal Intervention Counterfactual | 15:00 | District policy view | Shelters 24, DHC 72%, bylaw, canopy 55%, AC grant 70%, 22% roof budget |

Keyboard: `ArrowLeft` / `ArrowRight` → `beat-prev` / `beat-next` in `lib/hotkeys.ts`. Presets `1–4` unchanged.

### 14.2 Spatial data sonification (`lib/audio/sonification.ts`)

`AudioContext` is constructed only inside `HeatSoundscape.unlock()` after a click (`Play briefing` or `Enable audio`). No `new AudioContext` at module load. Drone frequency/gain track `snapshot.regionalMeanWbgt` (ISO 7243, not Fiala). Hover ticks pulse while `solAirTempC(outdoorTa, roofAbsorbedWm2) > 40`. `close()` on director teardown.

### 14.3 Vector A4 briefing (`lib/presentation/a4-brief.ts`)

One-click PDF (`%PDF-1.4`, Helvetica, JPEG XObject of `[data-testid=twin-canvas]`) plus PNG raster 1240×1754. Sheet includes active map inset, Monte Carlo 95% CI (p2.5 / p50 / p97.5 + violin), and HA occupancy/deficit/arrivals/Cat-3 p50 for CMC, KWH, PMH, QEH. Existing DH/WHO exporters are unchanged.

### 14.4 SSR / hydration

| Gate | Evidence |
| --- | --- |
| Director | Mounted inside `ClientOnly` + `SimulationProvider` (`MissionControl`). |
| Audio | `lib/audio/sonification.ts` never touches `window` except inside functions. |
| Defaults | Beat tables and `OPTIMAL_COUNTERFACTUAL_POLICY` are compile-time literals. |
| Tests | `npm run test:presentation` |

## 15. Delivery ledger — Production Readiness Review (0.17.0)

Requirement-by-requirement evidence. Formal write-up: `PRR.md`. Gates: `npx tsc --noEmit`, `npm run test:verification`, `npm run build`.

### 15.1 Zero-allocation 60 FPS

| Path | Evidence |
| --- | --- |
| Wind | `lib/wind-field.ts` mutates `WindParticle[]` and a 6-point trail ring. |
| Ambulance | `pathLengthM` + `pointAlongPolylineInto`; same array returned. |
| TwinCanvas | `lib/twin-draw.ts` precomputed faces; `cameraBasisInto` / `projectEnuInto` / `HourInstanceCursor`. |
| Physics tick | Pooled `BuildingHourState`; HUD hour at 20 Hz; `hourClockRef` on rAF. |
| Deck.gl | `lib/gpu/particle-buffers.ts` binary `getPosition` (`Float32Array`). |

### 15.2 GPU lifecycle

`lib/gpu/context-lifecycle.ts`: `preventDefault` on lost, remount on restored, WebGPU adapter probe and `device.lost`. Overlay reports flags.

### 15.3 Verification harness

`lib/physics/__tests__/verification.ts`: Sol-Air night identity, ISO 7243/VDI 3787-2 mix, ISO 7730 PPD logistic, NSGA-II `dominates` + front, Monte Carlo PMF ∑=1.

### 15.4 Health overlay

`components/dev/SystemHealthOverlay.tsx`, `data-testid="system-health-overlay"`. Ctrl+Shift+D in `lib/hotkeys.ts` before the modifier guard. Smoke: Arrow + Neon + shader, < 1 s budget.

### 15.5 Hygiene

DuckDB `console.warn` behind `aerisDebugEnabled()`. Dead `AERIS_CONCEPT_PROMPTS` / `usePlaybackClock` removed. No `any` introduced.

## 16. Delivery ledger — Earth theater (0.18.0)

`/earth` is the Google-Earth analogue of `/` (operator HUD).

| Surface | Behaviour |
| --- | --- |
| `/earth`, `?briefing=1`, `?theater=1` | `isEarthTheater` → click-to-enter `EarthGate` (`data-testid="theater-gate"`) |
| Enter | Unlocks heat soundscape, `applyBeat(0)`, auto-advance every 7.5 s across 4 beats |
| GPU | `wantsGpuTwin` is true on Earth URLs; software ENU failover unchanged |
| Esc | Closes director, restores policy, clears `data-aeris-theater` |
| Tests | `npm run test:presentation` — path/query matrix in `scripts/presentation.test.ts` |





