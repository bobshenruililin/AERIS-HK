/**
 * Structured Spatial Policy Copilot tools.
 * Schemas are the contract for the Vercel AI SDK runtime *and* the
 * deterministic intent parser. Keep this module free of `window` / GPU.
 */
import { z } from "zod";
import type { DistrictName, HospitalCode } from "@/lib/types";
import type { StressScenarioId } from "@/lib/scenarios";

export const DistrictArgSchema = z.enum(["Sham Shui Po", "Yau Tsim Mong"]);
export const HospitalClusterSchema = z.enum(["CMC", "KWH", "QEH", "PMH", "KWC"]);
export const TriageTierSchema = z.enum(["low", "moderate", "high", "critical"]);
export const HotspotMetricSchema = z.enum(["cvi", "wbgt", "indoor", "pmv", "occupancy"]);
export const ScenarioIdSchema = z.enum([
  "july-2022-heatwave",
  "typhoon-subsidence",
  "district-blackout",
  "super-typhoon-heat-surge",
  "subdivided-3am-battery",
]);

export const RunCounterfactualArgsSchema = z.object({
  district: DistrictArgSchema,
  ac_reduction_pct: z.number().min(0).max(100),
  cool_roof_penetration: z.number().min(0).max(1),
  ambient_delta: z.number().min(-8).max(8),
});

export const FocusHotspotArgsSchema = z.object({
  threshold_cvi: z.number().min(0).max(100),
  triage_tier: TriageTierSchema,
  metric: HotspotMetricSchema,
});

export const QueryHospitalCapacityArgsSchema = z.object({
  cluster_id: HospitalClusterSchema,
  hour_of_day: z.number().min(0).max(23.99),
});

export const CompareScenariosArgsSchema = z.object({
  scenario_a_id: ScenarioIdSchema,
  scenario_b_id: ScenarioIdSchema,
});

export const ToolCallSchema = z.discriminatedUnion("name", [
  z.object({ name: z.literal("run_counterfactual"), args: RunCounterfactualArgsSchema }),
  z.object({ name: z.literal("focus_hotspot"), args: FocusHotspotArgsSchema }),
  z.object({ name: z.literal("query_hospital_capacity"), args: QueryHospitalCapacityArgsSchema }),
  z.object({ name: z.literal("compare_scenarios"), args: CompareScenariosArgsSchema }),
]);

export const CameraHintSchema = z.object({
  lon: z.number(),
  lat: z.number(),
  hour: z.number().min(0).max(23.99),
  target: z.enum(["district", "hospital", "building", "cluster"]),
});

export const AgentPlanSchema = z.object({
  tools: z.array(ToolCallSchema).min(1).max(4),
  narrative: z.string().min(1),
  citations: z.array(z.string()).min(1),
  camera: CameraHintSchema,
});

export type DistrictArg = z.infer<typeof DistrictArgSchema>;
export type HospitalClusterId = z.infer<typeof HospitalClusterSchema>;
export type TriageTier = z.infer<typeof TriageTierSchema>;
export type HotspotMetric = z.infer<typeof HotspotMetricSchema>;
export type RunCounterfactualArgs = z.infer<typeof RunCounterfactualArgsSchema>;
export type FocusHotspotArgs = z.infer<typeof FocusHotspotArgsSchema>;
export type QueryHospitalCapacityArgs = z.infer<typeof QueryHospitalCapacityArgsSchema>;
export type CompareScenariosArgs = z.infer<typeof CompareScenariosArgsSchema>;
export type ToolCall = z.infer<typeof ToolCallSchema>;
export type CameraHint = z.infer<typeof CameraHintSchema>;
export type AgentPlan = z.infer<typeof AgentPlanSchema>;

/** OpenAI/Anthropic-style tool definitions (JSON Schema) for the AI SDK. */
export const TOOL_DEFINITIONS = [
  {
    name: "run_counterfactual",
    description:
      "Run a live Gagge/WBGT/CVI counterfactual: district filter, AC rejector reduction, cool-roof penetration (0–1 of roof stock), and ambient ΔT (°C) on the HKO envelope.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        district: { type: "string", enum: ["Sham Shui Po", "Yau Tsim Mong"] },
        ac_reduction_pct: { type: "number", minimum: 0, maximum: 100 },
        cool_roof_penetration: { type: "number", minimum: 0, maximum: 1 },
        ambient_delta: { type: "number", minimum: -8, maximum: 8 },
      },
      required: ["district", "ac_reduction_pct", "cool_roof_penetration", "ambient_delta"],
    },
  },
  {
    name: "focus_hotspot",
    description:
      "Spatial filter: keep footprints at or above a CVI threshold in a triage tier, ranked by cvi | wbgt | indoor | pmv | occupancy. Flies the camera to the hottest canyon.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        threshold_cvi: { type: "number", minimum: 0, maximum: 100 },
        triage_tier: { type: "string", enum: ["low", "moderate", "high", "critical"] },
        metric: { type: "string", enum: ["cvi", "wbgt", "indoor", "pmv", "occupancy"] },
      },
      required: ["threshold_cvi", "triage_tier", "metric"],
    },
  },
  {
    name: "query_hospital_capacity",
    description:
      "Scrub to hour_of_day and report M/M/c occupancy / Cat 1–3 λ for CMC, KWH, QEH, PMH, or the KWC mean. Flies to the cluster.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        cluster_id: { type: "string", enum: ["CMC", "KWH", "QEH", "PMH", "KWC"] },
        hour_of_day: { type: "number", minimum: 0, maximum: 23.99 },
      },
      required: ["cluster_id", "hour_of_day"],
    },
  },
  {
    name: "compare_scenarios",
    description:
      "Evaluate two named stress plates at the peak thermal hour and inject green/red CVI delta polygons (B − A).",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        scenario_a_id: {
          type: "string",
          enum: [
            "july-2022-heatwave",
            "typhoon-subsidence",
            "district-blackout",
            "super-typhoon-heat-surge",
            "subdivided-3am-battery",
          ],
        },
        scenario_b_id: {
          type: "string",
          enum: [
            "july-2022-heatwave",
            "typhoon-subsidence",
            "district-blackout",
            "super-typhoon-heat-surge",
            "subdivided-3am-battery",
          ],
        },
      },
      required: ["scenario_a_id", "scenario_b_id"],
    },
  },
] as const;

export interface AgentContext {
  hour: number;
  scenarioId: StressScenarioId | null;
  simId: string | null;
  footprintCount: number;
  vectorCount: number;
  districtHint?: DistrictName | null;
  hospitalHint?: HospitalCode | null;
}

export const AGENT_SYSTEM_PROMPT = `You are the AERIS-HK Spatial Policy Copilot for Kowloon West (Sham Shui Po / Yau Tsim Mong).
You ONLY emit a JSON object matching the provided schema. Every narrative sentence MUST include at least one square-bracket citation from this catalog:
[Sol-Air Equation: Eq. 3]
[Gagge two-node: S = M − W − E − R − C]
[ISO 7730 Fanger PMV]
[ISO 7243 WBGT]
[DuckDB Footprint Aggregation]
[ENU SpatialGrid]
[Neon Simulation Run]
[M/M/c Erlang-C]
[Bishai DLNM-style RR 0.22/°C]
[Cool-roof 0/1 knapsack]
Never invent a Fiala UTCI polynomial or a Gasparrini DLNM spline. Outdoor heat is ISO 7243 WBGT.
Always pick at least one tool. Camera lon/lat must be inside Hong Kong (114.13–114.19 E, 22.29–22.35 N).
Peak thermal hour is 15.00 HKT unless the query names 3 AM / subdivided battery (use 3.0).`;

export function parseAgentPlan(input: unknown): AgentPlan {
  return AgentPlanSchema.parse(input);
}
