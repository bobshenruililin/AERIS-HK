"use client";

import type {
  BuildingFeature,
  BuildingHourState,
  CriticalBuildingRow,
  DistrictHourAggregate,
  DistrictName,
  DuckDbQueryBundle,
  PolicyState,
} from "./types";
import { classifyCvi } from "./epidemiology-engine";
import { CVI_MODERATE_MAX } from "./constants";

type DuckDbModule = typeof import("@duckdb/duckdb-wasm");
type AsyncDuckDB = import("@duckdb/duckdb-wasm").AsyncDuckDB;
type AsyncDuckDBConnection = import("@duckdb/duckdb-wasm").AsyncDuckDBConnection;

interface HourRow {
  building_id: string;
  name_en: string;
  name_zh: string;
  district: DistrictName;
  hour: number;
  cvi: number;
  micro_wbgt: number;
  indoor_ta: number;
  outdoor_ta: number;
  residents: number;
}

let duckdbMod: DuckDbModule | null = null;
let dbSingleton: AsyncDuckDB | null = null;
let initPromise: Promise<AsyncDuckDB | null> | null = null;

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

function toRows(
  buildings: BuildingFeature[],
  hourly: BuildingHourState[],
): HourRow[] {
  const meta = new Map(buildings.map((b) => [b.properties.id, b.properties]));
  return hourly.map((row) => {
    const props = meta.get(row.buildingId);
    if (!props) {
      throw new Error(`Hourly row missing building ${row.buildingId}`);
    }
    return {
      building_id: row.buildingId,
      name_en: props.nameEn,
      name_zh: props.nameZh,
      district: props.district,
      hour: Math.round(row.hour),
      cvi: row.cvi,
      micro_wbgt: row.microWbgt,
      indoor_ta: row.indoorTa,
      outdoor_ta: row.outdoorTa,
      residents: props.estimatedResidents,
    };
  });
}

function fallbackDistrictHourly(rows: HourRow[]): DistrictHourAggregate[] {
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

function fallbackTopCritical(rows: HourRow[], hour: number, limit = 10): CriticalBuildingRow[] {
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

async function queryDuckDb(
  conn: AsyncDuckDBConnection,
  hour: number,
): Promise<Omit<DuckDbQueryBundle, "queryLatencyMs" | "engine">> {
  const district = await conn.query(`
    SELECT
      district,
      hour,
      AVG(cvi)::DOUBLE AS mean_cvi,
      AVG(micro_wbgt)::DOUBLE AS mean_wbgt,
      AVG(indoor_ta)::DOUBLE AS mean_indoor_ta,
      COUNT(*)::INTEGER AS building_count
    FROM building_hours
    GROUP BY district, hour
    ORDER BY district, hour
  `);
  const critical = await conn.query(`
    SELECT
      building_id,
      name_en,
      name_zh,
      district,
      hour,
      cvi,
      micro_wbgt,
      indoor_ta
    FROM building_hours
    WHERE hour = ${Math.round(hour) % 24}
      AND cvi >= ${CVI_MODERATE_MAX}
    ORDER BY cvi DESC
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

  return { districtHourly, topCritical };
}

export async function runAerisAnalytics(args: {
  buildings: BuildingFeature[];
  hourly: BuildingHourState[];
  hour: number;
  policy: PolicyState;
}): Promise<DuckDbQueryBundle> {
  const started = performance.now();
  const rows = toRows(args.buildings, args.hourly);
  const db = await instantiateDuckDb();

  if (!db) {
    return {
      districtHourly: fallbackDistrictHourly(rows),
      topCritical: fallbackTopCritical(rows, args.hour),
      queryLatencyMs: performance.now() - started,
      engine: "columnar-fallback",
    };
  }

  const conn = await db.connect();
  try {
    await conn.query("DROP TABLE IF EXISTS building_hours");
    try {
      await db.dropFile("building_hours.json");
    } catch {
      // First ingest has no prior Arrow/JSON file handle.
    }
    await db.registerFileText("building_hours.json", JSON.stringify(rows));
    await conn.query(
      `CREATE OR REPLACE TABLE building_hours AS SELECT * FROM read_json_auto('building_hours.json')`,
    );
    const queried = await queryDuckDb(conn, args.hour);
    return {
      ...queried,
      queryLatencyMs: performance.now() - started,
      engine: "duckdb-wasm",
    };
  } catch (error) {
    console.warn("[AERIS-HK] DuckDB query failed; using columnar fallback.", error);
    return {
      districtHourly: fallbackDistrictHourly(rows),
      topCritical: fallbackTopCritical(rows, args.hour),
      queryLatencyMs: performance.now() - started,
      engine: "columnar-fallback",
    };
  } finally {
    await conn.close();
  }
}

export async function disposeDuckDb(): Promise<void> {
  if (!dbSingleton) return;
  await dbSingleton.terminate();
  dbSingleton = null;
  initPromise = null;
}
