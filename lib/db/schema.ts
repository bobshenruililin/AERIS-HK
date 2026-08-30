import { sql } from "drizzle-orm";
import {
  bigint,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { ClusterId, GeoJsonPolygon, PolicyModifiers } from "./types";

/**
 * CityJSON/CityGML-inspired LOD0 footprints persisted as GeoJSON polygons.
 * Column names match the AERIS-HK persistence contract exactly.
 */
export const buildings = pgTable("buildings", {
  id: text("id").primaryKey(),
  osmId: bigint("osm_id", { mode: "number" }).notNull(),
  nameEn: text("name_en").notNull(),
  nameZh: text("name_zh").notNull(),
  district: text("district").notNull(),
  geometry: jsonb("geometry").$type<GeoJsonPolygon>().notNull(),
  floorCount: integer("floor_count").notNull(),
  subdividedFlatPct: doublePrecision("subdivided_flat_pct").notNull(),
  elderlyRatio: doublePrecision("elderly_ratio").notNull(),
  baselineAcWattsSqm: doublePrecision("baseline_ac_watts_sqm").notNull(),
  uhiVulnerabilityScore: doublePrecision("uhi_vulnerability_score").notNull(),
});

export const simulationRuns = pgTable("simulation_runs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .default(sql`now()`),
  scenarioName: text("scenario_name").notNull(),
  ambientTempC: doublePrecision("ambient_temp_c").notNull(),
  relativeHumidity: doublePrecision("relative_humidity").notNull(),
  windSpeedMs: doublePrecision("wind_speed_ms").notNull(),
  acFailureRate: doublePrecision("ac_failure_rate").notNull(),
  policyModifiers: jsonb("policy_modifiers").$type<PolicyModifiers>().notNull(),
  totalAvertedEdVisits: doublePrecision("total_averted_ed_visits").notNull(),
});

export const hourlyClusterMetrics = pgTable(
  "hourly_cluster_metrics",
  {
    runId: uuid("run_id")
      .notNull()
      .references(() => simulationRuns.id, { onDelete: "cascade" }),
    timestamp: timestamp("timestamp", { withTimezone: true, mode: "date" }).notNull(),
    clusterId: text("cluster_id").$type<ClusterId>().notNull(),
    projectedAAndECat13: doublePrecision("projected_a_and_e_cat1_3").notNull(),
    bedOccupancyRatio: doublePrecision("bed_occupancy_ratio").notNull(),
    triageStrainIndex: doublePrecision("triage_strain_index").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.runId, table.timestamp, table.clusterId] }),
  }),
);

export const aerisPersistenceSchema = {
  buildings,
  simulationRuns,
  hourlyClusterMetrics,
};
