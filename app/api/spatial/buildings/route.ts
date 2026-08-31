import { NextResponse } from "next/server";
import { loadBuildingsPayload } from "@/lib/postgis/query";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const payload = await loadBuildingsPayload();
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "private, max-age=15",
        "X-AERIS-Authority": payload.authority,
        "X-AERIS-Source-SRID": "2326",
        "X-AERIS-Display-SRID": "4326",
        "X-AERIS-Dual-Write": String(payload.dualWrite),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Spatial buildings snapshot failed",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
}
