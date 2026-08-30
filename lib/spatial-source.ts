import type { BuildingFeature, DistrictName, SpatialBuildingsPayload, SpatialSnapshotMeta } from "./types";
import { assertWgs84 } from "./crs";

export const SYNTHETIC_SPATIAL_META: SpatialSnapshotMeta = {
  authority: "synthetic-seed",
  sourceSrid: 2326,
  displaySrid: 4326,
  dualWrite: false,
  buildingCount: 0,
  arrowBytes: 0,
};

interface GeoJsonPolygon {
  type: "Polygon";
  coordinates: number[][][];
}

export function featureFromPostgisRow(row: {
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
  geom_wgs84_geojson: GeoJsonPolygon | string;
}): BuildingFeature {
  const geom =
    typeof row.geom_wgs84_geojson === "string"
      ? (JSON.parse(row.geom_wgs84_geojson) as GeoJsonPolygon)
      : row.geom_wgs84_geojson;
  if (geom.type !== "Polygon" || !Array.isArray(geom.coordinates?.[0])) {
    throw new Error(`Building ${row.id} dual-write geometry is not a Polygon`);
  }
  const ring = geom.coordinates[0].map((pt) => [Number(pt[0]), Number(pt[1])] as [number, number]);
  const centroidLon = ring.slice(0, -1).reduce((s, p) => s + p[0], 0) / Math.max(1, ring.length - 1);
  const centroidLat = ring.slice(0, -1).reduce((s, p) => s + p[1], 0) / Math.max(1, ring.length - 1);
  assertWgs84(centroidLon, centroidLat);

  return {
    type: "Feature",
    id: row.id,
    geometry: { type: "Polygon", coordinates: [ring] },
    properties: {
      id: row.id,
      nameEn: row.name_en,
      nameZh: row.name_zh,
      address: row.address,
      streetEn: row.street_en,
      streetZh: row.street_zh,
      district: row.district as DistrictName,
      height: Number(row.height_m),
      subdividedFlatDensity: Number(row.subdivided_flat_density),
      elderlyRatio: Number(row.elderly_ratio),
      povertyIndex: Number(row.poverty_index),
      acAnthropogenicHeat: Number(row.ac_anthropogenic_heat),
      ventilationBlockage: Number(row.ventilation_blockage),
      baselineCVDPrevalence: Number(row.baseline_cvd_prevalence),
      estimatedResidents: Number(row.estimated_residents),
      headingDeg: Number(row.heading_deg),
      hk80: {
        easting: Number(row.hk80_easting),
        northing: Number(row.hk80_northing),
      },
    },
  };
}

export type { SpatialBuildingsPayload, SpatialSnapshotMeta };
