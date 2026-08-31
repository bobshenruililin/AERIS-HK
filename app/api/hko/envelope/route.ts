import { NextResponse } from "next/server";
import { ingestHko } from "@/lib/hko/ingest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const envelope = await ingestHko();
    return NextResponse.json(envelope, {
      headers: {
        "Cache-Control": "public, s-maxage=90, stale-while-revalidate=180",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "HKO ingest failed",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
}
