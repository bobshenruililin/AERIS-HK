import { getTableColumns } from "drizzle-orm";
import { buildings } from "./schema";
import type { BuildingFeature } from "../types";
import { clamp, hashString, roundTo } from "../utils";
import { buildingCentroid } from "../spatial-data";
import type { GeoJsonPolygon } from "./types";

export interface BuildingPersistenceRow {
  id: string;
  osmId: number;
  nameEn: string;
  nameZh: string;
  district: string;
  geometry: GeoJsonPolygon;
  floorCount: number;
  subdividedFlatPct: number;
  elderlyRatio: number;
  baselineAcWattsSqm: number;
  uhiVulnerabilityScore: number;
  centroidLon: number;
  centroidLat: number;
}

/** Mean storey height for Sham Shui Po / Yau Ma Tei walk-up tong lau (Census + BD typical). */
const TONG_LAU_STOREY_M = 3.2;

export function buildingToPersistenceRow(feature: BuildingFeature): BuildingPersistenceRow {
  const p = feature.properties;
  const floorCount = Math.max(4, Math.round(p.height / TONG_LAU_STOREY_M));
  const subdividedFlatPct = clamp(p.subdividedFlatDensity * 100, 0, 100);
  const roof = Math.max(40, p.roofAreaM2);
  const baselineAcWattsSqm = roundTo(p.acAnthropogenicHeat / roof, 4);
  const uhiVulnerabilityScore = roundTo(
    clamp(
      100 *
        (0.34 * p.elderlyRatio +
          0.28 * p.subdividedFlatDensity +
          0.22 * p.povertyIndex +
          0.16 * p.ventilationBlockage),
      0,
      100,
    ),
    3,
  );
  const [centroidLon, centroidLat] = buildingCentroid(feature);
  return {
    id: p.id,
    osmId: 90_000_000 + (hashString(p.id) % 9_000_000),
    nameEn: p.nameEn,
    nameZh: p.nameZh,
    district: p.district,
    geometry: {
      type: "Polygon",
      coordinates: feature.geometry.coordinates,
    },
    floorCount,
    subdividedFlatPct,
    elderlyRatio: p.elderlyRatio,
    baselineAcWattsSqm,
    uhiVulnerabilityScore,
    centroidLon: roundTo(centroidLon, 7),
    centroidLat: roundTo(centroidLat, 7),
  };
}

export const BUILDING_COLUMN_KEYS = Object.keys(getTableColumns(buildings)).sort();
