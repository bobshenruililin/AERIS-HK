import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  HKO_RH_CSV,
  HKO_TEMP_CSV,
  HKO_WEATHER_API,
  isKowloonRhStation,
  isKowloonTempStation,
  KOWLOON_TEMP_STATIONS,
} from "./stations";
import { buildRollingEnvelope, emptyWarning } from "./envelope";
import type {
  HkoDiurnalEnvelope,
  HkoForecastAnchor,
  HkoLiveSnapshot,
  HkoRingSample,
  HkoStationReading,
  HkoWarningState,
} from "./types";

const RING_PATH = "/tmp/aeris-hko-ring.json";
const FETCH_MS = 9000;
let memoryRing: HkoRingSample[] = [];
let lastEnvelope: HkoDiurnalEnvelope | null = null;
let lastPullMs = 0;

interface WarnsumEntry {
  name?: string;
  code?: string;
  actionCode?: string;
  issueTime?: string;
  updateTime?: string;
}

function hktHourFromMs(ms: number): number {
  const hkt = new Date(ms + 8 * 3600 * 1000);
  return hkt.getUTCHours() + hkt.getUTCMinutes() / 60;
}

function parseCsvDatetime(raw: string): number | null {
  if (!/^\d{12}$/.test(raw)) return null;
  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(4, 6));
  const day = Number(raw.slice(6, 8));
  const hour = Number(raw.slice(8, 10));
  const minute = Number(raw.slice(10, 12));
  return Date.UTC(year, month - 1, day, hour - 8, minute, 0);
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_MS),
    headers: { Accept: "text/csv, application/json;q=0.9, */*;q=0.8" },
  });
  if (!res.ok) {
    throw new Error(`${url} → HTTP ${res.status}`);
  }
  return res.text();
}

async function fetchJson<T>(url: string): Promise<T> {
  const text = await fetchText(url);
  return JSON.parse(text) as T;
}

function parseCsvMap(text: string, valueKey: "temp" | "rh"): Map<string, number> {
  const map = new Map<string, number>();
  const lines = text.trim().split(/\r?\n/);
  for (let i = 1; i < lines.length; i += 1) {
    const parts = lines[i].split(",");
    if (parts.length < 3) continue;
    const station = parts[1]?.trim();
    const value = Number(parts[2]);
    if (!station || !Number.isFinite(value)) continue;
    if (valueKey === "temp" && (value < -5 || value > 50)) continue;
    if (valueKey === "rh" && (value < 0 || value > 100)) continue;
    map.set(station, value);
  }
  return map;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function parseWarnsum(en: Record<string, WarnsumEntry>, tc: Record<string, WarnsumEntry>): HkoWarningState {
  const hotEn = en.WHOT;
  const hotTc = tc.WHOT;
  const action = hotEn?.actionCode ?? hotTc?.actionCode ?? null;
  const cancelled = action === "CANCEL" || action === "CANCEL_ALL";
  const active = Boolean(hotEn || hotTc) && !cancelled;
  return {
    veryHotWeatherWarning: active,
    actionCode: action,
    code: hotEn?.code ?? hotTc?.code ?? (active ? "WHOT" : null),
    nameEn: hotEn?.name ?? (active ? "Very Hot Weather Warning" : "No Very Hot Weather Warning"),
    nameZh: hotTc?.name ?? (active ? "酷熱天氣警告" : "沒有酷熱天氣警告"),
    issueTime: hotEn?.issueTime ?? hotTc?.issueTime ?? null,
    updateTime: hotEn?.updateTime ?? hotTc?.updateTime ?? null,
  };
}

function parseForecast(payload: {
  weatherForecast?: Array<{
    forecastDate: string;
    forecastWeather: string;
    forecastMaxtemp?: { value: number };
    forecastMintemp?: { value: number };
    forecastMaxrh?: { value: number };
    forecastMinrh?: { value: number };
  }>;
}): HkoForecastAnchor | null {
  const first = payload.weatherForecast?.[0];
  if (!first) return null;
  return {
    date: first.forecastDate,
    minTempC: first.forecastMintemp?.value ?? 26,
    maxTempC: first.forecastMaxtemp?.value ?? 32,
    minRhPct: first.forecastMinrh?.value ?? 65,
    maxRhPct: first.forecastMaxrh?.value ?? 90,
    weatherEn: first.forecastWeather,
  };
}

function mergeStations(temp: Map<string, number>, rh: Map<string, number>): HkoStationReading[] {
  const names = new Set([...Array.from(temp.keys()), ...Array.from(rh.keys())]);
  const preferred = [...KOWLOON_TEMP_STATIONS, "HK Observatory", "Hong Kong Observatory"];
  const ordered = [
    ...preferred.filter((n) => names.has(n)),
    ...Array.from(names).filter((n) => !preferred.includes(n)),
  ];
  return ordered.map((name) => ({
    name,
    airTempC: temp.has(name) ? temp.get(name)! : null,
    rhPercent: rh.has(name) ? rh.get(name)! : null,
  }));
}

function loadRing(): HkoRingSample[] {
  if (memoryRing.length > 0) return memoryRing;
  try {
    const raw = readFileSync(RING_PATH, "utf8");
    const parsed = JSON.parse(raw) as HkoRingSample[];
    memoryRing = pruneRing(parsed);
  } catch {
    memoryRing = [];
  }
  return memoryRing;
}

function pruneRing(ring: HkoRingSample[]): HkoRingSample[] {
  const cutoff = Date.now() - 26 * 3600 * 1000;
  return ring.filter((s) => s.recordedAtMs >= cutoff).slice(-400);
}

function persistRing(ring: HkoRingSample[]): void {
  memoryRing = pruneRing(ring);
  try {
    mkdirSync(dirname(RING_PATH), { recursive: true });
    writeFileSync(RING_PATH, JSON.stringify(memoryRing));
  } catch {
    // Ephemeral filesystem is optional; in-memory ring still works.
  }
}

export function appendRingSample(sample: HkoRingSample): void {
  const ring = loadRing();
  ring.push(sample);
  persistRing(ring);
}

export async function pullHkoSnapshot(): Promise<HkoLiveSnapshot> {
  const sourcesOk: string[] = [];
  const sourcesFailed: string[] = [];
  const temp = new Map<string, number>();
  const rh = new Map<string, number>();
  let warning = emptyWarning();
  let forecast: HkoForecastAnchor | null = null;

  const tasks: Array<[string, Promise<unknown>]> = [
    [
      "rhrread",
      fetchJson<{
        temperature?: { data?: Array<{ place: string; value: number }> };
        humidity?: { data?: Array<{ place: string; value: number }> };
      }>(`${HKO_WEATHER_API}?dataType=rhrread&lang=en`).then((body) => {
        for (const row of body.temperature?.data ?? []) {
          if (Number.isFinite(row.value)) temp.set(row.place, row.value);
        }
        for (const row of body.humidity?.data ?? []) {
          if (Number.isFinite(row.value)) rh.set(row.place, row.value);
        }
      }),
    ],
    [
      "csv-temp",
      fetchText(HKO_TEMP_CSV).then((text) => {
        for (const [name, value] of Array.from(parseCsvMap(text, "temp"))) temp.set(name, value);
      }),
    ],
    [
      "csv-rh",
      fetchText(HKO_RH_CSV).then((text) => {
        for (const [name, value] of Array.from(parseCsvMap(text, "rh"))) rh.set(name, value);
      }),
    ],
    [
      "warnsum",
      Promise.all([
        fetchJson<Record<string, WarnsumEntry>>(`${HKO_WEATHER_API}?dataType=warnsum&lang=en`),
        fetchJson<Record<string, WarnsumEntry>>(`${HKO_WEATHER_API}?dataType=warnsum&lang=tc`),
      ]).then(([en, tc]) => {
        warning = parseWarnsum(en, tc);
      }),
    ],
    [
      "fnd",
      fetchJson<{
        weatherForecast?: Array<{
          forecastDate: string;
          forecastWeather: string;
          forecastMaxtemp?: { value: number };
          forecastMintemp?: { value: number };
          forecastMaxrh?: { value: number };
          forecastMinrh?: { value: number };
        }>;
      }>(`${HKO_WEATHER_API}?dataType=fnd&lang=en`).then((body) => {
        forecast = parseForecast(body);
      }),
    ],
  ];

  const settled = await Promise.allSettled(
    tasks.map(async ([name, promise]) => {
      await promise;
      sourcesOk.push(name);
    }),
  );
  settled.forEach((result, i) => {
    if (result.status === "rejected") {
      sourcesFailed.push(tasks[i][0]);
    }
  });

  const kowloonTemps = Array.from(temp.entries())
    .filter(([name]) => isKowloonTempStation(name))
    .map(([, v]) => v);
  const kowloonRh = Array.from(rh.entries())
    .filter(([name]) => isKowloonRhStation(name))
    .map(([, v]) => v);
  const fallbackT = mean(Array.from(temp.values()).filter((v) => v > 10 && v < 45));
  const fallbackRh = mean(Array.from(rh.values()).filter((v) => v > 5 && v < 100));

  const kowloonAirTempC = mean(kowloonTemps) ?? fallbackT ?? 29;
  const kowloonRhFrac = (mean(kowloonRh) ?? fallbackRh ?? 75) / 100;

  return {
    pulledAtMs: Date.now(),
    stations: mergeStations(temp, rh).filter(
      (s) => isKowloonTempStation(s.name) || isKowloonRhStation(s.name) || s.name.includes("Observatory"),
    ),
    kowloonAirTempC,
    kowloonRhFrac,
    warning,
    forecast,
    sourcesOk,
    sourcesFailed,
  };
}

export async function ingestHko(options?: {
  force?: boolean;
  webhookSample?: { airTempC: number; rhFrac: number; recordedAtMs?: number };
}): Promise<HkoDiurnalEnvelope> {
  const now = Date.now();
  if (!options?.force && lastEnvelope && now - lastPullMs < 90_000) {
    return lastEnvelope;
  }

  const snapshot = await pullHkoSnapshot();
  appendRingSample({
    recordedAtMs: snapshot.pulledAtMs,
    hourHkt: hktHourFromMs(snapshot.pulledAtMs),
    kowloonAirTempC: snapshot.kowloonAirTempC,
    kowloonRhFrac: snapshot.kowloonRhFrac,
    source: "csv",
  });

  if (options?.webhookSample) {
    const recordedAtMs = options.webhookSample.recordedAtMs ?? now;
    appendRingSample({
      recordedAtMs,
      hourHkt: hktHourFromMs(recordedAtMs),
      kowloonAirTempC: options.webhookSample.airTempC,
      kowloonRhFrac: options.webhookSample.rhFrac,
      source: "webhook",
    });
  }

  const envelope = buildRollingEnvelope({ snapshot, ring: loadRing(), nowMs: now });
  lastEnvelope = envelope;
  lastPullMs = now;
  return envelope;
}

export function getCachedEnvelope(): HkoDiurnalEnvelope | null {
  return lastEnvelope;
}

export function parseCsvDatetimeForTest(raw: string): number | null {
  return parseCsvDatetime(raw);
}
