import { NextResponse } from "next/server";
import { planQuery } from "@/lib/agent/runtime";
import type { AgentContext } from "@/lib/agent/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { query?: string; context?: Partial<AgentContext> };
    const query = (body.query ?? "").trim();
    if (!query) {
      return NextResponse.json({ error: "query is required" }, { status: 400 });
    }
    const context: AgentContext = {
      hour: Number(body.context?.hour ?? 15),
      scenarioId: body.context?.scenarioId ?? null,
      simId: body.context?.simId ?? null,
      footprintCount: Number(body.context?.footprintCount ?? 168),
      vectorCount: Number(body.context?.vectorCount ?? 24_000),
      districtHint: body.context?.districtHint ?? null,
      hospitalHint: body.context?.hospitalHint ?? null,
    };
    const plan = await planQuery(query, context);
    return NextResponse.json(plan);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "agent failed" },
      { status: 500 },
    );
  }
}
