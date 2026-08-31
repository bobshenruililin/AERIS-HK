import type { HospitalCode } from "../types";
import { HOSPITALS } from "../hospitals";
import { delayedCmsOccupancy, OCCUPANCY_LAG_MS } from "./occupancy-mock";
import {
  calibrateMuFromMix,
  hospitalCodeFromHaName,
  mixFromRates,
  mixFromWaitRow,
  parseHaUpdateTimeMs,
  parseWaitToMinutes,
} from "./parse";
import { assertNoPatientIdentifiers, AGGREGATE_WEBHOOK_KEYS, stripUnknownKeys } from "./privacy";
import type {
  CatMixFractions,
  DelayedOccupancySample,
  HaHospitalNowcast,
  HaNowcast,
  HaWaitBoardPayload,
  HaWaitBoardRow,
} from "./types";
import { HA_HOSPITAL_NAMES, HA_WAIT_URL } from "./types";

const FETCH_MS = 9000;
const CACHE_MS = 90_000;
let lastNowcast: HaNowcast | null = null;
let lastPullMs = 0;

const TARGET_CODES: HospitalCode[] = ["CMC", "KWH", "QEH"];

async function fetchWaitBoard(): Promise<{ rows: HaWaitBoardRow[]; updateTime: string | null }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_MS);
  try {
    const res = await fetch(HA_WAIT_URL, {
      signal: ctrl.signal,
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HA wait board HTTP ${res.status}`);
    const body = (await res.json()) as HaWaitBoardPayload;
    assertNoPatientIdentifiers(body, "HA A&E wait board");
    return { rows: body.waitTime ?? [], updateTime: body.updateTime ?? null };
  } finally {
    clearTimeout(timer);
  }
}

function webhookMix(sample: DelayedOccupancySample | undefined): CatMixFractions | null {
  if (!sample) return null;
  return mixFromRates(sample.cat1PerHour, sample.cat2PerHour, sample.cat3PerHour);
}

function buildHospital(
  code: HospitalCode,
  row: HaWaitBoardRow | undefined,
  occupancy: DelayedOccupancySample,
  occupancySource: HaHospitalNowcast["occupancySource"],
  nowMs: number,
): HaHospitalNowcast {
  const spec = HOSPITALS.find((h) => h.code === code)!;
  const mix = mixFromWaitRow(row ?? { hospName: HA_HOSPITAL_NAMES[code] }, webhookMix(occupancy));
  const waitCat1Minutes = parseWaitToMinutes(row?.t1wt);
  const waitCat2Minutes = parseWaitToMinutes(row?.t2wt);
  const waitCat3P50Minutes = parseWaitToMinutes(row?.t3p50);
  const waitCat3P95Minutes = parseWaitToMinutes(row?.t3p95);
  const waitCat45P50Minutes = parseWaitToMinutes(row?.t45p50);
  const occupancyAsOfMs = Date.parse(occupancy.asOf);
  return {
    code,
    nameEn: spec.nameEn,
    nameZh: spec.nameZh,
    waitCat1Minutes,
    waitCat2Minutes,
    waitCat3P50Minutes,
    waitCat3P95Minutes,
    waitCat45P50Minutes,
    managingMultipleResus:
      (row?.t1wt ?? "").toLowerCase().includes("resuscitation") || row?.manageT1case === "N/A",
    mix,
    muPerHour: calibrateMuFromMix(mix),
    occupancyFrac: occupancy.occupancyFrac,
    occupancyAsOf: occupancy.asOf,
    occupancyDelayMinutes: Number.isFinite(occupancyAsOfMs)
      ? Math.max(0, Math.round((nowMs - occupancyAsOfMs) / 60000))
      : Math.round(OCCUPANCY_LAG_MS / 60000),
    occupancySource,
  };
}

export function parseWebhookOccupancy(raw: unknown): DelayedOccupancySample[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new Error("occupancy webhook must be an array of hospital aggregates");
  }
  assertNoPatientIdentifiers(raw, "HA occupancy webhook");
  const out: DelayedOccupancySample[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const stripped = stripUnknownKeys(item as Record<string, unknown>, AGGREGATE_WEBHOOK_KEYS);
    const code = String(stripped.code ?? "") as HospitalCode;
    if (!TARGET_CODES.includes(code)) continue;
    const occupancyFrac = Number(stripped.occupancyFrac);
    const cat1PerHour = Number(stripped.cat1PerHour);
    const cat2PerHour = Number(stripped.cat2PerHour);
    const cat3PerHour = Number(stripped.cat3PerHour);
    if (![occupancyFrac, cat1PerHour, cat2PerHour, cat3PerHour].every(Number.isFinite)) {
      throw new Error(`Incomplete aggregate occupancy for ${code}`);
    }
    out.push({
      code,
      occupancyFrac,
      cat1PerHour,
      cat2PerHour,
      cat3PerHour,
      asOf: typeof stripped.asOf === "string" ? stripped.asOf : new Date(Date.now() - OCCUPANCY_LAG_MS).toISOString(),
    });
  }
  return out;
}

export async function ingestHaNowcast(options?: {
  force?: boolean;
  occupancyWebhook?: unknown;
}): Promise<HaNowcast> {
  const nowMs = Date.now();
  if (!options?.force && lastNowcast && nowMs - lastPullMs < CACHE_MS) {
    return lastNowcast;
  }

  const webhook = parseWebhookOccupancy(options?.occupancyWebhook);
  const webhookByCode = new Map(webhook.map((s) => [s.code, s]));

  let rows: HaWaitBoardRow[] = [];
  let updateTime: string | null = null;
  let degraded = false;
  let degradeReason: string | null = null;
  try {
    const board = await fetchWaitBoard();
    rows = board.rows;
    updateTime = board.updateTime;
  } catch (error) {
    degraded = true;
    degradeReason = error instanceof Error ? error.message : String(error);
  }

  const waitBoardMs = parseHaUpdateTimeMs(updateTime, nowMs);
  const byName = new Map<HospitalCode, HaWaitBoardRow>();
  for (const row of rows) {
    const code = hospitalCodeFromHaName(row.hospName);
    if (code) byName.set(code, row);
  }

  const hospitals = TARGET_CODES.map((code) => {
    const row = byName.get(code);
    const waitCat3 = parseWaitToMinutes(row?.t3p50);
    const waitCat45 = parseWaitToMinutes(row?.t45p50);
    const webhookOcc = webhookByCode.get(code);
    const occupancy =
      webhookOcc ??
      delayedCmsOccupancy({
        code,
        waitCat3Minutes: waitCat3,
        waitCat45Minutes: waitCat45,
        nowMs,
        waitBoardMs,
      });
    return buildHospital(
      code,
      row,
      occupancy,
      webhookOcc ? "delayed-cms-webhook" : "delayed-cms-mock",
      nowMs,
    );
  });

  const nowcast: HaNowcast = {
    generatedAt: new Date(nowMs).toISOString(),
    timezone: "Asia/Hong_Kong",
    source: "ha-opendata-wait+delayed-cms-occupancy",
    grain: "hospital-aggregate",
    patientIdentifiers: false,
    waitBoardAsOf: updateTime,
    waitBoardDelayMinutes: Math.max(0, Math.round((nowMs - waitBoardMs) / 60000)),
    nowHour: ((nowMs + 8 * 3600 * 1000) / 3600_000) % 24,
    degraded,
    degradeReason,
    hospitals,
  };
  assertNoPatientIdentifiers(nowcast, "composed HA nowcast");
  lastNowcast = nowcast;
  lastPullMs = nowMs;
  return nowcast;
}

export function lastHaNowcast(): HaNowcast | null {
  return lastNowcast;
}
