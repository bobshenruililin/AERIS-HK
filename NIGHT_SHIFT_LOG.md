# AERIS-HK night-shift ledger

Overnight sprint: progressive-disclosure HUD, solar-engine canyon physics, client-side Monte Carlo, and the three historic/stress plates. **Zero deletion** — every slider, metric, decade chip, knapsack table, Gagge identity, and HA nowcast remains mounted; only presentation is docked.

---

## 02:10 HKT — Architecture decisions

- HUD density is a **viewport-preset** problem, not a data problem. Four aerospace plates (`1` Strategic Command, `2` Micro-Canyon Physics, `3` Policy Sandbox, `4` Clinical Surveillance Briefing) live in `lib/hud.ts`. Drawers collapse to glass pills with sparklines; content stays in the tree (`height: 0` / `sr-only`) so testids and state survive.
- Command palette is `components/ui/CommandPalette.tsx` (`⌘/Ctrl+K`): jump to any tong lau (aliases include “Pei Ho St Tong Lau Block A” and “Temple St Night Market”), policy macros (30 shelters / 100% DHC / Extreme Heat Baseline), layer toggles, and the three stress scenarios.
- Shortcuts: `1–4` presets, `Space` play/pause, `F` harbour fly-in reset. Ignored while typing.
- `lib/solar.ts` stays the Deck.gl lighting clock. New `lib/solar-engine.ts` is the astronomical engine at **22.3193°N, 114.1694°E**, feeding canyon beam fraction into Gagge / globe temperature without breaking `S = M − W − E − R − C`.
- Monte Carlo is **1,000 draws** of ±1.8°C truncated-normal spikes and Bernoulli AC-grid failure, scaling the already-solved 24h impact with Bishai RR 0.22/°C. A dedicated worker (`lib/monte-carlo-worker.ts`) tries DuckDB-WASM `quantile_cont`; JS quantiles are the guaranteed path.

## 02:40 HKT — Track 1 (HUD)

| Surface | Presentation |
|---|---|
| Floating Control Dock | Top-centre glassmorphic `1–4` + `⌘K`; bottom-centre play / focus |
| Header telemetry | Compact vital strip by default on plates 2–3; full mission strip + causal chain still in DOM |
| Hospital / Policy / Knapsack / Decade | Expandable drawers; pills show occupancy / averted / roof count / decade Σ |
| Building inspector | Tabbed mini-HUD (Biophysics / Demographics / Inpatient surge) pinned to click coordinates |
| Preset 4 | Auto-opens the existing DH/WHO print briefing (`data-testid="clinical-briefing"`) |

## 03:10 HKT — Track 2 (physics)

- Pei Ho Street canyon **H/W = 3.5**: floor is shadowed when `tan(el) < (H/W)·|sin(az − street axis)|`. Noon beam fraction > 0.8; dawn beam < 0.5 (unit tests).
- Wind layer: **Venturi** acceleration between opposing tong-lau walls, **stall** in dead-end alleys, sea-breeze scale 0 under typhoon subsidence.
- TwinCanvas / Deck.gl: convective shimmer (wavy CVI plumes) and optional wireframes, gated by `hudLayers` so they can be toggled from the palette without deleting the particle system.

## 03:25 HKT — Track 3 (scenarios)

| Id | What it forces |
|---|---|
| `july-2022-heatwave` | 37.4°C peak, zero cloud, 88% night RH, midnight AC-rejector boost 1.85 |
| `typhoon-subsidence` | `seaBreezeScale = 0`, ozone index 0.92 |
| `district-blackout` | AC grid failure = 1, 90 min elapsed → indoor wet-bulb **≥ 36°C** on dense SSP tenements |

Decade observatory (2016–2026) is **not** replaced. Scenarios overlay the live/episode envelope.

## 03:40 HKT — Performance benchmarks (this VM)

| Probe | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| Monte Carlo 1,000 draws (sync JS) | **~3.3 ms** |
| Gagge identity over full twin at 15:00 | **~68 ms**, S reconstructed on every footprint |
| Cool-roof 24h ranking + knapsack (existing suite) | pass, including exact vs window greedy |
| CRS / PostGIS / HA privacy suites | 42/42 pass |
| Solar-engine + scenarios + HUD presets | 27/27 pass in the combined physics file set |
| Deck.gl frame budget | Software ENU twin remains the default picture (60 fps target). GPU Deck.gl still `?gpu=1` + healthy WebGL2 only — hydration-safe `ssr: false` on `AERISMap` |
| DuckDB | Existing analytics bundle + worker `quantile_cont` attempt (1.6 s race, then JS CI). Query latency still surfaced on the mission strip |

## How to demo to stakeholders tomorrow

1. Load `/` — harbour fly-in, Control Dock at top centre. **Do not** hunt sidebars; they are docked.
2. Press **`1`**: Strategic Command — HA CMC/KWH/QEH board + knapsack list expanded, policy as a pill.
3. Press **`2`**: Micro-Canyon — wind + thermal shimmer + wireframes; click a tong lau; inspector tabs (Gagge `S = M − W − E − R − C` is the Biophysics tab).
4. Press **`⌘K`**, type `Pei Ho` or `Temple St Night Market` — camera look-at + inspector pin.
5. Press **`3`**: Policy Sandbox. Drag shelters / DHC / cool-roof m² (all still there). Watch the **Monte Carlo violin** 95% CI. Click **July 2022 Historic Heatwave**, then **District Blackout**.
6. Press **`4`**: full-screen clinical briefing, Print/PDF. Esc / close returns to plate 1.
7. **`Space`** plays the 24h scrubber; **`F`** resets the harbour approach.
8. Decade chips, Export report, Run briefing, HA nowcast, Neon archive badge — all still reachable (expand the header / decade pill if you docked them).

## Files added

- `lib/solar-engine.ts`, `lib/physics-forcing.ts`, `lib/scenarios.ts`, `lib/monte-carlo.ts`, `lib/monte-carlo-worker.ts`, `lib/monte-carlo-client.ts`, `lib/hud.ts`
- `components/ui/CommandPalette.tsx`, `ControlDock.tsx`, `HudDrawer.tsx`, `MonteCarloPanel.tsx`
- `scripts/solar-engine.test.ts`, `scripts/monte-carlo.test.ts`, `scripts/scenarios.test.ts`

## 04:05 HKT — Browser walkthrough (headless Chrome, production `next start`)

Verified against `http://127.0.0.1:3000/`:

- Control dock presets 1–4 present; twin canvas mounted.
- Preset 3 exposes every policy slider, cool-roof knapsack card, Monte Carlo 95% CI panel, and the three scenario chips.
- July 2022 and District Blackout load without stripping sliders.
- `Ctrl+K` palette filters Pei Ho footprints; Enter pins the inspector with Biophysics / Demographics / Inpatient surge tabs and live Gagge `S = M − W − E − R − C`.
- Preset 4 opens `clinical-briefing` (existing DH/WHO print surface).
- Zero-deletion DOM check: `admissions-averted`, `decade-years`, `mission-strip` still present when docked.

Screenshots: `/opt/cursor/artifacts/preset-1-strategic.png`, `preset-2-canyon.png`, `preset-3-policy.png`, `command-palette.png`, `inspector-hud.png`, `preset-4-briefing.png`.


- No metric, slider, or simulation feature was removed.
- Figma/Notion/Canva MCP remain desktop-auth-only in this cloud; the HUD uses the existing `lib/tokens.ts` cyan/amber glass language.
- Headless Chrome still does not reliably rasterize Deck.gl; the software twin is the verified 3D city.
