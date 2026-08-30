import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  compileExecutiveBriefing,
  HA_BED_DAY_HKD,
  HA_ED_EPISODE_HKD,
  populationAtRisk,
  roiPerDollar,
} from "../lib/executive-briefing";
import { EMPTY_LOAD_BALANCE_PLAN } from "../lib/hospital-triage";
import { HOSPITALS } from "../lib/hospitals";
import { DEFAULT_POLICY, type PolicyImpact, type SystemHourSnapshot } from "../lib/types";
import { getBuildings } from "../lib/spatial-data";
import { evaluateSystemAtHour, computePolicyImpact } from "../lib/epidemiology-engine";

function impactStub(over: Partial<PolicyImpact> = {}): PolicyImpact {
  return {
    baselineAdmissions24h: 120,
    scenarioAdmissions24h: 100,
    admissionsAverted: 20,
    baselineBedDeficitPct: 8,
    scenarioBedDeficitPct: 3,
    bedDeficitAvertedPct: 5,
    preventableMortalityPer100k: 0.4,
    baselineMortalityIndex: 1.2,
    scenarioMortalityIndex: 1.1,
    hourlyBaselineArrivals: Array.from({ length: 24 }, () => 5),
    hourlyScenarioArrivals: Array.from({ length: 24 }, () => 4),
    hourlyBaselineBedDeficitBeds: Array.from({ length: 24 }, () => 40),
    hourlyScenarioBedDeficitBeds: Array.from({ length: 24 }, () => 12),
    ...over,
  };
}

describe("executive briefing", () => {
  it("counts residents at CVI ≥ 70, indoor ≥ 32°C, or indoor WBGT ≥ 28", () => {
    const buildings = getBuildings().slice(0, 3);
    const snap = evaluateSystemAtHour(15, DEFAULT_POLICY, buildings);
    const hot: SystemHourSnapshot = {
      ...snap,
      buildings: snap.buildings.map((row, i) => ({
        ...row,
        cvi: i === 0 ? 82 : 20,
        indoorTa: i === 1 ? 33 : 28,
        indoorWbgt: i === 2 ? 29 : 24,
      })),
    };
    const pop = populationAtRisk(hot, buildings);
    const expected = buildings.reduce((s, b) => s + b.properties.estimatedResidents, 0);
    assert.equal(pop, expected);
  });

  it("reports HA bed deficit, transfers, and ROI per intervention dollar", () => {
    const buildings = getBuildings();
    const snap = evaluateSystemAtHour(15, DEFAULT_POLICY, buildings);
    const briefing = compileExecutiveBriefing({
      snapshot: snap,
      buildings,
      impact: impactStub(),
      policy: { ...DEFAULT_POLICY, coolRoofBudgetM2: 100, coolingShelters: 2, dhcOutreach: 10 },
      scenarioName: "unit",
      generatedAt: "2026-08-30T00:00:00.000Z",
    });
    assert.ok(briefing.populationCatchment > 0);
    assert.ok(briefing.projectedHaBedDeficitBeds >= 0);
    assert.ok(briefing.hospitals.length === HOSPITALS.length);
    assert.ok(briefing.spend.totalHkd > 0);
    assert.ok(briefing.benefit.avertedAdmissionsHkd === 20 * HA_ED_EPISODE_HKD);
    assert.ok(Math.abs(briefing.benefit.bedDaysSaved - 28) < 1e-6);
    assert.ok(briefing.benefit.bedDaysSavedHkd === 28 * HA_BED_DAY_HKD);
    assert.ok(briefing.roiPerInterventionDollar > 0);
    assert.equal(roiPerDollar(100, 0), Number.POSITIVE_INFINITY);
    assert.equal(roiPerDollar(0, 0), 0);
    assert.ok(snap.triage);
    assert.equal(EMPTY_LOAD_BALANCE_PLAN.overflowThreshold, 1.2);
  });

  it("uses live policy-impact 24h bed-deficit series from the engine", () => {
    const buildings = getBuildings().slice(0, 8);
    const impact = computePolicyImpact(DEFAULT_POLICY, buildings);
    assert.equal(impact.hourlyScenarioBedDeficitBeds.length, 24);
    assert.equal(impact.hourlyBaselineBedDeficitBeds.length, 24);
    const briefing = compileExecutiveBriefing({
      snapshot: evaluateSystemAtHour(15, DEFAULT_POLICY, buildings),
      buildings,
      impact,
      policy: DEFAULT_POLICY,
    });
    assert.ok(Number.isFinite(briefing.projectedHaBedDeficit24hMean));
    assert.ok(Number.isFinite(briefing.roiPerInterventionDollar));
  });
});
