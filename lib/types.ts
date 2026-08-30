export type DistrictName = "Sham Shui Po" | "Yau Tsim Mong";

export type HospitalCode = "CMC" | "KWH" | "QEH";

export type CviRiskTier = "low" | "moderate" | "high" | "critical";

export type HkoHeatStatus =
  | "NORMAL"
  | "VERY_HOT_WEATHER_WARNING"
  | "EXTREME_HEAT_AMBER"
  | "SPECIAL_HEAT_STRESS_BLACK";

export type PlaybackSpeed = 1 | 2 | 5;

export type RGBA = [number, number, number, number];

export type LonLat = [number, number];

export interface Hk80Coordinate {
  easting: number;
  northing: number;
}

export interface BuildingProperties {
  id: string;
  nameEn: string;
  nameZh: string;
  address: string;
  streetEn: string;
  streetZh: string;
  district: DistrictName;
  height: number;
  subdividedFlatDensity: number;
  elderlyRatio: number;
  povertyIndex: number;
  acAnthropogenicHeat: number;
  ventilationBlockage: number;
  baselineCVDPrevalence: number;
  estimatedResidents: number;
  headingDeg: number;
  hk80: Hk80Coordinate;
}

export interface BuildingFeature {
  type: "Feature";
  id: string;
  geometry: {
    type: "Polygon";
    coordinates: LonLat[][];
  };
  properties: BuildingProperties;
}

export interface BuildingFeatureCollection {
  type: "FeatureCollection";
  crs: {
    type: "name";
    properties: { name: "EPSG:4326" };
  };
  features: BuildingFeature[];
}

export interface PolicyState {
  coolingShelters: number;
  dhcOutreach: number;
  coolRoofPercent: number;
  acDeflectionBylaw: boolean;
}

export interface GaggeNodeState {
  metabolicRate: number;
  externalWork: number;
  evaporativeLoss: number;
  radiativeLoss: number;
  convectiveLoss: number;
  heatStorage: number;
  skinTempC: number;
  coreTempC: number;
  airVelocityMs: number;
}

export interface BuildingHourState {
  buildingId: string;
  hour: number;
  outdoorTa: number;
  indoorTa: number;
  globeTemp: number;
  wetBulbTemp: number;
  canyonWbgt: number;
  indoorWbgt: number;
  microWbgt: number;
  cvi: number;
  cviTier: CviRiskTier;
  gagge: GaggeNodeState;
  thermalLagHours: number;
  cardiovascularStrain: number;
}

export interface TriageMix {
  category1: number;
  category2: number;
  category3: number;
  total: number;
}

export interface QueueMetrics {
  lambda: number;
  mu: number;
  servers: number;
  utilization: number;
  probabilityWait: number;
  queueLength: number;
  waitHours: number;
}

export interface HospitalHourState {
  code: HospitalCode;
  nameEn: string;
  nameZh: string;
  hour: number;
  arrivals: TriageMix;
  edQueue: QueueMetrics;
  bedOccupancy: number;
  bedDeficitPct: number;
  relativeMortalityIndex: number;
}

export interface SystemHourSnapshot {
  hour: number;
  buildings: BuildingHourState[];
  hospitals: HospitalHourState[];
  regionalMeanWbgt: number;
  regionalMeanCvi: number;
  hkoStatus: HkoHeatStatus;
  clusterBedStress: number;
  totalCat13Arrivals: number;
}

export interface PolicyImpact {
  baselineAdmissions24h: number;
  scenarioAdmissions24h: number;
  admissionsAverted: number;
  baselineBedDeficitPct: number;
  scenarioBedDeficitPct: number;
  bedDeficitAvertedPct: number;
  preventableMortalityPer100k: number;
  baselineMortalityIndex: number;
  scenarioMortalityIndex: number;
}

export interface DistrictHourAggregate {
  district: DistrictName;
  hour: number;
  meanCvi: number;
  meanWbgt: number;
  meanIndoorTa: number;
  buildingCount: number;
}

export interface CriticalBuildingRow {
  buildingId: string;
  nameEn: string;
  nameZh: string;
  district: DistrictName;
  hour: number;
  cvi: number;
  microWbgt: number;
  indoorTa: number;
  cviTier: CviRiskTier;
}

export interface DuckDbQueryBundle {
  districtHourly: DistrictHourAggregate[];
  topCritical: CriticalBuildingRow[];
  queryLatencyMs: number;
  engine: "duckdb-wasm" | "columnar-fallback";
}

export const BASELINE_POLICY: PolicyState = {
  coolingShelters: 0,
  dhcOutreach: 0,
  coolRoofPercent: 0,
  acDeflectionBylaw: false,
};

export const DEFAULT_POLICY: PolicyState = {
  coolingShelters: 4,
  dhcOutreach: 18,
  coolRoofPercent: 8,
  acDeflectionBylaw: false,
};
