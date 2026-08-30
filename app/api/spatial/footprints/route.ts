import { NextResponse } from "next/server";
import { ARROW_IPC_CONTENT_TYPE } from "@/lib/arrow-ipc";
import { loadFootprintsIpc } from "@/lib/postgis/query";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const { bytes, meta } = await loadFootprintsIpc();
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": ARROW_IPC_CONTENT_TYPE,
        "Content-Disposition": 'inline; filename="aeris-footprints-hk80.arrow"',
        "Cache-Control": "private, max-age=15",
        "X-AERIS-Authority": meta.authority,
        "X-AERIS-Source-SRID": String(meta.sourceSrid),
        "X-AERIS-Display-SRID": String(meta.displaySrid),
        "X-AERIS-Dual-Write": String(meta.dualWrite),
        "X-AERIS-Building-Count": String(meta.buildingCount),
        "X-AERIS-Arrow-Bytes": String(meta.arrowBytes),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Arrow IPC footprint snapshot failed",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 502 },
    );
  }
}
