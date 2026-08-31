"use client";

import type {
  BuildingFeature,
  BuildingHourState,
  CoolRoofCandidate,
  CoolRoofPlan,
  CriticalBuildingRow,
  DistrictHourAggregate,
  DistrictName,
  DuckDbQueryBundle,
  PolicyState,
} from "./types";
import { classifyCvi } from "./epidemiology-engine";
import { CVI_MODERATE_MAX } from "./constants";
import { encodeCoolRoofCandidatesIpc } from "./arrow-ipc";
import { encodeHourColumnsIpc, groupDistrictHourlyColumns, packHourColumns, queryHourColumns } from "./arrow-columns";
import { bindCoolRoofSql } from "./cool-roof-sql";
import { emptyCoolRoofPlan, planFromSelected, selectCoolRoofsGreedyJs, totalRoofAreaM2 } from "./cool-roof-optimiser";
import { attachWindowComparison, selectCoolRoofsKnapsack } from "./cool-roof-knapsack";
import { knapsackEnsembleBand } from "./ensemble";
import { aerisDebugWarn } from "./debug";
import { canUseDuckDbWasm } from "./runtime-guards";
import { registerAerisWorker } from "./runtime-diagnostics";

type DuckCountRow = { n?: number | string };
type DuckDistrictAggRow = {
  district?: string;
  hour?: number | string;
  mean_cvi?: number | string;
  mean_wbgt?: number | string;
  mean_indoor_ta?: number | string;
  building_count?: number | string;
};
type DuckCriticalRow = {
  building_id?: string;
  name_en?: string;
  name_zh?: string;
  district?: string;
  hour?: number | string;
  cvi?: number | string;
  micro_wbgt?: number | string;
  indoor_ta?: number | string;
};
type DuckCoolRoofRow = {
  building_id?: string;
  cum_area_m2?: number | string;
};

function duckJson<T>(rec: { toJSON: () => unknown }): T {
  return rec.toJSON() as T;
}

type DuckDbModule = typeof import("@duckdb/duckdb-wasm");
type AsyncDuckDB = import("@duckdb/duckdb-wasm").AsyncDuckDB;
type AsyncDuckDBConnection = import("@duckdb/duckdb-wasm").AsyncDuckDBConnection;

let duckdbMod: DuckDbModule | null = null;
let dbSingleton: AsyncDuckDB | null = null;
let persistentConn: AsyncDuckDBConnection | null = null;
let initPromise: Promise<AsyncDuckDB | null> | null = null;
let ingestQueue: Promise<unknown> = Promise.resolve();
let hoursFingerprint = "";
let footprintsFingerprint = 0;

function enqueueDuckDb<T>(fn: () => Promise<T>): Promise<T> {
  const next = ingestQueue.then(fn, fn);
  ingestQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

async function instantiateDuckDb(): Promise<AsyncDuckDB | null> {
  if (!canUseDuckDbWasm()) return null;
  if (dbSingleton) return dbSingleton;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      duckdbMod = await import("@duckdb/duckdb-wasm");
      const bundles = duckdbMod.getJsDelivrBundles();
      const bundle = await duckdbMod.selectBundle(bundles);
      const workerUrl = URL.createObjectURL(
        new Blob([`importScripts("${bundle.mainWorker}");`], { type: "text/javascript" }),
      );
      const worker = new Worker(workerUrl, { name: "aeris-duckdb" });
      registerAerisWorker("duckdb");
      const logger = new duckdbMod.ConsoleLogger();
      const db = new duckdbMod.AsyncDuckDB(logger, worker);
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      URL.revokeObjectURL(workerUrl);
      dbSingleton = db;
      persistentConn = await db.connect();
      return db;
    } catch (error) {
      aerisDebugWarn("[AERIS-HK] DuckDB-WASM unavailable, using columnar fallback.", error);
      return null;
    }
  })();

  return initPromise;
}

async function ingestIpcTable(
  db: AsyncDuckDB,
  conn: AsyncDuckDBConnection,
  name: string,
  fileName: string,
  ipc: Uint8Array,
): Promise<void> {
  const { tableFromIPC, tableToIPC } = await import("apache-arrow");
  const table = tableFromIPC(ipc);
  const stream = tableToIPC(table, "stream");

  const drop = async () => {
    await conn.query(`DROP TABLE IF EXISTS ${name}`);
  };

  await drop();
  try {
    await conn.insertArrowFromIPCStream(stream, { name, create: true });
    return;
  } catch (error) {
    aerisDebugWarn(`[AERIS-HK] insertArrowFromIPCStream(${name}) failed; trying insertArrowTable.`, error);
  }

  await drop();
  try {
    await conn.insertArrowTable(table, { name, create: true });
    return;
  } catch (error) {
    aerisDebugWarn(`[AERIS-HK] insertArrowTable(${name}) failed; trying Arrow file scan.`, error);
  }

  await drop();
  try {
    await db.dropFile(fileName);
  } catch {
    // First ingest has no prior Arrow file handle.
  }
  await db.registerFileBuffer(fileName, ipc);
  await conn.query(`CREATE TABLE ${name} AS SELECT * FROM '${fileName}'`);
}

async function countRows(conn: AsyncDuckDBConnection, table: string): Promise<number> {
  const result = await conn.query(`SELECT COUNT(*)::INTEGER AS n FROM ${table}`);
  const rec = result.toArray()[0];
  if (!rec) return 0;
  const row = duckJson<DuckCountRow>(rec);
  return Number(row.n ?? 0);
}

async function queryDuckDb(
  conn: AsyncDuckDBConnection,
  hour: number,
  useFootprints: boolean,
): Promise<Omit<DuckDbQueryBundle, "queryLatencyMs" | "engine" | "arrowIpc">> {
  const fromClause = useFootprints
    ? `building_hours h INNER JOIN footprints f ON CAST(f.id AS VARCHAR) = CAST(h.building_id AS VARCHAR)`
    : `building_hours h`;
  const districtExpr = useFootprints ? "CAST(f.district AS VARCHAR)" : "h.district";

  const district = await conn.query(`
    SELECT
      ${districtExpr} AS district,
      h.hour,
      AVG(h.cvi)::DOUBLE AS mean_cvi,
      AVG(h.micro_wbgt)::DOUBLE AS mean_wbgt,
      AVG(h.indoor_ta)::DOUBLE AS mean_indoor_ta,
      COUNT(*)::INTEGER AS building_count
    FROM ${fromClause}
    GROUP BY 1, 2
    ORDER BY 1, 2
  `);
  const critical = await conn.query(`
    SELECT * FROM (
      SELECT
        h.building_id,
        h.name_en,
        h.name_zh,
        ${districtExpr} AS district,
        h.hour,
        h.cvi,
        h.micro_wbgt,
        h.indoor_ta,
        ROW_NUMBER() OVER (PARTITION BY h.hour ORDER BY h.cvi DESC) AS rn
      FROM ${fromClause}
      WHERE h.cvi >= ${CVI_MODERATE_MAX}
    ) ranked
    WHERE rn <= 10
    ORDER BY hour, cvi DESC
  `);

  const districtHourly: DistrictHourAggregate[] = [];
  for (const rec of district.toArray()) {
    const row = duckJson<DuckDistrictAggRow>(rec);
    districtHourly.push({
      district: String(row.district) as DistrictName,
      hour: Number(row.hour),
      meanCvi: Number(row.mean_cvi),
      meanWbgt: Number(row.mean_wbgt),
      meanIndoorTa: Number(row.mean_indoor_ta),
      buildingCount: Number(row.building_count),
    });
  }

  const topCritical: CriticalBuildingRow[] = [];
  for (const rec of critical.toArray()) {
    const row = duckJson<DuckCriticalRow>(rec);
    const cvi = Number(row.cvi);
    topCritical.push({
      buildingId: String(row.building_id),
      nameEn: String(row.name_en),
      nameZh: String(row.name_zh),
      district: String(row.district) as DistrictName,
      hour: Number(row.hour),
      cvi,
      microWbgt: Number(row.micro_wbgt),
      indoorTa: Number(row.indoor_ta),
      cviTier: classifyCvi(cvi),
    });
  }

  const footprintCount = useFootprints ? await countRows(conn, "footprints") : 0;
  return {
    districtHourly,
    topCritical,
    footprintsLoaded: useFootprints && footprintCount > 0,
    footprintCount,
  };
}

export async function runAerisAnalytics(args: {
  buildings: BuildingFeature[];
  hourly: BuildingHourState[];
  hour: number;
  policy: PolicyState;
  footprintsIpc?: Uint8Array | null;
}): Promise<DuckDbQueryBundle> {
  return enqueueDuckDb(() => runAerisAnalyticsExclusive(args));
}

async function runAerisAnalyticsExclusive(args: {
  buildings: BuildingFeature[];
  hourly: BuildingHourState[];
  hour: number;
  policy: PolicyState;
  footprintsIpc?: Uint8Array | null;
}): Promise<DuckDbQueryBundle> {
  const started = performance.now();
  const store = packHourColumns(args.buildings, args.hourly);
  const columnar = queryHourColumns(store, args.hour);
  const db = await instantiateDuckDb();

  if (!db || !persistentConn) {
    return {
      districtHourly: groupDistrictHourlyColumns(store),
      topCritical: columnar.topCritical,
      queryLatencyMs: columnar.elapsedMs,
      engine: "arrow-columns",
      footprintsLoaded: false,
      footprintCount: 0,
      arrowIpc: true,
    };
  }

  const hoursFp = `${store.n}:${args.buildings.length}:${args.policy.coolRoofBudgetM2}`;
  const footprintsFp = args.footprintsIpc?.byteLength ?? 0;
  try {
    if (hoursFingerprint !== hoursFp) {
      const ipc = encodeHourColumnsIpc(store);
      await ingestIpcTable(db, persistentConn, "building_hours", "building_hours.arrow", ipc);
      hoursFingerprint = hoursFp;
    }
    let useFootprints = footprintsFingerprint > 0 && footprintsFp === footprintsFingerprint;
    if (args.footprintsIpc && args.footprintsIpc.byteLength > 0 && footprintsFingerprint !== footprintsFp) {
      await ingestIpcTable(db, persistentConn, "footprints", "footprints.arrow", args.footprintsIpc);
      const joined = await persistentConn.query(`
        SELECT COUNT(*)::INTEGER AS n
        FROM building_hours h
        INNER JOIN footprints f ON CAST(f.id AS VARCHAR) = CAST(h.building_id AS VARCHAR)
      `);
      const rec = joined.toArray()[0];
      const row = rec ? duckJson<DuckCountRow>(rec) : undefined;
      useFootprints = Number(row?.n ?? 0) > 0;
      footprintsFingerprint = footprintsFp;
    }

    const queried = await queryDuckDb(persistentConn, args.hour, useFootprints);
    return {
      ...queried,
      queryLatencyMs: performance.now() - started,
      engine: "duckdb-wasm",
      arrowIpc: true,
    };
  } catch (error) {
    aerisDebugWarn("[AERIS-HK] DuckDB Arrow IPC query failed; using Arrow columns.", error);
    return {
      districtHourly: columnar.districtHourly,
      topCritical: columnar.topCritical,
      queryLatencyMs: columnar.elapsedMs,
      engine: "arrow-columns",
      footprintsLoaded: false,
      footprintCount: 0,
      arrowIpc: true,
    };
  }
}

export async function optimiseCoolRoofTargets(args: {
  candidates: CoolRoofCandidate[];
  budgetM2: number;
  totalRoofM2: number;
}): Promise<CoolRoofPlan> {
  return enqueueDuckDb(() => optimiseCoolRoofTargetsExclusive(args)).then((plan) => {
    const band = knapsackEnsembleBand(args.candidates, args.budgetM2, args.totalRoofM2, 12);
    return {
      ...plan,
      ensembleP10: band.p10,
      ensembleP50: band.p50,
      ensembleP90: band.p90,
      ensembleDraws: band.draws,
    };
  });
}

async function optimiseCoolRoofTargetsExclusive(args: {
  candidates: CoolRoofCandidate[];
  budgetM2: number;
  totalRoofM2: number;
}): Promise<CoolRoofPlan> {
  const started = performance.now();
  const windowFallback = selectCoolRoofsGreedyJs(args.candidates, args.budgetM2, args.totalRoofM2);
  const exact = selectCoolRoofsKnapsack(args.candidates, args.budgetM2, args.totalRoofM2);
  if (args.candidates.length === 0 || args.budgetM2 <= 0) {
    return attachWindowComparison(
      { ...emptyCoolRoofPlan(args.budgetM2, args.totalRoofM2, "exact-knapsack", performance.now() - started) },
      windowFallback,
    );
  }

  const db = await instantiateDuckDb();
  if (!db || !persistentConn) {
    return attachWindowComparison(
      { ...exact, queryLatencyMs: performance.now() - started },
      windowFallback,
    );
  }

  try {
    const ipc = encodeCoolRoofCandidatesIpc(args.candidates);
    await ingestIpcTable(db, persistentConn, "cool_roof_candidates", "cool_roof_candidates.arrow", ipc);
    const sql = bindCoolRoofSql(args.budgetM2);
    const result = await persistentConn.query(sql);
    const byId = new Map(args.candidates.map((row) => [row.buildingId, row]));
    const selected: CoolRoofCandidate[] = [];
    let lastCum = 0;
    for (const rec of result.toArray()) {
      const row = duckJson<DuckCoolRoofRow>(rec);
      const id = String(row.building_id ?? "");
      const candidate = byId.get(id);
      if (!candidate) continue;
      const cum = Number(row.cum_area_m2 ?? lastCum + candidate.roofM2);
      if (cum > args.budgetM2 + 1e-6) break;
      lastCum = cum;
      selected.push(candidate);
    }
    const windowPlan = planFromSelected(
      selected,
      args.budgetM2,
      args.totalRoofM2,
      "duckdb-wasm",
      performance.now() - started,
    );
    return attachWindowComparison({ ...exact, queryLatencyMs: performance.now() - started }, windowPlan);
  } catch (error) {
    aerisDebugWarn("[AERIS-HK] DuckDB cool-roof window query failed; using greedy fallback.", error);
    return attachWindowComparison(
      { ...exact, queryLatencyMs: performance.now() - started },
      windowFallback,
    );
  }
}

export { totalRoofAreaM2 };

export function isDuckDbInstantiated(): boolean {
  return dbSingleton != null && persistentConn != null;
}

/** Warm-path probe: SELECT 1 if WASM is already up. Never instantiates (that would blow the 1 s smoke budget). */
export async function runSyntheticDuckDbProbe(): Promise<{ ok: boolean; ms: number; detail: string }> {
  const t0 =
    typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
  if (!persistentConn) {
    return { ok: true, ms: 0, detail: "wasm-cold" };
  }
  try {
    const result = await persistentConn.query("SELECT 1::INTEGER AS n");
    const rec = result.toArray()[0];
    const n = rec ? Number(duckJson<DuckCountRow>(rec).n ?? 0) : 0;
    const ms =
      (typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now()) -
      t0;
    return { ok: n === 1, ms, detail: n === 1 ? "SELECT 1" : `n=${n}` };
  } catch (error) {
    const ms =
      (typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now()) -
      t0;
    return { ok: false, ms, detail: error instanceof Error ? error.message : "duckdb-throw" };
  }
}

export async function disposeDuckDb(): Promise<void> {
  if (persistentConn) {
    await persistentConn.close();
    persistentConn = null;
  }
  if (!dbSingleton) return;
  await dbSingleton.terminate();
  dbSingleton = null;
  initPromise = null;
  hoursFingerprint = "";
  footprintsFingerprint = 0;
}
