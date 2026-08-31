import { tableFromIPC, tableFromJSON, tableToIPC } from "apache-arrow";
import type { BuildingFeature, BuildingHourState, CoolRoofCandidate, DistrictName } from "./types";
import { lonLatRingToWgs84Wkt, wgs84RingToHk80Wkt } from "./crs";
import { buildingCentroid } from "./spatial-data";

export const ARROW_IPC_CONTENT_TYPE = "application/vnd.apache.arrow.file";

export interface FootprintIpcRow {
  id: string;
  name_en: string;
  name_zh: string;
  address: string;
  street_en: string;
  street_zh: string;
  district: string;
  height_m: number;
  subdivided_flat_density: number;
  elderly_ratio: number;
  poverty_index: number;
  ac_anthropogenic_heat: number;
  ventilation_blockage: number;
  baseline_cvd_prevalence: number;
  estimated_residents: number;
  heading_deg: number;
  hk80_easting: number;
  hk80_northing: number;
  geom_hk80_wkt: string;
  geom_wgs84_wkt: string;
  centroid_lon: number;
  centroid_lat: number;
  source_srid: number;
  display_srid: number;
  roof_m2: number;
}

export interface HourIpcRow {
  building_id: string;
  name_en: string;
  name_zh: string;
  district: DistrictName;
  hour: number;
  cvi: number;
  micro_wbgt: number;
  indoor_ta: number;
  outdoor_ta: number;
  residents: number;
}

export function encodeFootprintsIpc(rows: FootprintIpcRow[]): Uint8Array {
  return tableToIPC(tableFromJSON(rows as unknown as Record<string, unknown>[]), "file");
}

export function decodeFootprintsIpc(bytes: Uint8Array | ArrayBuffer): FootprintIpcRow[] {
  const table = tableFromIPC(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  return table.toArray().map((rec) => {
    const row = rec.toJSON() as Record<string, unknown>;
    return {
      id: String(row.id),
      name_en: String(row.name_en),
      name_zh: String(row.name_zh),
      address: String(row.address),
      street_en: String(row.street_en),
      street_zh: String(row.street_zh),
      district: String(row.district),
      height_m: Number(row.height_m),
      subdivided_flat_density: Number(row.subdivided_flat_density),
      elderly_ratio: Number(row.elderly_ratio),
      poverty_index: Number(row.poverty_index),
      ac_anthropogenic_heat: Number(row.ac_anthropogenic_heat),
      ventilation_blockage: Number(row.ventilation_blockage),
      baseline_cvd_prevalence: Number(row.baseline_cvd_prevalence),
      estimated_residents: Number(row.estimated_residents),
      heading_deg: Number(row.heading_deg),
      hk80_easting: Number(row.hk80_easting),
      hk80_northing: Number(row.hk80_northing),
      geom_hk80_wkt: String(row.geom_hk80_wkt),
      geom_wgs84_wkt: String(row.geom_wgs84_wkt),
      centroid_lon: Number(row.centroid_lon),
      centroid_lat: Number(row.centroid_lat),
      source_srid: Number(row.source_srid),
      display_srid: Number(row.display_srid),
      roof_m2: Number(row.roof_m2),
    };
  });
}

export function encodeHourlyIpc(rows: HourIpcRow[]): Uint8Array {
  return tableToIPC(tableFromJSON(rows as unknown as Record<string, unknown>[]), "file");
}

export function footprintsFromBuildings(buildings: BuildingFeature[]): FootprintIpcRow[] {
  return buildings.map((feature) => {
    const p = feature.properties;
    const ring = feature.geometry.coordinates[0];
    const centroid = buildingCentroid(feature);
    return {
      id: p.id,
      name_en: p.nameEn,
      name_zh: p.nameZh,
      address: p.address,
      street_en: p.streetEn,
      street_zh: p.streetZh,
      district: p.district,
      height_m: p.height,
      subdivided_flat_density: p.subdividedFlatDensity,
      elderly_ratio: p.elderlyRatio,
      poverty_index: p.povertyIndex,
      ac_anthropogenic_heat: p.acAnthropogenicHeat,
      ventilation_blockage: p.ventilationBlockage,
      baseline_cvd_prevalence: p.baselineCVDPrevalence,
      estimated_residents: p.estimatedResidents,
      heading_deg: p.headingDeg,
      hk80_easting: p.hk80.easting,
      hk80_northing: p.hk80.northing,
      geom_hk80_wkt: wgs84RingToHk80Wkt(ring),
      geom_wgs84_wkt: lonLatRingToWgs84Wkt(ring),
      centroid_lon: centroid[0],
      centroid_lat: centroid[1],
      source_srid: 2326,
      display_srid: 4326,
      roof_m2: p.roofAreaM2,
    };
  });
}

export function hourlyRowsFromState(
  buildings: BuildingFeature[],
  hourly: BuildingHourState[],
): HourIpcRow[] {
  const meta = new Map(buildings.map((b) => [b.properties.id, b.properties]));
  return hourly.map((row) => {
    const props = meta.get(row.buildingId);
    if (!props) {
      throw new Error(`Hourly row missing building ${row.buildingId}`);
    }
    return {
      building_id: row.buildingId,
      name_en: props.nameEn,
      name_zh: props.nameZh,
      district: props.district,
      hour: Math.round(row.hour),
      cvi: row.cvi,
      micro_wbgt: row.microWbgt,
      indoor_ta: row.indoorTa,
      outdoor_ta: row.outdoorTa,
      residents: props.estimatedResidents,
    };
  });
}

export function encodeCoolRoofCandidatesIpc(candidates: CoolRoofCandidate[]): Uint8Array {
  return tableToIPC(
    tableFromJSON(
      candidates.map((row) => ({
        building_id: row.buildingId,
        roof_m2: row.roofM2,
        admissions_averted: row.admissionsAverted,
        efficiency: row.efficiency,
      })) as unknown as Record<string, unknown>[],
    ),
    "file",
  );
}
