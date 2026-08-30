import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getBuildings } from "../spatial-data";
import { wgs84RingToHk80Wkt } from "../crs";
import { withClient } from "./pool";

const UPSERT_SQL = `
INSERT INTO aeris.buildings (
  id, name_en, name_zh, address, street_en, street_zh, district,
  height_m, subdivided_flat_density, elderly_ratio, poverty_index,
  ac_anthropogenic_heat, ventilation_blockage, baseline_cvd_prevalence,
  estimated_residents, heading_deg, hk80_easting, hk80_northing, geom_hk80
) VALUES (
  $1, $2, $3, $4, $5, $6, $7,
  $8, $9, $10, $11,
  $12, $13, $14,
  $15, $16, $17, $18,
  ST_SetSRID(ST_GeomFromText($19), 2326)
)
ON CONFLICT (id) DO UPDATE SET
  name_en = EXCLUDED.name_en,
  name_zh = EXCLUDED.name_zh,
  address = EXCLUDED.address,
  street_en = EXCLUDED.street_en,
  street_zh = EXCLUDED.street_zh,
  district = EXCLUDED.district,
  height_m = EXCLUDED.height_m,
  subdivided_flat_density = EXCLUDED.subdivided_flat_density,
  elderly_ratio = EXCLUDED.elderly_ratio,
  poverty_index = EXCLUDED.poverty_index,
  ac_anthropogenic_heat = EXCLUDED.ac_anthropogenic_heat,
  ventilation_blockage = EXCLUDED.ventilation_blockage,
  baseline_cvd_prevalence = EXCLUDED.baseline_cvd_prevalence,
  estimated_residents = EXCLUDED.estimated_residents,
  heading_deg = EXCLUDED.heading_deg,
  hk80_easting = EXCLUDED.hk80_easting,
  hk80_northing = EXCLUDED.hk80_northing,
  geom_hk80 = EXCLUDED.geom_hk80,
  ingested_at = now()
`;

export function migrationSqlPath(): string {
  return join(process.cwd(), "scripts", "ingest-hk80.sql");
}

export async function applyHk80Migration(): Promise<void> {
  const sql = readFileSync(migrationSqlPath(), "utf8");
  await withClient(async (client) => {
    await client.query(sql);
  });
}

export interface IngestResult {
  buildingCount: number;
  dualWriteOk: boolean;
  sridHk80: number;
  sridWgs84: number;
}

export async function ingestHk80FromTwin(): Promise<IngestResult> {
  await applyHk80Migration();
  const buildings = getBuildings();
  await withClient(async (client) => {
    await client.query("BEGIN");
    try {
      for (const feature of buildings) {
        const p = feature.properties;
        const wkt = wgs84RingToHk80Wkt(feature.geometry.coordinates[0]);
        await client.query(UPSERT_SQL, [
          p.id,
          p.nameEn,
          p.nameZh,
          p.address,
          p.streetEn,
          p.streetZh,
          p.district,
          p.height,
          p.subdividedFlatDensity,
          p.elderlyRatio,
          p.povertyIndex,
          p.acAnthropogenicHeat,
          p.ventilationBlockage,
          p.baselineCVDPrevalence,
          p.estimatedResidents,
          p.headingDeg,
          p.hk80.easting,
          p.hk80.northing,
          wkt,
        ]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
  return verifyDualWrite(buildings.length);
}

export async function verifyDualWrite(expectedCount: number): Promise<IngestResult> {
  return withClient(async (client) => {
    const stats = await client.query<{
      n: string;
      dual: string;
      srid_hk80: number | null;
      srid_wgs84: number | null;
    }>(`
      SELECT
        COUNT(*)::text AS n,
        COUNT(*) FILTER (
          WHERE ST_SRID(geom_hk80) = 2326
            AND ST_SRID(geom_wgs84) = 4326
            AND NOT ST_IsEmpty(geom_hk80)
            AND NOT ST_IsEmpty(geom_wgs84)
        )::text AS dual,
        MAX(ST_SRID(geom_hk80)) AS srid_hk80,
        MAX(ST_SRID(geom_wgs84)) AS srid_wgs84
      FROM aeris.buildings
    `);
    const row = stats.rows[0];
    const buildingCount = Number(row?.n ?? 0);
    const dualCount = Number(row?.dual ?? 0);
    if (buildingCount !== expectedCount) {
      throw new Error(`PostGIS ingest expected ${expectedCount} buildings, stored ${buildingCount}`);
    }
    if (dualCount !== buildingCount) {
      throw new Error(`PostGIS dual-write incomplete: ${dualCount}/${buildingCount} rows have SRID 2326+4326`);
    }
    return {
      buildingCount,
      dualWriteOk: true,
      sridHk80: Number(row?.srid_hk80 ?? 0),
      sridWgs84: Number(row?.srid_wgs84 ?? 0),
    };
  });
}
