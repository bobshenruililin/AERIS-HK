/**
 * Client-side 1,000-iteration Monte Carlo policy stress-tester.
 * Samples micro-climate temperature spikes (±1.8°C) and AC grid failures,
 * then reports 95% CI for daily CVD presentations and bed-occupancy deficit.
 *
 * Physics identity is not re-solved 1,000 × 168 × 24 times — each draw scales
 * the already-computed 24-hour impact with a Bishai-style RR and an AC-failure
 * multiplier so the worker stays inside a frame budget.
 */
import { clamp, mulberry32 } from "./utils";

export const MC_ITERATIONS = 1000;
export const MC_SPIKE_AMP_C = 1.8;
export const MC_HEAT_RR_PER_C = 0.22;
export const MC_AC_FAIL_MULTIPLIER = 1.42;
export const MC_VIOLIN_BINS = 32;

export interface MonteCarloInput {
  scenarioAdmissions24h: number;
  scenarioBedDeficitPct: number;
  acFailProbability: number;
  spikeAmpC?: number;
  iterations?: number;
  seed?: number;
  ozoneIndex?: number;
}

export interface QuantileBand {
  mean: number;
  p025: number;
  p50: number;
  p975: number;
}

export interface MonteCarloResult {
  iterations: number;
  elapsedMs: number;
  admissions: QuantileBand;
  bedDeficitPct: QuantileBand;
  violinAdmissions: number[];
  violinBeds: number[];
  engine: "sync-js" | "worker-js" | "worker-duckdb";
  duckdbMs: number | null;
}

export function quantileLinear(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const t = clamp(p, 0, 1) * (sorted.length - 1);
  const lo = Math.floor(t);
  const hi = Math.min(sorted.length - 1, lo + 1);
  const u = t - lo;
  return sorted[lo] * (1 - u) + sorted[hi] * u;
}

export function bandFromSamples(samples: number[]): QuantileBand {
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = samples.reduce((s, v) => s + v, 0) / Math.max(1, samples.length);
  return {
    mean,
    p025: quantileLinear(sorted, 0.025),
    p50: quantileLinear(sorted, 0.5),
    p975: quantileLinear(sorted, 0.975),
  };
}

/** Standard-normal via Box–Muller, then truncated to ±amp. */
function truncatedNormal(rng: () => number, amp: number): number {
  const u1 = Math.max(1e-9, rng());
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return clamp(z * (amp / 1.96), -amp, amp);
}

export function densityProfile(samples: number[], bins = MC_VIOLIN_BINS): number[] {
  if (samples.length === 0) return Array.from({ length: bins }, () => 0);
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const span = Math.max(1e-6, max - min);
  const counts = new Array<number>(bins).fill(0);
  for (const v of samples) {
    const i = Math.min(bins - 1, Math.floor(((v - min) / span) * bins));
    counts[i] += 1;
  }
  const peak = Math.max(1, ...counts);
  return counts.map((c) => c / peak);
}

export function runMonteCarlo(input: MonteCarloInput): MonteCarloResult {
  const t0 =
    typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
  const n = Math.max(32, Math.round(input.iterations ?? MC_ITERATIONS));
  const amp = input.spikeAmpC ?? MC_SPIKE_AMP_C;
  const rng = mulberry32(input.seed ?? 20220719);
  const pFail = clamp(input.acFailProbability, 0, 1);
  const ozone = 1 + 0.08 * clamp(input.ozoneIndex ?? 0, 0, 1);
  const admissions: number[] = new Array(n);
  const beds: number[] = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const spike = truncatedNormal(rng, amp);
    const acFail = rng() < pFail;
    const rr = Math.exp(MC_HEAT_RR_PER_C * spike) * (acFail ? MC_AC_FAIL_MULTIPLIER : 1) * ozone;
    admissions[i] = Math.max(0, input.scenarioAdmissions24h * rr);
    beds[i] = Math.max(0, input.scenarioBedDeficitPct * (0.92 + 0.55 * (rr - 1) + (acFail ? 0.18 : 0)));
  }
  const elapsedMs =
    (typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now()) - t0;
  return {
    iterations: n,
    elapsedMs,
    admissions: bandFromSamples(admissions),
    bedDeficitPct: bandFromSamples(beds),
    violinAdmissions: densityProfile(admissions),
    violinBeds: densityProfile(beds),
    engine: "sync-js",
    duckdbMs: null,
  };
}

export const MONTE_CARLO_QUANTILE_SQL = `
  SELECT
    quantile_cont(admissions, 0.025) AS adm_p025,
    quantile_cont(admissions, 0.50)  AS adm_p50,
    quantile_cont(admissions, 0.975) AS adm_p975,
    quantile_cont(beds, 0.025)       AS bed_p025,
    quantile_cont(beds, 0.50)        AS bed_p50,
    quantile_cont(beds, 0.975)       AS bed_p975
  FROM mc_draws
`;
