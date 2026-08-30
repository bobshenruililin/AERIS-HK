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
import { encodeCoolRoofCandidatesIpc, encodeHourlyIpc, hourlyRowsFromState, type HourIpcRow } from "./arrow-ipc";
import { bindCoolRoofSql } from "./cool-roof-sql";
import { emptyCoolRoofPlan, planFromSelected, selectCoolRoofsGreedyJs, totalRoofAreaM2 } from "./cool-roof-optimiser";
import { attachWindowComparison, selectCoolRoofsKnapsack } from "./cool-roof-knapsack";

type DuckDbModule = typeof import("@duckdb/duckdb-wasm");
type AsyncDuckDB = import("@duckdb/duckdb-wasm").AsyncDuckDB;
type AsyncDuckDBConnection = import("@duckdb/duckdb-wasm").AsyncDuckDBConnection;

let duckdbMod: DuckDbModule | null = null;
let dbSingleton: AsyncDuckDB | null = null;
let initPromise: Promise<AsyncDuckDB | null> | null = null;
let ingestQueue: Promise<unknown> = Promise.resolve();

function enqueueDuckDb<T>(fn: () => Promise<T>): Promise<T> {
  const next = ingestQueue.then(fn, fn);
  ingestQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function assertBrowser(): void {
  if (typeof window === "undefined" || typeof Worker === "undefined") {
    throw new Error("DuckDB-WASM is a client-only engine. Import it behind ssr:false.");
  }
}

async function instantiateDuckDb(): Promise<AsyncDuckDB | null> {
  assertBrowser();
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
      const worker = new Worker(workerUrl);
      const logger = new duckdbMod.ConsoleLogger();
      const db = new duckdbMod.AsyncDuckDB(logger, worker);
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      URL.revokeObjectURL(workerUrl);
      dbSingleton = db;
      return db;
    } catch (error) {
      console.warn("[AERIS-HK] DuckDB-WASM unavailable, using columnar fallback.", error);
      return null;
    }
  })();

  return initPromise;
}

function fallbackDistrictHourly(rows: HourIpcRow[]): DistrictHourAggregate[] {
  const buckets = new Map<string, DistrictHourAggregate & { cviSum: number; wbgtSum: number; taSum: number }>();
  for (const row of rows) {
    const key = `${row.district}:${row.hour}`;
    const current = buckets.get(key) ?? {
      district: row.district,
      hour: row.hour,
      meanCvi: 0,
      meanWbgt: 0,
      meanIndoorTa: 0,
      buildingCount: 0,
      cviSum: 0,
      wbgtSum: 0,
      taSum: 0,
    };
    current.cviSum += row.cvi;
    current.wbgtSum += row.micro_wbgt;
    current.taSum += row.indoor_ta;
    current.buildingCount += 1;
    buckets.set(key, current);
  }
  return Array.from(buckets.values())
    .map((b) => ({
      district: b.district,
      hour: b.hour,
      meanCvi: b.cviSum / b.buildingCount,
      meanWbgt: b.wbgtSum / b.buildingCount,
      meanIndoorTa: b.taSum / b.buildingCount,
      buildingCount: b.buildingCount,
    }))
    .sort((a, b) => a.district.localeCompare(b.district) || a.hour - b.hour);
}

function fallbackTopCritical(rows: HourIpcRow[], hour: number, limit = 10): CriticalBuildingRow[] {
  const h = Math.round(hour) % 24;
  return rows
    .filter((r) => r.hour === h && r.cvi >= CVI_MODERATE_MAX)
    .sort((a, b) => b.cvi - a.cvi)
    .slice(0, limit)
    .map((r) => ({
      buildingId: r.building_id,
      nameEn: r.name_en,
      nameZh: r.name_zh,
      district: r.district,
      hour: r.hour,
      cvi: r.cvi,
      microWbgt: r.micro_wbgt,
      indoorTa: r.indoor_ta,
      cviTier: classifyCvi(r.cvi),
    }));
}

function emptyBundle(
  rows: HourIpcRow[],
  hour: number,
  started: number,
  engine: DuckDbQueryBundle["engine"],
): DuckDbQueryBundle {
  return {
    districtHourly: fallbackDistrictHourly(rows),
    topCritical: fallbackTopCritical(rows, hour),
    queryLatencyMs: performance.now() - started,
    engine,
    footprintsLoaded: false,
    footprintCount: 0,
    arrowIpc: false,
  };
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
    console.warn(`[AERIS-HK] insertArrowFromIPCStream(${name}) failed; trying insertArrowTable.`, error);
  }

  await drop();
  try {
    await conn.insertArrowTable(table, { name, create: true });
    return;
  } catch (error) {
    console.warn(`[AERIS-HK] insertArrowTable(${name}) failed; trying Arrow file scan.`, error);
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
  const row = rec.toJSON() as Record<string, unknown>;
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
    SELECT
      h.building_id,
      h.name_en,
      h.name_zh,
      ${districtExpr} AS district,
      h.hour,
      h.cvi,
      h.micro_wbgt,
      h.indoor_ta
    FROM ${fromClause}
    WHERE h.hour = ${Math.round(hour) % 24}
      AND h.cvi >= ${CVI_MODERATE_MAX}
    ORDER BY h.cvi DESC
    LIMIT 10
  `);

  const districtHourly: DistrictHourAggregate[] = [];
  for (const rec of district.toArray()) {
    const row = rec.toJSON() as Record<string, unknown>;
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
    const row = rec.toJSON() as Record<string, unknown>;
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
  const rows = hourlyRowsFromState(args.buildings, args.hourly);
  const db = await instantiateDuckDb();

  if (!db) {
    return emptyBundle(rows, args.hour, started, "columnar-fallback");
  }

  const conn = await db.connect();
  try {
    const hoursIpc = encodeHourlyIpc(rows);
    await ingestIpcTable(db, conn, "building_hours", "building_hours.arrow", hoursIpc);

    let useFootprints = false;
    if (args.footprintsIpc && args.footprintsIpc.byteLength > 0) {
      await ingestIpcTable(db, conn, "footprints", "footprints.arrow", args.footprintsIpc);
      const joined = await conn.query(`
        SELECT COUNT(*)::INTEGER AS n
        FROM building_hours h
        INNER JOIN footprints f ON CAST(f.id AS VARCHAR) = CAST(h.building_id AS VARCHAR)
      `);
      const rec = joined.toArray()[0]?.toJSON() as Record<string, unknown> | undefined;
      useFootprints = Number(rec?.n ?? 0) > 0;
    }

    const queried = await queryDuckDb(conn, args.hour, useFootprints);
    return {
      ...queried,
      queryLatencyMs: performance.now() - started,
      engine: "duckdb-wasm",
      arrowIpc: true,
    };
  } catch (error) {
    console.warn("[AERIS-HK] DuckDB Arrow IPC query failed; using columnar fallback.", error);
    return emptyBundle(rows, args.hour, started, "columnar-fallback");
  } finally {
    await conn.close();
  }
}

export async function optimiseCoolRoofTargets(args: {
  candidates: CoolRoofCandidate[];
  budgetM2: number;
  totalRoofM2: number;
}): Promise<CoolRoofPlan> {
  return enqueueDuckDb(() => optimiseCoolRoofTargetsExclusive(args));
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
  if (!db) {
    return attachWindowComparison(
      { ...exact, queryLatencyMs: performance.now() - started },
      windowFallback,
    );
  }

  const conn = await db.connect();
  try {
    const ipc = encodeCoolRoofCandidatesIpc(args.candidates);
    await ingestIpcTable(db, conn, "cool_roof_candidates", "cool_roof_candidates.arrow", ipc);
    const sql = bindCoolRoofSql(args.budgetM2);
    const result = await conn.query(sql);
    const byId = new Map(args.candidates.map((row) => [row.buildingId, row]));
    const selected: CoolRoofCandidate[] = [];
    let lastCum = 0;
    for (const rec of result.toArray()) {
      const row = rec.toJSON() as Record<string, unknown>;
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
    console.warn("[AERIS-HK] DuckDB cool-roof window query failed; using greedy fallback.", error);
    return attachWindowComparison(
      { ...exact, queryLatencyMs: performance.now() - started },
      windowFallback,
    );
  } finally {
    await conn.close();
  }
}

export { totalRoofAreaM2 };

export async function disposeDuckDb(): Promise<void> {
  if (!dbSingleton) return;
  await dbSingleton.terminate();
  dbSingleton = null;
  initPromise = null;
}
