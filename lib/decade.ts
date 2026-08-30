/**
 * Decade observatory: 2016–2026 Kowloon West heat episodes.
 * Anomalies are relative to the live HKO envelope (today). Cool-roof
 * counterfactuals scale with a Bishai-style relative-risk multiplier:
 * hotter summers avert more admissions from the same locked roofs.
 */
import type { HkoDiurnalEnvelope, HkoHeatStatus } from "./types";

export interface HeatEpisode {
  id: string;
  year: number;
  nameEn: string;
  nameZh: string;
  /** °C added to the live Kowloon envelope. */
  anomalyC: number;
  peakWbgt: number;
  hkoStatus: HkoHeatStatus;
  durationDays: number;
  notesEn: string;
}

export const DECADE_EPISODES: readonly HeatEpisode[] = [
  {
    id: "2016",
    year: 2016,
    nameEn: "2016 WHOT summer",
    nameZh: "2016 酷熱天氣警告季",
    anomalyC: -0.35,
    peakWbgt: 31.4,
    hkoStatus: "VERY_HOT_WEATHER_WARNING",
    durationDays: 18,
    notesEn: "First long WHOT cluster of the decade in Kowloon West tong lau.",
  },
  {
    id: "2017",
    year: 2017,
    nameEn: "2017 monsoon heat",
    nameZh: "2017 季風熱浪",
    anomalyC: -0.15,
    peakWbgt: 31.7,
    hkoStatus: "VERY_HOT_WEATHER_WARNING",
    durationDays: 14,
    notesEn: "Shorter spikes; indoor inertia still overnight in subdivided flats.",
  },
  {
    id: "2018",
    year: 2018,
    nameEn: "2018 May–Aug record run",
    nameZh: "2018 五至八月破紀錄",
    anomalyC: 0.55,
    peakWbgt: 32.6,
    hkoStatus: "EXTREME_HEAT_AMBER",
    durationDays: 26,
    notesEn: "Longest consecutive very-hot days then on record for the territory.",
  },
  {
    id: "2019",
    year: 2019,
    nameEn: "2019 late-season heat",
    nameZh: "2019 季末高溫",
    anomalyC: 0.2,
    peakWbgt: 32.1,
    hkoStatus: "VERY_HOT_WEATHER_WARNING",
    durationDays: 16,
    notesEn: "September carry-over; canyon lag after sunset.",
  },
  {
    id: "2020",
    year: 2020,
    nameEn: "2020 masked indoor trap",
    nameZh: "2020 室內熱陷阱",
    anomalyC: 0.35,
    peakWbgt: 32.3,
    hkoStatus: "EXTREME_HEAT_AMBER",
    durationDays: 21,
    notesEn: "Stay-home period raised indoor occupancy during peak WBGT hours.",
  },
  {
    id: "2021",
    year: 2021,
    nameEn: "2021 wet-bulb summer",
    nameZh: "2021 濕球夏季",
    anomalyC: 0.7,
    peakWbgt: 32.9,
    hkoStatus: "EXTREME_HEAT_AMBER",
    durationDays: 24,
    notesEn: "High RH; evaporative term E in Gagge saturates in deep canyons.",
  },
  {
    id: "2022",
    year: 2022,
    nameEn: "2022 July–Aug extreme",
    nameZh: "2022 七至八月極端",
    anomalyC: 1.15,
    peakWbgt: 33.4,
    hkoStatus: "SPECIAL_HEAT_STRESS_BLACK",
    durationDays: 28,
    notesEn: "Territory-wide extreme heat; KWC A&E Cat 3 waits lengthened.",
  },
  {
    id: "2023",
    year: 2023,
    nameEn: "2023 record heat",
    nameZh: "2023 破紀錄酷熱",
    anomalyC: 1.65,
    peakWbgt: 33.8,
    hkoStatus: "SPECIAL_HEAT_STRESS_BLACK",
    durationDays: 32,
    notesEn: "Hottest year of the decade in the HKO series used here as forcing.",
  },
  {
    id: "2024",
    year: 2024,
    nameEn: "2024 persistent WHOT",
    nameZh: "2024 持續酷熱",
    anomalyC: 1.25,
    peakWbgt: 33.5,
    hkoStatus: "SPECIAL_HEAT_STRESS_BLACK",
    durationDays: 27,
    notesEn: "Multiple WHOT re-issues; night minima stayed above 28°C in SSP.",
  },
  {
    id: "2025",
    year: 2025,
    nameEn: "2025 early-onset heat",
    nameZh: "2025 提早入夏",
    anomalyC: 1.05,
    peakWbgt: 33.2,
    hkoStatus: "EXTREME_HEAT_AMBER",
    durationDays: 23,
    notesEn: "May WHOT; elderly ratio in YTM walk-ups drives CVI.",
  },
  {
    id: "2026",
    year: 2026,
    nameEn: "2026 live envelope",
    nameZh: "2026 實況包絡",
    anomalyC: 0,
    peakWbgt: 32.8,
    hkoStatus: "EXTREME_HEAT_AMBER",
    durationDays: 12,
    notesEn: "Live HKO Open Data — anomaly 0 by definition.",
  },
] as const;

export const CURRENT_EPISODE_ID = "2026";

export function episodeById(id: string): HeatEpisode {
  return DECADE_EPISODES.find((e) => e.id === id) ?? DECADE_EPISODES[DECADE_EPISODES.length - 1];
}

/** Bishai-style RR increment per °C of episode anomaly (cardiovascular heat). */
export const HEAT_RR_PER_C = 0.22;

export function episodeRelativeRisk(episode: HeatEpisode): number {
  return Math.max(0.55, 1 + HEAT_RR_PER_C * episode.anomalyC);
}

export function counterfactualAverted(liveAverted: number, episode: HeatEpisode): number {
  return liveAverted * episodeRelativeRisk(episode);
}

export function decadeCumulativeAverted(liveAverted: number): number {
  return DECADE_EPISODES.reduce((sum, episode) => sum + counterfactualAverted(liveAverted, episode), 0);
}

export function applyEpisodeAnomaly(
  envelope: HkoDiurnalEnvelope | null,
  episode: HeatEpisode,
): HkoDiurnalEnvelope | null {
  if (!envelope) return null;
  const d = episode.anomalyC;
  if (Math.abs(d) < 1e-9) return envelope;
  return {
    ...envelope,
    kowloonAirTempC: envelope.kowloonAirTempC + d,
    hours: envelope.hours.map((h) => ({ ...h, airTempC: h.airTempC + d })),
    stations: envelope.stations.map((s) => ({
      ...s,
      airTempC: s.airTempC == null ? null : s.airTempC + d,
    })),
    warning: {
      ...envelope.warning,
      veryHotWeatherWarning: d >= 0.4 || envelope.warning.veryHotWeatherWarning,
    },
  };
}
