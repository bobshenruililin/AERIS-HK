import type { BuildingFeature, CoolRoofCandidate, HkoDiurnalEnvelope, PolicyState } from "../types";
import type { PhysicsForcing } from "../physics-forcing";

/** Default NSGA-II generation budget (requirement: 500). */
export const NSGA2_GENERATIONS = 500;
/** Default population size. */
export const NSGA2_POPULATION = 32;
/** Diurnal sample hours used while evolving (HUD click still runs 24 h). */
export const FITNESS_HOURS = [3, 15, 21] as const;
/** Peak HVAC / Gini hour. */
export const PEAK_STRAIN_HOUR = 15;
export const TENEMENT_SUBDIVIDED_MIN = 0.4;

export const LEVER_BOUNDS = {
  coolRoofRebatePct: { min: 0, max: 100 },
  canopyGreeneryPercent: { min: 0, max: 100 },
  acEfficiencyGrantPct: { min: 0, max: 100 },
  coolingShelters: { min: 0, max: 30, integer: true },
} as const;

export interface PolicyLevers {
  /** Cool-roof rebate as % of district roof stock (maps to coolRoofBudgetM2). */
  coolRoofRebatePct: number;
  canopyGreeneryPercent: number;
  acEfficiencyGrantPct: number;
  coolingShelters: number;
}

export interface ParetoObjectives {
  /** Total municipal + household cost (HKD). Minimize. */
  costHkd: number;
  /** Category 1–3 ED visits averted (Kowloon West cluster, 24 h). Maximize. */
  admissionsAverted: number;
  /** G_baseline − G_scenario on tenement indoor T_a. Maximize. */
  giniReduction: number;
  /** Peak HVAC rejector load (MW). Minimize. */
  peakPowerMw: number;
}

export interface ParetoPoint {
  id: string;
  rank: number;
  crowding: number;
  levers: PolicyLevers;
  objectives: ParetoObjectives;
  coolRoofBudgetM2: number;
  coolRoofTargetIds: string[];
  /** Internal NSGA-II minimization vector. */
  minimize: [number, number, number, number];
}

export interface ParetoSolveInput {
  buildings: BuildingFeature[];
  candidates: CoolRoofCandidate[];
  totalRoofM2: number;
  envelope: HkoDiurnalEnvelope | null;
  forcing: PhysicsForcing;
  /** Frozen DHC / bylaw / existing cool-roof targeting outside the four GA levers. */
  anchorPolicy: PolicyState;
  generations?: number;
  populationSize?: number;
  seed?: number;
  hours?: readonly number[];
  /** When set, fitness uses this subset (tenement-first). Front is re-scored on all buildings. */
  searchBuildings?: BuildingFeature[];
}

export interface ParetoSolveResult {
  front: ParetoPoint[];
  generation: number;
  elapsedMs: number;
  engine: "worker-nsga2" | "sync-js";
  populationSize: number;
  generations: number;
}

export type ParetoProgressCallback = (
  generation: number,
  front: ParetoPoint[],
) => void | Promise<void>;
