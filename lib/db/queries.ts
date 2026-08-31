import { desc, eq } from "drizzle-orm";
import { getBuildings } from "../spatial-data";
import { ensureAerisPersistenceSchema, getDrizzleHttp, getDrizzleWs } from "./client";
import { buildings, hourlyClusterMetrics, simulationRuns } from "./schema";
import { buildingToPersistenceRow } from "./mapping";
import type {
  CreateSimulationRequest,
  HourlyClusterMetricDto,
  SimulationRunDto,
  SimulationSnapshotDto,
} from "./types";
import { isClusterId } from "./types";

export async function seedKowloonWestBuildings(): Promise<{
  ok: boolean;
  count: number;
  error?: string;
}> {
  const schema = await ensureAerisPersistenceSchema();
  if (!schema.ok) return { ok: false, count: 0, error: schema.error };
  const db = getDrizzleWs();
  if (!db) return { ok: false, count: 0, error: "NEON_DATABASE_URL unset" };

  const rows = getBuildings().map(buildingToPersistenceRow);
  try {
    await db.transaction(async (tx) => {
      await tx.delete(buildings);
      for (let i = 0; i < rows.length; i += 40) {
        await tx.insert(buildings).values(rows.slice(i, i + 40));
      }
    });
    return { ok: true, count: rows.length };
  } catch (error) {
    return { ok: false, count: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

function toRunDto(row: typeof simulationRuns.$inferSelect): SimulationRunDto {
  return {
    id: row.id,
    created_at: row.createdAt.toISOString(),
    scenario_name: row.scenarioName,
    ambient_temp_c: row.ambientTempC,
    relative_humidity: row.relativeHumidity,
    wind_speed_ms: row.windSpeedMs,
    ac_failure_rate: row.acFailureRate,
    policy_modifiers: row.policyModifiers,
    total_averted_ed_visits: row.totalAvertedEdVisits,
  };
}

export async function listSimulationRuns(limit = 40): Promise<SimulationRunDto[]> {
  const schema = await ensureAerisPersistenceSchema();
  const db = getDrizzleHttp();
  if (!schema.ok || !db) return [];
  const rows = await db.select().from(simulationRuns).orderBy(desc(simulationRuns.createdAt)).limit(limit);
  return rows.map(toRunDto);
}

export async function getSimulationSnapshot(id: string): Promise<SimulationSnapshotDto | null> {
  const schema = await ensureAerisPersistenceSchema();
  const db = getDrizzleHttp();
  if (!schema.ok || !db) return null;
  const [run] = await db.select().from(simulationRuns).where(eq(simulationRuns.id, id)).limit(1);
  if (!run) return null;
  const hourly = await db
    .select()
    .from(hourlyClusterMetrics)
    .where(eq(hourlyClusterMetrics.runId, id));
  return {
    ...toRunDto(run),
    hourly: hourly.map(
      (row): HourlyClusterMetricDto => ({
        timestamp: row.timestamp.toISOString(),
        cluster_id: row.clusterId,
        projected_a_and_e_cat1_3: row.projectedAAndECat13,
        bed_occupancy_ratio: row.bedOccupancyRatio,
        triage_strain_index: row.triageStrainIndex,
      }),
    ),
  };
}

export async function insertSimulationRun(
  body: CreateSimulationRequest,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const schema = await ensureAerisPersistenceSchema();
  if (!schema.ok) return { ok: false, error: schema.error ?? "schema failed" };
  const db = getDrizzleWs();
  if (!db) return { ok: false, error: "NEON_DATABASE_URL unset" };

  const hourly = body.hourly.filter((row) => isClusterId(row.cluster_id));
  try {
    const id = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(simulationRuns)
        .values({
          scenarioName: body.scenario_name,
          ambientTempC: body.ambient_temp_c,
          relativeHumidity: body.relative_humidity,
          windSpeedMs: body.wind_speed_ms,
          acFailureRate: body.ac_failure_rate,
          policyModifiers: body.policy_modifiers,
          totalAvertedEdVisits: body.total_averted_ed_visits,
        })
        .returning({ id: simulationRuns.id });
      const runId = inserted[0]?.id;
      if (!runId) throw new Error("insert simulation_runs returned no id");
      if (hourly.length > 0) {
        await tx.insert(hourlyClusterMetrics).values(
          hourly.map((row) => ({
            runId,
            timestamp: new Date(row.timestamp),
            clusterId: row.cluster_id,
            projectedAAndECat13: row.projected_a_and_e_cat1_3,
            bedOccupancyRatio: row.bed_occupancy_ratio,
            triageStrainIndex: row.triage_strain_index,
          })),
        );
      }
      return runId;
    });
    return { ok: true, id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function countPersistedBuildings(): Promise<number> {
  const db = getDrizzleHttp();
  if (!db) return 0;
  const rows = await db.select({ id: buildings.id }).from(buildings);
  return rows.length;
}
