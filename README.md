# AERIS-HK

**Atmospheric & Epidemiological Risk Intelligence System — Hong Kong**

A dual-scale research platform: an 18-district territory air/epidemiological **risk index** (FastAPI) and a Kowloon West **planetary digital twin** (Next.js) that couples first-principles biophysics, Hospital Authority surge queuing, and GPU/CPU geospatial rendering. Neither layer is a toy dashboard. Together they form a whitepaper-grade system of record for heat, air, and bed-capacity stress under Hong Kong’s humid-subtropical climate.

```
                    ┌─────────────────────────────────────┐
                    │         Operator / researcher       │
                    └──────────────┬──────────────────────┘
           ┌───────────────────────┴───────────────────────┐
           ▼                                               ▼
 ┌─────────────────────┐                       ┌─────────────────────────┐
 │ Territory index     │                       │ Kowloon West twin       │
 │ FastAPI :8000       │                       │ Next.js App Router :3000│
 │ 18 DC districts     │                       │ 168 CityJSON footprints │
 │ PM2.5 · NO₂ · O₃    │                       │ Deck.gl / TwinCanvas    │
 │ ILI · respiratory   │                       │ Gagge · Fanger · WBGT   │
 │ susceptibility amp. │                       │ M/M/c · Monte Carlo     │
 └─────────────────────┘                       └───────────┬─────────────┘
                                                           │
                    ┌──────────────────────────────────────┼──────────────┐
                    ▼                                      ▼              ▼
            Neon Postgres                          DuckDB-WASM      Spatial grid
            Drizzle ORM                            Arrow IPC        typed arrays
            ?sim=uuid share                        window SQL       bbox < 10 ms
```

This is **not** an official HKO, HA, or HKSAR product. Forecasts, queues, and risk scores are research estimators.

---

## Dual-scale architecture

### 1. Territory risk index (`aeris_hk/`)

A FastAPI service over Hong Kong’s 18 District Council districts. Each district carries:

| Layer | Meaning |
| --- | --- |
| Air | 0.55·PM2.5 + 0.25·NO₂ + 0.20·O₃, each scaled to WHO-order references |
| Epi | 0.6·ILI + 0.4·respiratory admissions |
| Susceptibility | log₁₀ population density between ~1k and ~60k / km² |

Composite (see `aeris_hk/model.py`):

\[
\text{amplifier} = 1 + 0.2\cdot\text{susceptibility}
\]

\[
\text{risk} = 100\cdot\mathrm{clamp}\bigl(\text{amplifier}\cdot(0.50\cdot\text{air} + 0.35\cdot\text{epi} + 0.15\cdot\text{susceptibility})\bigr)
\]

Bands: **Low** `[0,25)`, **Moderate** `[25,50)`, **High** `[50,75)`, **Very High** `[75,100]`.

APIs: `GET /api/health`, `GET /api/districts`, `GET /api/risk`, `GET /api/risk/{id}`, `GET /api/summary`. UI at `/`. Tests: `python3 -m pytest tests/`.

### 2. Kowloon West planetary twin (`app/`, `lib/`, `components/`)

A Next.js 14 App Router twin of Sham Shui Po / Yau Tsim Mong. Default renderer is a **software ENU TwinCanvas** (deterministic, CI-safe). Optional GPU Deck.gl is gated by `?gpu=1` **and** a healthy WebGL2 context. **Earth theater** at `/earth` (or `?briefing=1`) is the click-to-enter cinematic: harbour plate, bilingual thesis, four beats, GPU requested.

Authoritative CRS: **HK1980 Grid (EPSG:2326)** on `properties.hk80` and PostGIS `geom_hk80`. WGS84 (EPSG:4326) is derived exclusively via `lib/crs.ts` (Helmert TOWGS84 + International 1924 TM). Deck.gl `getPosition` is **never** fed HK80 eastings. The software twin projects WGS84 → local ENU metres (`lib/twin-camera.ts`) for display only.

**Cloud tier — Neon Serverless Postgres + Drizzle ORM**

- Tables: `buildings`, `simulation_runs`, `hourly_cluster_metrics` (`lib/db/schema.ts`).
- HTTP driver for serverless routes; WebSocket `postgres` pool for seed (`lib/db/http.ts`, `lib/db/client.ts`).
- Shareable URLs: `/?sim=<uuid>` hydrates the HUD from `simulation_runs.config`.
- Seed: `npm run db:seed` writes 168 Kowloon West footprints as GeoJSON polygons.

**Client tier — DuckDB-WASM + Apache Arrow IPC + spatial hash**

- `lib/duckdb-engine.ts` registers Arrow tables (`lib/arrow-ipc.ts`) and runs window-function knapsack SQL.
- `lib/spatial-grid.ts` is a typed-array uniform grid over ENU metres: bbox / kNN over tens of thousands of urban vectors in **sub-10 ms** on the main thread (see `SYSTEM_INTELLIGENCE.md`).
- `lib/cityjson.ts` emits CityJSON 2.0 `Building` objects from the same footprints.

**Geospatial patterns**

- Kepler.gl-style **instancing**: 20,480 `instancePositions` / `instanceColors` on Deck.gl `ColumnLayer` (`lib/instance-mesh.ts`) plus packed 168-footprint attributes (`lib/gpu-attributes.ts`). District LoD uses 4-sided disks; street LoD restores true GeoJSON footprints.
- Timeline scrub reads **hour-major Arrow columns** (`lib/arrow-columns.ts`) inside a 5 ms frame budget; DuckDB-WASM stays on a named `aeris-duckdb` Worker for ingest / knapsack SQL.
- Client **SWR** cache (`lib/sim-cache.ts`) dedupes `/api/simulations` list and snapshot fetches. Neon composite indexes cover centroid bbox and `(run_id, timestamp)`.
- Uber **H3** resolution 9 / 10 hex aggregation (`lib/h3-index.ts`), drawn as GeoJSON (not `@deck.gl/geo-layers` — that barrel pulls `mesh-layers` and breaks the Next 14 webpack build).
- **CityJSON**-shaped building records: `id`, `height_m`, `year_built`, `storeys`, `typology`, `footprint` rings.

---

## First-principles physics (twin)

| Model | Identity / solver | Module |
| --- | --- | --- |
| Gagge two-node | \(S = M - W - E - R - C\) | `lib/epidemiology-engine.ts` |
| Fanger PMV–PPD | ISO 7730, Newton \(T_{cl}\) | `lib/biophysics.ts` |
| WBGT | Liljegren-class iteration | `lib/biophysics.ts` |
| 劏房 4 h battery | Night-only Euler, \(\tau=4\,\mathrm{h}\) | `lib/biophysics.ts` |
| Street-canyon / Tong Lau | Aspect \(H/W\), Oke SVF, thermal inertia | `lib/canyon.ts` |
| NOAA SPA solar | \(\gamma_s, \alpha_s\) at 22.3193°N, 114.1694°E | `lib/solar-engine.ts` |
| Venturi wind | Continuity squeeze in alleys | `lib/wind-field.ts` |
| CVI | WBGT × elderly × density × blockage | `lib/epidemiology-engine.ts` |
| M/M/c | Erlang-C wait, ρ, 8-hour overflow | `lib/epidemiology-engine.ts` |
| Monte Carlo | 1,000 draws, 95% CI on HA beds | `lib/monte-carlo.ts` |
| Cool-roof knapsack | DuckDB `SUM() OVER` + 0/1 DP | `lib/duckdb-engine.ts` |
| NSGA-II Pareto | 500 gen, cost / Cat 1–3 averted / ΔGini / MW | `lib/optimization/` |
| HKO IDW field | \(ẑ=\sum d_i^{-2}z_i/\sum d_i^{-2}\) on SSP / KP / Kai Tak | `lib/telemetry/hko-feed.ts` |
| LoRaWAN 劏房 mesh | 250 sensors, \(\tau=4\,\mathrm{h}\cdot(0.5+0.5\rho_{sub})\) | `lib/telemetry/sensor-network.ts` |
| Sol-air temperature | \(T_{sa}=T_a+q_{abs}/h_o\), \(h_o=22\,\mathrm{W\,m^{-2}K^{-1}}\) | `lib/solar.ts` |
| Heat soundscape | WBGT drone + Sol-Air \(>40^\circ\mathrm{C}\) ticks | `lib/audio/sonification.ts` |

Hospital Authority clusters in the twin: **CMC** (Caritas Medical Centre), **KWH** (Kwong Wah), **QEH** (Queen Elizabeth). Live HKO / HA pollers remain on 60 s / 5 min cadences.

---

## Progressive disclosure HUD (zero deletions)

Interface density is solved with aerospace / VisionOS glass — **not** by removing sliders or metrics.

- **LIVE MONITORING / PREDICTIVE TWIN** toggle: current HKO AWS + IDW field vs July 2022 heatwave plate; 250 LoRaWAN 劏房 sensors.
- **Command palette** (`⌘K` / `Ctrl+K`): streets, districts, DB snapshots, scenarios, live monitoring / predictive twin.
- **Control Dock** (bottom pill): layers, playbar, Jul 2022 / Typhoon / Blackout, Share `?sim=`.
- **Pinned ENU telemetry** on building pick; inspector tabs Thermal / Demographic / A&E Surge (Cat 1–3).
- **Cinematic orbital camera** on TwinCanvas (Control Dock → Orbit).
- **Keyboard**: `1–4` dock presets, `Space` play/pause, `←` / `→` cinematic briefing beats, `⌘K` / `Ctrl+K` palette, `Ctrl+Shift+D` system health overlay, `Esc` dismisses palette then pinned inspector HUDs. Formula `ƒ` tips on every biophysical spark (UTCI/WBGT, Fanger PMV, DLNM-style RR).
- **Executive Presentation Suite**: `Play briefing` opens the cinematic director (camera + diurnal keyframes, Web Audio heat soundscape, one-click A4 PDF+PNG). Existing DH/WHO `ExportReport` and `ExecutiveBriefing` remain.
- **Spatial Policy Copilot**: `Ask copilot` on the Control Dock / ⌘K. Natural language plans four Zod-validated tools (`run_counterfactual`, `focus_hotspot`, `query_hospital_capacity`, `compare_scenarios`) via OpenAI, Anthropic, Neon AI Gateway, or the offline intent parser. The twin flies to the canyon, scrubs to peak thermal hour, and paints green/red CVI delta polygons. Every sentence cites the live engine (`[Sol-Air Equation: Eq. 3]`, DuckDB footprint counts, Neon run id).

---

## Quick start

### Planetary twin (port 3000)

```bash
npm install --legacy-peer-deps
cp .env.example .env.local   # NEON_DATABASE_URL
npx drizzle-kit push
npm run db:seed
npm run dev                  # http://127.0.0.1:3000
npm run build && PORT=3000 npm start
```

`npm install` without `--legacy-peer-deps` fails (Mapbox / Deck.gl peer range).

### Territory index (port 8000)

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 -m aeris_hk.main     # http://127.0.0.1:8000
python3 -m pytest tests/
```

### Gates (twin)

```bash
npx tsc --noEmit
npm run test:crs && npm run test:ha && npm run test:cool-roof
npm run test:twin && npm run test:decade && npm run test:solar
npm run test:mc && npm run test:scenarios && npm run test:bio
npm run test:h3 && npm run test:db && npm run test:spatial
npm run test:instance && npm run test:arrow && npm run test:cache
npm run test:triage && npm run test:briefing && npm run test:hardening && npm run test:agent
npm run test:pareto && npm run test:telemetry && npm run test:presentation
npm run test:verification
npm run build
```

---

## Repository map

| Path | Role |
| --- | --- |
| `aeris_hk/` | FastAPI territory index |
| `static/` | District choropleth UI |
| `tests/` | Python pytest suite |
| `app/` | Next.js App Router + `/api/simulations` |
| `lib/` | CRS, physics, Neon, DuckDB, H3, GPU, Spatial Policy Copilot, NSGA-II Pareto, HKO telemetry / LoRaWAN mesh |
| `components/` | TwinCanvas, Deck overlay, HUD, dock, `components/copilot/PolicyAgent.tsx` |
| `scripts/` | Seed, neon ping, DuckDB bench |
| `drizzle/` | SQL migrations |
| `PRR.md` | Production Readiness Review: SLIs, degradation matrix, math spec |
| `PERFORMANCE_AUDIT.md` | Before/after Deck.gl, Arrow, Neon benches |
| `SYSTEM_INTELLIGENCE.md` | Formulas, CRS, SSR, measured benches |
| `CHANGELOG.md` / `ROADMAP.md` | Leaves and remaining work |

---

## Licence & disclaimer

Research software. Do not treat outputs as clinical, meteorological, or statutory advice.
