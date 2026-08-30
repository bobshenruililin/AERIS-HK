import type {
  BuildingFeature,
  CoolRoofCandidate,
  CoolRoofPlan,
  HkoDiurnalEnvelope,
  PolicyState,
} from "./types";
import { DEFAULT_COOL_ROOF_STOCK_FRACTION } from "./types";
import { buildingClusterLoad24h } from "./epidemiology-engine";

export { COOL_ROOF_WINDOW_SQL, bindCoolRoofSql, coolRoofSqlUsesWindowFunctions } from "./cool-roof-sql";

export function totalRoofAreaM2(buildings: BuildingFeature[]): number {
  return buildings.reduce((sum, b) => sum + Math.max(0, b.properties.roofAreaM2), 0);
}

export function defaultCoolRoofBudgetM2(buildings: BuildingFeature[]): number {
  return DEFAULT_COOL_ROOF_STOCK_FRACTION * totalRoofAreaM2(buildings);
}

export function districtCoolRoofPercent(selectedAreaM2: number, totalRoofM2: number): number {
  if (!(totalRoofM2 > 0)) return 0;
  return (50 * Math.max(0, selectedAreaM2)) / totalRoofM2;
}

export function rankingPolicy(policy: PolicyState): PolicyState {
  return {
    ...policy,
    coolRoofPercent: 0,
    coolRoofBudgetM2: policy.coolRoofBudgetM2,
    coolRoofTargetIds: [],
  };
}

function compareCandidates(a: CoolRoofCandidate, b: CoolRoofCandidate): number {
  if (b.efficiency !== a.efficiency) return b.efficiency - a.efficiency;
  if (b.admissionsAverted !== a.admissionsAverted) return b.admissionsAverted - a.admissionsAverted;
  if (a.roofM2 !== b.roofM2) return a.roofM2 - b.roofM2;
  return a.buildingId.localeCompare(b.buildingId);
}

export function rankCoolRoofCandidates(
  buildings: BuildingFeature[],
  envelope: HkoDiurnalEnvelope | null,
  policy: PolicyState,
): CoolRoofCandidate[] {
  const baselinePolicy = rankingPolicy(policy);
  return buildings.map((building) => {
    const roofM2 = Math.max(0, building.properties.roofAreaM2);
    const baseline = buildingClusterLoad24h(building, envelope, baselinePolicy);
    const retrofit = buildingClusterLoad24h(building, envelope, {
      ...baselinePolicy,
      coolRoofTargetIds: [building.properties.id],
    });
    const admissionsAverted = Math.max(0, baseline - retrofit);
    return {
      buildingId: building.properties.id,
      roofM2,
      admissionsAverted,
      efficiency: roofM2 > 0 ? admissionsAverted / roofM2 : 0,
    };
  });
}

export function emptyCoolRoofPlan(
  budgetM2: number,
  totalRoofM2: number,
  engine: CoolRoofPlan["engine"],
  queryLatencyMs = 0,
): CoolRoofPlan {
  const budget = Math.max(0, budgetM2);
  return {
    selectedIds: [],
    selectedAreaM2: 0,
    budgetM2: budget,
    totalRoofM2,
    remainingBudgetM2: budget,
    districtCoolRoofPercent: 0,
    predictedAdmissionsAverted: 0,
    engine,
    queryLatencyMs,
  };
}

export function planFromSelected(
  selected: CoolRoofCandidate[],
  budgetM2: number,
  totalRoofM2: number,
  engine: CoolRoofPlan["engine"],
  queryLatencyMs = 0,
): CoolRoofPlan {
  const budget = Math.max(0, budgetM2);
  const selectedAreaM2 = selected.reduce((sum, row) => sum + row.roofM2, 0);
  const predictedAdmissionsAverted = selected.reduce((sum, row) => sum + row.admissionsAverted, 0);
  return {
    selectedIds: selected.map((row) => row.buildingId),
    selectedAreaM2,
    budgetM2: budget,
    totalRoofM2,
    remainingBudgetM2: Math.max(0, budget - selectedAreaM2),
    districtCoolRoofPercent: districtCoolRoofPercent(selectedAreaM2, totalRoofM2),
    predictedAdmissionsAverted,
    engine,
    queryLatencyMs,
  };
}

/**
 * Prefix-greedy selection matching `COOL_ROOF_WINDOW_SQL`:
 * sort by efficiency, take a running SUM(roof_m2) that stays ≤ budget.
 */
export function selectCoolRoofsGreedyJs(
  candidates: CoolRoofCandidate[],
  budgetM2: number,
  totalRoofM2: number,
): CoolRoofPlan {
  const started = typeof performance !== "undefined" ? performance.now() : Date.now();
  const budget = Math.max(0, budgetM2);
  const eligible = candidates.filter((row) => row.roofM2 > 0 && row.roofM2 <= budget).sort(compareCandidates);
  const selected: CoolRoofCandidate[] = [];
  let cumArea = 0;
  for (const row of eligible) {
    const next = cumArea + row.roofM2;
    if (next > budget) break;
    selected.push(row);
    cumArea = next;
  }
  const latency = (typeof performance !== "undefined" ? performance.now() : Date.now()) - started;
  return planFromSelected(selected, budget, totalRoofM2, "greedy-fallback", latency);
}

export function sameIdSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((id, i) => id === right[i]);
}
