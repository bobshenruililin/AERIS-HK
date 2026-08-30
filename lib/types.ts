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
  roofAreaM2: number;
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

export type SpatialAuthority = "postgis-hk80" | "synthetic-seed";

export interface SpatialSnapshotMeta {
  authority: SpatialAuthority;
  sourceSrid: 2326;
  displaySrid: 4326;
  dualWrite: boolean;
  buildingCount: number;
  arrowBytes: number;
  postgisVersion?: string;
  error?: string;
}

export interface SpatialBuildingsPayload {
  authority: SpatialAuthority;
  sourceSrid: 2326;
  displaySrid: 4326;
  dualWrite: boolean;
  postgisVersion?: string;
  collection: BuildingFeatureCollection;
}

export interface PolicyState {
  coolingShelters: number;
  dhcOutreach: number;
  /** District-scale albedo cooling, 0–50. Derived as 50 × selectedRoofM2 / totalRoofM2. */
  coolRoofPercent: number;
  /** Retrofit budget in square metres of roof. */
  coolRoofBudgetM2: number;
  /** Building ids selected by the DuckDB (or greedy) targeting optimiser. */
  coolRoofTargetIds: string[];
  acDeflectionBylaw: boolean;
}

export interface CoolRoofCandidate {
  buildingId: string;
  roofM2: number;
  admissionsAverted: number;
  efficiency: number;
}

export interface CoolRoofPlan {
  selectedIds: string[];
  selectedAreaM2: number;
  budgetM2: number;
  totalRoofM2: number;
  remainingBudgetM2: number;
  districtCoolRoofPercent: number;
  /** Sum of local-only ranking averted (not the full district-cooling impact). */
  predictedAdmissionsAverted: number;
  engine: "exact-knapsack" | "duckdb-wasm" | "greedy-fallback";
  rankEngine: "duckdb-wasm" | "greedy-fallback";
  windowSelectedIds: string[];
  windowAdmissionsAverted: number;
  queryLatencyMs: number;
  ensembleP10?: number;
  ensembleP50?: number;
  ensembleP90?: number;
  ensembleDraws?: number;
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
  skyViewFactor: number;
  canyonAspect: number;
  roofAbsorbedWm2: number;
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
  calibratedMu: number;
  calibratedServers: number;
  occupancySource: "delayed-nowcast" | "model";
  waitCat3P50Minutes: number | null;
  nowcastDelayMinutes: number | null;
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
  hourlyBaselineArrivals: number[];
  hourlyScenarioArrivals: number[];
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
  footprintsLoaded: boolean;
  footprintCount: number;
  arrowIpc: boolean;
}

export const DEFAULT_COOL_ROOF_STOCK_FRACTION = 0.08;

export const BASELINE_POLICY: PolicyState = {
  coolingShelters: 0,
  dhcOutreach: 0,
  coolRoofPercent: 0,
  coolRoofBudgetM2: 0,
  coolRoofTargetIds: [],
  acDeflectionBylaw: false,
};

export const DEFAULT_POLICY: PolicyState = {
  coolingShelters: 4,
  dhcOutreach: 18,
  coolRoofPercent: 0,
  coolRoofBudgetM2: 0,
  coolRoofTargetIds: [],
  acDeflectionBylaw: false,
};

export type { HkoDiurnalEnvelope } from "./hko/types";
