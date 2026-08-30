import { NextResponse } from "next/server";
import { ingestHko } from "@/lib/hko/ingest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface IngestBody {
  pull?: boolean;
  source?: string;
  observed?: {
    airTempC: number;
    rhFrac?: number;
    rhPercent?: number;
    recordedAt?: string;
  };
}

export async function POST(request: Request) {
  let body: IngestBody = { pull: true };
  const text = await request.text();
  if (text.trim()) {
    try {
      body = JSON.parse(text) as IngestBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
  }

  const observed = body.observed;
  const webhookSample =
    observed && Number.isFinite(observed.airTempC)
      ? {
          airTempC: observed.airTempC,
          rhFrac:
            typeof observed.rhFrac === "number"
              ? observed.rhFrac
              : (observed.rhPercent ?? 75) / 100,
          recordedAtMs: observed.recordedAt ? Date.parse(observed.recordedAt) : Date.now(),
        }
      : undefined;

  try {
    const envelope = await ingestHko({ force: true, webhookSample });
    return NextResponse.json({
      ok: true,
      ingestedVia: webhookSample ? "webhook+pull" : "pull",
      source: body.source ?? "hko-open-data",
      envelope,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "HKO webhook ingest failed",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
}

export async function GET() {
  const envelope = await ingestHko({ force: true });
  return NextResponse.json({ ok: true, ingestedVia: "pull", envelope });
}
