import { NextResponse } from "next/server";
import { pollHkoStationsMemoized } from "@/lib/telemetry/hko-feed";

export const runtime = "edge";
export const dynamic = "force-dynamic";

/**
 * Serverless edge poller for Sham Shui Po / King's Park / Kai Tak AWS
 * (air temperature, RH, solar, wind) plus the Kowloon IDW field.
 * Additive to the Node HKO envelope at GET /api/hko/envelope.
 */
export async function GET() {
  try {
    const feed = await pollHkoStationsMemoized();
    return NextResponse.json(feed, {
      headers: {
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "HKO telemetry ingest failed",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
}
