/**
 * Apply a validated AgentPlan to HUD state. Client-safe — no AI SDK, no pg.
 */
import { classifyCvi, evaluateBuildingAtHour } from "@/lib/epidemiology-engine";
import { HOSPITALS } from "@/lib/hospitals";
import { TWIN_DISTRICTS } from "@/lib/districts";
import { applyScenarioEnvelope, scenarioById, type StressScenarioId } from "@/lib/scenarios";
import { DEFAULT_PHYSICS_FORCING } from "@/lib/physics-forcing";
import { TWIN_LOOKAT_EVENT } from "@/lib/twin-camera";
import type {
  BuildingFeature,
  BuildingHourState,
  DistrictName,
  HospitalCode,
  HkoDiurnalEnvelope,
  PolicyState,
  SystemHourSnapshot,
} from "@/lib/types";
import type { AgentPlan, HotspotMetric, ToolCall } from "./tools";
import type { CitationHighlight } from "./citations";
import { shiftEnvelopeTemp } from "./envelope";

export interface CopilotDiffCell {
  buildingId: string;
  delta: number;
  cviA: number;
  cviB: number;
  indoorDelta: number;
}

export interface CopilotSpatialState {
  district: DistrictName | null;
  cviMin: number | null;
  triageTier: string | null;
  metric: HotspotMetric;
  highlightIds: string[];
  diff: CopilotDiffCell[] | null;
  compare: { a: StressScenarioId; b: StressScenarioId } | null;
  citationId: string | null;
  citationHighlight: CitationHighlight | null;
  lastTools: string[];
  lastQuery: string;
}

export const EMPTY_COPILOT: CopilotSpatialState = {
  district: null,
  cviMin: null,
  triageTier: null,
  metric: "cvi",
  highlightIds: [],
  diff: null,
  compare: null,
  citationId: null,
  citationHighlight: null,
  lastTools: [],
  lastQuery: "",
};

export interface CopilotApplyPatch {
  policyPatch: Partial<PolicyState>;
  ambientDeltaC: number;
  hour: number;
  playing: false;
  scenarioId: StressScenarioId | null;
  applyScenario: boolean;
  focusedHospital: HospitalCode | null;
  selectedBuildingId: string | null;
  lookAt: { lon: number; lat: number };
  copilot: CopilotSpatialState;
}

function metricValue(state: BuildingHourState, metric: HotspotMetric): number {
  if (metric === "wbgt") return state.microWbgt;
  if (metric === "indoor") return state.indoorTa;
  if (metric === "pmv") return state.pmv;
  if (metric === "occupancy") return state.aeSurgeCat1 + state.aeSurgeCat2 + state.aeSurgeCat3;
  return state.cvi;
}

/** Green when scenario B is cooler (ΔCVI < 0); red when B is hotter. */
export function copilotDiffRgba(delta: number): [number, number, number, number] {
  const mag = Math.min(190, 55 + Math.abs(delta) * 16);
  if (delta < -0.05) return [16, 185, 129, mag];
  if (delta > 0.05) return [239, 68, 68, mag];
  return [148, 163, 184, 48];
}

export function peakThermalHour(
  buildings: BuildingFeature[],
  cache: Map<string, BuildingHourState>,
  fallback = 15,
): number {
  let bestHour = fallback;
  let best = -1;
  for (let h = 0; h < 24; h += 1) {
    let sum = 0;
    let n = 0;
    for (const b of buildings) {
      const row = cache.get(`${b.properties.id}:${h}`);
      if (!row) continue;
      sum += row.cvi;
      n += 1;
    }
    const mean = n ? sum / n : -1;
    if (mean > best) {
      best = mean;
      bestHour = h;
    }
  }
  return bestHour;
}

export function compareScenarioDiff(
  buildings: BuildingFeature[],
  policy: PolicyState,
  envelope: HkoDiurnalEnvelope | null,
  aId: StressScenarioId,
  bId: StressScenarioId,
  hour: number,
): CopilotDiffCell[] {
  const a = scenarioById(aId);
  const b = scenarioById(bId);
  const envA = applyScenarioEnvelope(envelope, a);
  const envB = applyScenarioEnvelope(envelope, b);
  const forceA = a?.forcing ?? DEFAULT_PHYSICS_FORCING;
  const forceB = b?.forcing ?? DEFAULT_PHYSICS_FORCING;
  return buildings.map((feature) => {
    const sa = evaluateBuildingAtHour(feature, hour, policy, envA, forceA);
    const sb = evaluateBuildingAtHour(feature, hour, policy, envB, forceB);
    return {
      buildingId: feature.properties.id,
      delta: sb.cvi - sa.cvi,
      cviA: sa.cvi,
      cviB: sb.cvi,
      indoorDelta: sb.indoorTa - sa.indoorTa,
    };
  });
}

export function planToPatch(
  plan: AgentPlan,
  args: {
    buildings: BuildingFeature[];
    snapshot: SystemHourSnapshot;
    cache: Map<string, BuildingHourState>;
    policy: PolicyState;
    envelope: HkoDiurnalEnvelope | null;
    totalRoofM2: number;
    query: string;
  },
): CopilotApplyPatch {
  const peak = peakThermalHour(args.buildings, args.cache, plan.camera.hour);
  const copilot: CopilotSpatialState = {
    ...EMPTY_COPILOT,
    lastTools: plan.tools.map((t) => t.name),
    lastQuery: args.query,
  };
  const patch: CopilotApplyPatch = {
    policyPatch: {},
    ambientDeltaC: 0,
    hour: plan.camera.hour || peak,
    playing: false,
    scenarioId: null,
    applyScenario: false,
    focusedHospital: null,
    selectedBuildingId: null,
    lookAt: { lon: plan.camera.lon, lat: plan.camera.lat },
    copilot,
  };

  for (const tool of plan.tools) {
    applyTool(tool, patch, args, peak);
  }
  return patch;
}

function applyTool(
  tool: ToolCall,
  patch: CopilotApplyPatch,
  args: {
    buildings: BuildingFeature[];
    snapshot: SystemHourSnapshot;
    cache: Map<string, BuildingHourState>;
    policy: PolicyState;
    envelope: HkoDiurnalEnvelope | null;
    totalRoofM2: number;
  },
  peak: number,
): void {
  if (tool.name === "run_counterfactual") {
    const { district, ac_reduction_pct, cool_roof_penetration, ambient_delta } = tool.args;
    patch.copilot.district = district;
    patch.ambientDeltaC = ambient_delta;
    patch.policyPatch = {
      ...patch.policyPatch,
      acDeflectionBylaw: ac_reduction_pct >= 5,
      coolRoofBudgetM2: Math.max(0, cool_roof_penetration * args.totalRoofM2),
    };
    const districtBuildings = args.buildings.filter((b) => b.properties.district === district);
    patch.copilot.highlightIds = districtBuildings.map((b) => b.properties.id);
    const look = TWIN_DISTRICTS.find((d) => d.nameEn === district);
    if (look) patch.lookAt = { lon: look.lon, lat: look.lat };
    patch.hour = peak;
  }

  if (tool.name === "focus_hotspot") {
    const { threshold_cvi, triage_tier, metric } = tool.args;
    patch.copilot.cviMin = threshold_cvi;
    patch.copilot.triageTier = triage_tier;
    patch.copilot.metric = metric;
    const ranked = args.snapshot.buildings
      .filter((row) => {
        if (row.cvi < threshold_cvi) return false;
        const tier = classifyCvi(row.cvi);
        const order = ["low", "moderate", "high", "critical"];
        return order.indexOf(tier) >= order.indexOf(triage_tier);
      })
      .sort((a, b) => metricValue(b, metric) - metricValue(a, metric));
    patch.copilot.highlightIds = ranked.map((r) => r.buildingId);
    const top = ranked[0];
    if (top) {
      const feature = args.buildings.find((b) => b.properties.id === top.buildingId);
      patch.selectedBuildingId = top.buildingId;
      if (feature) {
        const ring = feature.geometry.coordinates[0];
        const lon = ring.reduce((s, p) => s + p[0], 0) / ring.length;
        const lat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
        patch.lookAt = { lon, lat };
      }
    }
    patch.hour = peak;
  }

  if (tool.name === "query_hospital_capacity") {
    const { cluster_id, hour_of_day } = tool.args;
    patch.hour = hour_of_day;
    if (cluster_id === "KWC") {
      patch.focusedHospital = "CMC";
      const cmc = HOSPITALS.find((h) => h.code === "CMC")!;
      const kwh = HOSPITALS.find((h) => h.code === "KWH")!;
      patch.lookAt = { lon: (cmc.longitude + kwh.longitude) / 2, lat: (cmc.latitude + kwh.latitude) / 2 };
    } else {
      patch.focusedHospital = cluster_id;
      const spec = HOSPITALS.find((h) => h.code === cluster_id)!;
      patch.lookAt = { lon: spec.longitude, lat: spec.latitude };
    }
    const catchment = args.buildings.filter((b) => {
      const spec = HOSPITALS.find((h) => h.code === (cluster_id === "KWC" ? "CMC" : cluster_id));
      const w = spec?.catchmentWeight[b.properties.district] ?? 0;
      return w >= 0.25;
    });
    patch.copilot.highlightIds = catchment.map((b) => b.properties.id);
    patch.copilot.metric = "occupancy";
  }

  if (tool.name === "compare_scenarios") {
    const { scenario_a_id, scenario_b_id } = tool.args;
    patch.scenarioId = scenario_a_id;
    patch.applyScenario = true;
    patch.hour = peak;
    patch.copilot.compare = { a: scenario_a_id, b: scenario_b_id };
    patch.copilot.diff = compareScenarioDiff(
      args.buildings,
      args.policy,
      args.envelope,
      scenario_a_id,
      scenario_b_id,
      peak,
    );
    const hottest = [...patch.copilot.diff].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
    if (hottest) {
      patch.copilot.highlightIds = patch.copilot.diff
        .filter((d) => Math.abs(d.delta) >= 1)
        .map((d) => d.buildingId);
      const feature = args.buildings.find((b) => b.properties.id === hottest.buildingId);
      if (feature) {
        const ring = feature.geometry.coordinates[0];
        patch.lookAt = {
          lon: ring.reduce((s, p) => s + p[0], 0) / ring.length,
          lat: ring.reduce((s, p) => s + p[1], 0) / ring.length,
        };
      }
    }
  }
}

export function flyTo(lon: number, lat: number): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TWIN_LOOKAT_EVENT, { detail: { lon, lat } }));
}

export { shiftEnvelopeTemp };
