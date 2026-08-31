import type { CoolRoofCandidate } from "./types";
import { selectCoolRoofsKnapsack } from "./cool-roof-knapsack";
import { mulberry32 } from "./utils";

export interface EnsembleBand {
  p10: number;
  p50: number;
  p90: number;
  draws: number;
}

function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[i];
}

/**
 * Perturb local averted ±18% and re-solve the knapsack to get a 10–90 band.
 * This is the decade-grade uncertainty the HUD should refuse to hide.
 */
export function knapsackEnsembleBand(
  candidates: CoolRoofCandidate[],
  budgetM2: number,
  totalRoofM2: number,
  draws = 24,
  seed = 2026,
): EnsembleBand {
  const rng = mulberry32(seed);
  const samples: number[] = [];
  for (let i = 0; i < draws; i += 1) {
    const noisy = candidates.map((row) => {
      const shock = 0.82 + rng() * 0.36;
      const admissionsAverted = Math.max(0, row.admissionsAverted * shock);
      return {
        ...row,
        admissionsAverted,
        efficiency: row.roofM2 > 0 ? admissionsAverted / row.roofM2 : 0,
      };
    });
    const plan = selectCoolRoofsKnapsack(noisy, budgetM2, totalRoofM2);
    samples.push(plan.predictedAdmissionsAverted);
  }
  samples.sort((a, b) => a - b);
  return {
    p10: quantile(samples, 0.1),
    p50: quantile(samples, 0.5),
    p90: quantile(samples, 0.9),
    draws,
  };
}
