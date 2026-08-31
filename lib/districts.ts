import type { DistrictName } from "./types";

export type TwinDistrictId = "sham-shui-po" | "yau-tsim-mong";

export interface TwinDistrict {
  id: TwinDistrictId;
  nameEn: DistrictName;
  nameZh: string;
  lon: number;
  lat: number;
  bbox: { minLon: number; minLat: number; maxLon: number; maxLat: number };
}

/** Kowloon West look-ats used by ⌘K district jumps and the spatial grid. */
export const TWIN_DISTRICTS: TwinDistrict[] = [
  {
    id: "sham-shui-po",
    nameEn: "Sham Shui Po",
    nameZh: "深水埗",
    lon: 114.1629,
    lat: 22.3312,
    bbox: { minLon: 114.155, minLat: 22.324, maxLon: 114.171, maxLat: 22.338 },
  },
  {
    id: "yau-tsim-mong",
    nameEn: "Yau Tsim Mong",
    nameZh: "油尖旺",
    lon: 114.1708,
    lat: 22.3104,
    bbox: { minLon: 114.163, minLat: 22.297, maxLon: 114.182, maxLat: 22.322 },
  },
];
