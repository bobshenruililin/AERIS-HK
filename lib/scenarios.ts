/**
 * Instant-load historic and stress scenarios for the Kowloon West twin.
 * Decade episodes (lib/decade.ts) stay untouched — this matrix is an overlay.
 */
import type { HkoDiurnalEnvelope, PolicyState } from "./types";
import type { PhysicsForcing } from "./physics-forcing";
import { mergeForcing } from "./physics-forcing";
import { clamp, lerp, wrapHour } from "./utils";

export type StressScenarioId = "july-2022-heatwave" | "typhoon-subsidence" | "district-blackout";

export interface StressScenario {
  id: StressScenarioId;
  nameEn: string;
  nameZh: string;
  summaryEn: string;
  summaryZh: string;
  /** Optional policy overlay; existing sliders remain reachable. */
  policyPatch: Partial<PolicyState>;
  forcing: PhysicsForcing;
  envelope: {
    peakAirTempC: number;
    troughAirTempC: number;
    peakHour: number;
    troughHour: number;
    nightRh: number;
    dayRh: number;
    forceWhot: boolean;
  };
}

export const STRESS_SCENARIOS: readonly StressScenario[] = [
  {
    id: "july-2022-heatwave",
    nameEn: "July 2022 Historic Heatwave",
    nameZh: "2022年7月歷史熱浪",
    summaryEn:
      "37.4°C record baseline, zero cloud cover, 88% nighttime humidity, extreme midnight AC rejector heat.",
    summaryZh: "37.4°C 紀錄基線、無雲、夜間濕度 88%、午夜空調廢熱極端。",
    policyPatch: {},
    forcing: mergeForcing({
      seaBreezeScale: 1,
      cloudCover: 0,
      nightRhFloor: 0.88,
      midnightAcRejectorBoost: 1.85,
      ozoneIndex: 0.15,
    }),
    envelope: {
      peakAirTempC: 37.4,
      troughAirTempC: 29.6,
      peakHour: 15.1,
      troughHour: 5.2,
      nightRh: 0.88,
      dayRh: 0.58,
      forceWhot: true,
    },
  },
  {
    id: "typhoon-subsidence",
    nameEn: "Typhoon Subsidence Air Trap",
    nameZh: "颱風下沉氣流陷阱",
    summaryEn:
      "Stagnant outer-subsidence airflow before a tropical cyclone, zero sea breeze, severe ozone and particle concentration.",
    summaryZh: "熱帶氣旋外圍下沉、海風為零、臭氧與粒子嚴重累積。",
    policyPatch: {},
    forcing: mergeForcing({
      seaBreezeScale: 0,
      cloudCover: 0.22,
      ozoneIndex: 0.92,
      nightRhFloor: 0.78,
    }),
    envelope: {
      peakAirTempC: 34.1,
      troughAirTempC: 30.4,
      peakHour: 14.6,
      troughHour: 6,
      nightRh: 0.78,
      dayRh: 0.64,
      forceWhot: true,
    },
  },
  {
    id: "district-blackout",
    nameEn: "District Blackout / AC Grid Tripping",
    nameZh: "區域停電 / 空調電網跳掣",
    summaryEn:
      "Catastrophic power failure in Sham Shui Po old tenement blocks; indoor wet-bulb temperatures spike past 36°C within 90 minutes.",
    summaryZh: "深水埗舊唐樓電網崩潰，90 分鐘內室內濕球超過 36°C。",
    policyPatch: { acDeflectionBylaw: false },
    forcing: mergeForcing({
      seaBreezeScale: 0.55,
      acGridFailure: 1,
      blackoutElapsedMin: 90,
      cloudCover: 0.08,
      nightRhFloor: 0.86,
      midnightAcRejectorBoost: 0,
      ozoneIndex: 0.2,
    }),
    envelope: {
      peakAirTempC: 35.2,
      troughAirTempC: 30.1,
      peakHour: 15,
      troughHour: 5,
      nightRh: 0.86,
      dayRh: 0.7,
      forceWhot: true,
    },
  },
] as const;

export function scenarioById(id: string | null | undefined): StressScenario | null {
  if (!id) return null;
  return STRESS_SCENARIOS.find((s) => s.id === id) ?? null;
}

function shapedTempC(hour: number, peak: number, trough: number, peakHour: number, troughHour: number): number {
  const h = wrapHour(hour);
  const span = wrapHour(peakHour - troughHour) || 12;
  const phase = wrapHour(h - troughHour) / span;
  const cosine = 0.5 - 0.5 * Math.cos(Math.min(1, phase) * Math.PI);
  const rising = wrapHour(h - troughHour) <= span;
  if (rising) return lerp(trough, peak, cosine);
  const downSpan = 24 - span;
  const downPhase = wrapHour(h - peakHour) / Math.max(0.5, downSpan);
  return lerp(peak, trough, 0.5 - 0.5 * Math.cos(clamp(downPhase, 0, 1) * Math.PI));
}

function shapedRh(hour: number, nightRh: number, dayRh: number): number {
  const h = wrapHour(hour);
  const night = h >= 21 || h <= 6 ? 1 : h >= 18 ? (h - 18) / 3 : h <= 8 ? (8 - h) / 2 : 0;
  return clamp(lerp(dayRh, nightRh, clamp(night, 0, 1)), 0.25, 0.99);
}

export function applyScenarioEnvelope(
  base: HkoDiurnalEnvelope | null,
  scenario: StressScenario | null,
): HkoDiurnalEnvelope | null {
  if (!scenario) return base;
  const env = scenario.envelope;
  const hours = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    airTempC: shapedTempC(hour, env.peakAirTempC, env.troughAirTempC, env.peakHour, env.troughHour),
    rhFrac: shapedRh(hour, env.nightRh, env.dayRh),
    origin: "blended" as const,
  }));
  const nowHour = base?.nowHour ?? 15;
  const now = hours[Math.round(wrapHour(nowHour)) % 24] ?? hours[15];
  const generatedAt = base?.generatedAt ?? new Date().toISOString();
  return {
    generatedAt,
    timezone: "Asia/Hong_Kong",
    source: "hko-open-data",
    degraded: base?.degraded ?? false,
    degradeReason: base?.degradeReason ?? null,
    nowHour,
    kowloonAirTempC: now.airTempC,
    kowloonRhFrac: now.rhFrac,
    stations: (base?.stations ?? [{ name: "Sham Shui Po", airTempC: now.airTempC, rhPercent: now.rhFrac * 100 }]).map(
      (s) => ({
        ...s,
        airTempC: s.name === "Sham Shui Po" || s.airTempC == null ? now.airTempC : s.airTempC,
        rhPercent: Math.round(now.rhFrac * 100),
      }),
    ),
    warning: {
      veryHotWeatherWarning: env.forceWhot || Boolean(base?.warning.veryHotWeatherWarning),
      actionCode: base?.warning.actionCode ?? "WHOT",
      code: base?.warning.code ?? "WHOT",
      nameEn: env.forceWhot ? "Very Hot Weather Warning" : (base?.warning.nameEn ?? ""),
      nameZh: env.forceWhot ? "酷熱天氣警告" : (base?.warning.nameZh ?? ""),
      issueTime: base?.warning.issueTime ?? generatedAt,
      updateTime: generatedAt,
    },
    forecast: base?.forecast ?? null,
    hours,
    observedHours: 0,
    forecastHours: 0,
    blendedHours: 24,
  };
}

export const POLICY_PRESETS = [
  {
    id: "open-all-shelters",
    nameEn: "Open All 30 Night Shelters",
    nameZh: "開放全部 30 個夜間降溫中心",
    patch: { coolingShelters: 30 } satisfies Partial<PolicyState>,
  },
  {
    id: "max-dhc",
    nameEn: "Max DHC Nurse Dispatch",
    nameZh: "地區康健中心外展 100%",
    patch: { dhcOutreach: 100 } satisfies Partial<PolicyState>,
  },
  {
    id: "extreme-heat-baseline",
    nameEn: "Extreme Heat Baseline",
    nameZh: "極端酷熱基線",
    scenarioId: "july-2022-heatwave" as StressScenarioId,
    patch: {} satisfies Partial<PolicyState>,
  },
] as const;
