import type { BuildingFeature, LonLat } from "./types";
import { buildingCentroid } from "./spatial-data";

export interface StreetSpine {
  id: string;
  nameEn: string;
  nameZh: string;
  path: LonLat[];
}

export function streetSpinesFromBuildings(buildings: BuildingFeature[]): StreetSpine[] {
  const groups = new Map<string, BuildingFeature[]>();
  for (const feature of buildings) {
    const key = feature.properties.streetEn;
    const list = groups.get(key) ?? [];
    list.push(feature);
    groups.set(key, list);
  }
  const spines: StreetSpine[] = [];
  for (const [streetEn, feats] of Array.from(groups.entries())) {
    if (feats.length < 2) continue;
    const pts = feats.map((f) => ({
      c: buildingCentroid(f),
      nameZh: f.properties.streetZh,
    }));
    pts.sort((a, b) => a.c[1] - b.c[1] || a.c[0] - b.c[0]);
    spines.push({
      id: streetEn.toLowerCase().replace(/\s+/g, "-"),
      nameEn: streetEn,
      nameZh: pts[0]?.nameZh ?? streetEn,
      path: pts.map((p) => p.c),
    });
  }
  return spines;
}
