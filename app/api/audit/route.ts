import { NextResponse } from "next/server";
import { ensureNeonDecadeSchema, getNeonPool } from "@/lib/neon-archive";

export const dynamic = "force-dynamic";

export async function GET() {
  const schema = await ensureNeonDecadeSchema();
  const neon = getNeonPool();
  if (!schema.ok || !neon) {
    return NextResponse.json({ authority: "session", events: [], neon: false, error: schema.error ?? null });
  }
  const result = await neon.query<{ at: string; actor: string; patch: unknown }>(
    "SELECT at, actor, patch FROM aeris_policy_audit ORDER BY id DESC LIMIT 40",
  );
  return NextResponse.json({
    authority: "neon-claimable",
    neon: true,
    events: result.rows,
  });
}

export async function POST(req: Request) {
  const body = (await req.json()) as { actor?: string; patch?: Record<string, unknown> };
  if (!body.patch || typeof body.patch !== "object") {
    return NextResponse.json({ error: "patch required" }, { status: 400 });
  }
  const schema = await ensureNeonDecadeSchema();
  const neon = getNeonPool();
  if (!schema.ok || !neon) {
    return NextResponse.json({ persisted: false, error: schema.error ?? "no neon" }, { status: 503 });
  }
  await neon.query("INSERT INTO aeris_policy_audit (actor, patch) VALUES ($1, $2::jsonb)", [
    body.actor ?? "mission-control",
    JSON.stringify(body.patch),
  ]);
  return NextResponse.json({ persisted: true });
}
