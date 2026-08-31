import type { BuildingFeature, PolicyState } from "../types";
import { BASELINE_POLICY } from "../types";
import { DEFAULT_PHYSICS_FORCING } from "../physics-forcing";
import { evaluateBuildingCat13Lite } from "../epidemiology-engine";
import { selectCoolRoofsGreedyJs } from "../cool-roof-optimiser";
import { interventionSpend } from "../executive-briefing";
import { tenementHeatGini } from "./gini";
import {
  FITNESS_HOURS,
  LEVER_BOUNDS,
  PEAK_STRAIN_HOUR,
  type ParetoObjectives,
  type ParetoPoint,
  type ParetoSolveInput,
  type PolicyLevers,
} from "./types";

export function leversFromVector(x: number[]): PolicyLevers {
  return {
    coolRoofRebatePct: x[0] ?? 0,
    canopyGreeneryPercent: x[1] ?? 0,
    acEfficiencyGrantPct: x[2] ?? 0,
    coolingShelters: x[3] ?? 0,
  };
}

export function vectorFromLevers(levers: PolicyLevers): number[] {
  return [
    levers.coolRoofRebatePct,
    levers.canopyGreeneryPercent,
    levers.acEfficiencyGrantPct,
    levers.coolingShelters,
  ];
}

export function coolRoofBudgetFromRebate(rebatePct: number, totalRoofM2: number): number {
  return Math.max(0, (rebatePct / 100) * Math.max(0, totalRoofM2));
}

export function policyFromLevers(
  levers: PolicyLevers,
  input: Pick<ParetoSolveInput, "anchorPolicy" | "candidates" | "totalRoofM2">,
): { policy: PolicyState; coolRoofBudgetM2: number; coolRoofTargetIds: string[] } {
  const coolRoofBudgetM2 = coolRoofBudgetFromRebate(levers.coolRoofRebatePct, input.totalRoofM2);
  const plan = selectCoolRoofsGreedyJs(input.candidates, coolRoofBudgetM2, input.totalRoofM2);
  const policy: PolicyState = {
    ...input.anchorPolicy,
    coolingShelters: Math.round(levers.coolingShelters),
    canopyGreeneryPercent: levers.canopyGreeneryPercent,
    acEfficiencyGrantPct: levers.acEfficiencyGrantPct,
    coolRoofBudgetM2,
    coolRoofTargetIds: plan.selectedIds,
    coolRoofPercent: plan.districtCoolRoofPercent,
  };
  return { policy, coolRoofBudgetM2, coolRoofTargetIds: plan.selectedIds };
}

export function minimizeVector(obj: ParetoObjectives): [number, number, number, number] {
  return [obj.costHkd, -obj.admissionsAverted, -obj.giniReduction, obj.peakPowerMw];
}

export function selectSearchBuildings(buildings: BuildingFeature[]): BuildingFeature[] {
  if (buildings.length <= 72) return buildings;
  const tenement: BuildingFeature[] = [];
  const rest: BuildingFeature[] = [];
  for (const b of buildings) {
    if (b.properties.subdividedFlatDensity >= 0.4) tenement.push(b);
    else rest.push(b);
  }
  const sampled = rest.filter((_, i) => i % 2 === 0);
  return [...tenement, ...sampled];
}

function sampleMetrics(
  buildings: BuildingFeature[],
  policy: PolicyState,
  input: ParetoSolveInput,
  hours: readonly number[],
): { cat13_24h: number; indoorPeak: Map<string, number>; peakPowerMw: number } {
  const scale = 24 / Math.max(1, hours.length);
  let cat13 = 0;
  const indoorPeak = new Map<string, number>();
  let peakPowerMw = 0;
  const forcing = input.forcing ?? DEFAULT_PHYSICS_FORCING;
  for (const hour of hours) {
    for (const building of buildings) {
      const lite = evaluateBuildingCat13Lite(building, hour, policy, input.envelope, forcing);
      cat13 += lite.cat13Arrivals;
      if (hour === PEAK_STRAIN_HOUR || (hours.indexOf(PEAK_STRAIN_HOUR) < 0 && hour === hours[0])) {
        indoorPeak.set(building.properties.id, lite.indoorTa);
        peakPowerMw += (lite.acHeatWm2 * Math.max(0, building.properties.roofAreaM2)) / 1e6;
      }
    }
  }
  if (!hours.includes(PEAK_STRAIN_HOUR) && indoorPeak.size === 0) {
    const hour = hours[Math.floor(hours.length / 2)] ?? 15;
    for (const building of buildings) {
      const lite = evaluateBuildingCat13Lite(building, hour, policy, input.envelope, forcing);
      indoorPeak.set(building.properties.id, lite.indoorTa);
      peakPowerMw += (lite.acHeatWm2 * Math.max(0, building.properties.roofAreaM2)) / 1e6;
    }
  }
  return { cat13_24h: cat13 * scale, indoorPeak, peakPowerMw };
}

export function evaluateLevers(
  levers: PolicyLevers,
  input: ParetoSolveInput,
  buildings: BuildingFeature[],
  baseline: { cat13_24h: number; gini: number },
): { objectives: ParetoObjectives; coolRoofBudgetM2: number; coolRoofTargetIds: string[] } {
  const hours = input.hours ?? FITNESS_HOURS;
  const mapped = policyFromLevers(levers, input);
  const sampled = sampleMetrics(buildings, mapped.policy, input, hours);
  const gini = tenementHeatGini(buildings, sampled.indoorPeak);
  const spend = interventionSpend(mapped.policy, 0, input.buildings);
  const objectives: ParetoObjectives = {
    costHkd: spend.totalHkd,
    admissionsAverted: Math.max(0, baseline.cat13_24h - sampled.cat13_24h),
    giniReduction: baseline.gini - gini,
    peakPowerMw: sampled.peakPowerMw,
  };
  return {
    objectives,
    coolRoofBudgetM2: mapped.coolRoofBudgetM2,
    coolRoofTargetIds: mapped.coolRoofTargetIds,
  };
}

export function makeBaseline(input: ParetoSolveInput, buildings: BuildingFeature[]) {
  const hours = input.hours ?? FITNESS_HOURS;
  const baselinePolicy: PolicyState = {
    ...BASELINE_POLICY,
    dhcOutreach: 0,
    acDeflectionBylaw: input.anchorPolicy.acDeflectionBylaw,
  };
  const sampled = sampleMetrics(buildings, baselinePolicy, input, hours);
  return {
    cat13_24h: sampled.cat13_24h,
    gini: tenementHeatGini(buildings, sampled.indoorPeak),
    peakPowerMw: sampled.peakPowerMw,
  };
}

export function pointFromIndividual(
  id: string,
  x: number[],
  rank: number,
  crowding: number,
  input: ParetoSolveInput,
  buildings: BuildingFeature[],
  baseline: { cat13_24h: number; gini: number },
): ParetoPoint {
  const levers = leversFromVector(x);
  const scored = evaluateLevers(levers, input, buildings, baseline);
  return {
    id,
    rank,
    crowding,
    levers,
    objectives: scored.objectives,
    coolRoofBudgetM2: scored.coolRoofBudgetM2,
    coolRoofTargetIds: scored.coolRoofTargetIds,
    minimize: minimizeVector(scored.objectives),
  };
}

export const NSGA2_BOUNDS = [
  { min: LEVER_BOUNDS.coolRoofRebatePct.min, max: LEVER_BOUNDS.coolRoofRebatePct.max },
  { min: LEVER_BOUNDS.canopyGreeneryPercent.min, max: LEVER_BOUNDS.canopyGreeneryPercent.max },
  { min: LEVER_BOUNDS.acEfficiencyGrantPct.min, max: LEVER_BOUNDS.acEfficiencyGrantPct.max },
  {
    min: LEVER_BOUNDS.coolingShelters.min,
    max: LEVER_BOUNDS.coolingShelters.max,
    integer: true,
  },
];
