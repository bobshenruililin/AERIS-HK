import "server-only";
import { Pool } from "pg";

let pool: Pool | null = null;

export function getNeonDatabaseUrl(): string | null {
  const url = process.env.NEON_DATABASE_URL?.trim();
  return url && url.length > 0 ? url : null;
}

export function getNeonClaimUrl(): string | null {
  const url = process.env.NEON_CLAIM_URL?.trim();
  return url && url.length > 0 ? url : null;
}

export function getNeonPool(): Pool | null {
  const url = getNeonDatabaseUrl();
  if (!url) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      max: 4,
      idleTimeoutMillis: 8_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return pool;
}

export async function ensureNeonDecadeSchema(): Promise<{ ok: boolean; error?: string }> {
  const neon = getNeonPool();
  if (!neon) return { ok: false, error: "NEON_DATABASE_URL unset" };
  try {
    await neon.query(`
      CREATE TABLE IF NOT EXISTS aeris_heat_episodes (
        id text PRIMARY KEY,
        year integer NOT NULL,
        name_en text NOT NULL,
        name_zh text NOT NULL,
        anomaly_c double precision NOT NULL,
        peak_wbgt double precision NOT NULL,
        hko_status text NOT NULL,
        duration_days integer NOT NULL,
        notes_en text NOT NULL
      );
      CREATE TABLE IF NOT EXISTS aeris_policy_audit (
        id bigserial PRIMARY KEY,
        at timestamptz NOT NULL DEFAULT now(),
        actor text NOT NULL,
        patch jsonb NOT NULL
      );
    `);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
