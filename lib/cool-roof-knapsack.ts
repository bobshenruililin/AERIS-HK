import type { CoolRoofCandidate, CoolRoofPlan } from "./types";
import { emptyCoolRoofPlan, planFromSelected } from "./cool-roof-optimiser";

/**
 * Exact 0/1 knapsack: maximise local admissions averted subject to roof m² ≤ budget.
 * Weights are rounded to 1 m²; n=62 and W≈16e3 is ~1e6 cells.
 */
export function selectCoolRoofsKnapsack(
  candidates: CoolRoofCandidate[],
  budgetM2: number,
  totalRoofM2: number,
): CoolRoofPlan {
  const started = typeof performance !== "undefined" ? performance.now() : Date.now();
  const budget = Math.max(0, budgetM2);
  const items = candidates.filter((row) => row.roofM2 > 0 && row.roofM2 <= budget);
  const W = Math.max(0, Math.round(budget));
  if (items.length === 0 || W <= 0) {
    return {
      ...emptyCoolRoofPlan(budget, totalRoofM2, "exact-knapsack", elapsed(started)),
      rankEngine: "greedy-fallback",
      windowSelectedIds: [],
      windowAdmissionsAverted: 0,
    };
  }

  const n = items.length;
  const weight = items.map((row) => Math.max(1, Math.round(row.roofM2)));
  let prev = new Float64Array(W + 1);
  let cur = new Float64Array(W + 1);
  const take: Uint8Array[] = Array.from({ length: n }, () => new Uint8Array(W + 1));

  for (let i = 0; i < n; i += 1) {
    const wt = weight[i];
    const val = items[i].admissionsAverted;
    for (let w = 0; w <= W; w += 1) {
      cur[w] = prev[w];
      take[i][w] = 0;
      if (w >= wt) {
        const withItem = prev[w - wt] + val;
        if (withItem > cur[w] + 1e-15) {
          cur[w] = withItem;
          take[i][w] = 1;
        }
      }
    }
    const swap = prev;
    prev = cur;
    cur = swap;
  }

  const selected: CoolRoofCandidate[] = [];
  let w = W;
  for (let i = n - 1; i >= 0; i -= 1) {
    if (take[i][w] === 1) {
      selected.push(items[i]);
      w -= weight[i];
      if (w < 0) break;
    }
  }
  selected.reverse();

  let area = selected.reduce((sum, row) => sum + row.roofM2, 0);
  if (area > budget + 1e-6) {
    selected.sort((a, b) => a.efficiency - b.efficiency);
    while (selected.length && area > budget + 1e-6) {
      const drop = selected.shift();
      if (!drop) break;
      area -= drop.roofM2;
    }
    selected.sort((a, b) => b.efficiency - a.efficiency || a.buildingId.localeCompare(b.buildingId));
  }

  return {
    ...planFromSelected(selected, budget, totalRoofM2, "exact-knapsack", elapsed(started)),
    rankEngine: "greedy-fallback",
    windowSelectedIds: [],
    windowAdmissionsAverted: 0,
  };
}

function elapsed(started: number): number {
  return (typeof performance !== "undefined" ? performance.now() : Date.now()) - started;
}

export function attachWindowComparison(exact: CoolRoofPlan, windowPlan: CoolRoofPlan): CoolRoofPlan {
  return {
    ...exact,
    rankEngine: windowPlan.engine === "duckdb-wasm" ? "duckdb-wasm" : "greedy-fallback",
    windowSelectedIds: windowPlan.selectedIds,
    windowAdmissionsAverted: windowPlan.predictedAdmissionsAverted,
    queryLatencyMs: exact.queryLatencyMs + windowPlan.queryLatencyMs,
  };
}
