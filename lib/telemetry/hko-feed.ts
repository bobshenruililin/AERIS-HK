/**
 * Serverless-edge HKO meteorological ingest + Inverse Distance Weighting
 * reconstruction of Kowloon-peninsula microclimate fields.
 *
 * Edge-safe: Web Fetch only. Do not import node:fs, pg, or server-only
 * modules — this file is loaded by `runtime: "edge"` Route Handlers.
 *
 * Stations: Sham Shui Po, King's Park, Kai Tak AWS.
 * Variables: air temperature, relative humidity, solar radiation, wind vector.
 *
 * IDW identity (p = 2, haversine kilometres):
 *   ẑ(x) = Σ d_i^{-p} z_i  /  Σ d_i^{-p}
 * Components with a missing observation are skipped independently.
 */

export const HKO_TEMP_CSV =
  "https://data.weather.gov.hk/weatherAPI/hko_data/regional-weather/latest_1min_temperature.csv";
export const HKO_RH_CSV =
  "https://data.weather.gov.hk/weatherAPI/hko_data/regional-weather/latest_1min_humidity.csv";
export const HKO_WIND_CSV =
  "https://data.weather.gov.hk/weatherAPI/hko_data/regional-weather/latest_10min_wind.csv";
export const HKO_SOLAR_CSV =
  "https://data.weather.gov.hk/weatherAPI/hko_data/regional-weather/latest_1min_solar.csv";

export const IDW_POWER = 2;
export const IDW_COLLAPSE_KM = 1e-6;
const EARTH_RADIUS_KM = 6371.0088;
const FETCH_MS = 8000;
const KMH_TO_MS = 1 / 3.6;

/** Kowloon peninsula bbox used by the continuous IDW field. */
export const KOWLOON_BBOX = {
  minLon: 114.155,
  maxLon: 114.22,
  minLat: 22.297,
  maxLat: 22.338,
} as const;

export const COMPASS_TO_DEG: Record<string, number> = {
  N: 0,
  NNE: 22.5,
  NE: 45,
  ENE: 67.5,
  E: 90,
  ESE: 112.5,
  SE: 135,
  SSE: 157.5,
  S: 180,
  SSW: 202.5,
  SW: 225,
  WSW: 247.5,
  W: 270,
  WNW: 292.5,
  NW: 315,
  NNW: 337.5,
};

export type HkoAwsId = "ssp" | "kp" | "kt";

export interface HkoAwsSpec {
  id: HkoAwsId;
  nameEn: string;
  nameZh: string;
  lon: number;
  lat: number;
  tempNames: readonly string[];
  rhNames: readonly string[];
  windNames: readonly string[];
  solarNames: readonly string[];
}

/**
 * WGS84 AWS positions used by IDW. Sham Shui Po matches the twin look-at;
 * King's Park is the HKO headquarters park; Kai Tak is the runway-park AWS
 * (wind CSV key is "Kai Tak").
 */
export const HKO_AWS_STATIONS: readonly HkoAwsSpec[] = [
  {
    id: "ssp",
    nameEn: "Sham Shui Po",
    nameZh: "深水埗",
    lon: 114.1629,
    lat: 22.3312,
    tempNames: ["Sham Shui Po"],
    rhNames: ["Sham Shui Po"],
    windNames: ["Sham Shui Po"],
    solarNames: [],
  },
  {
    id: "kp",
    nameEn: "King's Park",
    nameZh: "京士柏",
    lon: 114.1728,
    lat: 22.3119,
    tempNames: ["King's Park"],
    rhNames: ["King's Park"],
    windNames: ["King's Park"],
    solarNames: ["King's Park"],
  },
  {
    id: "kt",
    nameEn: "Kai Tak",
    nameZh: "啟德",
    lon: 114.2133,
    lat: 22.3094,
    tempNames: ["Kai Tak Runway Park", "Kai Tak"],
    rhNames: ["Kai Tak Runway Park", "Kai Tak"],
    windNames: ["Kai Tak", "Kai Tak Runway Park"],
    solarNames: [],
  },
] as const;

export interface HkoStationLive {
  id: HkoAwsId;
  nameEn: string;
  nameZh: string;
  lon: number;
  lat: number;
  airTempC: number | null;
  rhFrac: number | null;
  windDirDeg: number | null;
  windSpeedMs: number | null;
  solarWm2: number | null;
  observedAtMs: number | null;
  sources: string[];
}

export interface SpatialWxSample {
  airTempC: number | null;
  rhFrac: number | null;
  windDirDeg: number | null;
  windSpeedMs: number | null;
  solarWm2: number | null;
  weightSum: number;
}

export type SpatialWxLookup = (lon: number, lat: number) => SpatialWxSample | null;

export interface KowloonFieldCell extends SpatialWxSample {
  lon: number;
  lat: number;
}

export interface KowloonMicroclimateField {
  nx: number;
  ny: number;
  bbox: typeof KOWLOON_BBOX;
  power: number;
  cells: KowloonFieldCell[];
}

export interface HkoLiveFeed {
  pulledAtMs: number;
  hourHkt: number;
  timezone: "Asia/Hong_Kong";
  stations: HkoStationLive[];
  kowloonMean: SpatialWxSample;
  field: KowloonMicroclimateField;
  fieldSummary: {
    cellCount: number;
    minAirTempC: number | null;
    maxAirTempC: number | null;
    meanAirTempC: number | null;
    minRhFrac: number | null;
    maxRhFrac: number | null;
  };
  degraded: boolean;
  degradeReason: string | null;
  sourcesOk: string[];
  sourcesFailed: string[];
}

export function compassToDeg(raw: string): number | null {
  const key = raw.trim().toUpperCase();
  if (!key || key === "CALM" || key === "VARIABLE" || key === "N/A" || key === "***") {
    return null;
  }
  const deg = COMPASS_TO_DEG[key];
  return Number.isFinite(deg) ? deg : null;
}

export function kmhToMs(kmh: number): number {
  return kmh * KMH_TO_MS;
}

export function hktHourFromMs(ms: number): number {
  const hkt = new Date(ms + 8 * 3600 * 1000);
  return hkt.getUTCHours() + hkt.getUTCMinutes() / 60;
}

export function parseCsvDatetime(raw: string): number | null {
  if (!/^\d{12}$/.test(raw)) return null;
  const year = Number(raw.slice(0, 4));
  const month = Number(raw.slice(4, 6));
  const day = Number(raw.slice(6, 8));
  const hour = Number(raw.slice(8, 10));
  const minute = Number(raw.slice(10, 12));
  return Date.UTC(year, month - 1, day, hour - 8, minute, 0);
}

export function haversineKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

function splitCsvLine(line: string): string[] {
  return line.split(",").map((part) => part.trim());
}

export function parseKeyedCsv(
  text: string,
  valueIndex: number,
  opts?: { min?: number; max?: number },
): Map<string, { value: number; observedAtMs: number | null }> {
  const map = new Map<string, { value: number; observedAtMs: number | null }>();
  const lines = text.trim().split(/\r?\n/);
  for (let i = 1; i < lines.length; i += 1) {
    const parts = splitCsvLine(lines[i]);
    if (parts.length <= Math.max(2, valueIndex)) continue;
    const observedAtMs = parseCsvDatetime(parts[0] ?? "");
    const station = parts[1] ?? "";
    const value = Number(parts[valueIndex]);
    if (!station || !Number.isFinite(value)) continue;
    if (opts?.min != null && value < opts.min) continue;
    if (opts?.max != null && value > opts.max) continue;
    map.set(station, { value, observedAtMs });
  }
  return map;
}

export interface ParsedWindRow {
  dirDeg: number | null;
  speedMs: number;
  observedAtMs: number | null;
  calm: boolean;
}

export function parseWindCsv(text: string): Map<string, ParsedWindRow> {
  const map = new Map<string, ParsedWindRow>();
  const lines = text.trim().split(/\r?\n/);
  for (let i = 1; i < lines.length; i += 1) {
    const parts = splitCsvLine(lines[i]);
    if (parts.length < 4) continue;
    const observedAtMs = parseCsvDatetime(parts[0] ?? "");
    const station = parts[1] ?? "";
    const dirRaw = parts[2] ?? "";
    const calm = dirRaw.toUpperCase() === "CALM";
    const speedKmh = Number(parts[3]);
    if (!station) continue;
    if (!calm && !Number.isFinite(speedKmh)) continue;
    const speedMs = calm ? 0 : kmhToMs(speedKmh);
    if (!Number.isFinite(speedMs) || speedMs < 0 || speedMs > 80) continue;
    map.set(station, {
      dirDeg: compassToDeg(dirRaw),
      speedMs,
      observedAtMs,
      calm,
    });
  }
  return map;
}

function lookupNumeric(
  map: Map<string, { value: number; observedAtMs: number | null }>,
  names: readonly string[],
): { value: number; observedAtMs: number | null } | null {
  for (const name of names) {
    const hit = map.get(name);
    if (hit) return hit;
  }
  return null;
}

function lookupWind(map: Map<string, ParsedWindRow>, names: readonly string[]): ParsedWindRow | null {
  for (const name of names) {
    const hit = map.get(name);
    if (hit) return hit;
  }
  return null;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function abortAfter(ms: number): AbortSignal {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  if (typeof t === "object" && "unref" in t && typeof t.unref === "function") {
    t.unref();
  }
  return controller.signal;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    cache: "no-store",
    signal: abortAfter(FETCH_MS),
    headers: { Accept: "text/csv, */*;q=0.8" },
  });
  if (!res.ok) {
    throw new Error(`${url} → HTTP ${res.status}`);
  }
  return res.text();
}

function emptyStation(spec: HkoAwsSpec): HkoStationLive {
  return {
    id: spec.id,
    nameEn: spec.nameEn,
    nameZh: spec.nameZh,
    lon: spec.lon,
    lat: spec.lat,
    airTempC: null,
    rhFrac: null,
    windDirDeg: null,
    windSpeedMs: null,
    solarWm2: null,
    observedAtMs: null,
    sources: [],
  };
}

export function mergeAwsStations(args: {
  temp: Map<string, { value: number; observedAtMs: number | null }>;
  rh: Map<string, { value: number; observedAtMs: number | null }>;
  wind: Map<string, ParsedWindRow>;
  solar: Map<string, { value: number; observedAtMs: number | null }>;
}): HkoStationLive[] {
  return HKO_AWS_STATIONS.map((spec) => {
    const station = emptyStation(spec);
    const t = lookupNumeric(args.temp, spec.tempNames);
    const rh = lookupNumeric(args.rh, spec.rhNames);
    const wind = lookupWind(args.wind, spec.windNames);
    const solar = lookupNumeric(args.solar, spec.solarNames);
    if (t) {
      station.airTempC = t.value;
      station.observedAtMs = t.observedAtMs;
      station.sources.push("csv-temp");
    }
    if (rh) {
      station.rhFrac = rh.value / 100;
      station.observedAtMs = station.observedAtMs ?? rh.observedAtMs;
      station.sources.push("csv-rh");
    }
    if (wind) {
      station.windDirDeg = wind.dirDeg;
      station.windSpeedMs = wind.speedMs;
      station.observedAtMs = station.observedAtMs ?? wind.observedAtMs;
      station.sources.push("csv-wind");
    }
    if (solar) {
      station.solarWm2 = solar.value;
      station.observedAtMs = station.observedAtMs ?? solar.observedAtMs;
      station.sources.push("csv-solar");
    }
    return station;
  });
}

function fillStationFallbacks(stations: HkoStationLive[]): HkoStationLive[] {
  const kp = stations.find((s) => s.id === "kp");
  const rhPool = stations.map((s) => s.rhFrac).filter((v): v is number => v != null);
  const rhFallback = mean(rhPool);
  const solarFallback = kp?.solarWm2 ?? null;
  return stations.map((s) => {
    const next = { ...s, sources: [...s.sources] };
    if (next.rhFrac == null && rhFallback != null) {
      next.rhFrac = rhFallback;
      next.sources.push("rh-neighbor");
    }
    if (next.solarWm2 == null && solarFallback != null) {
      next.solarWm2 = solarFallback;
      next.sources.push("solar-kp-broadcast");
    }
    if (next.windSpeedMs == null) {
      const neighbors = stations.filter((n) => n.id !== s.id && n.windSpeedMs != null);
      if (neighbors.length > 0) {
        next.windSpeedMs = mean(neighbors.map((n) => n.windSpeedMs!));
        const dirs = neighbors.filter((n) => n.windDirDeg != null);
        if (dirs.length > 0) {
          next.windDirDeg = mean(dirs.map((n) => n.windDirDeg!));
        }
        next.sources.push("wind-neighbor");
      }
    }
    return next;
  });
}

function idwScalar(
  stations: readonly HkoStationLive[],
  lon: number,
  lat: number,
  pick: (s: HkoStationLive) => number | null,
  power = IDW_POWER,
): { value: number | null; weightSum: number } {
  let num = 0;
  let den = 0;
  for (const station of stations) {
    const z = pick(station);
    if (z == null || !Number.isFinite(z)) continue;
    const d = haversineKm(lon, lat, station.lon, station.lat);
    if (d < IDW_COLLAPSE_KM) {
      return { value: z, weightSum: Number.POSITIVE_INFINITY };
    }
    const w = 1 / d ** power;
    num += w * z;
    den += w;
  }
  return { value: den === 0 ? null : num / den, weightSum: den };
}

/**
 * Reconstruct a continuous microclimate sample at (lon, lat).
 * Temperature, RH, solar, and wind (u/v) are IDW'd independently so a
 * missing Sham Shui Po RH row does not drop the temperature field.
 */
export function idwInterpolate(
  stations: readonly HkoStationLive[],
  lon: number,
  lat: number,
  power = IDW_POWER,
): SpatialWxSample {
  const t = idwScalar(stations, lon, lat, (s) => s.airTempC, power);
  const rh = idwScalar(stations, lon, lat, (s) => s.rhFrac, power);
  const solar = idwScalar(stations, lon, lat, (s) => s.solarWm2, power);
  const speed = idwScalar(stations, lon, lat, (s) => s.windSpeedMs, power);

  let uNum = 0;
  let vNum = 0;
  let uvDen = 0;
  let collapseDir: number | null | undefined;
  for (const station of stations) {
    if (station.windSpeedMs == null || station.windDirDeg == null) continue;
    const d = haversineKm(lon, lat, station.lon, station.lat);
    const rad = (station.windDirDeg * Math.PI) / 180;
    const u = -station.windSpeedMs * Math.sin(rad);
    const v = -station.windSpeedMs * Math.cos(rad);
    if (d < IDW_COLLAPSE_KM) {
      collapseDir = station.windDirDeg;
      break;
    }
    const w = 1 / d ** power;
    uNum += w * u;
    vNum += w * v;
    uvDen += w;
  }
  let windDirDeg: number | null = collapseDir ?? null;
  if (windDirDeg == null && uvDen > 0) {
    const u = uNum / uvDen;
    const v = vNum / uvDen;
    if (u * u + v * v > 1e-12) {
      windDirDeg = (Math.atan2(-u, -v) * 180) / Math.PI;
      if (windDirDeg < 0) windDirDeg += 360;
    }
  }

  return {
    airTempC: t.value,
    rhFrac: rh.value,
    windDirDeg,
    windSpeedMs: speed.value,
    solarWm2: solar.value,
    weightSum: t.weightSum,
  };
}

export function interpolateKowloonField(
  stations: readonly HkoStationLive[],
  nx = 12,
  ny = 8,
  power = IDW_POWER,
): KowloonMicroclimateField {
  const { minLon, maxLon, minLat, maxLat } = KOWLOON_BBOX;
  const cells: KowloonFieldCell[] = [];
  for (let j = 0; j < ny; j += 1) {
    const lat = ny === 1 ? (minLat + maxLat) / 2 : minLat + (j / (ny - 1)) * (maxLat - minLat);
    for (let i = 0; i < nx; i += 1) {
      const lon = nx === 1 ? (minLon + maxLon) / 2 : minLon + (i / (nx - 1)) * (maxLon - minLon);
      cells.push({ lon, lat, ...idwInterpolate(stations, lon, lat, power) });
    }
  }
  return { nx, ny, bbox: KOWLOON_BBOX, power, cells };
}

export function fieldSummary(field: KowloonMicroclimateField): HkoLiveFeed["fieldSummary"] {
  const temps = field.cells.map((c) => c.airTempC).filter((v): v is number => v != null);
  const rhs = field.cells.map((c) => c.rhFrac).filter((v): v is number => v != null);
  return {
    cellCount: field.cells.length,
    minAirTempC: temps.length ? Math.min(...temps) : null,
    maxAirTempC: temps.length ? Math.max(...temps) : null,
    meanAirTempC: mean(temps),
    minRhFrac: rhs.length ? Math.min(...rhs) : null,
    maxRhFrac: rhs.length ? Math.max(...rhs) : null,
  };
}

export function kowloonMeanFromStations(stations: readonly HkoStationLive[]): SpatialWxSample {
  return {
    airTempC: mean(stations.map((s) => s.airTempC).filter((v): v is number => v != null)),
    rhFrac: mean(stations.map((s) => s.rhFrac).filter((v): v is number => v != null)),
    windDirDeg: mean(stations.map((s) => s.windDirDeg).filter((v): v is number => v != null)),
    windSpeedMs: mean(stations.map((s) => s.windSpeedMs).filter((v): v is number => v != null)),
    solarWm2: mean(stations.map((s) => s.solarWm2).filter((v): v is number => v != null)),
    weightSum: stations.length,
  };
}

export function assembleLiveFeed(args: {
  stations: HkoStationLive[];
  sourcesOk: string[];
  sourcesFailed: string[];
  pulledAtMs?: number;
}): HkoLiveFeed {
  const pulledAtMs = args.pulledAtMs ?? Date.now();
  const stations = fillStationFallbacks(args.stations);
  const field = interpolateKowloonField(stations);
  const degraded = args.sourcesOk.length === 0;
  return {
    pulledAtMs,
    hourHkt: hktHourFromMs(pulledAtMs),
    timezone: "Asia/Hong_Kong",
    stations,
    kowloonMean: kowloonMeanFromStations(stations),
    field,
    fieldSummary: fieldSummary(field),
    degraded,
    degradeReason: degraded
      ? args.sourcesFailed.join(", ") || "HKO endpoints unreachable"
      : args.sourcesFailed.length
        ? `Partial ingest: missing ${args.sourcesFailed.join(", ")}`
        : null,
    sourcesOk: args.sourcesOk,
    sourcesFailed: args.sourcesFailed,
  };
}

export async function pollHkoStations(): Promise<HkoLiveFeed> {
  const sourcesOk: string[] = [];
  const sourcesFailed: string[] = [];
  let temp = new Map<string, { value: number; observedAtMs: number | null }>();
  let rh = new Map<string, { value: number; observedAtMs: number | null }>();
  let wind = new Map<string, ParsedWindRow>();
  let solar = new Map<string, { value: number; observedAtMs: number | null }>();

  const tasks: Array<[string, Promise<void>]> = [
    [
      "csv-temp",
      fetchText(HKO_TEMP_CSV).then((text) => {
        temp = parseKeyedCsv(text, 2, { min: -5, max: 50 });
      }),
    ],
    [
      "csv-rh",
      fetchText(HKO_RH_CSV).then((text) => {
        rh = parseKeyedCsv(text, 2, { min: 0, max: 100 });
      }),
    ],
    [
      "csv-wind",
      fetchText(HKO_WIND_CSV).then((text) => {
        wind = parseWindCsv(text);
      }),
    ],
    [
      "csv-solar",
      fetchText(HKO_SOLAR_CSV).then((text) => {
        solar = parseKeyedCsv(text, 2, { min: 0, max: 1600 });
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

  const stations = mergeAwsStations({ temp, rh, wind, solar });
  return assembleLiveFeed({ stations, sourcesOk, sourcesFailed });
}

let memo: { feed: HkoLiveFeed; at: number } | null = null;
const MEMO_MS = 45_000;

export async function pollHkoStationsMemoized(force = false): Promise<HkoLiveFeed> {
  const now = Date.now();
  if (!force && memo && now - memo.at < MEMO_MS) {
    return memo.feed;
  }
  try {
    const feed = await pollHkoStations();
    memo = { feed, at: now };
    return feed;
  } catch (error) {
    if (memo) return { ...memo.feed, degraded: true, degradeReason: String(error) };
    return assembleLiveFeed({
      stations: HKO_AWS_STATIONS.map(emptyStation),
      sourcesOk: [],
      sourcesFailed: ["csv-temp", "csv-rh", "csv-wind", "csv-solar"],
      pulledAtMs: now,
    });
  }
}

export function lookupFromStations(stations: readonly HkoStationLive[]): SpatialWxLookup {
  return (lon, lat) => idwInterpolate(stations, lon, lat);
}
