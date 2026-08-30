import { encodeFootprintsIpc, footprintsFromBuildings, type FootprintIpcRow } from "../arrow-ipc";
import { getBuildings } from "../spatial-data";
import type { SpatialBuildingsPayload, SpatialSnapshotMeta } from "../types";
import { featureFromPostgisRow } from "../spatial-source";
import { ingestHk80FromTwin } from "./ingest";
import { pingPostgis, withClient } from "./pool";

const FOOTPRINT_SQL = `
SELECT
  id,
  name_en,
  name_zh,
  address,
  street_en,
  street_zh,
  district,
  height_m,
  subdivided_flat_density,
  elderly_ratio,
  poverty_index,
  ac_anthropogenic_heat,
  ventilation_blockage,
  baseline_cvd_prevalence,
  estimated_residents,
  heading_deg,
  hk80_easting,
  hk80_northing,
  ST_AsGeoJSON(geom_wgs84) AS geom_wgs84_geojson,
  ST_AsText(geom_hk80) AS geom_hk80_wkt,
  ST_AsText(geom_wgs84) AS geom_wgs84_wkt,
  ST_X(ST_Centroid(geom_wgs84)) AS centroid_lon,
  ST_Y(ST_Centroid(geom_wgs84)) AS centroid_lat,
  ST_SRID(geom_hk80) AS source_srid,
  ST_SRID(geom_wgs84) AS display_srid,
  ST_Area(geom_hk80)::double precision AS roof_m2
FROM aeris.buildings
ORDER BY id
`;

interface FootprintQueryRow {
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
  geom_wgs84_geojson: string;
  geom_hk80_wkt: string;
  geom_wgs84_wkt: string;
  centroid_lon: number;
  centroid_lat: number;
  source_srid: number;
  display_srid: number;
  roof_m2: number;
}

async function tableExists(): Promise<boolean> {
  return withClient(async (client) => {
    const res = await client.query<{ exists: boolean }>(
      `SELECT to_regclass('aeris.buildings') IS NOT NULL AS exists`,
    );
    return Boolean(res.rows[0]?.exists);
  });
}

async function buildingCount(): Promise<number> {
  return withClient(async (client) => {
    const res = await client.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM aeris.buildings`);
    return Number(res.rows[0]?.n ?? 0);
  });
}

export async function ensureAuthoritativeFootprints(): Promise<void> {
  if (!(await tableExists()) || (await buildingCount()) === 0) {
    await ingestHk80FromTwin();
  }
}

function rowsToIpc(rows: FootprintQueryRow[]): FootprintIpcRow[] {
  return rows.map((row) => ({
    id: row.id,
    name_en: row.name_en,
    name_zh: row.name_zh,
    address: row.address,
    street_en: row.street_en,
    street_zh: row.street_zh,
    district: row.district,
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
    geom_hk80_wkt: row.geom_hk80_wkt,
    geom_wgs84_wkt: row.geom_wgs84_wkt,
    centroid_lon: Number(row.centroid_lon),
    centroid_lat: Number(row.centroid_lat),
    source_srid: Number(row.source_srid),
    display_srid: Number(row.display_srid),
    roof_m2: Number(row.roof_m2),
  }));
}

export async function loadAuthoritativeRows(): Promise<FootprintQueryRow[]> {
  await ensureAuthoritativeFootprints();
  return withClient(async (client) => {
    const res = await client.query<FootprintQueryRow>(FOOTPRINT_SQL);
    return res.rows;
  });
}

export async function loadBuildingsPayload(): Promise<SpatialBuildingsPayload> {
  const ping = await pingPostgis();
  if (!ping.ok) {
    const features = getBuildings();
    return {
      authority: "synthetic-seed",
      sourceSrid: 2326,
      displaySrid: 4326,
      dualWrite: false,
      collection: {
        type: "FeatureCollection",
        crs: { type: "name", properties: { name: "EPSG:4326" } },
        features,
      },
    };
  }
  const rows = await loadAuthoritativeRows();
  const features = rows.map((row) =>
    featureFromPostgisRow({
      ...row,
      geom_wgs84_geojson: row.geom_wgs84_geojson,
      roof_m2: row.roof_m2,
    }),
  );
  return {
    authority: "postgis-hk80",
    sourceSrid: 2326,
    displaySrid: 4326,
    dualWrite: true,
    postgisVersion: ping.version,
    collection: {
      type: "FeatureCollection",
      crs: { type: "name", properties: { name: "EPSG:4326" } },
      features,
    },
  };
}

export async function loadFootprintsIpc(): Promise<{
  bytes: Uint8Array;
  meta: SpatialSnapshotMeta;
}> {
  const ping = await pingPostgis();
  if (!ping.ok) {
    const features = getBuildings();
    const bytes = encodeFootprintsIpc(footprintsFromBuildings(features));
    return {
      bytes,
      meta: {
        authority: "synthetic-seed",
        sourceSrid: 2326,
        displaySrid: 4326,
        dualWrite: false,
        buildingCount: features.length,
        arrowBytes: bytes.byteLength,
        error: ping.error,
      },
    };
  }
  const rows = await loadAuthoritativeRows();
  const bytes = encodeFootprintsIpc(rowsToIpc(rows));
  return {
    bytes,
    meta: {
      authority: "postgis-hk80",
      sourceSrid: 2326,
      displaySrid: 4326,
      dualWrite: true,
      buildingCount: rows.length,
      arrowBytes: bytes.byteLength,
      postgisVersion: ping.version,
    },
  };
}
