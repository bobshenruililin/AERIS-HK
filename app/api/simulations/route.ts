import { NextResponse } from "next/server";
import { getNeonClaimUrl } from "@/lib/neon-archive";
import { countPersistedBuildings, insertSimulationRun, listSimulationRuns, seedKowloonWestBuildings } from "@/lib/db/queries";
import { ensureAerisPersistenceSchema } from "@/lib/db/client";
import type { CreateSimulationRequest } from "@/lib/db/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const schema = await ensureAerisPersistenceSchema();
  let buildingCount = 0;
  if (schema.ok) {
    buildingCount = await countPersistedBuildings();
    if (buildingCount === 0) {
      const seeded = await seedKowloonWestBuildings();
      buildingCount = seeded.count;
    }
  }
  const runs = schema.ok ? await listSimulationRuns() : [];
  return NextResponse.json({
    authority: schema.ok ? "neon-drizzle" : "unset",
    neon: schema.ok,
    neonError: schema.error ?? null,
    claimUrl: getNeonClaimUrl(),
    buildingCount,
    runs,
  });
}

export async function POST(req: Request) {
  const body = (await req.json()) as CreateSimulationRequest;
  if (!body?.scenario_name || !body.policy_modifiers || !Array.isArray(body.hourly)) {
    return NextResponse.json({ error: "scenario_name, policy_modifiers, and hourly required" }, { status: 400 });
  }
  const result = await insertSimulationRun(body);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 503 });
  }
  return NextResponse.json({ id: result.id, sim: result.id, url: `?sim=${result.id}` });
}
