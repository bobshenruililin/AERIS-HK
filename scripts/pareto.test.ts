import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getBuildings } from "../lib/spatial-data";
import { BASELINE_POLICY, DEFAULT_POLICY } from "../lib/types";
import { DEFAULT_PHYSICS_FORCING } from "../lib/physics-forcing";
import {
  canyonAirTemp,
  indoorAirTemp,
  peakHvacLoadMw,
  evaluateBuildingCat13Lite,
  TENEMENT_SUBDIVIDED_MIN,
} from "../lib/epidemiology-engine";
import { interventionSpend, CANOPY_HKD_PER_PCT } from "../lib/executive-briefing";
import { FORMULAS } from "../lib/formulas";
import { canUseParetoWorker, isBrowser } from "../lib/runtime-guards";
import {
  NSGA2_GENERATIONS,
  NSGA2_POPULATION,
  FITNESS_HOURS,
  unweightedGini,
  weightedGini,
  tenementHeatGini,
  nonDominatedSort,
  crowdingDistance,
  solveParetoFrontier,
  coolRoofBudgetFromRebate,
  policyFromLevers,
  selectSearchBuildings,
} from "../lib/optimization";
import { rankCoolRoofCandidates, totalRoofAreaM2 } from "../lib/cool-roof-optimiser";
import type { Nsga2Individual } from "../lib/optimization/nsga2";
import { dominates } from "../lib/optimization/nsga2";

const buildings = getBuildings();
const slice = buildings.slice(0, 8);
const totalRoof = totalRoofAreaM2(slice);
const candidates = rankCoolRoofCandidates(slice, null, BASELINE_POLICY);

describe("Pareto objective identities", () => {
  it("ships a 500-generation NSGA-II default", () => {
    assert.equal(NSGA2_GENERATIONS, 500);
    assert.ok(NSGA2_POPULATION >= 24);
    assert.deepEqual([...FITNESS_HOURS], [3, 15, 21]);
    assert.match(FORMULAS.nsga2.identity, /500 gen/);
    assert.match(FORMULAS.gini.identity, /ρ_sub/);
    assert.match(FORMULAS["hvac-mw"].identity, /10\^6/);
  });

  it("computes Gini 0 for equal exposure and > 0 for skewed tenement heat", () => {
    assert.equal(unweightedGini([30, 30, 30, 30]), 0);
    const skewed = unweightedGini([28, 28, 28, 40]);
    assert.ok(skewed > 0.05, `gini ${skewed}`);
    assert.ok(Math.abs(unweightedGini([28, 28, 28, 28])) < 1e-9);
    const w = weightedGini([
      { x: 28, w: 10 },
      { x: 40, w: 90 },
    ]);
    assert.ok(w > unweightedGini([28, 40]) - 0.2);
    const indoor = new Map(slice.map((b) => [b.properties.id, 32 + 6 * b.properties.subdividedFlatDensity]));
    const g = tenementHeatGini(slice, indoor);
    assert.ok(g >= 0 && g <= 1);
    assert.ok(TENEMENT_SUBDIVIDED_MIN === 0.4);
  });

  it("urban canopy cools canyon air relative to a bare-street counterfactual", () => {
    const b = slice.find((row) => row.properties.subdividedFlatDensity >= 0.4) ?? slice[0];
    const bare = canyonAirTemp(15, b, { ...DEFAULT_POLICY, canopyGreeneryPercent: 0 }, null);
    const green = canyonAirTemp(15, b, { ...DEFAULT_POLICY, canopyGreeneryPercent: 80 }, null);
    assert.ok(green < bare - 0.3, `canopy ${green} vs bare ${bare}`);
    const indoorBare = indoorAirTemp(15, b, { ...DEFAULT_POLICY, canopyGreeneryPercent: 0 });
    const indoorGreen = indoorAirTemp(15, b, { ...DEFAULT_POLICY, canopyGreeneryPercent: 80 });
    assert.ok(indoorGreen < indoorBare);
  });

  it("AC efficiency grants cut peak HVAC MW on subdivided stock", () => {
    const none = peakHvacLoadMw(slice, { ...DEFAULT_POLICY, acEfficiencyGrantPct: 0 }, 15);
    const grant = peakHvacLoadMw(slice, { ...DEFAULT_POLICY, acEfficiencyGrantPct: 100 }, 15);
    assert.ok(none > 0);
    assert.ok(grant < none, `grant ${grant} vs ${none}`);
  });

  it("municipal + household cost includes canopy and AC copay", () => {
    const spend = interventionSpend(
      { ...DEFAULT_POLICY, canopyGreeneryPercent: 10, acEfficiencyGrantPct: 50, coolingShelters: 2, coolRoofBudgetM2: 100 },
      0,
      slice,
    );
    assert.equal(spend.canopyHkd, 10 * CANOPY_HKD_PER_PCT);
    assert.ok(spend.acGrantMunicipalHkd > 0);
    assert.ok(spend.acGrantHouseholdHkd > 0);
    assert.ok(Math.abs(spend.totalHkd - (spend.municipalHkd + spend.householdHkd)) < 1e-6);
  });

  it("maps cool-roof rebate percent onto roof-stock budget", () => {
    assert.equal(coolRoofBudgetFromRebate(50, 10_000), 5_000);
    const mapped = policyFromLevers(
      { coolRoofRebatePct: 20, canopyGreeneryPercent: 15, acEfficiencyGrantPct: 40, coolingShelters: 6 },
      { anchorPolicy: DEFAULT_POLICY, candidates, totalRoofM2: totalRoof },
    );
    assert.ok(mapped.coolRoofBudgetM2 > 0);
    assert.equal(mapped.policy.coolingShelters, 6);
    assert.equal(mapped.policy.canopyGreeneryPercent, 15);
  });
});

describe("NSGA-II operators", () => {
  it("marks the cheaper, better, fairer, lower-MW genome as dominating", () => {
    assert.equal(dominates([1, -10, -0.2, 1], [2, -4, -0.05, 3]), true);
    assert.equal(dominates([1, -10, -0.2, 1], [1, -10, -0.2, 1]), false);
    assert.equal(dominates([2, -4, -0.2, 1], [1, -10, -0.05, 3]), false);
  });

  it("assigns rank 0 to the non-dominated set and infinite crowding at edges", () => {
    const pop: Nsga2Individual[] = [
      { x: [0], f: [1, 4], rank: 0, crowding: 0 },
      { x: [1], f: [2, 2], rank: 0, crowding: 0 },
      { x: [2], f: [3, 1], rank: 0, crowding: 0 },
      { x: [3], f: [4, 5], rank: 0, crowding: 0 },
    ];
    const fronts = nonDominatedSort(pop);
    assert.ok(fronts[0].length >= 3);
    crowdingDistance(fronts[0]);
    const infs = fronts[0].filter((ind) => !Number.isFinite(ind.crowding));
    assert.ok(infs.length >= 2);
  });
});

describe("Pareto solver on Kowloon West footprints", () => {
  it("returns a non-empty rank-1 front after a short evolution", async () => {
    const result = await solveParetoFrontier({
      buildings: slice,
      candidates,
      totalRoofM2: totalRoof,
      envelope: null,
      forcing: DEFAULT_PHYSICS_FORCING,
      anchorPolicy: DEFAULT_POLICY,
      generations: 12,
      populationSize: 16,
      seed: 42,
    });
    assert.ok(result.front.length >= 2, `front ${result.front.length}`);
    assert.equal(result.generations, 12);
    for (const point of result.front) {
      assert.ok(point.objectives.costHkd >= 0);
      assert.ok(point.objectives.admissionsAverted >= 0);
      assert.ok(Number.isFinite(point.objectives.giniReduction));
      assert.ok(point.objectives.peakPowerMw > 0);
      assert.ok(point.levers.coolRoofRebatePct >= 0 && point.levers.coolRoofRebatePct <= 100);
      assert.ok(point.levers.coolingShelters >= 0 && point.levers.coolingShelters <= 30);
    }
    const costs = result.front.map((p) => p.objectives.costHkd);
    assert.ok(Math.max(...costs) > Math.min(...costs) || result.front.length === 1);
  });

  it("runs the required 500 generations on a tiny subset", async () => {
    const tiny = slice.slice(0, 4);
    const tinyRoof = totalRoofAreaM2(tiny);
    const tinyCand = rankCoolRoofCandidates(tiny, null, BASELINE_POLICY);
    const t0 = Date.now();
    const result = await solveParetoFrontier({
      buildings: tiny,
      candidates: tinyCand,
      totalRoofM2: tinyRoof,
      envelope: null,
      forcing: DEFAULT_PHYSICS_FORCING,
      anchorPolicy: BASELINE_POLICY,
      generations: NSGA2_GENERATIONS,
      populationSize: 12,
      seed: 7,
      hours: [15],
    });
    const ms = Date.now() - t0;
    assert.equal(result.generation, 500);
    assert.equal(result.generations, 500);
    assert.ok(result.front.length >= 1);
    assert.ok(ms < 120_000, `500-gen run took ${ms} ms`);
    const lite = evaluateBuildingCat13Lite(tiny[0], 15, DEFAULT_POLICY, null);
    assert.ok(lite.cat13Arrivals >= 0);
    assert.ok(selectSearchBuildings(buildings).length <= buildings.length);
  });

  it("does not claim a Pareto worker under Node", () => {
    assert.equal(isBrowser(), false);
    assert.equal(canUseParetoWorker(), false);
  });
});
