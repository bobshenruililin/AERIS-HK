/// <reference lib="webworker" />
/**
 * Dedicated worker for the 1,000-draw policy stress-tester.
 * Tries DuckDB-WASM QUANTILE_CONT; falls back to the JS engine in monte-carlo.ts.
 */
import { bandFromSamples, runMonteCarlo, type MonteCarloInput, type MonteCarloResult } from "./monte-carlo";
import { mulberry32, clamp } from "./utils";
import { MC_AC_FAIL_MULTIPLIER, MC_HEAT_RR_PER_C, MC_ITERATIONS, MC_SPIKE_AMP_C } from "./monte-carlo";

export type MonteCarloWorkerRequest = { type: "run"; requestId: number; payload: MonteCarloInput };
export type MonteCarloWorkerResponse = { type: "result"; requestId: number; result: MonteCarloResult };

function truncatedNormal(rng: () => number, amp: number): number {
  const u1 = Math.max(1e-9, rng());
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return clamp(z * (amp / 1.96), -amp, amp);
}

function sampleDraws(input: MonteCarloInput): { admissions: number[]; beds: number[] } {
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
  return { admissions, beds };
}

async function duckdbQuantiles(
  admissions: number[],
  beds: number[],
): Promise<{ admissions: ReturnType<typeof bandFromSamples>; beds: ReturnType<typeof bandFromSamples>; ms: number } | null> {
  try {
    const duckdb = await import("@duckdb/duckdb-wasm");
    const bundles = duckdb.getJsDelivrBundles();
    const bundle = await duckdb.selectBundle(bundles);
    const workerUrl = URL.createObjectURL(
      new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" }),
    );
    const worker = new Worker(workerUrl);
    const db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    URL.revokeObjectURL(workerUrl);
    const conn = await db.connect();
    await conn.query("CREATE TABLE mc_draws (admissions DOUBLE, beds DOUBLE)");
    const n = admissions.length;
    const chunk = 200;
    for (let i = 0; i < n; i += chunk) {
      const sliceA = admissions.slice(i, i + chunk);
      const sliceB = beds.slice(i, i + chunk);
      const values = sliceA.map((a, j) => `(${a}, ${sliceB[j]})`).join(",");
      await conn.query(`INSERT INTO mc_draws VALUES ${values}`);
    }
    const t0 = Date.now();
    const table = await conn.query(`
      SELECT
        avg(admissions) AS adm_mean,
        quantile_cont(admissions, 0.025) AS adm_p025,
        quantile_cont(admissions, 0.50) AS adm_p50,
        quantile_cont(admissions, 0.975) AS adm_p975,
        avg(beds) AS bed_mean,
        quantile_cont(beds, 0.025) AS bed_p025,
        quantile_cont(beds, 0.50) AS bed_p50,
        quantile_cont(beds, 0.975) AS bed_p975
      FROM mc_draws
    `);
    const ms = Date.now() - t0;
    const row = table.toArray()[0] as Record<string, number>;
    await conn.close();
    await db.terminate();
    return {
      ms,
      admissions: {
        mean: Number(row.adm_mean),
        p025: Number(row.adm_p025),
        p50: Number(row.adm_p50),
        p975: Number(row.adm_p975),
      },
      beds: {
        mean: Number(row.bed_mean),
        p025: Number(row.bed_p025),
        p50: Number(row.bed_p50),
        p975: Number(row.bed_p975),
      },
    };
  } catch {
    return null;
  }
}

self.onmessage = (event: MessageEvent<MonteCarloWorkerRequest>) => {
  const msg = event.data;
  if (!msg || msg.type !== "run") return;
  const base = runMonteCarlo(msg.payload);
  const { admissions, beds } = sampleDraws(msg.payload);
  let sent = false;
  const send = (result: MonteCarloResult) => {
    if (sent) return;
    sent = true;
    const reply: MonteCarloWorkerResponse = { type: "result", requestId: msg.requestId, result };
    (self as DedicatedWorkerGlobalScope).postMessage(reply);
  };
  const timer = setTimeout(() => send({ ...base, engine: "worker-js" }), 1600);
  void duckdbQuantiles(admissions, beds).then((duck) => {
    clearTimeout(timer);
    send(
      duck
        ? {
            ...base,
            admissions: duck.admissions,
            bedDeficitPct: duck.beds,
            engine: "worker-duckdb",
            duckdbMs: duck.ms,
          }
        : { ...base, engine: "worker-js" },
    );
  });
};
