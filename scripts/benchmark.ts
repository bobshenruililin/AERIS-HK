import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { neon } from "@neondatabase/serverless";
import { getBuildings } from "../lib/spatial-data";
import { precomputeHourlyCache } from "../lib/epidemiology-engine";
import { DEFAULT_POLICY } from "../lib/types";
import { projectEnu, wgs84ToEnu, KOWLOON_TWIN_VIEW } from "../lib/twin-camera";
import { buildingCentroid } from "../lib/spatial-data";
import { ensureAerisPersistenceSchema } from "../lib/db/client";
import { seedKowloonWestBuildings } from "../lib/db/queries";

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[i] ?? 0;
}

async function neonLatencies(): Promise<{ coldMs: number; warmMs: number; joinMs: number; error?: string }> {
  const url = process.env.NEON_DATABASE_URL;
  if (!url) return { coldMs: -1, warmMs: -1, joinMs: -1, error: "NEON_DATABASE_URL unset" };
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
  return { coldMs, warmMs: percentile(warmSamples, 50), joinMs: performance.now() - joinStart };
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

async function main() {
  const neon = await neonLatencies();
  const duck = duckDbShapedSpatialScan();
  const frames = frameBudget1080p();
  const report = {
    at: new Date().toISOString(),
    neon,
    duckdbShaped: duck,
    deckFrameBudget: frames,
    targetFps: 60,
    frameBudgetMs: 16.67,
  };
  writeFileSync("/tmp/aeris-bench.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

void main();
