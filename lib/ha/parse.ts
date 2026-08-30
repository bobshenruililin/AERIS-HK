import { HOSPITALS } from "../hospitals";
import type { HospitalCode } from "../types";
import { HA_HOSPITAL_NAMES, type CatMixFractions, type HaWaitBoardRow } from "./types";

export function hospitalCodeFromHaName(name: string): HospitalCode | null {
  const entry = (Object.entries(HA_HOSPITAL_NAMES) as Array<[HospitalCode, string]>).find(
    ([, full]) => full.toLowerCase() === name.trim().toLowerCase(),
  );
  return entry ? entry[0] : null;
}

export function parseWaitToMinutes(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (!s || s === "n/a" || s.includes("resuscitation")) return null;
  if (s.includes("less than 15")) return 10;
  if (s === "0 minute" || s === "0 minutes") return 0;
  const hours = s.match(/^(\d+(?:\.\d+)?)\s*hours?$/);
  if (hours) return Number(hours[1]) * 60;
  const mins = s.match(/^(\d+(?:\.\d+)?)\s*minutes?$/);
  if (mins) return Number(mins[1]);
  return null;
}

export function parseHaUpdateTimeMs(raw: string | null | undefined, fallbackMs = Date.now()): number {
  if (!raw) return fallbackMs;
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return fallbackMs;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  let hour = Number(m[4]);
  const minute = Number(m[5]);
  const ap = m[6].toUpperCase();
  if (ap === "AM") hour = hour % 12;
  else hour = (hour % 12) + 12;
  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+08:00`;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : fallbackMs;
}

/** Mean service minutes by triage (HA A&E operational priors, not patient records). */
export const SERVICE_MINUTES = { cat1: 50, cat2: 34, cat3: 20 } as const;

export function mixFromWaitRow(row: HaWaitBoardRow, webhookMix?: CatMixFractions | null): CatMixFractions {
  if (webhookMix) return normalizeMix(webhookMix);
  let p1 = 0.022;
  let p2 = 0.114;
  const resus = (row.t1wt ?? "").toLowerCase().includes("resuscitation") || row.manageT1case === "N/A";
  if (row.manageT1case === "Y" || resus) p1 += 0.028;
  if (row.manageT2case === "Y") p2 += 0.035;
  const t3 = parseWaitToMinutes(row.t3p50);
  if (t3 != null && t3 >= 45) p1 += 0.01;
  return normalizeMix({ p1, p2, p3: 1 - p1 - p2 });
}

export function mixFromRates(cat1PerHour: number, cat2PerHour: number, cat3PerHour: number): CatMixFractions {
  const total = Math.max(1e-6, cat1PerHour + cat2PerHour + cat3PerHour);
  return normalizeMix({
    p1: cat1PerHour / total,
    p2: cat2PerHour / total,
    p3: cat3PerHour / total,
  });
}

export function normalizeMix(mix: CatMixFractions): CatMixFractions {
  const p1 = Math.min(0.18, Math.max(0.008, mix.p1));
  const p2 = Math.min(0.42, Math.max(0.06, mix.p2));
  const rest = Math.max(0.4, 1 - p1 - p2);
  const sum = p1 + p2 + rest;
  return { p1: p1 / sum, p2: p2 / sum, p3: rest / sum };
}

export function calibrateMuFromMix(mix: CatMixFractions): number {
  const tHours =
    mix.p1 * (SERVICE_MINUTES.cat1 / 60) +
    mix.p2 * (SERVICE_MINUTES.cat2 / 60) +
    mix.p3 * (SERVICE_MINUTES.cat3 / 60);
  return 1 / Math.max(0.12, tHours);
}

export function specForCode(code: HospitalCode) {
  const spec = HOSPITALS.find((h) => h.code === code);
  if (!spec) throw new Error(`Unknown hospital ${code}`);
  return spec;
}
