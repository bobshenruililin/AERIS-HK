import { NextResponse } from "next/server";
import { ingestHaNowcast } from "@/lib/ha/ingest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface IngestBody {
  pull?: boolean;
  occupancy?: unknown;
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
  try {
    const nowcast = await ingestHaNowcast({
      force: true,
      occupancyWebhook: body.occupancy,
    });
    return NextResponse.json({
      ok: true,
      ingestedVia: body.occupancy ? "ha-wait+occupancy-webhook" : "ha-wait+delayed-cms-mock",
      grain: "hospital-aggregate",
      patientIdentifiers: false,
      nowcast,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const privacy = /patient|HKID|identifier/i.test(message);
    return NextResponse.json(
      { error: privacy ? "Rejected non-aggregate payload" : "HA ingest failed", detail: message },
      { status: privacy ? 400 : 502 },
    );
  }
}

export async function GET() {
  const nowcast = await ingestHaNowcast({ force: true });
  return NextResponse.json({
    ok: true,
    ingestedVia: "pull",
    grain: "hospital-aggregate",
    patientIdentifiers: false,
    nowcast,
  });
}
