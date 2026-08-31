import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getBuildings } from "../lib/spatial-data";
import { precomputeHourlyCache } from "../lib/epidemiology-engine";
import { DEFAULT_POLICY, type BuildingFeature, type BuildingHourState } from "../lib/types";
import {
  encodeHourColumnsIpc,
  hourColumnView,
  packHourColumns,
  queryHourColumns,
} from "../lib/arrow-columns";

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[i] ?? 0;
}

function densifyHourly(buildings: BuildingFeature[], cache: Map<string, BuildingHourState>, target = 12_000): BuildingHourState[] {
  const base = Array.from(cache.values());
  const rows: BuildingHourState[] = [];
  let k = 0;
  while (rows.length < target) {
    const src = base[k % base.length];
    const b = buildings[k % buildings.length];
    rows.push({
      ...src,
      buildingId: b.properties.id,
      hour: k % 24,
      cvi: src.cvi,
    });
    k += 1;
  }
  return rows;
}

describe("Arrow hour-major columns", () => {
  it("queries 10k+ rows inside a 5 ms frame budget (p50)", () => {
    const buildings = getBuildings();
    const cache = precomputeHourlyCache(DEFAULT_POLICY, buildings, null);
    const hourly = densifyHourly(buildings, cache, 12_000);
    const store = packHourColumns(buildings, hourly);
    assert.ok(store.n >= 10_000, `rows ${store.n}`);
    const view = hourColumnView(store, 15);
    assert.ok(view.count > 0);
    assert.equal(view.cvi.buffer, store.cvi.buffer);

    queryHourColumns(store, 15);
    const samples: number[] = [];
    for (let i = 0; i < 40; i += 1) {
      samples.push(queryHourColumns(store, i % 24).elapsedMs);
    }
    const p50 = percentile(samples, 50);
    const p95 = percentile(samples, 95);
    assert.ok(p50 < 5, `queryHourColumns p50 ${p50.toFixed(3)} ms (p95 ${p95.toFixed(3)})`);
  });

  it("encodes hour columns as Arrow IPC without JSON row objects", () => {
    const buildings = getBuildings();
    const cache = precomputeHourlyCache(DEFAULT_POLICY, buildings, null);
    const store = packHourColumns(buildings, Array.from(cache.values()));
    const ipc = encodeHourColumnsIpc(store);
    assert.ok(ipc.byteLength > 64);
    const magic = `${String.fromCharCode(ipc[0], ipc[1], ipc[2], ipc[3], ipc[4], ipc[5])}`;
    assert.equal(magic, "ARROW1");
  });
});
