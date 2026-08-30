import { neon, neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle as drizzleHttp } from "drizzle-orm/neon-http";
import { drizzle as drizzleWs } from "drizzle-orm/neon-serverless";
import ws from "ws";
import { getNeonDatabaseUrl } from "../neon-env";
import { aerisPersistenceSchema } from "./schema";

neonConfig.webSocketConstructor = ws;

let httpDb: ReturnType<typeof drizzleHttp<typeof aerisPersistenceSchema>> | null = null;
let wsDb: ReturnType<typeof drizzleWs<typeof aerisPersistenceSchema>> | null = null;
let wsPool: Pool | null = null;
let schemaReady: Promise<{ ok: boolean; error?: string }> | null = null;

const DDL_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS buildings (
    id text PRIMARY KEY,
    osm_id bigint NOT NULL,
    name_en text NOT NULL,
    name_zh text NOT NULL,
    district text NOT NULL,
    geometry jsonb NOT NULL,
    floor_count integer NOT NULL,
    subdivided_flat_pct double precision NOT NULL,
    elderly_ratio double precision NOT NULL,
    baseline_ac_watts_sqm double precision NOT NULL,
    uhi_vulnerability_score double precision NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS simulation_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    scenario_name text NOT NULL,
    ambient_temp_c double precision NOT NULL,
    relative_humidity double precision NOT NULL,
    wind_speed_ms double precision NOT NULL,
    ac_failure_rate double precision NOT NULL,
    policy_modifiers jsonb NOT NULL,
    total_averted_ed_visits double precision NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS hourly_cluster_metrics (
    run_id uuid NOT NULL REFERENCES simulation_runs(id) ON DELETE CASCADE,
    "timestamp" timestamptz NOT NULL,
    cluster_id text NOT NULL CHECK (cluster_id IN ('CMC', 'KWH', 'QEH')),
    projected_a_and_e_cat1_3 double precision NOT NULL,
    bed_occupancy_ratio double precision NOT NULL,
    triage_strain_index double precision NOT NULL,
    PRIMARY KEY (run_id, "timestamp", cluster_id)
  )`,
  `CREATE INDEX IF NOT EXISTS buildings_district_idx ON buildings (district)`,
  `CREATE INDEX IF NOT EXISTS simulation_runs_created_idx ON simulation_runs (created_at DESC)`,
];

export function getDrizzleHttp() {
  const url = getNeonDatabaseUrl();
  if (!url) return null;
  if (!httpDb) {
    httpDb = drizzleHttp(neon(url), { schema: aerisPersistenceSchema });
  }
  return httpDb;
}

export function getDrizzleWs() {
  const url = getNeonDatabaseUrl();
  if (!url) return null;
  if (!wsDb) {
    wsPool = new Pool({ connectionString: url, max: 4 });
    wsDb = drizzleWs({ client: wsPool, schema: aerisPersistenceSchema, ws });
  }
  return wsDb;
}

export function getNeonWsPool(): Pool | null {
  getDrizzleWs();
  return wsPool;
}

export async function ensureAerisPersistenceSchema(): Promise<{ ok: boolean; error?: string }> {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const url = getNeonDatabaseUrl();
    if (!url) return { ok: false, error: "NEON_DATABASE_URL unset" };
    try {
      const sql = neon(url);
      for (const statement of DDL_STATEMENTS) {
        await sql.query(statement);
      }
      return { ok: true };
    } catch (error) {
      schemaReady = null;
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  })();
  return schemaReady;
}
