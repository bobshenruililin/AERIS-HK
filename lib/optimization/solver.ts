import { runNsga2, type Nsga2Individual } from "./nsga2";
import {
  evaluateLevers,
  leversFromVector,
  makeBaseline,
  minimizeVector,
  NSGA2_BOUNDS,
  pointFromIndividual,
  selectSearchBuildings,
} from "./fitness";
import {
  NSGA2_GENERATIONS,
  NSGA2_POPULATION,
  type ParetoPoint,
  type ParetoProgressCallback,
  type ParetoSolveInput,
  type ParetoSolveResult,
} from "./types";

function uniqueFront(points: ParetoPoint[]): ParetoPoint[] {
  const seen = new Set<string>();
  const out: ParetoPoint[] = [];
  for (const point of points) {
    const key = [
      point.levers.coolRoofRebatePct.toFixed(2),
      point.levers.canopyGreeneryPercent.toFixed(2),
      point.levers.acEfficiencyGrantPct.toFixed(2),
      Math.round(point.levers.coolingShelters),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(point);
  }
  return out.sort((a, b) => a.objectives.costHkd - b.objectives.costHkd);
}

function individualToPoint(
  ind: Nsga2Individual,
  index: number,
  generation: number,
  input: ParetoSolveInput,
  buildings: typeof input.buildings,
  baseline: { cat13_24h: number; gini: number },
): ParetoPoint {
  return pointFromIndividual(
    `g${generation}-${index}`,
    ind.x,
    ind.rank,
    ind.crowding,
    input,
    buildings,
    baseline,
  );
}

/**
 * NSGA-II over the four policy levers. Fitness during evolution may use a
 * tenement-first building subset; the returned rank-1 front is re-scored on
 * every footprint so click-to-apply matches the twin.
 */
export async function solveParetoFrontier(
  input: ParetoSolveInput,
  onProgress?: ParetoProgressCallback,
): Promise<ParetoSolveResult> {
  const started = typeof performance !== "undefined" ? performance.now() : Date.now();
  const generations = Math.max(1, input.generations ?? NSGA2_GENERATIONS);
  const populationSize = Math.max(8, input.populationSize ?? NSGA2_POPULATION);
  const search = input.searchBuildings ?? selectSearchBuildings(input.buildings);
  const searchBaseline = makeBaseline(input, search);
  const fullBaseline = search === input.buildings ? searchBaseline : makeBaseline(input, input.buildings);

  const evaluate = (x: number[]) => {
    const levers = leversFromVector(x);
    const scored = evaluateLevers(levers, input, search, searchBaseline);
    return [...minimizeVector(scored.objectives)];
  };

  const emit = async (generation: number, rank1: Nsga2Individual[]) => {
    if (!onProgress) return;
    const preview = uniqueFront(
      rank1.map((ind, i) => individualToPoint(ind, i, generation, input, search, searchBaseline)),
    );
    await onProgress(generation, preview);
  };

  const rank1 = await runNsga2({
    bounds: NSGA2_BOUNDS,
    populationSize,
    generations,
    seed: input.seed ?? 20220719,
    evaluate,
    onGeneration: async (generation, front) => {
      if (generation === 0 || generation === generations || generation % 10 === 0) {
        await emit(generation, front);
      }
    },
  });

  const refined = uniqueFront(
    rank1.map((ind, i) =>
      individualToPoint(ind, i, generations, input, input.buildings, fullBaseline),
    ),
  );

  const elapsed =
    (typeof performance !== "undefined" ? performance.now() : Date.now()) - started;
  return {
    front: refined,
    generation: generations,
    elapsedMs: elapsed,
    engine: "sync-js",
    populationSize,
    generations,
  };
}

export { uniqueFront };
