/**
 * Exact identities used by AERIS-HK biophysical graphs.
 * Tooltips must quote these strings — do not invent a Fiala UTCI polynomial
 * or a Gasparrini DLNM spline the engine does not run.
 */

export const FORMULAS = {
  utci: {
    id: "utci",
    name: "UTCI (operational outdoor heat)",
    identity: "WBGT_out = 0.7 Tw + 0.2 Tg + 0.1 Ta   |   WBGT_in = 0.7 Tw + 0.3 Tg   (ISO 7243)",
    note: "AERIS does not evaluate the Fiala UTCI polynomial. Outdoor heat strain is ISO 7243 wet-bulb globe temperature (lib/biophysics.ts solveWbgtDifferential) as the operational UTCI analogue. Tw from a Stull/Newton wet-bulb; Tg is the globe.",
  },
  pmv: {
    id: "pmv",
    name: "PMV / PPD (ISO 7730 Fanger)",
    identity:
      "PMV = (0.303 e^{-0.036M} + 0.028)·[(M−W) − ΣH_L];  PPD = 100 − 95 e^{−0.03353 PMV⁴ − 0.2179 PMV²}",
    note: "Clothing temperature Tcl is Newton-iterated. 1 met = 58.15 W/m². fangerPmvPpd in lib/biophysics.ts. PPD is clamped to [5, 100].",
  },
  "dlnm-rr": {
    id: "dlnm-rr",
    name: "DLNM-style relative risk",
    identity:
      "Decade RR = max(0.55, 1 + 0.22·ΔT);  MC RR = exp(0.22·ΔT_spike)·AC_fail;  strain = exp(β(WBGT−26.4) + 0.22(T_core−37.2))",
    note: "Not a full Gasparrini DLNM cross-basis spline. Cardiovascular heat uses a Bishai-style lag-response (HEAT_RR_PER_C = MC_HEAT_RR_PER_C = 0.22 / °C) in lib/decade.ts, lib/monte-carlo.ts, and bishaiCardiovascularStrain.",
  },
  gagge: {
    id: "gagge",
    name: "Gagge two-node",
    identity: "S = M − W − E − R − C   (W/m²)",
    note: "Skin/core heat storage identity asserted on every footprint at 15:00 HKT. lib/epidemiology-engine.ts. Do not collapse to a single temperature proxy.",
  },
  cvi: {
    id: "cvi",
    name: "Cardiovascular Vulnerability Index",
    identity: "CVI = 100·(0.35·MicroWBGT/35 + 0.28·ρ_sub + 0.22·elderly + 0.15·blockage + 0.12·ozone)",
    note: "Clamped to [0, 100]. DHC outreach reduces the elderly term. buildingCardiovascularIndex in lib/epidemiology-engine.ts.",
  },
  mmc: {
    id: "mmc",
    name: "M/M/c HA surge",
    identity: "ρ = λ / (cμ);  P(wait) = Erlang-C(c, ρ);  overflow when occupancy ≥ 120% → PMH/QEH",
    note: "CMC, KWH, PMH, QEH. μ from Cat 1–3 mix; c from Cat 3 p50 wait. 120% staffed-bed trigger boards onto PMH and QEH.",
  },
  knapsack: {
    id: "knapsack",
    name: "Cool-roof 0/1 knapsack",
    identity: "max Σ averted_i  s.t.  Σ roof_m2_i ≤ budget,  s_i ∈ {0,1}",
    note: "Exact DP on 24-hour admissions averted. DuckDB ROW_NUMBER + running SUM(roof_m2) OVER ranks the same table.",
  },
  "sol-air": {
    id: "sol-air",
    name: "Sol-Air Equation: Eq. 3",
    identity: "q_abs = I_peak · sin^{1.15}(γ_s) · (1 − ρ)   ρ_asphalt=0.18  ρ_cool=0.65",
    note: "Absorbed roof shortwave in lib/solar.ts roofAbsorbedShortwaveWm2. I_peak = 890 W/m². Not a Fiala UTCI term.",
  },
  nsga2: {
    id: "nsga2",
    name: "NSGA-II Pareto frontier",
    identity:
      "min (C_muni+hh, −A_cat13, −ΔGini_tenement, P_MW)  |  500 gen · pop 32 · SBX ηc=15 · poly-mut ηm=20",
    note: "Client Web Worker in lib/optimization/. Rank-1 non-dominated set. Click a point to write the four levers into PolicyState; the HUD then recomputes Gagge / M/M/c / knapsack on the main twin.",
  },
  gini: {
    id: "gini",
    name: "Thermal inequity (weighted Gini)",
    identity: "G = (2 Σ x_i w_i S_i − Σ x_i w_i²) / (W Σ x w) − 1   x = indoor T_a,  ρ_sub ≥ 0.4",
    note: "Residents of tenement / subdivided-flat blocks only. Inequity reduction is G_baseline − G_scenario at 15:00 HKT. lib/optimization/gini.ts.",
  },
  "hvac-mw": {
    id: "hvac-mw",
    name: "Grid peak HVAC strain",
    identity: "P_MW = Σ_b (q_AC,b · A_roof,b) / 10^6    q_AC in W/m² at 15:00 HKT",
    note: "q_AC is effectiveAcHeat (rejector waste heat after bylaw, cool roof, tenement efficiency grant, and grid failure). Not a Fiala term.",
  },
  idw: {
    id: "idw",
    name: "Inverse Distance Weighting microclimate",
    identity: "ẑ(x) = Σ d_i^{-p} z_i / Σ d_i^{-p}    p=2    d_i = haversine(x, x_i)",
    note: "HKO Sham Shui Po, King's Park, and Kai Tak AWS (T, RH, solar, wind). Missing components skipped independently. lib/telemetry/hko-feed.ts. Not a Fiala UTCI term.",
  },
  "lorawan-lag": {
    id: "lorawan-lag",
    name: "劏房 LoRaWAN indoor lag",
    identity: "T_in^{t+Δt}=T_in^t+(Δt/τ)(T_eq−T_in^t)  τ=4h·(0.5+0.5ρ_sub)  T_eq=(1−α)T_idw+α T_AC",
    note: "250 synthetic LoRaWAN sensors in Sham Shui Po subdivided flats. Night battery is the same τ=4 h identity as applySubdividedFlatThermalLag. Not a Fiala term.",
  },
} as const;

export type FormulaId = keyof typeof FORMULAS;

export const FORMULA_IDS = Object.keys(FORMULAS) as FormulaId[];

export function formulaById(id: FormulaId) {
  return FORMULAS[id];
}
