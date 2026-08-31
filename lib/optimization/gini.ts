import { TENEMENT_SUBDIVIDED_MIN } from "./types";
import type { BuildingFeature } from "../types";

/**
 * Weighted Gini of exposure x with mass w.
 * Sort by x; S_i is cumulative weight including i.
 * G = (2 Σ x_i w_i S_i − Σ x_i w_i²) / (W Σ x w) − 1
 */
export function weightedGini(values: Array<{ x: number; w: number }>): number {
  const filtered = values.filter((row) => row.w > 0 && Number.isFinite(row.x) && Number.isFinite(row.w));
  const n = filtered.length;
  if (n === 0) return 0;
  const sorted = [...filtered].sort((a, b) => a.x - b.x);
  let sumW = 0;
  let sumWX = 0;
  for (const row of sorted) {
    sumW += row.w;
    sumWX += row.w * row.x;
  }
  if (sumW <= 0 || Math.abs(sumWX) < 1e-12) return 0;
  let cumW = 0;
  let acc = 0;
  let accSq = 0;
  for (const row of sorted) {
    cumW += row.w;
    acc += row.x * row.w * cumW;
    accSq += row.x * row.w * row.w;
  }
  const g = (2 * acc - accSq) / (sumW * sumWX) - 1;
  return Math.min(1, Math.max(0, g));
}

export function unweightedGini(xs: number[]): number {
  return weightedGini(xs.map((x) => ({ x, w: 1 })));
}

export function isTenementBlock(building: BuildingFeature, minDensity = TENEMENT_SUBDIVIDED_MIN): boolean {
  return building.properties.subdividedFlatDensity >= minDensity;
}

export function tenementHeatGini(
  buildings: BuildingFeature[],
  indoorById: Map<string, number>,
  minDensity = TENEMENT_SUBDIVIDED_MIN,
): number {
  const rows: Array<{ x: number; w: number }> = [];
  for (const building of buildings) {
    if (!isTenementBlock(building, minDensity)) continue;
    const x = indoorById.get(building.properties.id);
    if (x == null || !Number.isFinite(x)) continue;
    rows.push({ x, w: Math.max(1, building.properties.estimatedResidents) });
  }
  return weightedGini(rows);
}
