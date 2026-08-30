import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getBuildings } from "../lib/spatial-data";
import { precomputeHourlyCache } from "../lib/epidemiology-engine";
import { DEFAULT_POLICY } from "../lib/types";
import { aggregateHeatPlumes, aggregateHeatPlumesMultiRes, buildingH3Index } from "../lib/h3-index";
import { packDiurnalGpuAttributes, packedColorAt, packedElevationAt } from "../lib/gpu-attributes";
import { isValidCell } from "h3-js";

describe("Uber H3 hexagonal tessellation", () => {
  it("indexes every Kowloon West footprint at resolutions 9 and 10", () => {
    const buildings = getBuildings();
    for (const feature of buildings) {
      const h9 = buildingH3Index(feature, 9);
      const h10 = buildingH3Index(feature, 10);
      assert.equal(isValidCell(h9), true);
      assert.equal(isValidCell(h10), true);
    }
  });

  it("aggregates heat plumes into continuous hex gradients", () => {
    const buildings = getBuildings();
    const cache = precomputeHourlyCache(DEFAULT_POLICY, buildings, null);
    const hourStates = buildings.map((b) => cache.get(`${b.properties.id}:15`)!);
    const { res9, res10 } = aggregateHeatPlumesMultiRes(buildings, hourStates);
    assert.ok(res9.length >= 1 && res9.length < buildings.length);
    assert.ok(res10.length >= res9.length);
    assert.ok(res10.every((cell) => cell.boundary.length >= 6 && cell.meanHeatWm2 > 0));
    const canyon = aggregateHeatPlumes(buildings, hourStates, 10);
    assert.equal(canyon.length, res10.length);
  });
});

describe("Deck.gl packed 24-h instance attributes", () => {
  it("packs colors and elevations without rebuilding topology", () => {
    const buildings = getBuildings();
    const cache = precomputeHourlyCache(DEFAULT_POLICY, buildings, null);
    const pack = packDiurnalGpuAttributes(buildings, cache);
    assert.equal(pack.instanceColors.length, buildings.length * 24 * 4);
    assert.equal(pack.instanceElevations.length, buildings.length * 24);
    const id = buildings[0].properties.id;
    const c0 = packedColorAt(pack, id, 3);
    const c15 = packedColorAt(pack, id, 15);
    assert.equal(c0.length, 4);
    assert.ok(packedElevationAt(pack, id, 15) > 10);
    assert.ok(c15[0] + c15[1] + c15[2] > 0);
  });
});
