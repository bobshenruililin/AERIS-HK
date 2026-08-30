import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { getNeonDatabaseUrl } from "@/lib/neon-env";
import { ensureAerisPersistenceSchema } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const url = getNeonDatabaseUrl();
  if (!url) {
    return NextResponse.json({ error: "NEON_DATABASE_URL unset" }, { status: 503 });
  }
  await ensureAerisPersistenceSchema();
  const sql = neon(url);
  const coldStart = performance.now();
  await sql.query("SELECT COUNT(*)::int AS n FROM buildings");
  const coldMs = performance.now() - coldStart;
  const warmStart = performance.now();
  await sql.query("SELECT COUNT(*)::int AS n FROM buildings");
  const warmMs = performance.now() - warmStart;
  const joinStart = performance.now();
  await sql.query(
    `SELECT r.scenario_name, m.cluster_id, AVG(m.triage_strain_index) AS strain
     FROM simulation_runs r
     LEFT JOIN hourly_cluster_metrics m ON m.run_id = r.id
     GROUP BY r.scenario_name, m.cluster_id`,
  );
  const joinMs = performance.now() - joinStart;
  return NextResponse.json({
    coldMs,
    warmMs,
    joinMs,
    pooler: url.includes("-pooler"),
  });
}
