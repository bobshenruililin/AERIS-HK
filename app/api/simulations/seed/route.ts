import { NextResponse } from "next/server";
import { seedKowloonWestBuildings } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export async function POST() {
  const result = await seedKowloonWestBuildings();
  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "seed failed" }, { status: 503 });
  }
  return NextResponse.json({ ok: true, count: result.count });
}
