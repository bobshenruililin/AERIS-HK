import { Pool, type PoolClient } from "pg";
import { getDatabaseUrl } from "./config";

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: getDatabaseUrl(),
      max: 6,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 8_000,
    });
  }
  return pool;
}

export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function pingPostgis(): Promise<{ ok: true; version: string; srid2326: boolean } | { ok: false; error: string }> {
  try {
    return await withClient(async (client) => {
      const version = await client.query<{ v: string }>("SELECT PostGIS_Version() AS v");
      const srid = await client.query<{ n: string }>("SELECT COUNT(*)::text AS n FROM spatial_ref_sys WHERE srid = 2326");
      return {
        ok: true as const,
        version: version.rows[0]?.v ?? "unknown",
        srid2326: Number(srid.rows[0]?.n ?? 0) === 1,
      };
    });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
