/**
 * Uniform-hash spatial index over local ENU metres.
 *
 * DuckDB-WASM remains the SQL/window-function engine (cool-roof knapsack).
 * This grid is the sub-10 ms path for bbox / kNN over tens of thousands of
 * urban sample vectors (building centroids + alley infill), Kepler.gl-style
 * typed arrays with no object-per-point in the hot loop.
 */
import type { BuildingFeature, BuildingHourState } from "./types";
import { buildingCentroid } from "./spatial-data";
import { wgs84ToEnu } from "./twin-camera";
import { TWIN_DISTRICTS, type TwinDistrictId } from "./districts";

export const URBAN_VECTOR_TARGET = 24_000;
export const SPATIAL_CELL_M = 40;

export interface SpatialHit {
  index: number;
  id: string;
  east: number;
  north: number;
  lon: number;
  lat: number;
  cvi: number;
  dist2: number;
}

export interface SpatialIndexStats {
  vectorCount: number;
  cellCount: number;
  bboxMs: number;
  bboxHits: number;
  knnMs: number;
  knnK: number;
}

function packCell(ix: number, iy: number): number {
  return ((ix + 32768) << 16) | ((iy + 32768) & 0xffff);
}

export class SpatialGrid {
  readonly cellSize: number;
  readonly count: number;
  readonly east: Float64Array;
  readonly north: Float64Array;
  readonly lon: Float64Array;
  readonly lat: Float64Array;
  readonly cvi: Float32Array;
  readonly ids: string[];
  private readonly buckets: Map<number, Uint32Array>;
  private readonly originE: number;
  private readonly originN: number;
  private readonly idIndex: Map<string, number[]>;

  constructor(args: {
    ids: string[];
    east: Float64Array;
    north: Float64Array;
    lon: Float64Array;
    lat: Float64Array;
    cvi: Float32Array;
    cellSize?: number;
  }) {
    this.cellSize = args.cellSize ?? SPATIAL_CELL_M;
    this.count = args.ids.length;
    this.ids = args.ids;
    this.east = args.east;
    this.north = args.north;
    this.lon = args.lon;
    this.lat = args.lat;
    this.cvi = args.cvi;
    this.originE = args.east.length ? args.east[0] : 0;
    this.originN = args.north.length ? args.north[0] : 0;
    this.idIndex = new Map();
    const lists = new Map<number, number[]>();
    for (let i = 0; i < this.count; i += 1) {
      const key = this.cellOf(this.east[i], this.north[i]);
      const bucket = lists.get(key);
      if (bucket) bucket.push(i);
      else lists.set(key, [i]);
      const existing = this.idIndex.get(this.ids[i]);
      if (existing) existing.push(i);
      else this.idIndex.set(this.ids[i], [i]);
    }
    this.buckets = new Map();
    lists.forEach((idxs, key) => {
      this.buckets.set(key, Uint32Array.from(idxs));
    });
  }

  get cellCount(): number {
    return this.buckets.size;
  }

  cellOf(east: number, north: number): number {
    const ix = Math.floor((east - this.originE) / this.cellSize);
    const iy = Math.floor((north - this.originN) / this.cellSize);
    return packCell(ix, iy);
  }

  setCviById(id: string, value: number): void {
    const idxs = this.idIndex.get(id);
    if (!idxs) return;
    for (const i of idxs) this.cvi[i] = value;
  }

  applyHourlyCvi(rows: ReadonlyArray<Pick<BuildingHourState, "buildingId" | "cvi">>): void {
    for (const row of rows) this.setCviById(row.buildingId, row.cvi);
  }

  queryBBox(
    minE: number,
    minN: number,
    maxE: number,
    maxN: number,
    minCvi = 0,
  ): SpatialHit[] {
    const hits: SpatialHit[] = [];
    const minIx = Math.floor((minE - this.originE) / this.cellSize);
    const maxIx = Math.floor((maxE - this.originE) / this.cellSize);
    const minIy = Math.floor((minN - this.originN) / this.cellSize);
    const maxIy = Math.floor((maxN - this.originN) / this.cellSize);
    for (let ix = minIx; ix <= maxIx; ix += 1) {
      for (let iy = minIy; iy <= maxIy; iy += 1) {
        const bucket = this.buckets.get(packCell(ix, iy));
        if (!bucket) continue;
        for (let k = 0; k < bucket.length; k += 1) {
          const i = bucket[k];
          const e = this.east[i];
          const n = this.north[i];
          if (e < minE || e > maxE || n < minN || n > maxN) continue;
          if (this.cvi[i] < minCvi) continue;
          hits.push({
            index: i,
            id: this.ids[i],
            east: e,
            north: n,
            lon: this.lon[i],
            lat: this.lat[i],
            cvi: this.cvi[i],
            dist2: 0,
          });
        }
      }
    }
    return hits;
  }

  queryLonLatBBox(
    minLon: number,
    minLat: number,
    maxLon: number,
    maxLat: number,
    minCvi = 0,
  ): SpatialHit[] {
    const sw = wgs84ToEnu(minLon, minLat, 0);
    const ne = wgs84ToEnu(maxLon, maxLat, 0);
    return this.queryBBox(
      Math.min(sw.east, ne.east),
      Math.min(sw.north, ne.north),
      Math.max(sw.east, ne.east),
      Math.max(sw.north, ne.north),
      minCvi,
    );
  }

  queryDistrict(id: TwinDistrictId, minCvi = 0): SpatialHit[] {
    const district = TWIN_DISTRICTS.find((d) => d.id === id);
    if (!district) return [];
    return this.queryLonLatBBox(
      district.bbox.minLon,
      district.bbox.minLat,
      district.bbox.maxLon,
      district.bbox.maxLat,
      minCvi,
    );
  }

  queryRadius(east: number, north: number, radiusM: number, minCvi = 0): SpatialHit[] {
    const r2 = radiusM * radiusM;
    const hits = this.queryBBox(east - radiusM, north - radiusM, east + radiusM, north + radiusM, minCvi);
    const inner: SpatialHit[] = [];
    for (const hit of hits) {
      const d2 = (hit.east - east) ** 2 + (hit.north - north) ** 2;
      if (d2 <= r2) inner.push({ ...hit, dist2: d2 });
    }
    return inner;
  }

  queryKnn(east: number, north: number, k: number): SpatialHit[] {
    const want = Math.max(1, k);
    let radius = this.cellSize;
    let hits: SpatialHit[] = [];
    for (let step = 0; step < 12 && hits.length < want; step += 1) {
      hits = this.queryRadius(east, north, radius);
      radius *= 1.8;
    }
    hits.sort((a, b) => a.dist2 - b.dist2);
    return hits.slice(0, want);
  }
}

function mulberry(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Expand each footprint into alley / street-canyon sample vectors so the
 * index covers tens of thousands of urban points, not only building centroids.
 */
export function densifyUrbanVectors(
  buildings: BuildingFeature[],
  cviById: ReadonlyMap<string, number>,
  targetCount = URBAN_VECTOR_TARGET,
): {
  ids: string[];
  east: Float64Array;
  north: Float64Array;
  lon: Float64Array;
  lat: Float64Array;
  cvi: Float32Array;
} {
  const n = Math.max(buildings.length, targetCount);
  const ids: string[] = new Array(n);
  const east = new Float64Array(n);
  const north = new Float64Array(n);
  const lon = new Float64Array(n);
  const lat = new Float64Array(n);
  const cvi = new Float32Array(n);
  const rnd = mulberry(0xa3e15);
  let i = 0;
  for (const feature of buildings) {
    const [clon, clat] = buildingCentroid(feature);
    const enu = wgs84ToEnu(clon, clat, 0);
    ids[i] = feature.properties.id;
    east[i] = enu.east;
    north[i] = enu.north;
    lon[i] = clon;
    lat[i] = clat;
    cvi[i] = cviById.get(feature.properties.id) ?? 0;
    i += 1;
  }
  while (i < n) {
    const feature = buildings[i % buildings.length];
    const ring = feature.geometry.coordinates[0];
    const t = rnd();
    const u = rnd();
    const a = Math.floor(t * Math.max(1, ring.length - 1));
    const b = (a + 1) % Math.max(1, ring.length - 1);
    const lonJ = ring[a][0] * (1 - u) + ring[b][0] * u + (rnd() - 0.5) * 0.00018;
    const latJ = ring[a][1] * (1 - u) + ring[b][1] * u + (rnd() - 0.5) * 0.00016;
    const enu = wgs84ToEnu(lonJ, latJ, 0);
    ids[i] = feature.properties.id;
    east[i] = enu.east;
    north[i] = enu.north;
    lon[i] = lonJ;
    lat[i] = latJ;
    cvi[i] = cviById.get(feature.properties.id) ?? 0;
    i += 1;
  }
  return { ids, east, north, lon, lat, cvi };
}

export function spatialGridFromBuildings(
  buildings: BuildingFeature[],
  cviById: ReadonlyMap<string, number> = new Map(),
  targetCount = URBAN_VECTOR_TARGET,
): SpatialGrid {
  return new SpatialGrid(densifyUrbanVectors(buildings, cviById, targetCount));
}

export function measureSpatialIndex(
  grid: SpatialGrid,
  minCvi = 70,
): SpatialIndexStats {
  const t0 = performance.now();
  const bbox = grid.queryBBox(-700, -1100, 900, 700, minCvi);
  const bboxMs = performance.now() - t0;
  const t1 = performance.now();
  const knn = grid.queryKnn(0, 0, 16);
  const knnMs = performance.now() - t1;
  return {
    vectorCount: grid.count,
    cellCount: grid.cellCount,
    bboxMs,
    bboxHits: bbox.length,
    knnMs,
    knnK: knn.length,
  };
}
