import { NextResponse } from "next/server";
import { ingestHk80FromTwin } from "@/lib/postgis/ingest";
import { pingPostgis } from "@/lib/postgis/pool";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  const ping = await pingPostgis();
  if (!ping.ok) {
    return NextResponse.json(
      { error: "PostGIS unreachable", detail: ping.error },
      { status: 503 },
    );
  }
  try {
    const result = await ingestHk80FromTwin();
    return NextResponse.json({
      ok: true,
      postgisVersion: ping.version,
      ...result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "HK80 ingest failed",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
