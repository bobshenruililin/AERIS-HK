import type { HospitalCode, DistrictName } from "./types";

export interface HospitalSpec {
  code: HospitalCode;
  nameEn: string;
  nameZh: string;
  clusterLabel: string;
  longitude: number;
  latitude: number;
  edServers: number;
  muPerHour: number;
  staffedAcuteBeds: number;
  baselineOccupancy: number;
  catchmentWeight: Record<DistrictName, number>;
}

export const HOSPITALS: readonly HospitalSpec[] = [
  {
    code: "CMC",
    nameEn: "Caritas Medical Centre",
    nameZh: "明愛醫院",
    clusterLabel: "Kowloon West Cluster",
    longitude: 114.15255,
    latitude: 22.34075,
    edServers: 14,
    muPerHour: 2.35,
    staffedAcuteBeds: 420,
    baselineOccupancy: 0.88,
    catchmentWeight: { "Sham Shui Po": 0.82, "Yau Tsim Mong": 0.18 },
  },
  {
    code: "KWH",
    nameEn: "Kwong Wah Hospital",
    nameZh: "廣華醫院",
    clusterLabel: "Kowloon West Cluster",
    longitude: 114.17255,
    latitude: 22.31535,
    edServers: 16,
    muPerHour: 2.45,
    staffedAcuteBeds: 780,
    baselineOccupancy: 0.91,
    catchmentWeight: { "Sham Shui Po": 0.28, "Yau Tsim Mong": 0.72 },
  },
  {
    code: "QEH",
    nameEn: "Queen Elizabeth Hospital",
    nameZh: "伊利沙伯醫院",
    clusterLabel: "Kowloon Central Cluster — regional overflow receiver for KWC surge",
    longitude: 114.17472,
    latitude: 22.30948,
    edServers: 24,
    muPerHour: 2.55,
    staffedAcuteBeds: 1420,
    baselineOccupancy: 0.93,
    catchmentWeight: { "Sham Shui Po": 0.35, "Yau Tsim Mong": 0.65 },
  },
] as const;

export function hospitalByCode(code: HospitalCode): HospitalSpec {
  const found = HOSPITALS.find((h) => h.code === code);
  if (!found) {
    throw new Error(`Unknown hospital code ${code}`);
  }
  return found;
}
