import { NextResponse } from "next/server";
import { ingestHaNowcast } from "@/lib/ha/ingest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const nowcast = await ingestHaNowcast();
    return NextResponse.json(nowcast, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
        "X-AERIS-HA-Grain": "hospital-aggregate",
        "X-AERIS-Patient-Identifiers": "false",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "HA A&E nowcast failed",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
}
