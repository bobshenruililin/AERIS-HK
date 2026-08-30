/**
 * Kepler.gl-style instanced extrusion pack for Deck.gl ColumnLayer.
 * Layout is hour-major so a diurnal scrub is a zero-copy subarray, not a
 * new typed array. First `parentCount` slots are true building centroids;
 * the remainder are alley / lot infill so the GPU path holds ≥20,480 instances.
 */
import type { BuildingFeature, BuildingHourState, RGBA } from "./types";
import { cviColor } from "./epidemiology-engine";
import { EXTRUSION_SCALE } from "./constants";
import { buildingCentroid } from "./spatial-data";
import { wrapHour } from "./utils";

export const INSTANCE_TARGET = 20_480;

export type LodLevel = 0 | 1 | 2;

export function lodFromZoom(zoom: number): LodLevel {
  if (zoom < 14.35) return 0;
  if (zoom < 15.7) return 1;
  return 2;
}

export function lodFromDistanceM(distance: number): LodLevel {
  if (distance > 1800) return 0;
  if (distance > 900) return 1;
  return 2;
}

export function visibleInstanceCount(lod: LodLevel, total: number, parentCount: number): number {
  if (lod === 0) return total;
  if (lod === 1) return Math.min(total, Math.max(parentCount, Math.ceil(total / 4)));
  return parentCount;
}

export interface InstancePack {
  count: number;
  parentCount: number;
  /** length = 3 * count, lon/lat/0. Never rebuilt on hour scrub. */
  instancePositions: Float32Array;
  /** hour-major, length = 24 * count * 4. */
  instanceColors: Uint8Array;
  /** hour-major, length = 24 * count. */
  instanceElevations: Float32Array;
  /** hour-major, length = 24 * count. */
  instanceAcWatts: Float32Array;
  parentIds: string[];
}

export interface HourInstanceSlice {
  count: number;
  instancePositions: Float32Array;
  instanceColors: Uint8Array;
  instanceElevations: Float32Array;
  instanceAcWatts: Float32Array;
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

export function packInstanceExtrusions(
  buildings: BuildingFeature[],
  cache: Map<string, BuildingHourState>,
  targetCount = INSTANCE_TARGET,
): InstancePack {
  const parentCount = buildings.length;
  if (parentCount === 0) {
    return {
      count: 0,
      parentCount: 0,
      instancePositions: new Float32Array(0),
      instanceColors: new Uint8Array(0),
      instanceElevations: new Float32Array(0),
      instanceAcWatts: new Float32Array(0),
      parentIds: [],
    };
  }
  const count = Math.max(parentCount, targetCount);
  const instancePositions = new Float32Array(count * 3);
  const instanceColors = new Uint8Array(24 * count * 4);
  const instanceElevations = new Float32Array(24 * count);
  const instanceAcWatts = new Float32Array(24 * count);
  const parentIds: string[] = new Array(count);
  const rnd = mulberry(0x51ed20);

  const centroids: Array<[number, number]> = buildings.map((b) => buildingCentroid(b));

  for (let i = 0; i < count; i += 1) {
    const parent = buildings[i % parentCount];
    parentIds[i] = parent.properties.id;
    const [clon, clat] = centroids[i % parentCount];
    let lon = clon;
    let lat = clat;
    if (i >= parentCount) {
      lon += (rnd() - 0.5) * 0.0018;
      lat += (rnd() - 0.5) * 0.0015;
    }
    instancePositions[i * 3] = lon;
    instancePositions[i * 3 + 1] = lat;
    instancePositions[i * 3 + 2] = 0;
  }

  for (let hour = 0; hour < 24; hour += 1) {
    const colorBase = hour * count * 4;
    const elevBase = hour * count;
    for (let i = 0; i < count; i += 1) {
      const parent = buildings[i % parentCount];
      const state = cache.get(`${parent.properties.id}:${hour}`);
      const cvi = state?.cvi ?? 0;
      const color = cviColor(cvi);
      const o = colorBase + i * 4;
      instanceColors[o] = color[0];
      instanceColors[o + 1] = color[1];
      instanceColors[o + 2] = color[2];
      instanceColors[o + 3] = i >= parentCount ? Math.max(70, color[3] - 40) : color[3];
      const ac = parent.properties.acAnthropogenicHeat * (0.55 + 0.45 * (cvi / 100));
      instanceAcWatts[elevBase + i] = ac;
      const shimmer = 1 + 0.045 * (ac / 180);
      instanceElevations[elevBase + i] = parent.properties.height * EXTRUSION_SCALE * shimmer;
    }
  }

  return {
    count,
    parentCount,
    instancePositions,
    instanceColors,
    instanceElevations,
    instanceAcWatts,
    parentIds,
  };
}

/**
 * Cursor over hour-major instance buffers. Mutate in place on the 60 FPS path
 * so a diurnal scrub never allocates TypedArray views.
 */
export interface HourInstanceCursor {
  count: number;
  colorOffset: number;
  elevOffset: number;
  positions: Float32Array;
  colors: Uint8Array;
  elevations: Float32Array;
  acWatts: Float32Array;
}

export function fillHourInstanceCursor(
  out: HourInstanceCursor,
  pack: InstancePack,
  hour: number,
  lod: LodLevel,
): HourInstanceCursor {
  const h = Math.floor(wrapHour(hour)) % 24;
  out.count = visibleInstanceCount(lod, pack.count, pack.parentCount);
  out.colorOffset = h * pack.count * 4;
  out.elevOffset = h * pack.count;
  out.positions = pack.instancePositions;
  out.colors = pack.instanceColors;
  out.elevations = pack.instanceElevations;
  out.acWatts = pack.instanceAcWatts;
  return out;
}

/** Zero-copy hour slice for Deck.gl binary attributes. Callers must not mutate the views. */
export function sliceHourInstances(pack: InstancePack, hour: number, lod: LodLevel): HourInstanceSlice {
  const h = Math.floor(wrapHour(hour)) % 24;
  const count = visibleInstanceCount(lod, pack.count, pack.parentCount);
  const colorStart = h * pack.count * 4;
  const elevStart = h * pack.count;
  return {
    count,
    instancePositions: pack.instancePositions.subarray(0, count * 3),
    instanceColors: pack.instanceColors.subarray(colorStart, colorStart + count * 4),
    instanceElevations: pack.instanceElevations.subarray(elevStart, elevStart + count),
    instanceAcWatts: pack.instanceAcWatts.subarray(elevStart, elevStart + count),
  };
}

export function packedInstanceColorInto(out: RGBA, slice: HourInstanceSlice, index: number): RGBA {
  const o = index * 4;
  out[0] = slice.instanceColors[o];
  out[1] = slice.instanceColors[o + 1];
  out[2] = slice.instanceColors[o + 2];
  out[3] = slice.instanceColors[o + 3];
  return out;
}

export function packedCursorColorInto(out: RGBA, cursor: HourInstanceCursor, index: number): RGBA {
  const o = cursor.colorOffset + index * 4;
  out[0] = cursor.colors[o];
  out[1] = cursor.colors[o + 1];
  out[2] = cursor.colors[o + 2];
  out[3] = cursor.colors[o + 3];
  return out;
}

export function packedInstanceColor(slice: HourInstanceSlice, index: number): RGBA {
  return packedInstanceColorInto([0, 0, 0, 0], slice, index);
}
