import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hk80ToWgs84, wgs84RingAreaM2 } from "../lib/crs";
import {
  COOL_ROOF_WINDOW_SQL,
  bindCoolRoofSql,
  coolRoofSqlUsesWindowFunctions,
  defaultCoolRoofBudgetM2,
  districtCoolRoofPercent,
  rankCoolRoofCandidates,
  selectCoolRoofsGreedyJs,
  totalRoofAreaM2,
} from "../lib/cool-roof-optimiser";
import { decodeFootprintsIpc, encodeFootprintsIpc, footprintsFromBuildings } from "../lib/arrow-ipc";
import { computePolicyImpact, indoorAirTemp, localCoolRoofFraction } from "../lib/epidemiology-engine";
import { getBuildings } from "../lib/spatial-data";
import { BASELINE_POLICY, DEFAULT_COOL_ROOF_STOCK_FRACTION, DEFAULT_POLICY } from "../lib/types";
import type { CoolRoofCandidate } from "../lib/types";

const HAND_SET: CoolRoofCandidate[] = [
  { buildingId: "a", roofM2: 60, admissionsAverted: 12, efficiency: 12 / 60 },
  { buildingId: "b", roofM2: 50, admissionsAverted: 5, efficiency: 5 / 50 },
  { buildingId: "c", roofM2: 40, admissionsAverted: 2, efficiency: 2 / 40 },
  { buildingId: "too-big", roofM2: 200, admissionsAverted: 40, efficiency: 40 / 200 },
];

describe("HK80 shoelace roof area", () => {
  it("measures a 14 × 12 m HK80 rectangle as 168 m²", () => {
    const sw = hk80ToWgs84(835000, 822000);
    const se = hk80ToWgs84(835014, 822000);
    const ne = hk80ToWgs84(835014, 822012);
    const nw = hk80ToWgs84(835000, 822012);
    const area = wgs84RingAreaM2([
      [sw.lon, sw.lat],
      [se.lon, se.lat],
      [ne.lon, ne.lat],
      [nw.lon, nw.lat],
      [sw.lon, sw.lat],
    ]);
    assert.ok(Math.abs(area - 168) < 0.35, `area ${area} m² drifted from 168`);
  });

  it("assigns positive roof m² to every twin footprint", () => {
    const buildings = getBuildings();
    assert.ok(buildings.length >= 50);
    for (const feature of buildings) {
      assert.ok(
        feature.properties.roofAreaM2 > 80,
        `${feature.properties.id} roof ${feature.properties.roofAreaM2}`,
      );
    }
    const total = totalRoofAreaM2(buildings);
    assert.ok(total > 8_000 && total < 40_000, `total roof ${total}`);
  });

  it("round-trips roof_m2 through Arrow IPC", () => {
    const buildings = getBuildings();
    const decoded = decodeFootprintsIpc(encodeFootprintsIpc(footprintsFromBuildings(buildings)));
    assert.equal(decoded.length, buildings.length);
    for (let i = 0; i < buildings.length; i += 1) {
      assert.ok(Math.abs(decoded[i].roof_m2 - buildings[i].properties.roofAreaM2) < 0.02);
    }
  });
});

describe("DuckDB window-function SQL", () => {
  it("ranks with ROW_NUMBER and running SUM OVER unbounded preceding", () => {
    assert.equal(coolRoofSqlUsesWindowFunctions(), true);
    assert.match(COOL_ROOF_WINDOW_SQL, /ROW_NUMBER\(\)/i);
    assert.match(COOL_ROOF_WINDOW_SQL, /SUM\(roof_m2\) OVER/i);
    assert.match(COOL_ROOF_WINDOW_SQL, /SUM\(admissions_averted\) OVER/i);
    assert.match(COOL_ROOF_WINDOW_SQL, /ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW/i);
  });

  it("binds a finite budget into the window query", () => {
    const sql = bindCoolRoofSql(1234.5);
    assert.ok(sql.includes("1234.5"));
    assert.equal(sql.includes("$BUDGET"), false);
    assert.equal(coolRoofSqlUsesWindowFunctions(sql), true);
  });
});

describe("prefix-greedy targeting (matches SUM OVER windows)", () => {
  it("selects the efficiency prefix whose cumulative area stays within budget", () => {
    const plan = selectCoolRoofsGreedyJs(HAND_SET, 100, 350);
    assert.deepEqual(plan.selectedIds, ["a"]);
    assert.equal(plan.selectedAreaM2, 60);
    assert.ok(plan.selectedAreaM2 <= 100);
    assert.equal(plan.predictedAdmissionsAverted, 12);
    assert.equal(plan.engine, "greedy-fallback");
  });

  it("takes a then b when the running sum still fits", () => {
    const plan = selectCoolRoofsGreedyJs(HAND_SET, 120, 350);
    assert.deepEqual(plan.selectedIds, ["a", "b"]);
    assert.equal(plan.selectedAreaM2, 110);
    assert.equal(plan.predictedAdmissionsAverted, 17);
  });

  it("excludes buildings larger than the whole budget", () => {
    const plan = selectCoolRoofsGreedyJs(HAND_SET, 100, 350);
    assert.equal(plan.selectedIds.includes("too-big"), false);
  });

  it("returns nothing at zero budget", () => {
    const plan = selectCoolRoofsGreedyJs(HAND_SET, 0, 350);
    assert.deepEqual(plan.selectedIds, []);
    assert.equal(plan.selectedAreaM2, 0);
  });

  it("prefers higher efficiency over larger roofs of equal budget", () => {
    const smallHot: CoolRoofCandidate[] = [
      { buildingId: "hot", roofM2: 100, admissionsAverted: 8, efficiency: 0.08 },
      { buildingId: "cool", roofM2: 100, admissionsAverted: 1, efficiency: 0.01 },
    ];
    const plan = selectCoolRoofsGreedyJs(smallHot, 100, 200);
    assert.deepEqual(plan.selectedIds, ["hot"]);
  });

  it("derives district albedo as 50 × selected / stock (full stock = old 50% slider)", () => {
    assert.equal(districtCoolRoofPercent(100, 200), 25);
    assert.equal(districtCoolRoofPercent(200, 200), 50);
    assert.equal(districtCoolRoofPercent(0, 200), 0);
  });
});

describe("per-building cool-roof physics and 24h ranking", () => {
  it("applies local albedo only to targeted ids when a set is active", () => {
    const building = getBuildings()[0];
    const targeted = localCoolRoofFraction(building, {
      ...DEFAULT_POLICY,
      coolRoofPercent: 4,
      coolRoofTargetIds: [building.properties.id],
    });
    const neighbour = localCoolRoofFraction(building, {
      ...DEFAULT_POLICY,
      coolRoofPercent: 4,
      coolRoofTargetIds: ["someone-else"],
    });
    const uniform = localCoolRoofFraction(building, {
      ...DEFAULT_POLICY,
      coolRoofPercent: 25,
      coolRoofTargetIds: [],
    });
    assert.equal(targeted, 1);
    assert.equal(neighbour, 0);
    assert.ok(Math.abs(uniform - 0.5) < 1e-9);
  });

  it("lowers indoor trap temperature on a retrofitted roof", () => {
    const building = getBuildings()[0];
    const baseline = indoorAirTemp(15, building, { ...BASELINE_POLICY, coolRoofTargetIds: [] });
    const retrofitted = indoorAirTemp(15, building, {
      ...BASELINE_POLICY,
      coolRoofTargetIds: [building.properties.id],
    });
    assert.ok(retrofitted < baseline - 0.4, `indoor ${retrofitted} vs ${baseline}`);
  });

  it("ranks every building and the greedy plan stays within an 8% stock budget", () => {
    const buildings = getBuildings();
    const budget = defaultCoolRoofBudgetM2(buildings);
    assert.ok(Math.abs(budget / totalRoofAreaM2(buildings) - DEFAULT_COOL_ROOF_STOCK_FRACTION) < 1e-9);
    const candidates = rankCoolRoofCandidates(buildings, null, DEFAULT_POLICY);
    assert.equal(candidates.length, buildings.length);
    assert.ok(candidates.some((row) => row.admissionsAverted > 0));
    const plan = selectCoolRoofsGreedyJs(candidates, budget, totalRoofAreaM2(buildings));
    assert.ok(plan.selectedAreaM2 <= budget + 1e-6);
    assert.ok(plan.selectedIds.length >= 1);
    assert.ok(plan.selectedIds.length < buildings.length);
    const byId = new Map(candidates.map((row) => [row.buildingId, row]));
    let cum = 0;
    for (const id of plan.selectedIds) {
      const row = byId.get(id);
      assert.ok(row);
      cum += row.roofM2;
      assert.ok(cum <= budget + 1e-6);
    }
    const minSelectedEff = Math.min(...plan.selectedIds.map((id) => byId.get(id)!.efficiency));
    const skippedBetter = candidates.filter(
      (row) =>
        !plan.selectedIds.includes(row.buildingId) &&
        row.roofM2 <= budget &&
        row.efficiency > minSelectedEff + 1e-12,
    );
    assert.equal(skippedBetter.length, 0, "a higher-efficiency eligible roof was skipped");
  });

  it("averted 24h admissions is higher with the greedy set than with the same m² of lowest-efficiency roofs", () => {
    const buildings = getBuildings();
    const budget = defaultCoolRoofBudgetM2(buildings);
    const candidates = rankCoolRoofCandidates(buildings, null, DEFAULT_POLICY);
    const greedy = selectCoolRoofsGreedyJs(candidates, budget, totalRoofAreaM2(buildings));
    const worst = [...candidates]
      .filter((row) => row.roofM2 > 0)
      .sort((a, b) => a.efficiency - b.efficiency || b.roofM2 - a.roofM2);
    const wasteIds: string[] = [];
    let wasteArea = 0;
    for (const row of worst) {
      if (wasteArea + row.roofM2 > greedy.selectedAreaM2 + 1e-6) continue;
      wasteIds.push(row.buildingId);
      wasteArea += row.roofM2;
      if (wasteArea >= greedy.selectedAreaM2 * 0.95) break;
    }
    const greedyImpact = computePolicyImpact(
      {
        ...DEFAULT_POLICY,
        coolRoofBudgetM2: budget,
        coolRoofTargetIds: greedy.selectedIds,
        coolRoofPercent: greedy.districtCoolRoofPercent,
      },
      buildings,
    );
    const wasteImpact = computePolicyImpact(
      {
        ...DEFAULT_POLICY,
        coolRoofBudgetM2: budget,
        coolRoofTargetIds: wasteIds,
        coolRoofPercent: districtCoolRoofPercent(wasteArea, totalRoofAreaM2(buildings)),
      },
      buildings,
    );
    assert.ok(
      greedyImpact.admissionsAverted > wasteImpact.admissionsAverted,
      `greedy ${greedyImpact.admissionsAverted} vs worst-set ${wasteImpact.admissionsAverted}`,
    );
  });
});
