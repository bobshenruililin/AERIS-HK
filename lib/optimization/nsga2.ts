import { clamp, mulberry32 } from "../utils";

export interface Bound {
  min: number;
  max: number;
  integer?: boolean;
}

export interface Nsga2Individual {
  x: number[];
  f: number[];
  rank: number;
  crowding: number;
}

export interface Nsga2Config {
  bounds: Bound[];
  populationSize: number;
  generations: number;
  seed: number;
  evaluate: (x: number[]) => number[];
  crossoverEta?: number;
  mutationEta?: number;
  crossoverProb?: number;
  onGeneration?: (generation: number, population: Nsga2Individual[]) => void | Promise<void>;
}

export function dominates(a: number[], b: number[]): boolean {
  let better = false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] > b[i] + 1e-12) return false;
    if (a[i] < b[i] - 1e-12) better = true;
  }
  return better;
}

export function nonDominatedSort(population: Nsga2Individual[]): Nsga2Individual[][] {
  const n = population.length;
  const S: number[][] = Array.from({ length: n }, () => []);
  const nDom = new Array<number>(n).fill(0);
  const fronts: number[][] = [[]];
  for (let p = 0; p < n; p += 1) {
    for (let q = 0; q < n; q += 1) {
      if (p === q) continue;
      if (dominates(population[p].f, population[q].f)) S[p].push(q);
      else if (dominates(population[q].f, population[p].f)) nDom[p] += 1;
    }
    if (nDom[p] === 0) {
      population[p].rank = 0;
      fronts[0].push(p);
    }
  }
  let i = 0;
  while (fronts[i] && fronts[i].length > 0) {
    const next: number[] = [];
    for (const p of fronts[i]) {
      for (const q of S[p]) {
        nDom[q] -= 1;
        if (nDom[q] === 0) {
          population[q].rank = i + 1;
          next.push(q);
        }
      }
    }
    i += 1;
    fronts[i] = next;
  }
  if (fronts[fronts.length - 1]?.length === 0) fronts.pop();
  return fronts.map((idx) => idx.map((k) => population[k]));
}

export function crowdingDistance(front: Nsga2Individual[]): void {
  const m = front.length;
  if (m === 0) return;
  const nObj = front[0].f.length;
  for (const ind of front) ind.crowding = 0;
  for (let obj = 0; obj < nObj; obj += 1) {
    const sorted = [...front].sort((a, b) => a.f[obj] - b.f[obj]);
    sorted[0].crowding = Number.POSITIVE_INFINITY;
    sorted[m - 1].crowding = Number.POSITIVE_INFINITY;
    const span = sorted[m - 1].f[obj] - sorted[0].f[obj];
    if (span < 1e-12) continue;
    for (let i = 1; i < m - 1; i += 1) {
      sorted[i].crowding += (sorted[i + 1].f[obj] - sorted[i - 1].f[obj]) / span;
    }
  }
}

function tournament(rng: () => number, a: Nsga2Individual, b: Nsga2Individual): Nsga2Individual {
  if (a.rank < b.rank) return a;
  if (b.rank < a.rank) return b;
  if (a.crowding > b.crowding) return a;
  if (b.crowding > a.crowding) return b;
  return rng() < 0.5 ? a : b;
}

function sbx(
  p1: number,
  p2: number,
  lo: number,
  hi: number,
  eta: number,
  rng: () => number,
): [number, number] {
  if (Math.abs(p1 - p2) < 1e-12) return [p1, p2];
  const y1 = Math.min(p1, p2);
  const y2 = Math.max(p1, p2);
  const u = rng();
  const beta = u <= 0.5 ? (2 * u) ** (1 / (eta + 1)) : (1 / (2 * (1 - u))) ** (1 / (eta + 1));
  const c1 = clamp(0.5 * (y1 + y2 - beta * (y2 - y1)), lo, hi);
  const c2 = clamp(0.5 * (y1 + y2 + beta * (y2 - y1)), lo, hi);
  return [c1, c2];
}

function polyMut(x: number, lo: number, hi: number, eta: number, rng: () => number, pMut: number): number {
  if (rng() >= pMut) return x;
  const u = rng();
  const delta =
    u < 0.5 ? (2 * u) ** (1 / (eta + 1)) - 1 : 1 - (2 * (1 - u)) ** (1 / (eta + 1));
  return clamp(x + delta * (hi - lo), lo, hi);
}

function repair(x: number[], bounds: Bound[]): number[] {
  return x.map((v, i) => {
    const b = bounds[i];
    const c = clamp(v, b.min, b.max);
    return b.integer ? Math.round(c) : c;
  });
}

function randomX(rng: () => number, bounds: Bound[]): number[] {
  return bounds.map((b) => {
    const v = b.min + rng() * (b.max - b.min);
    return b.integer ? Math.round(v) : v;
  });
}

function seedCorners(bounds: Bound[]): number[][] {
  const zeros = bounds.map((b) => b.min);
  const maxes = bounds.map((b) => b.max);
  const corners: number[][] = [zeros, maxes];
  for (let i = 0; i < bounds.length; i += 1) {
    const only = bounds.map((b) => b.min);
    only[i] = bounds[i].max;
    corners.push(only);
  }
  return corners;
}

function evaluateAll(xs: number[][], evaluate: (x: number[]) => number[]): Nsga2Individual[] {
  return xs.map((x) => ({
    x,
    f: evaluate(x),
    rank: Number.POSITIVE_INFINITY,
    crowding: 0,
  }));
}

function crowdedCompare(a: Nsga2Individual, b: Nsga2Individual): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  return b.crowding - a.crowding;
}

export async function runNsga2(config: Nsga2Config): Promise<Nsga2Individual[]> {
  const {
    bounds,
    populationSize,
    generations,
    seed,
    evaluate,
    crossoverEta = 15,
    mutationEta = 20,
    crossoverProb = 0.9,
    onGeneration,
  } = config;
  const rng = mulberry32(seed);
  const dim = bounds.length;
  const pMut = 1 / Math.max(1, dim);
  const popN = Math.max(8, populationSize);

  const xs: number[][] = seedCorners(bounds);
  while (xs.length < popN) xs.push(randomX(rng, bounds));
  let population = evaluateAll(xs.slice(0, popN).map((x) => repair(x, bounds)), evaluate);

  const rankAndCrowd = (pool: Nsga2Individual[]) => {
    const fronts = nonDominatedSort(pool);
    for (const front of fronts) crowdingDistance(front);
    return fronts;
  };

  for (let gen = 0; gen < generations; gen += 1) {
    const fronts = rankAndCrowd(population);
    population = fronts.flat();
    if (onGeneration) await onGeneration(gen, population.filter((ind) => ind.rank === 0));

    const offspringX: number[][] = [];
    while (offspringX.length < popN) {
      const p1 = tournament(rng, population[Math.floor(rng() * population.length)], population[Math.floor(rng() * population.length)]);
      const p2 = tournament(rng, population[Math.floor(rng() * population.length)], population[Math.floor(rng() * population.length)]);
      const c1 = p1.x.slice();
      const c2 = p2.x.slice();
      if (rng() < crossoverProb) {
        for (let i = 0; i < dim; i += 1) {
          const [a, b] = sbx(p1.x[i], p2.x[i], bounds[i].min, bounds[i].max, crossoverEta, rng);
          c1[i] = a;
          c2[i] = b;
        }
      }
      for (let i = 0; i < dim; i += 1) {
        c1[i] = polyMut(c1[i], bounds[i].min, bounds[i].max, mutationEta, rng, pMut);
        c2[i] = polyMut(c2[i], bounds[i].min, bounds[i].max, mutationEta, rng, pMut);
      }
      offspringX.push(repair(c1, bounds));
      if (offspringX.length < popN) offspringX.push(repair(c2, bounds));
    }
    const offspring = evaluateAll(offspringX, evaluate);
    const merged = rankAndCrowd([...population, ...offspring]);
    const next: Nsga2Individual[] = [];
    for (const front of merged) {
      if (next.length + front.length <= popN) {
        next.push(...front);
        continue;
      }
      const sorted = [...front].sort(crowdedCompare);
      next.push(...sorted.slice(0, popN - next.length));
      break;
    }
    population = next;
  }

  const finalFronts = rankAndCrowd(population);
  population = finalFronts.flat();
  if (onGeneration) await onGeneration(generations, population.filter((ind) => ind.rank === 0));
  return population.filter((ind) => ind.rank === 0).sort(crowdedCompare);
}
