import { NextResponse } from "next/server";
import { buildingsToCityJson } from "@/lib/cityjson";
import { getBuildings } from "@/lib/spatial-data";

export const dynamic = "force-dynamic";

export async function GET() {
  const doc = buildingsToCityJson(getBuildings());
  return NextResponse.json(doc, {
    headers: {
      "X-AERIS-CRS": "EPSG:2326",
      "X-AERIS-CITYJSON": doc.version,
      "X-AERIS-Building-Count": String(Object.keys(doc.CityObjects).length),
    },
  });
}
