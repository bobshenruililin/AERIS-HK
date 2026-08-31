import type { BuildingFeature, BuildingHourState, RGBA } from "./types";
import { cviColor } from "./epidemiology-engine";
import { EXTRUSION_SCALE } from "./constants";
import { wrapHour } from "./utils";

export interface GpuDiurnalPack {
  ids: string[];
  indexById: Map<string, number>;
  /** length = n * 24 * 4, RGBA bytes, hour-major within each building. */
  instanceColors: Uint8Array;
  /** length = n * 24, metres of extrusion. */
  instanceElevations: Float32Array;
  /** length = n * 24, AC rejector W used by the shimmer shader. */
  instanceAcWatts: Float32Array;
}

function hourOffset(buildingIndex: number, hour: number): number {
  return buildingIndex * 24 + (Math.floor(wrapHour(hour)) % 24);
}

/**
 * Pack a 24-h diurnal buffer so Deck.gl can swap instanceColors /
 * instanceElevations via updateTriggers on Math.floor(hour) without
 * rebuilding the GeoJSON topology every animation frame.
 */
export function packDiurnalGpuAttributes(
  buildings: BuildingFeature[],
  cache: Map<string, BuildingHourState>,
): GpuDiurnalPack {
  const n = buildings.length;
  const instanceColors = new Uint8Array(n * 24 * 4);
  const instanceElevations = new Float32Array(n * 24);
  const instanceAcWatts = new Float32Array(n * 24);
  const indexById = new Map<string, number>();

  for (let i = 0; i < n; i += 1) {
    const feature = buildings[i];
    indexById.set(feature.properties.id, i);
    for (let hour = 0; hour < 24; hour += 1) {
      const state = cache.get(`${feature.properties.id}:${hour}`);
      const cvi = state?.cvi ?? 0;
      const color = cviColor(cvi);
      const base = (i * 24 + hour) * 4;
      instanceColors[base] = color[0];
      instanceColors[base + 1] = color[1];
      instanceColors[base + 2] = color[2];
      instanceColors[base + 3] = color[3];
      const ac = feature.properties.acAnthropogenicHeat * (0.55 + 0.45 * (cvi / 100));
      instanceAcWatts[i * 24 + hour] = ac;
      const shimmer = 1 + 0.045 * (ac / 180);
      instanceElevations[i * 24 + hour] = feature.properties.height * EXTRUSION_SCALE * shimmer;
    }
  }

  return { ids: buildings.map((b) => b.properties.id), indexById, instanceColors, instanceElevations, instanceAcWatts };
}

export function packedColorAt(pack: GpuDiurnalPack, buildingId: string, hour: number): RGBA {
  const i = pack.indexById.get(buildingId);
  if (i == null) return [16, 185, 129, 210];
  const o = hourOffset(i, hour) * 4;
  return [pack.instanceColors[o], pack.instanceColors[o + 1], pack.instanceColors[o + 2], pack.instanceColors[o + 3]];
}

export function packedElevationAt(pack: GpuDiurnalPack, buildingId: string, hour: number): number {
  const i = pack.indexById.get(buildingId);
  if (i == null) return 20;
  return pack.instanceElevations[hourOffset(i, hour)];
}

export function packedAcWattsAt(pack: GpuDiurnalPack, buildingId: string, hour: number): number {
  const i = pack.indexById.get(buildingId);
  if (i == null) return 0;
  return pack.instanceAcWatts[hourOffset(i, hour)];
}

export function acPulseFromHour(hour: number, thermalShimmer: boolean): number {
  if (!thermalShimmer) return 0;
  const h = wrapHour(hour);
  const midnight = h >= 22 || h <= 4 ? 1 : 0;
  const diurnal = 0.35 + 0.65 * Math.max(0, Math.sin(((h - 6) * Math.PI) / 12));
  return diurnal + 0.55 * midnight;
}
