import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getBuildings } from "../lib/spatial-data";
import { evaluateSystemAtHour, precomputeHourlyCache } from "../lib/epidemiology-engine";
import { DEFAULT_POLICY } from "../lib/types";
import {
  URBAN_VECTOR_TARGET,
  measureSpatialIndex,
  spatialGridFromBuildings,
} from "../lib/spatial-grid";
import { buildingsToCityJson } from "../lib/cityjson";
import { TWIN_DISTRICTS } from "../lib/districts";

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[i] ?? 0;
}

describe("ENU spatial grid", () => {
  it("indexes tens of thousands of urban vectors and answers bbox/kNN under 10 ms", () => {
    const buildings = getBuildings();
    const cache = precomputeHourlyCache(DEFAULT_POLICY, buildings, null);
    const snap = evaluateSystemAtHour(15, DEFAULT_POLICY, buildings, cache, null, null);
    const cvi = new Map(snap.buildings.map((row) => [row.buildingId, row.cvi]));
    const grid = spatialGridFromBuildings(buildings, cvi, 50_000);
    assert.equal(grid.count, 50_000);
    assert.ok(grid.cellCount > 8);

    grid.queryBBox(-400, -400, 400, 400);
    const bboxSamples: number[] = [];
    const knnSamples: number[] = [];
    for (let i = 0; i < 24; i += 1) {
      const t0 = performance.now();
      const hits = grid.queryBBox(-700, -1100, 900, 700, 0);
      bboxSamples.push(performance.now() - t0);
      assert.ok(hits.length > 100, `bbox hits ${hits.length}`);
      const t1 = performance.now();
      const knn = grid.queryKnn(0, 0, 16);
      knnSamples.push(performance.now() - t1);
      assert.equal(knn.length, 16);
      for (let k = 1; k < knn.length; k += 1) {
        assert.ok(knn[k].dist2 >= knn[k - 1].dist2);
      }
    }
    const bboxP50 = percentile(bboxSamples, 50);
    const knnP50 = percentile(knnSamples, 50);
    assert.ok(bboxP50 < 10, `bbox p50 ${bboxP50.toFixed(3)} ms`);
    assert.ok(knnP50 < 10, `knn p50 ${knnP50.toFixed(3)} ms`);

    const stats = measureSpatialIndex(grid, 0);
    assert.ok(stats.vectorCount >= URBAN_VECTOR_TARGET);
    assert.ok(stats.bboxHits > 0);
  });

  it("filters Sham Shui Po vs Yau Tsim Mong district bboxes", () => {
    const buildings = getBuildings();
    const grid = spatialGridFromBuildings(buildings, new Map(), buildings.length);
    const ssp = grid.queryDistrict("sham-shui-po");
    const ytm = grid.queryDistrict("yau-tsim-mong");
    assert.ok(ssp.length > 0);
    assert.ok(ytm.length > 0);
    const sspIds = new Set(ssp.map((h) => h.id));
    const ytmIds = new Set(ytm.map((h) => h.id));
    const overlap = Array.from(sspIds).filter((id) => ytmIds.has(id));
    assert.ok(overlap.length < Math.min(sspIds.size, ytmIds.size));
    assert.equal(TWIN_DISTRICTS.length, 2);
  });
});

describe("CityJSON 2.0 HK80 solids", () => {
  it("emits one Building CityObject per footprint with EPSG:2326 vertices", () => {
    const buildings = getBuildings();
    const doc = buildingsToCityJson(buildings);
    assert.equal(doc.type, "CityJSON");
    assert.equal(doc.version, "2.0");
    assert.equal(doc.metadata.referenceSystem, "urn:ogc:def:crs:EPSG::2326");
    assert.equal(Object.keys(doc.CityObjects).length, buildings.length);
    assert.ok(doc.vertices.length >= buildings.length * 6);
    const first = Object.values(doc.CityObjects)[0];
    assert.equal(first.type, "Building");
    assert.ok(first.attributes.height_m > 0);
    assert.equal(first.geometry[0].type, "Solid");
  });
});
