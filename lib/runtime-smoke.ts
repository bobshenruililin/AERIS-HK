import { CVI_MODERATE_MAX } from "./constants";
import { queryHourColumns, type HourColumnStore } from "./arrow-columns";
import { compileProbeShaders } from "./gpu/context-lifecycle";
import { runSyntheticDuckDbProbe } from "./duckdb-engine";
import type { SmokeCheckResult, SmokeTestReport } from "./runtime-diagnostics";

function syntheticColumnStore(): HourColumnStore {
  const n = 48;
  const buildingId = new Array<string>(n);
  const nameEn = new Array<string>(n);
  const nameZh = new Array<string>(n);
  const district = new Uint8Array(n);
  const hour = new Uint8Array(n);
  const cvi = new Float32Array(n);
  const microWbgt = new Float32Array(n);
  const indoorTa = new Float32Array(n);
  const counts = new Uint32Array(24);
  for (let i = 0; i < n; i += 1) {
    const h = i % 24;
    buildingId[i] = `smoke-${Math.floor(i / 24)}`;
    nameEn[i] = "Smoke";
    nameZh[i] = "煙";
    district[i] = i < 24 ? 0 : 1;
    hour[i] = h;
    cvi[i] = 40 + (i % 12);
    microWbgt[i] = 28 + (i % 5) * 0.2;
    indoorTa[i] = 31 + (i % 4) * 0.15;
    counts[h] += 1;
  }
  const orderedBuildingId = new Array<string>(n);
  const orderedNameEn = new Array<string>(n);
  const orderedNameZh = new Array<string>(n);
  const orderedDistrict = new Uint8Array(n);
  const orderedHour = new Uint8Array(n);
  const orderedCvi = new Float32Array(n);
  const orderedWbgt = new Float32Array(n);
  const orderedTa = new Float32Array(n);
  const hourStart = new Uint32Array(25);
  for (let h = 0; h < 24; h += 1) hourStart[h + 1] = hourStart[h] + counts[h];
  const cursor = hourStart.slice(0, 24);
  for (let i = 0; i < n; i += 1) {
    const h = hour[i];
    const slot = cursor[h]++;
    orderedBuildingId[slot] = buildingId[i];
    orderedNameEn[slot] = nameEn[i];
    orderedNameZh[slot] = nameZh[i];
    orderedDistrict[slot] = district[i];
    orderedHour[slot] = h;
    orderedCvi[slot] = cvi[i];
    orderedWbgt[slot] = microWbgt[i];
    orderedTa[slot] = indoorTa[i];
  }
  return {
    n,
    buildingId: orderedBuildingId,
    nameEn: orderedNameEn,
    nameZh: orderedNameZh,
    district: orderedDistrict,
    hour: orderedHour,
    cvi: orderedCvi,
    microWbgt: orderedWbgt,
    indoorTa: orderedTa,
    hourStart,
  };
}

async function checkDuckDb(): Promise<SmokeCheckResult> {
  const t0 = performance.now();
  try {
    const store = syntheticColumnStore();
    const [arrow, duck] = await Promise.all([
      Promise.resolve(queryHourColumns(store, 15, CVI_MODERATE_MAX)),
      runSyntheticDuckDbProbe(),
    ]);
    const ms = performance.now() - t0;
    const arrowOk = arrow.rowCount === store.n && arrow.elapsedMs < 50;
    const duckOk = duck.ok;
    const ok = arrowOk && duckOk && ms < 200;
    const duckDetail = duck.detail === "wasm-cold" ? "wasm cold · Arrow fallback" : `DuckDB ${duck.detail}`;
    return {
      id: "duckdb",
      ok,
      ms,
      detail: ok
        ? `Arrow scrub ${arrow.elapsedMs.toFixed(2)} ms · ${arrow.rowCount} rows · ${duckDetail}`
        : `scrub ${arrow.elapsedMs.toFixed(2)} ms rows=${arrow.rowCount} · ${duck.detail}`,
    };
  } catch (error) {
    return {
      id: "duckdb",
      ok: false,
      ms: performance.now() - t0,
      detail: error instanceof Error ? error.message : "duckdb-throw",
    };
  }
}

async function checkNeon(): Promise<SmokeCheckResult> {
  const t0 = performance.now();
  try {
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => ctrl.abort(), 400);
    const res = await fetch("/api/simulations", { cache: "no-store", signal: ctrl.signal });
    window.clearTimeout(timer);
    const ms = performance.now() - t0;
    if (!res.ok) {
      return { id: "neon", ok: false, ms, detail: `HTTP ${res.status}` };
    }
    const body = (await res.json()) as { neon?: boolean; authority?: string; neonError?: string | null };
    const ok = body.neon === true;
    return {
      id: "neon",
      ok,
      ms,
      detail: ok ? `schema ${body.authority ?? "neon-drizzle"}` : body.neonError ?? body.authority ?? "unset",
    };
  } catch (error) {
    const ms = performance.now() - t0;
    const aborted = error instanceof DOMException && error.name === "AbortError";
    return { id: "neon", ok: false, ms, detail: aborted ? "timeout" : "fetch-fail" };
  }
}

function checkShader(): SmokeCheckResult {
  const compiled = compileProbeShaders();
  return {
    id: "shader",
    ok: compiled.ok,
    ms: compiled.ms,
    detail: compiled.ok ? `GLSL ES 3.00 linked in ${compiled.ms.toFixed(1)} ms` : compiled.reason,
  };
}

export async function runAutomatedSmokeTest(): Promise<SmokeTestReport> {
  const started = performance.now();
  const [duckdb, neon] = await Promise.all([checkDuckDb(), checkNeon()]);
  const shader = checkShader();
  const checks = [duckdb, neon, shader];
  const elapsedMs = performance.now() - started;
  return {
    ok: checks.every((c) => c.ok) && elapsedMs < 1000,
    elapsedMs,
    checks,
  };
}
