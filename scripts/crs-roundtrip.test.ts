import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertWgs84,
  crsRoundTripErrorMeters,
  geodesicDistanceMeters,
  hk80ToWgs84,
  wgs84RingToHk80Wkt,
  wgs84ToHk80,
} from "../lib/crs";
import { decodeFootprintsIpc, encodeFootprintsIpc, footprintsFromBuildings } from "../lib/arrow-ipc";
import { getBuildings } from "../lib/spatial-data";
import { ingestHk80FromTwin } from "../lib/postgis/ingest";
import { loadFootprintsIpc } from "../lib/postgis/query";
import { pingPostgis, withClient } from "../lib/postgis/pool";

const KOWLOON_SAMPLES: Array<{ name: string; lon: number; lat: number }> = [
  { name: "Sham Shui Po Pei Ho", lon: 114.16355, lat: 22.33005 },
  { name: "Apliu Street", lon: 114.1621, lat: 22.3294 },
  { name: "Temple Street", lon: 114.1702, lat: 22.3064 },
  { name: "Nathan Road Jordan", lon: 114.1714, lat: 22.3051 },
  { name: "King's Park", lon: 114.1726, lat: 22.3119 },
];

const JS_ROUNDTRIP_MAX_M = 0.25;
const POSTGIS_ROUNDTRIP_MAX_M = 0.05;
const JS_VS_POSTGIS_MAX_M = 2.5;

describe("JS HK80 ↔ WGS84 round-trip", () => {
  for (const sample of KOWLOON_SAMPLES) {
    it(`${sample.name} stays within ${JS_ROUNDTRIP_MAX_M} m`, () => {
      assertWgs84(sample.lon, sample.lat);
      const err = crsRoundTripErrorMeters(sample.lon, sample.lat);
      assert.ok(
        err < JS_ROUNDTRIP_MAX_M,
        `${sample.name} round-trip ${err.toFixed(4)} m exceeds ${JS_ROUNDTRIP_MAX_M} m`,
      );
    });
  }

  it("every synthetic footprint centroid round-trips", () => {
    const buildings = getBuildings();
    assert.ok(buildings.length >= 50);
    for (const feature of buildings) {
      const ring = feature.geometry.coordinates[0];
      const n = Math.max(1, ring.length - 1);
      const lon = ring.slice(0, n).reduce((s, p) => s + p[0], 0) / n;
      const lat = ring.slice(0, n).reduce((s, p) => s + p[1], 0) / n;
      const err = crsRoundTripErrorMeters(lon, lat);
      assert.ok(err < JS_ROUNDTRIP_MAX_M, `${feature.properties.id} centroid round-trip ${err.toFixed(4)} m`);
    }
  });

  it("polygon ring vertices survive WGS84→HK80→WGS84", () => {
    const feature = getBuildings()[0];
    for (const [lon, lat] of feature.geometry.coordinates[0]) {
      const hk = wgs84ToHk80(lon, lat);
      const back = hk80ToWgs84(hk.easting, hk.northing);
      const err = geodesicDistanceMeters({ lon, lat }, back);
      assert.ok(err < JS_ROUNDTRIP_MAX_M, `vertex round-trip ${err.toFixed(4)} m`);
    }
  });
});

describe("PostGIS EPSG:2326 dual-write and ST_Transform round-trip", () => {
  it("PostGIS is reachable with EPSG:2326", async () => {
    const ping = await pingPostgis();
    assert.equal(ping.ok, true, ping.ok ? "" : ping.error);
    if (ping.ok) {
      assert.equal(ping.srid2326, true);
      assert.match(ping.version, /3\./);
    }
  });

  it("ingests twin footprints with geom_hk80 2326 and geom_wgs84 4326", async () => {
    const expected = getBuildings().length;
    const result = await ingestHk80FromTwin();
    assert.equal(result.buildingCount, expected);
    assert.equal(result.dualWriteOk, true);
    assert.equal(result.sridHk80, 2326);
    assert.equal(result.sridWgs84, 4326);
  });

  it("ST_Transform 2326→4326→2326 stays within centimetres", async () => {
    await withClient(async (client) => {
      for (const sample of KOWLOON_SAMPLES) {
        const hk = wgs84ToHk80(sample.lon, sample.lat);
        const res = await client.query<{ err: number }>(
          "SELECT aeris.crs_roundtrip_error_m($1, $2) AS err",
          [hk.easting, hk.northing],
        );
        const err = Number(res.rows[0]?.err ?? 99);
        assert.ok(
          err < POSTGIS_ROUNDTRIP_MAX_M,
          `${sample.name} PostGIS round-trip ${err.toFixed(5)} m exceeds ${POSTGIS_ROUNDTRIP_MAX_M} m`,
        );
      }
    });
  });

  it("JS hk80ToWgs84 agrees with PostGIS ST_Transform within metres", async () => {
    await withClient(async (client) => {
      for (const sample of KOWLOON_SAMPLES) {
        const hk = wgs84ToHk80(sample.lon, sample.lat);
        const js = hk80ToWgs84(hk.easting, hk.northing);
        const res = await client.query<{ lon: number; lat: number }>(
          `
          SELECT
            ST_X(ST_Transform(ST_SetSRID(ST_MakePoint($1, $2), 2326), 4326)) AS lon,
            ST_Y(ST_Transform(ST_SetSRID(ST_MakePoint($1, $2), 2326), 4326)) AS lat
          `,
          [hk.easting, hk.northing],
        );
        const pg = { lon: Number(res.rows[0]?.lon), lat: Number(res.rows[0]?.lat) };
        const err = geodesicDistanceMeters(js, pg);
        assert.ok(
          err < JS_VS_POSTGIS_MAX_M,
          `${sample.name} JS vs PostGIS ${err.toFixed(3)} m exceeds ${JS_VS_POSTGIS_MAX_M} m (js=${js.lon},${js.lat} pg=${pg.lon},${pg.lat})`,
        );
      }
    });
  });

  it("dual-write centroids are WGS84, not HK80 eastings", async () => {
    await withClient(async (client) => {
      const res = await client.query<{ lon: number; lat: number; easting: number; n: string }>(`
        SELECT
          ST_X(ST_Centroid(geom_wgs84)) AS lon,
          ST_Y(ST_Centroid(geom_wgs84)) AS lat,
          ST_X(ST_Centroid(geom_hk80)) AS easting,
          COUNT(*)::text AS n
        FROM aeris.buildings
        GROUP BY 1, 2, 3
        LIMIT 5
      `);
      assert.ok(res.rows.length > 0);
      for (const row of res.rows) {
        assert.ok(row.lon > 113.8 && row.lon < 114.5, `display centroid lon ${row.lon} is not WGS84`);
        assert.ok(row.lat > 22.2 && row.lat < 22.5, `display centroid lat ${row.lat} is not WGS84`);
        assert.ok(row.easting > 800_000 && row.easting < 870_000, `HK80 easting ${row.easting} out of range`);
        assertWgs84(Number(row.lon), Number(row.lat));
      }
    });
  });

  it("Arrow IPC snapshot round-trips PostGIS footprints", async () => {
    const { bytes, meta } = await loadFootprintsIpc();
    assert.equal(meta.authority, "postgis-hk80");
    assert.equal(meta.dualWrite, true);
    assert.equal(meta.sourceSrid, 2326);
    assert.equal(meta.displaySrid, 4326);
    assert.equal(meta.buildingCount, getBuildings().length);
    assert.ok(bytes.byteLength > 1024);
    const decoded = decodeFootprintsIpc(bytes);
    assert.equal(decoded.length, meta.buildingCount);
    assert.ok(decoded.every((row) => row.source_srid === 2326 && row.display_srid === 4326));
    assert.ok(decoded.every((row) => row.geom_hk80_wkt.startsWith("POLYGON")));
    assert.ok(decoded.every((row) => row.centroid_lon > 113.8 && row.centroid_lon < 114.5));
    assert.ok(decoded.every((row) => Number(row.roof_m2) > 80), "PostGIS ST_Area(geom_hk80) roof_m2");
  });

  it("in-memory Arrow encoder matches building count", () => {
    const buildings = getBuildings();
    const ipc = encodeFootprintsIpc(footprintsFromBuildings(buildings));
    const decoded = decodeFootprintsIpc(ipc);
    assert.equal(decoded.length, buildings.length);
    assert.ok(decoded[0].geom_hk80_wkt.includes("POLYGON"));
    const wkt = wgs84RingToHk80Wkt(buildings[0].geometry.coordinates[0]);
    assert.equal(decoded[0].geom_hk80_wkt, wkt);
  });
});
