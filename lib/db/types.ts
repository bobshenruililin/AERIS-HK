import type { HospitalCode, PlaybackSpeed, PolicyState } from "../types";
import type { StressScenarioId } from "../scenarios";
import type { HudPresetId } from "../hud";

export const CLUSTER_IDS = ["CMC", "KWH", "QEH"] as const;
export type ClusterId = (typeof CLUSTER_IDS)[number];

export interface GeoJsonPolygon {
  type: "Polygon";
  coordinates: number[][][];
}

export interface PolicyModifiers {
  policy: PolicyState;
  scenarioId: StressScenarioId | null;
  episodeId: string;
  hour: number;
  speed?: PlaybackSpeed;
  hudPreset?: HudPresetId;
  forcing?: Record<string, number>;
}

export interface SimulationRunDto {
  id: string;
  created_at: string;
  scenario_name: string;
  ambient_temp_c: number;
  relative_humidity: number;
  wind_speed_ms: number;
  ac_failure_rate: number;
  policy_modifiers: PolicyModifiers;
  total_averted_ed_visits: number;
}

export interface HourlyClusterMetricDto {
  timestamp: string;
  cluster_id: ClusterId;
  projected_a_and_e_cat1_3: number;
  bed_occupancy_ratio: number;
  triage_strain_index: number;
}

export interface SimulationSnapshotDto extends SimulationRunDto {
  hourly: HourlyClusterMetricDto[];
}

export interface CreateSimulationRequest {
  scenario_name: string;
  ambient_temp_c: number;
  relative_humidity: number;
  wind_speed_ms: number;
  ac_failure_rate: number;
  policy_modifiers: PolicyModifiers;
  total_averted_ed_visits: number;
  hourly: HourlyClusterMetricDto[];
}

export function isClusterId(value: string): value is ClusterId {
  return (CLUSTER_IDS as readonly string[]).includes(value);
}

export function isHospitalCluster(code: HospitalCode): code is ClusterId {
  return isClusterId(code);
}
