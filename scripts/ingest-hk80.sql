-- AERIS-HK PostGIS migration
-- Authoritative footprints: Hong Kong 1980 Grid (EPSG:2326)
-- Dual-write display CRS: WGS84 lon/lat (EPSG:4326) for Deck.gl / MapLibre
--
-- Apply with:  npm run ingest:hk80
--              psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/ingest-hk80.sql
--
-- geom_hk80 is the source of truth. geom_wgs84 is maintained by trigger via ST_Transform.
-- Never pass EPSG:2326 eastings to Deck.gl getPosition / getSourcePosition.

CREATE EXTENSION IF NOT EXISTS postgis;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM spatial_ref_sys WHERE srid = 2326) THEN
    INSERT INTO spatial_ref_sys (srid, auth_name, auth_srid, srtext, proj4text)
    VALUES (
      2326,
      'EPSG',
      2326,
      'PROJCS["Hong Kong 1980 Grid System",GEOGCS["Hong Kong 1980",DATUM["Hong_Kong_1980",SPHEROID["International 1924",6378388,297,AUTHORITY["EPSG","7022"]],TOWGS84[-162.619,-276.959,-161.764,0.067753,-2.243649,-1.158827,-1.094246],AUTHORITY["EPSG","6611"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4611"]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",22.3121333333333],PARAMETER["central_meridian",114.178555555556],PARAMETER["scale_factor",1],PARAMETER["false_easting",836694.05],PARAMETER["false_northing",819069.8],UNIT["metre",1,AUTHORITY["EPSG","9001"]],AUTHORITY["EPSG","2326"]]',
      '+proj=tmerc +lat_0=22.31213333333334 +lon_0=114.1785555555556 +k=1 +x_0=836694.05 +y_0=819069.8 +ellps=intl +towgs84=-162.619,-276.959,-161.764,0.067753,-2.243649,-1.158827,-1.094246 +units=m +no_defs'
    );
  ELSIF (SELECT proj4text FROM spatial_ref_sys WHERE srid = 2326) NOT LIKE '%towgs84%' THEN
    UPDATE spatial_ref_sys
    SET
      proj4text = '+proj=tmerc +lat_0=22.31213333333334 +lon_0=114.1785555555556 +k=1 +x_0=836694.05 +y_0=819069.8 +ellps=intl +towgs84=-162.619,-276.959,-161.764,0.067753,-2.243649,-1.158827,-1.094246 +units=m +no_defs',
      srtext = 'PROJCS["Hong Kong 1980 Grid System",GEOGCS["Hong Kong 1980",DATUM["Hong_Kong_1980",SPHEROID["International 1924",6378388,297,AUTHORITY["EPSG","7022"]],TOWGS84[-162.619,-276.959,-161.764,0.067753,-2.243649,-1.158827,-1.094246],AUTHORITY["EPSG","6611"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4611"]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",22.3121333333333],PARAMETER["central_meridian",114.178555555556],PARAMETER["scale_factor",1],PARAMETER["false_easting",836694.05],PARAMETER["false_northing",819069.8],UNIT["metre",1,AUTHORITY["EPSG","9001"]],AUTHORITY["EPSG","2326"]]'
    WHERE srid = 2326;
  END IF;
END
$$;

CREATE SCHEMA IF NOT EXISTS aeris;

CREATE TABLE IF NOT EXISTS aeris.buildings (
  id TEXT PRIMARY KEY,
  name_en TEXT NOT NULL,
  name_zh TEXT NOT NULL,
  address TEXT NOT NULL,
  street_en TEXT NOT NULL,
  street_zh TEXT NOT NULL,
  district TEXT NOT NULL CHECK (district IN ('Sham Shui Po', 'Yau Tsim Mong')),
  height_m DOUBLE PRECISION NOT NULL,
  subdivided_flat_density DOUBLE PRECISION NOT NULL,
  elderly_ratio DOUBLE PRECISION NOT NULL,
  poverty_index DOUBLE PRECISION NOT NULL,
  ac_anthropogenic_heat DOUBLE PRECISION NOT NULL,
  ventilation_blockage DOUBLE PRECISION NOT NULL,
  baseline_cvd_prevalence DOUBLE PRECISION NOT NULL,
  estimated_residents INTEGER NOT NULL,
  heading_deg DOUBLE PRECISION NOT NULL,
  hk80_easting DOUBLE PRECISION NOT NULL,
  hk80_northing DOUBLE PRECISION NOT NULL,
  geom_hk80 geometry(Polygon, 2326) NOT NULL,
  geom_wgs84 geometry(Polygon, 4326) NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS buildings_hk80_gix ON aeris.buildings USING GIST (geom_hk80);
CREATE INDEX IF NOT EXISTS buildings_wgs84_gix ON aeris.buildings USING GIST (geom_wgs84);
CREATE INDEX IF NOT EXISTS buildings_district_idx ON aeris.buildings (district);

CREATE OR REPLACE FUNCTION aeris.sync_geom_wgs84()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.geom_hk80 IS NULL THEN
    RAISE EXCEPTION 'aeris.buildings.geom_hk80 is required (EPSG:2326 authority)';
  END IF;
  IF ST_SRID(NEW.geom_hk80) = 0 THEN
    NEW.geom_hk80 := ST_SetSRID(NEW.geom_hk80, 2326);
  END IF;
  IF ST_SRID(NEW.geom_hk80) <> 2326 THEN
    RAISE EXCEPTION 'aeris.buildings.geom_hk80 must be EPSG:2326, got SRID %', ST_SRID(NEW.geom_hk80);
  END IF;
  NEW.geom_hk80 := ST_ForcePolygonCCW(NEW.geom_hk80);
  NEW.geom_wgs84 := ST_ForcePolygonCCW(ST_Transform(NEW.geom_hk80, 4326));
  NEW.hk80_easting := ST_X(ST_Centroid(NEW.geom_hk80));
  NEW.hk80_northing := ST_Y(ST_Centroid(NEW.geom_hk80));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_buildings_dual_write ON aeris.buildings;
CREATE TRIGGER trg_buildings_dual_write
BEFORE INSERT OR UPDATE OF geom_hk80 ON aeris.buildings
FOR EACH ROW
EXECUTE FUNCTION aeris.sync_geom_wgs84();

-- Plane-metre round-trip: 2326 → 4326 → 2326. Used by CRS tests.
CREATE OR REPLACE FUNCTION aeris.crs_roundtrip_error_m(
  easting DOUBLE PRECISION,
  northing DOUBLE PRECISION
)
RETURNS DOUBLE PRECISION
LANGUAGE sql
STABLE
AS $$
  SELECT ST_Distance(
    ST_SetSRID(ST_MakePoint(easting, northing), 2326),
    ST_Transform(
      ST_Transform(ST_SetSRID(ST_MakePoint(easting, northing), 2326), 4326),
      2326
    )
  );
$$;

-- Deck.gl-facing view: WGS84 only. Do not select geom_hk80 from the map client.
CREATE OR REPLACE VIEW aeris.buildings_deckgl AS
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
  geom_wgs84,
  ST_AsGeoJSON(geom_wgs84)::jsonb AS geom_wgs84_geojson
FROM aeris.buildings;
