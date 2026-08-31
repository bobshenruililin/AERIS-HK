export type HkoHourOrigin = "observed" | "forecast" | "blended";

export interface HkoStationReading {
  name: string;
  airTempC: number | null;
  rhPercent: number | null;
}

export interface HkoWarningState {
  veryHotWeatherWarning: boolean;
  actionCode: string | null;
  code: string | null;
  nameEn: string;
  nameZh: string;
  issueTime: string | null;
  updateTime: string | null;
}

export interface HkoForecastAnchor {
  date: string;
  minTempC: number;
  maxTempC: number;
  minRhPct: number;
  maxRhPct: number;
  weatherEn: string;
}

export interface HkoHourPoint {
  hour: number;
  airTempC: number;
  rhFrac: number;
  origin: HkoHourOrigin;
}

export interface HkoRingSample {
  recordedAtMs: number;
  hourHkt: number;
  kowloonAirTempC: number;
  kowloonRhFrac: number;
  source: "rhrread" | "csv" | "webhook";
}

export interface HkoDiurnalEnvelope {
  generatedAt: string;
  timezone: "Asia/Hong_Kong";
  source: "hko-open-data";
  degraded: boolean;
  degradeReason: string | null;
  nowHour: number;
  kowloonAirTempC: number;
  kowloonRhFrac: number;
  stations: HkoStationReading[];
  warning: HkoWarningState;
  forecast: HkoForecastAnchor | null;
  hours: HkoHourPoint[];
  observedHours: number;
  forecastHours: number;
  blendedHours: number;
}

export interface HkoLiveSnapshot {
  pulledAtMs: number;
  stations: HkoStationReading[];
  kowloonAirTempC: number;
  kowloonRhFrac: number;
  warning: HkoWarningState;
  forecast: HkoForecastAnchor | null;
  sourcesOk: string[];
  sourcesFailed: string[];
}
