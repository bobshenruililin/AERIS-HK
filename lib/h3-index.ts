import { cellToBoundary, cellToLatLng, latLngToCell } from "h3-js";
import type { BuildingFeature, BuildingHourState, RGBA } from "./types";
import { CVI_HIGH_MAX, CVI_LOW_MAX, CVI_MODERATE_MAX } from "./constants";
import { buildingCentroid } from "./spatial-data";
import { clamp, lerp } from "./utils";

function hexCviColor(cvi: number): RGBA {
  if (cvi < CVI_LOW_MAX) {
    const t = cvi / CVI_LOW_MAX;
    return [
      Math.round(lerp(16, 52, t)),
      Math.round(lerp(185, 211, t)),
      Math.round(lerp(129, 92, t)),
      160,
    ];
  }
  if (cvi < CVI_MODERATE_MAX) {
    const t = (cvi - CVI_LOW_MAX) / (CVI_MODERATE_MAX - CVI_LOW_MAX);
    return [
      Math.round(lerp(245, 249, t)),
      Math.round(lerp(158, 115, t)),
      Math.round(lerp(11, 22, t)),
      170,
    ];
  }
  const t = clamp((cvi - CVI_MODERATE_MAX) / (100 - CVI_HIGH_MAX + CVI_MODERATE_MAX), 0, 1);
  return [
    Math.round(lerp(239, 220, t)),
    Math.round(lerp(68, 20, t)),
    Math.round(lerp(68, 60, t)),
    185,
  ];
}

export type H3Resolution = 9 | 10;

export interface HexMicroclimate {
  hex: string;
  resolution: H3Resolution;
  lon: number;
  lat: number;
  boundary: Array<[number, number]>;
  buildingCount: number;
  meanHeatWm2: number;
  meanCvi: number;
  meanIndoorTa: number;
  meanAcRejector: number;
  color: RGBA;
  elevation: number;
}

export const H3_DISTRICT_RES: H3Resolution = 9;
export const H3_CANYON_RES: H3Resolution = 10;

export function buildingH3Index(feature: BuildingFeature, resolution: H3Resolution): string {
  const [lon, lat] = buildingCentroid(feature);
  return latLngToCell(lat, lon, resolution);
}

/**
 * Kepler.gl / Uber H3 tessellation: bin building heat plumes into continuous
 * hexagonal microclimate gradients at resolution 9 (district) and 10 (canyon).
 */
export function aggregateHeatPlumes(
  buildings: BuildingFeature[],
  states: BuildingHourState[],
  resolution: H3Resolution = H3_CANYON_RES,
): HexMicroclimate[] {
  const stateById = new Map(states.map((row) => [row.buildingId, row]));
  const buckets = new Map<
    string,
    {
      count: number;
      heat: number;
      cvi: number;
      indoor: number;
      ac: number;
    }
  >();

  for (const feature of buildings) {
    const state = stateById.get(feature.properties.id);
    if (!state) continue;
    const hex = buildingH3Index(feature, resolution);
    const current = buckets.get(hex) ?? { count: 0, heat: 0, cvi: 0, indoor: 0, ac: 0 };
    current.count += 1;
    current.heat += state.roofAbsorbedWm2 + feature.properties.acAnthropogenicHeat;
    current.cvi += state.cvi;
    current.indoor += state.indoorTa;
    current.ac += feature.properties.acAnthropogenicHeat;
    buckets.set(hex, current);
  }

  const hexes: HexMicroclimate[] = [];
  for (const [hex, acc] of Array.from(buckets.entries())) {
    const n = Math.max(1, acc.count);
    const meanCvi = acc.cvi / n;
    const meanHeat = acc.heat / n;
    const [lat, lon] = cellToLatLng(hex);
    const boundary = cellToBoundary(hex, true) as Array<[number, number]>; // GeoJSON [lon, lat]
    hexes.push({
      hex,
      resolution,
      lon,
      lat,
      boundary,
      buildingCount: acc.count,
      meanHeatWm2: meanHeat,
      meanCvi,
      meanIndoorTa: acc.indoor / n,
      meanAcRejector: acc.ac / n,
      color: hexCviColor(meanCvi),
      elevation: clamp(8 + (meanHeat / 40) * 18 + Math.max(0, meanCvi - 50) * 1.4, 6, 80),
    });
  }
  return hexes.sort((a, b) => b.meanHeatWm2 - a.meanHeatWm2);
}

export function aggregateHeatPlumesMultiRes(
  buildings: BuildingFeature[],
  states: BuildingHourState[],
): { res9: HexMicroclimate[]; res10: HexMicroclimate[] } {
  return {
    res9: aggregateHeatPlumes(buildings, states, 9),
    res10: aggregateHeatPlumes(buildings, states, 10),
  };
}
