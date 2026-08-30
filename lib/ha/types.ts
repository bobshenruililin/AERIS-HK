import type { HospitalCode } from "../types";

export const HA_WAIT_URL = "https://www.ha.org.hk/opendata/aed/aedwtdata2-en.json";

export const HA_HOSPITAL_NAMES: Record<HospitalCode, string> = {
  CMC: "Caritas Medical Centre",
  KWH: "Kwong Wah Hospital",
  QEH: "Queen Elizabeth Hospital",
};

export interface CatMixFractions {
  p1: number;
  p2: number;
  p3: number;
}

export interface HaWaitBoardRow {
  hospName: string;
  t1wt?: string;
  manageT1case?: string;
  t2wt?: string;
  manageT2case?: string;
  t3p50?: string;
  t3p95?: string;
  t45p50?: string;
  t45p95?: string;
}

export interface HaWaitBoardPayload {
  waitTime?: HaWaitBoardRow[];
  updateTime?: string;
}

export interface DelayedOccupancySample {
  code: HospitalCode;
  occupancyFrac: number;
  cat1PerHour: number;
  cat2PerHour: number;
  cat3PerHour: number;
  asOf: string;
}

export interface HaHospitalNowcast {
  code: HospitalCode;
  nameEn: string;
  nameZh: string;
  waitCat1Minutes: number | null;
  waitCat2Minutes: number | null;
  waitCat3P50Minutes: number | null;
  waitCat3P95Minutes: number | null;
  waitCat45P50Minutes: number | null;
  managingMultipleResus: boolean;
  mix: CatMixFractions;
  muPerHour: number;
  occupancyFrac: number;
  occupancyAsOf: string;
  occupancyDelayMinutes: number;
  occupancySource: "delayed-cms-mock" | "delayed-cms-webhook";
}

export interface HaNowcast {
  generatedAt: string;
  timezone: "Asia/Hong_Kong";
  source: "ha-opendata-wait+delayed-cms-occupancy";
  grain: "hospital-aggregate";
  patientIdentifiers: false;
  waitBoardAsOf: string | null;
  waitBoardDelayMinutes: number;
  nowHour: number;
  degraded: boolean;
  degradeReason: string | null;
  hospitals: HaHospitalNowcast[];
}
