/**
 * Zero-allocation helpers for TwinCanvas: precomputed ENU rings, mesh topology,
 * and in-place ENU → screen projection.
 */
import { EXTRUSION_SCALE } from "./constants";
import { buildingCentroid } from "./spatial-data";
import type { BuildingFeature } from "./types";
import {
  projectEnuInto,
  wgs84ToEnu,
  wgs84ToEnuInto,
  type CameraBasis,
  type EnuPoint,
  type ProjectedPoint,
  type TwinView,
} from "./twin-camera";
import { castGroundShadowInto } from "./solar-engine";

export interface MeshFace {
  pts: EnuPoint[];
  normal: EnuPoint;
  roof: boolean;
}

export interface MeshBuilding {
  id: string;
  ground: EnuPoint[];
  height: number;
  centroid: EnuPoint;
  roof: EnuPoint[];
  faces: MeshFace[];
  shadowScratch: EnuPoint[];
  projectScratch: ProjectedPoint[];
}

const HARBOUR_RING: Array<[number, number]> = [
  [114.148, 22.278],
  [114.205, 22.276],
  [114.198, 22.305],
  [114.176, 22.311],
  [114.149, 22.318],
];

const LAND_RING: Array<[number, number]> = [
  [114.1485, 22.318],
  [114.176, 22.311],
  [114.1785, 22.322],
  [114.175, 22.338],
  [114.158, 22.341],
  [114.151, 22.334],
];

export const HARBOUR_ENU: EnuPoint[] = HARBOUR_RING.map(([lon, lat]) => wgs84ToEnu(lon, lat, 0));
export const LAND_ENU: EnuPoint[] = LAND_RING.map(([lon, lat]) => wgs84ToEnu(lon, lat, 0.4));

export const HARBOUR_PROJECTED: ProjectedPoint[] = HARBOUR_ENU.map(() => ({
  x: 0,
  y: 0,
  depth: 0,
  visible: false,
}));
export const LAND_PROJECTED: ProjectedPoint[] = LAND_ENU.map(() => ({
  x: 0,
  y: 0,
  depth: 0,
  visible: false,
}));

const PARTICLE_ENU: EnuPoint = { east: 0, north: 0, up: 0 };
export const PARTICLE_PROJ: ProjectedPoint = { x: 0, y: 0, depth: 0, visible: false };
export const MESH_ORDER: number[] = [];
let meshDepthBuf = new Float32Array(512);
const CVI_MAP = new Map<string, number>();
const TARGETED = new Set<string>();
const WINDOW_ONLY = new Set<string>();
const HIGHLIGHT = new Set<string>();
const DIFF_BY_ID = new Map<string, { buildingId: string; delta: number }>();

export let drawCallCount = 0;

export function resetDrawCalls(): void {
  drawCallCount = 0;
}

export function bumpDrawCalls(): void {
  drawCallCount += 1;
}

export function getDrawCallCount(): number {
  return drawCallCount;
}

function allocProjected(n: number): ProjectedPoint[] {
  const out: ProjectedPoint[] = new Array(n);
  for (let i = 0; i < n; i += 1) out[i] = { x: 0, y: 0, depth: 0, visible: false };
  return out;
}

export function projectRingInto(
  ring: EnuPoint[],
  dest: ProjectedPoint[],
  view: TwinView,
  w: number,
  h: number,
  basis: CameraBasis,
): ProjectedPoint[] {
  const n = ring.length;
  while (dest.length < n) dest.push({ x: 0, y: 0, depth: 0, visible: false });
  for (let i = 0; i < n; i += 1) {
    projectEnuInto(dest[i], ring[i], view, w, h, basis);
  }
  dest.length = n;
  return dest;
}

export function buildMeshBuildings(buildings: BuildingFeature[]): MeshBuilding[] {
  return buildings.map((feature) => {
    const ring = feature.geometry.coordinates[0];
    const ground: EnuPoint[] = [];
    const n = Math.max(1, ring.length - 1);
    for (let i = 0; i < n; i += 1) {
      ground.push(wgs84ToEnu(ring[i][0], ring[i][1], 0));
    }
    const height = feature.properties.height * EXTRUSION_SCALE;
    const roof: EnuPoint[] = ground.map((p) => ({ east: p.east, north: p.north, up: height }));
    const faces: MeshFace[] = [];
    for (let i = 0; i < ground.length; i += 1) {
      const a = ground[i];
      const b = ground[(i + 1) % ground.length];
      const dx = b.east - a.east;
      const dy = b.north - a.north;
      const nlen = Math.hypot(dy, -dx) || 1;
      faces.push({
        pts: [a, b, { east: b.east, north: b.north, up: height }, { east: a.east, north: a.north, up: height }],
        normal: { east: dy / nlen, north: -dx / nlen, up: 0 },
        roof: false,
      });
    }
    faces.push({
      pts: roof,
      normal: { east: 0, north: 0, up: 1 },
      roof: true,
    });
    const [lon, lat] = buildingCentroid(feature);
    const maxPts = Math.max(ground.length, 8);
    return {
      id: feature.properties.id,
      ground,
      height,
      centroid: wgs84ToEnu(lon, lat, height * 0.5),
      roof,
      faces,
      shadowScratch: ground.map((p) => ({ east: p.east, north: p.north, up: 0 })),
      projectScratch: allocProjected(maxPts),
    };
  });
}

export function fillCviMap(rows: Array<{ buildingId: string; cvi: number }>): Map<string, number> {
  CVI_MAP.clear();
  for (let i = 0; i < rows.length; i += 1) {
    CVI_MAP.set(rows[i].buildingId, rows[i].cvi);
  }
  return CVI_MAP;
}

export function fillIdSet(set: Set<string>, ids: string[]): Set<string> {
  set.clear();
  for (let i = 0; i < ids.length; i += 1) set.add(ids[i]);
  return set;
}

export function targetedSet(ids: string[]): Set<string> {
  return fillIdSet(TARGETED, ids);
}

export function windowOnlySet(ids: string[], targeted: Set<string>): Set<string> {
  WINDOW_ONLY.clear();
  for (let i = 0; i < ids.length; i += 1) {
    if (!targeted.has(ids[i])) WINDOW_ONLY.add(ids[i]);
  }
  return WINDOW_ONLY;
}

export function highlightSetOf(ids: string[]): Set<string> | null {
  if (ids.length === 0) {
    HIGHLIGHT.clear();
    return null;
  }
  return fillIdSet(HIGHLIGHT, ids);
}

export function diffMap(
  cells: Array<{ buildingId: string; delta: number }>,
): Map<string, { buildingId: string; delta: number }> {
  DIFF_BY_ID.clear();
  for (let i = 0; i < cells.length; i += 1) {
    DIFF_BY_ID.set(cells[i].buildingId, cells[i]);
  }
  return DIFF_BY_ID;
}

export function depthSortMeshes(
  meshes: MeshBuilding[],
  view: TwinView,
  w: number,
  h: number,
  basis: CameraBasis,
): number[] {
  const n = meshes.length;
  MESH_ORDER.length = n;
  if (meshDepthBuf.length < n) meshDepthBuf = new Float32Array(n);
  const depths = meshDepthBuf;
  for (let i = 0; i < n; i += 1) {
    MESH_ORDER[i] = i;
    projectEnuInto(PARTICLE_PROJ, meshes[i].centroid, view, w, h, basis);
    depths[i] = PARTICLE_PROJ.depth;
  }
  MESH_ORDER.sort((a, b) => depths[b] - depths[a]);
  return MESH_ORDER;
}

export function projectParticle(
  lon: number,
  lat: number,
  up: number,
  view: TwinView,
  w: number,
  h: number,
  basis: CameraBasis,
): ProjectedPoint {
  wgs84ToEnuInto(PARTICLE_ENU, lon, lat, up);
  return projectEnuInto(PARTICLE_PROJ, PARTICLE_ENU, view, w, h, basis);
}

export function fillShadowScratch(mesh: MeshBuilding, sun: [number, number, number]): EnuPoint[] {
  const roofUp = mesh.height;
  for (let i = 0; i < mesh.ground.length; i += 1) {
    const p = mesh.ground[i];
    PARTICLE_ENU.east = p.east;
    PARTICLE_ENU.north = p.north;
    PARTICLE_ENU.up = roofUp;
    castGroundShadowInto(mesh.shadowScratch[i], PARTICLE_ENU, sun);
  }
  return mesh.shadowScratch;
}
