import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { buildings, hourlyClusterMetrics, simulationRuns } from "../lib/db/schema";
import { buildingToPersistenceRow, BUILDING_COLUMN_KEYS } from "../lib/db/mapping";
import { getBuildings } from "../lib/spatial-data";
import { CLUSTER_IDS } from "../lib/db/types";

describe("Drizzle persistence schema", () => {
  it("declares every required buildings column", () => {
    const cols = getTableColumns(buildings);
    for (const name of [
      "id",
      "osm_id",
      "name_en",
      "name_zh",
      "district",
      "geometry",
      "floor_count",
      "subdivided_flat_pct",
      "elderly_ratio",
      "baseline_ac_watts_sqm",
      "uhi_vulnerability_score",
      "centroid_lon",
      "centroid_lat",
    ]) {
      assert.ok(
        Object.values(cols).some((col) => col.name === name),
        `missing buildings.${name} (keys ${BUILDING_COLUMN_KEYS.join(",")})`,
      );
    }
  });

  it("declares simulation_runs and hourly_cluster_metrics contract columns", () => {
    const runCols = Object.values(getTableColumns(simulationRuns)).map((c) => c.name);
    for (const name of [
      "id",
      "created_at",
      "scenario_name",
      "ambient_temp_c",
      "relative_humidity",
      "wind_speed_ms",
      "ac_failure_rate",
      "policy_modifiers",
      "total_averted_ed_visits",
    ]) {
      assert.ok(runCols.includes(name), `missing simulation_runs.${name}`);
    }
    const hourCols = Object.values(getTableColumns(hourlyClusterMetrics)).map((c) => c.name);
    for (const name of [
      "run_id",
      "timestamp",
      "cluster_id",
      "projected_a_and_e_cat1_3",
      "bed_occupancy_ratio",
      "triage_strain_index",
    ]) {
      assert.ok(hourCols.includes(name), `missing hourly_cluster_metrics.${name}`);
    }
  });

  it("declares composite spatial and timestamp indexes", () => {
    const buildingIdx = getTableConfig(buildings).indexes.map((idx) => idx.config.name);
    const runIdx = getTableConfig(simulationRuns).indexes.map((idx) => idx.config.name);
    const hourIdx = getTableConfig(hourlyClusterMetrics).indexes.map((idx) => idx.config.name);
    for (const name of [
      "buildings_spatial_centroid_idx",
      "buildings_district_spatial_idx",
      "buildings_district_uhi_idx",
    ]) {
      assert.ok(buildingIdx.includes(name), `missing ${name} (${buildingIdx.join(",")})`);
    }
    assert.ok(runIdx.includes("simulation_runs_created_scenario_idx"));
    assert.ok(hourIdx.includes("hourly_cluster_run_ts_idx"));
    assert.ok(hourIdx.includes("hourly_cluster_ts_cluster_idx"));
  });

  it("maps Kowloon West footprints to census-like tenement rows", () => {
    const rows = getBuildings().map(buildingToPersistenceRow);
    assert.ok(rows.length >= 50);
    const peiHo = rows.filter((r) => r.geometry.coordinates[0].some(([lon, lat]) => lon > 114.16 && lat > 22.32));
    assert.ok(peiHo.length > 0);
    for (const row of rows) {
      assert.equal(row.geometry.type, "Polygon");
      assert.ok(row.floorCount >= 4);
      assert.ok(row.subdividedFlatPct >= 0 && row.subdividedFlatPct <= 100);
      assert.ok(row.osmId > 90_000_000);
      assert.ok(row.uhiVulnerabilityScore >= 0);
      assert.ok(row.centroidLon > 114.1 && row.centroidLon < 114.3);
      assert.ok(row.centroidLat > 22.2 && row.centroidLat < 22.4);
    }
  });

  it("restricts cluster ids to CMC / KWH / QEH", () => {
    assert.deepEqual([...CLUSTER_IDS], ["CMC", "KWH", "QEH"]);
  });
});

describe("Neon live snapshot (optional)", () => {
  it("seeds buildings and round-trips a simulation_run when NEON_DATABASE_URL is set", async () => {
    if (!process.env.NEON_DATABASE_URL) {
      return;
    }
    const { seedKowloonWestBuildings, insertSimulationRun, getSimulationSnapshot, countPersistedBuildings } =
      await import("../lib/db/queries");
    const seeded = await seedKowloonWestBuildings();
    assert.equal(seeded.ok, true, seeded.error);
    assert.ok((await countPersistedBuildings()) >= 50);
    const inserted = await insertSimulationRun({
      scenario_name: "schema-contract-test",
      ambient_temp_c: 33.4,
      relative_humidity: 0.72,
      wind_speed_ms: 1.4,
      ac_failure_rate: 0.08,
      policy_modifiers: {
        policy: {
          coolingShelters: 4,
          dhcOutreach: 18,
          coolRoofPercent: 0,
          coolRoofBudgetM2: 0,
          coolRoofTargetIds: [],
          acDeflectionBylaw: false,
        },
        scenarioId: "july-2022-heatwave",
        episodeId: "july-2022",
        hour: 15,
      },
      total_averted_ed_visits: 1.25,
      hourly: CLUSTER_IDS.map((cluster_id) => ({
        timestamp: "2022-07-19T15:00:00+08:00",
        cluster_id,
        projected_a_and_e_cat1_3: 12.4,
        bed_occupancy_ratio: 0.94,
        triage_strain_index: 61,
      })),
    });
    assert.equal(inserted.ok, true, inserted.ok ? "" : inserted.error);
    if (!inserted.ok) return;
    const snap = await getSimulationSnapshot(inserted.id);
    assert.ok(snap);
    assert.equal(snap.scenario_name, "schema-contract-test");
    assert.equal(snap.hourly.length, 3);
    assert.equal(snap.policy_modifiers.scenarioId, "july-2022-heatwave");
  });
});
