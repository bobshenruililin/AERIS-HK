import { clamp, lerp, wrapHour } from "../utils";
import type {
  HkoDiurnalEnvelope,
  HkoForecastAnchor,
  HkoHourOrigin,
  HkoHourPoint,
  HkoLiveSnapshot,
  HkoRingSample,
  HkoWarningState,
} from "./types";

const PEAK_HOUR = 15;
const TROUGH_HOUR = 5;

interface Anchor {
  h: number;
  t: number;
}

function interpolateAnchors(hour: number, anchors: Anchor[]): number {
  if (anchors.length === 0) return 28;
  const sorted = [...anchors].sort((a, b) => a.h - b.h);
  const cycle = [...sorted, { h: sorted[0].h + 24, t: sorted[0].t }];
  const h0 = sorted[0].h;
  const x = wrapHour(hour) < h0 - 1e-9 ? wrapHour(hour) + 24 : wrapHour(hour);
  for (let i = 0; i < cycle.length - 1; i += 1) {
    const a = cycle[i];
    const b = cycle[i + 1];
    if (x >= a.h - 1e-9 && x <= b.h + 1e-9) {
      const span = b.h - a.h;
      const u = span <= 1e-9 ? 0 : (x - a.h) / span;
      return lerp(a.t, b.t, clamp(u, 0, 1));
    }
  }
  return sorted[0].t;
}

function hourDelta(a: number, b: number): number {
  const d = wrapHour(a - b);
  return Math.min(d, 24 - d);
}

function ringAtHour(ring: HkoRingSample[], hour: number): HkoRingSample | null {
  const h = Math.round(wrapHour(hour)) % 24;
  const now = Date.now();
  const matches = ring.filter((s) => {
    if (now - s.recordedAtMs > 26 * 3600 * 1000) return false;
    return Math.round(wrapHour(s.hourHkt)) % 24 === h;
  });
  if (matches.length === 0) return null;
  matches.sort((a, b) => b.recordedAtMs - a.recordedAtMs);
  return matches[0];
}

export function sampleHkoEnvelope(
  envelope: HkoDiurnalEnvelope,
  hour: number,
): { airTempC: number; rhFrac: number; origin: HkoHourOrigin } {
  const h = wrapHour(hour);
  const h0 = Math.floor(h) % 24;
  const h1 = (h0 + 1) % 24;
  const t = h - Math.floor(h);
  const a = envelope.hours[h0] ?? envelope.hours[0];
  const b = envelope.hours[h1] ?? a;
  return {
    airTempC: lerp(a.airTempC, b.airTempC, t),
    rhFrac: lerp(a.rhFrac, b.rhFrac, t),
    origin: t < 0.5 ? a.origin : b.origin,
  };
}

export function emptyWarning(): HkoWarningState {
  return {
    veryHotWeatherWarning: false,
    actionCode: null,
    code: null,
    nameEn: "No Very Hot Weather Warning",
    nameZh: "沒有酷熱天氣警告",
    issueTime: null,
    updateTime: null,
  };
}

export function buildRollingEnvelope(args: {
  snapshot: HkoLiveSnapshot;
  ring: HkoRingSample[];
  nowMs?: number;
}): HkoDiurnalEnvelope {
  const now = args.nowMs ?? Date.now();
  const hkt = new Date(now + 8 * 3600 * 1000);
  const nowHour = hkt.getUTCHours() + hkt.getUTCMinutes() / 60;
  const tNow = args.snapshot.kowloonAirTempC;
  const rhNow = args.snapshot.kowloonRhFrac;
  const forecast: HkoForecastAnchor | null = args.snapshot.forecast;

  const tMax = Math.max(tNow, forecast?.maxTempC ?? tNow + 1.8);
  const tMin = Math.min(tNow, forecast?.minTempC ?? tNow - 2.4);
  const rhMax = clamp((forecast?.maxRhPct ?? rhNow * 100 + 12) / 100, 0.4, 0.98);
  const rhMin = clamp((forecast?.minRhPct ?? rhNow * 100 - 10) / 100, 0.3, 0.9);

  const tempAnchors: Anchor[] = [
    { h: TROUGH_HOUR, t: tMin },
    { h: PEAK_HOUR, t: tMax },
    { h: nowHour, t: tNow },
    { h: TROUGH_HOUR + 24, t: forecast?.minTempC ?? tMin },
  ];
  const rhAnchors: Anchor[] = [
    { h: TROUGH_HOUR, t: rhMax },
    { h: PEAK_HOUR, t: rhMin },
    { h: nowHour, t: rhNow },
    { h: TROUGH_HOUR + 24, t: rhMax },
  ];

  const hours: HkoHourPoint[] = [];
  let observedHours = 0;
  let forecastHours = 0;
  let blendedHours = 0;

  for (let hour = 0; hour < 24; hour += 1) {
    const sample = ringAtHour(args.ring, hour);
    const shapedT = interpolateAnchors(hour, tempAnchors);
    const shapedRh = clamp(interpolateAnchors(hour, rhAnchors), 0.25, 0.99);
    const isFuture = hour > nowHour + 0.51;
    const isNearNow = hourDelta(hour, nowHour) < 0.6;

    if (sample && !isFuture) {
      hours.push({
        hour,
        airTempC: sample.kowloonAirTempC,
        rhFrac: sample.kowloonRhFrac,
        origin: "observed",
      });
      observedHours += 1;
      continue;
    }

    if (isNearNow) {
      hours.push({ hour, airTempC: tNow, rhFrac: rhNow, origin: "observed" });
      observedHours += 1;
      continue;
    }

    const origin: HkoHourOrigin = isFuture ? "forecast" : "blended";
    if (origin === "forecast") forecastHours += 1;
    else blendedHours += 1;
    hours.push({ hour, airTempC: shapedT, rhFrac: shapedRh, origin });
  }

  const failed = args.snapshot.sourcesFailed;
  const degraded = args.snapshot.sourcesOk.length === 0;
  return {
    generatedAt: new Date(now).toISOString(),
    timezone: "Asia/Hong_Kong",
    source: "hko-open-data",
    degraded,
    degradeReason: degraded
      ? failed.join(", ") || "HKO endpoints unreachable"
      : failed.length
        ? `Partial ingest: missing ${failed.join(", ")}`
        : null,
    nowHour,
    kowloonAirTempC: tNow,
    kowloonRhFrac: rhNow,
    stations: args.snapshot.stations,
    warning: args.snapshot.warning,
    forecast,
    hours,
    observedHours,
    forecastHours,
    blendedHours,
  };
}
