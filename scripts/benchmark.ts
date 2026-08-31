import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { neon } from "@neondatabase/serverless";
import { getBuildings, buildingCentroid } from "../lib/spatial-data";
import { evaluateSystemAtHour, precomputeHourlyCache } from "../lib/epidemiology-engine";
import { DEFAULT_POLICY } from "../lib/types";
import { projectEnu, wgs84ToEnu, KOWLOON_TWIN_VIEW } from "../lib/twin-camera";
import { ensureAerisPersistenceSchema } from "../lib/db/client";
import { seedKowloonWestBuildings } from "../lib/db/queries";
import { spatialGridFromBuildings } from "../lib/spatial-grid";
import { packInstanceExtrusions, sliceHourInstances } from "../lib/instance-mesh";
import { packHourColumns, queryHourColumns } from "../lib/arrow-columns";
import type { BuildingFeature, BuildingHourState } from "../lib/types";

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[i] ?? 0;
}

async function neonLatencies(): Promise<{
  coldMs: number;
  warmMs: number;
  joinMs: number;
  spatialMs: number;
  timestampMs: number;
  error?: string;
}> {
  const url = process.env.NEON_DATABASE_URL;
  if (!url) return { coldMs: -1, warmMs: -1, joinMs: -1, spatialMs: -1, timestampMs: -1, error: "NEON_DATABASE_URL unset" };
  await ensureAerisPersistenceSchema();
  await seedKowloonWestBuildings();
  const sql = neon(url);
  const coldStart = performance.now();
  await sql.query("SELECT COUNT(*)::int AS n FROM buildings");
  const coldMs = performance.now() - coldStart;
  const warmSamples: number[] = [];
  for (let i = 0; i < 8; i += 1) {
    const t0 = performance.now();
    await sql.query(
      "SELECT district, AVG(uhi_vulnerability_score) AS uhi FROM buildings GROUP BY district",
    );
    warmSamples.push(performance.now() - t0);
  }
  const joinStart = performance.now();
  await sql.query(
    `SELECT r.id, m.cluster_id, AVG(m.projected_a_and_e_cat1_3)
     FROM simulation_runs r
     LEFT JOIN hourly_cluster_metrics m ON m.run_id = r.id
     GROUP BY r.id, m.cluster_id`,
  );
  const joinMs = performance.now() - joinStart;
  const spatialStart = performance.now();
  await sql.query(
    `SELECT id FROM buildings
     WHERE centroid_lon BETWEEN 114.15 AND 114.18
       AND centroid_lat BETWEEN 22.31 AND 22.34`,
  );
  const spatialMs = performance.now() - spatialStart;
  const tsStart = performance.now();
  await sql.query(
    `SELECT cluster_id, AVG(triage_strain_index)
     FROM hourly_cluster_metrics
     WHERE "timestamp" >= now() - interval '400 days'
     GROUP BY cluster_id`,
  );
  return {
    coldMs,
    warmMs: percentile(warmSamples, 50),
    joinMs,
    spatialMs,
    timestampMs: performance.now() - tsStart,
  };
}

function duckDbShapedSpatialScan(): { rows: number; groupByMs: number; filterMs: number } {
  const buildings = getBuildings();
  const cache = precomputeHourlyCache(DEFAULT_POLICY, buildings, null);
  const rows: Array<{ district: string; hour: number; lon: number; lat: number; cvi: number; indoor: number }> = [];
  let k = 0;
  while (rows.length < 10_000) {
    const feature = buildings[k % buildings.length];
    const hour = k % 24;
    const state = cache.get(`${feature.properties.id}:${hour}`)!;
    const [lon, lat] = buildingCentroid(feature);
    const jitter = (k * 0.000013) % 0.004;
    rows.push({
      district: feature.properties.district,
      hour,
      lon: lon + jitter,
      lat: lat + jitter * 0.6,
      cvi: state.cvi,
      indoor: state.indoorTa,
    });
    k += 1;
  }
  const t0 = performance.now();
  const buckets = new Map<string, { n: number; cvi: number; indoor: number }>();
  for (const row of rows) {
    const key = `${row.district}:${row.hour}`;
    const acc = buckets.get(key) ?? { n: 0, cvi: 0, indoor: 0 };
    acc.n += 1;
    acc.cvi += row.cvi;
    acc.indoor += row.indoor;
    buckets.set(key, acc);
  }
  const grouped = Array.from(buckets.values()).map((b) => ({
    meanCvi: b.cvi / b.n,
    meanIndoor: b.indoor / b.n,
  }));
  const groupByMs = performance.now() - t0;
  void grouped.length;
  const t1 = performance.now();
  const bbox = rows.filter((r) => r.lon > 114.16 && r.lon < 114.17 && r.lat > 22.32 && r.lat < 22.335 && r.cvi >= 70);
  const filterMs = performance.now() - t1;
  void bbox.length;
  return { rows: rows.length, groupByMs, filterMs };
}

function frameBudget1080p(): { meanMs: number; p95Ms: number; fpsEstimate: number } {
  const buildings = getBuildings();
  const view = { ...KOWLOON_TWIN_VIEW };
  const samples: number[] = [];
  for (let frame = 0; frame < 90; frame += 1) {
    const t0 = performance.now();
    for (const feature of buildings) {
      const ring = feature.geometry.coordinates[0];
      for (let i = 0; i < ring.length - 1; i += 1) {
        projectEnu(wgs84ToEnu(ring[i][0], ring[i][1], feature.properties.height), view, 1920, 1080);
      }
      const [lon, lat] = buildingCentroid(feature);
      projectEnu(wgs84ToEnu(lon, lat, feature.properties.height), view, 1920, 1080);
    }
    samples.push(performance.now() - t0);
  }
  const meanMs = samples.reduce((s, v) => s + v, 0) / samples.length;
  return { meanMs, p95Ms: percentile(samples, 95), fpsEstimate: 1000 / Math.max(0.01, meanMs) };
}

function spatialGrid50k(): { vectors: number; cells: number; bboxP50Ms: number; knnP50Ms: number } {
  const buildings = getBuildings();
  const cache = precomputeHourlyCache(DEFAULT_POLICY, buildings, null);
  const snap = evaluateSystemAtHour(15, DEFAULT_POLICY, buildings, cache, null, null);
  const cvi = new Map(snap.buildings.map((row) => [row.buildingId, row.cvi]));
  const grid = spatialGridFromBuildings(buildings, cvi, 50_000);
  grid.queryBBox(-700, -1100, 900, 700);
  const bbox: number[] = [];
  const knn: number[] = [];
  for (let i = 0; i < 24; i += 1) {
    const t0 = performance.now();
    grid.queryBBox(-700, -1100, 900, 700, 70);
    bbox.push(performance.now() - t0);
    const t1 = performance.now();
    grid.queryKnn(0, 0, 16);
    knn.push(performance.now() - t1);
  }
  return {
    vectors: grid.count,
    cells: grid.cellCount,
    bboxP50Ms: percentile(bbox, 50),
    knnP50Ms: percentile(knn, 50),
  };
}

function densifyHourly(buildings: BuildingFeature[], cache: Map<string, BuildingHourState>, target: number): BuildingHourState[] {
  const base = Array.from(cache.values());
  const rows: BuildingHourState[] = [];
  let k = 0;
  while (rows.length < target) {
    const src = base[k % base.length];
    const b = buildings[k % buildings.length];
    rows.push({ ...src, buildingId: b.properties.id, hour: k % 24 });
    k += 1;
  }
  return rows;
}

function instancePackBench(): { count: number; packMs: number; sliceMs: number; district: number; street: number } {
  const buildings = getBuildings();
  const cache = precomputeHourlyCache(DEFAULT_POLICY, buildings, null);
  const t0 = performance.now();
  const pack = packInstanceExtrusions(buildings, cache);
  const packMs = performance.now() - t0;
  const samples: number[] = [];
  for (let h = 0; h < 24; h += 1) {
    const t1 = performance.now();
    sliceHourInstances(pack, h, 0);
    samples.push(performance.now() - t1);
  }
  return {
    count: pack.count,
    packMs,
    sliceMs: percentile(samples, 50),
    district: sliceHourInstances(pack, 15, 0).count,
    street: sliceHourInstances(pack, 15, 2).count,
  };
}

function arrowScrubBench(): { rows: number; p50Ms: number; p95Ms: number } {
  const buildings = getBuildings();
  const cache = precomputeHourlyCache(DEFAULT_POLICY, buildings, null);
  const hourly = densifyHourly(buildings, cache, 12_000);
  const store = packHourColumns(buildings, hourly);
  queryHourColumns(store, 15);
  const samples: number[] = [];
  for (let i = 0; i < 40; i += 1) {
    samples.push(queryHourColumns(store, i % 24).elapsedMs);
  }
  return { rows: store.n, p50Ms: percentile(samples, 50), p95Ms: percentile(samples, 95) };
}

async function main() {
  const neon = await neonLatencies();
  const duck = duckDbShapedSpatialScan();
  const frames = frameBudget1080p();
  const spatial = spatialGrid50k();
  const instances = instancePackBench();
  const arrow = arrowScrubBench();
  const report = {
    at: new Date().toISOString(),
    neon,
    duckdbShaped: duck,
    spatialGrid: spatial,
    deckFrameBudget: frames,
    instances,
    arrowScrub: arrow,
    targetFps: 60,
    frameBudgetMs: 16.67,
  };
  writeFileSync("/tmp/aeris-bench.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

void main();
