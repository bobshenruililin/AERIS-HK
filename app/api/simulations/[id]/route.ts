import { NextResponse } from "next/server";
import { getSimulationSnapshot } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, context: { params: { id: string } }) {
  const snapshot = await getSimulationSnapshot(context.params.id);
  if (!snapshot) {
    return NextResponse.json({ error: "simulation not found" }, { status: 404 });
  }
  return NextResponse.json(snapshot);
}
