/**
 * Deterministic NL → tool plan. Used when no LLM key is present and as a
 * schema-valid fallback if the AI SDK call fails. Always returns AgentPlan.
 */
import { HOSPITALS } from "@/lib/hospitals";
import { TWIN_DISTRICTS } from "@/lib/districts";
import { STRESS_SCENARIOS, type StressScenarioId } from "@/lib/scenarios";
import { CITATION_CATALOG } from "./citations";
import {
  AgentPlanSchema,
  type AgentContext,
  type AgentPlan,
  type HospitalClusterId,
  type HotspotMetric,
  type ToolCall,
  type TriageTier,
  type CameraHint,
} from "./tools";

const PEAK_HOUR = 15;
const BATTERY_HOUR = 3;

function districtFromText(q: string): "Sham Shui Po" | "Yau Tsim Mong" {
  if (/yau|tsim|mong|油尖旺|nathan|temple|上海|廟街/i.test(q)) return "Yau Tsim Mong";
  return "Sham Shui Po";
}

function districtLookAt(name: "Sham Shui Po" | "Yau Tsim Mong"): { lon: number; lat: number } {
  const row = TWIN_DISTRICTS.find((d) => d.nameEn === name) ?? TWIN_DISTRICTS[0];
  return { lon: row.lon, lat: row.lat };
}

function hospitalFromText(q: string): HospitalClusterId | null {
  if (/\bkwc\b|kowloon west cluster/i.test(q)) return "KWC";
  if (/\bcmc\b|caritas|明愛/i.test(q)) return "CMC";
  if (/\bkwh\b|kwong wah|廣華/i.test(q)) return "KWH";
  if (/\bqeh\b|queen elizabeth|伊利沙伯/i.test(q)) return "QEH";
  if (/\bpmh\b|princess margaret|瑪嘉烈/i.test(q)) return "PMH";
  return null;
}

function hospitalLookAt(id: HospitalClusterId): { lon: number; lat: number } {
  if (id === "KWC") {
    const cmc = HOSPITALS.find((h) => h.code === "CMC")!;
    const kwh = HOSPITALS.find((h) => h.code === "KWH")!;
    return { lon: (cmc.longitude + kwh.longitude) / 2, lat: (cmc.latitude + kwh.latitude) / 2 };
  }
  const spec = HOSPITALS.find((h) => h.code === id)!;
  return { lon: spec.longitude, lat: spec.latitude };
}

function scenarioFromText(q: string, which: "first" | "second"): StressScenarioId | null {
  const aliases: Array<{ id: StressScenarioId; re: RegExp }> = [
    { id: "subdivided-3am-battery", re: /3\s*am|03:00|battery|劏房|subdivided/i },
    { id: "super-typhoon-heat-surge", re: /super\s*ty|post-?storm|超強/i },
    { id: "district-blackout", re: /blackout|grid trip|停電/i },
    { id: "typhoon-subsidence", re: /subsidence|air trap|下沉/i },
    { id: "july-2022-heatwave", re: /july|2022|heatwave|熱浪/i },
  ];
  const hits: Array<{ id: StressScenarioId; index: number }> = [];
  for (const a of aliases) {
    const m = q.match(a.re);
    if (m && m.index != null) hits.push({ id: a.id, index: m.index });
  }
  hits.sort((x, y) => x.index - y.index);
  const ids = hits.map((h) => h.id);
  if (which === "first") return ids[0] ?? null;
  if (ids.length >= 2) return ids[1];
  if (ids.length === 1) {
    const other = STRESS_SCENARIOS.find((s) => s.id !== ids[0]);
    return other?.id ?? null;
  }
  return null;
}

function numberAfter(q: string, re: RegExp, fallback: number): number {
  const m = q.match(re);
  if (!m) return fallback;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : fallback;
}

function parseHour(q: string): number | null {
  const hm = q.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (!hm) {
    if (/peak|15:00|hottest/i.test(q)) return PEAK_HOUR;
    if (/3\s*am|03:00|night/i.test(q)) return BATTERY_HOUR;
    return null;
  }
  let h = Number(hm[1]);
  const min = hm[2] ? Number(hm[2]) / 60 : 0;
  const ap = (hm[3] ?? "").toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h >= 24) return PEAK_HOUR;
  return h + min;
}

function metricFromText(q: string): HotspotMetric {
  if (/wbgt|wet.?bulb/i.test(q)) return "wbgt";
  if (/indoor|inertia|battery/i.test(q)) return "indoor";
  if (/\bpmv\b|fanger|comfort/i.test(q)) return "pmv";
  if (/occup|bed|arriv/i.test(q)) return "occupancy";
  return "cvi";
}

function tierFromText(q: string, threshold: number): TriageTier {
  if (/critical|black/i.test(q) || threshold >= 85) return "critical";
  if (/high|red/i.test(q) || threshold >= 70) return "high";
  if (/moderate|amber/i.test(q)) return "moderate";
  if (/low/i.test(q)) return "low";
  return threshold >= 70 ? "high" : "moderate";
}

function wantsCompare(q: string): boolean {
  return /compare|versus|\bvs\.?\b|對比|差 overlay|delta/i.test(q);
}

function wantsCapacity(q: string): boolean {
  return /capacit|occup|bed stress|queue|m\/m\/c|erlang|wait/i.test(q) || Boolean(hospitalFromText(q));
}

function wantsHotspot(q: string): boolean {
  return /hotspot|filter|cvi\s*[>≥]|above|critical canyon|where is.*hot/i.test(q);
}

function wantsCounterfactual(q: string): boolean {
  return /counterfactual|what if|cool roof|albedo|ac reduction|cut ac|reduce ac|ambient|penetration|政策/i.test(q);
}

export function parseIntent(query: string, context: AgentContext = { hour: PEAK_HOUR, scenarioId: null, simId: null, footprintCount: 168, vectorCount: 24000 }): AgentPlan {
  const q = query.trim();
  const tools: ToolCall[] = [];
  const citations = new Set<string>(["gagge", "iso-7243-wbgt"]);
  let camera: CameraHint = { lon: 114.1629, lat: 22.3312, hour: context.hour || PEAK_HOUR, target: "district" };
  const district = districtFromText(q);
  const look = districtLookAt(district);

  if (wantsCompare(q)) {
    const a = scenarioFromText(q, "first") ?? "july-2022-heatwave";
    const b = scenarioFromText(q, "second") ?? "district-blackout";
    tools.push({ name: "compare_scenarios", args: { scenario_a_id: a, scenario_b_id: b } });
    citations.add("dlnm-rr");
    citations.add("duckdb-agg");
    camera = { ...look, hour: PEAK_HOUR, target: "district" };
  }

  if (wantsCounterfactual(q) || tools.length === 0 && /roof|ac |ambient|Δt|delta t/i.test(q)) {
    const ac = numberAfter(q, /ac[^0-9]{0,12}(\d+(?:\.\d+)?)\s*%/i, numberAfter(q, /(\d+(?:\.\d+)?)\s*%[^.]{0,12}ac/i, 20));
    let pen = numberAfter(q, /(?:cool[- ]?roof|albedo|penetration)[^0-9]{0,16}(\d+(?:\.\d+)?)/i, 0.4);
    if (pen > 1) pen = pen / 100;
    const ambient = numberAfter(q, /(?:ambient|Δt|delta t|\+t)[^0-9\-+]{0,8}([+-]?\d+(?:\.\d+)?)/i, 0);
    tools.push({
      name: "run_counterfactual",
      args: {
        district,
        ac_reduction_pct: Math.max(0, Math.min(100, ac)),
        cool_roof_penetration: Math.max(0, Math.min(1, pen)),
        ambient_delta: Math.max(-8, Math.min(8, ambient)),
      },
    });
    citations.add("sol-air-eq-3");
    citations.add("knapsack");
    citations.add("duckdb-agg");
    camera = { lon: look.lon, lat: look.lat, hour: /3\s*am|battery/i.test(q) ? BATTERY_HOUR : PEAK_HOUR, target: "district" };
  }

  if (wantsHotspot(q)) {
    const threshold = numberAfter(q, /cvi[^0-9]{0,8}(\d+(?:\.\d+)?)/i, 70);
    const metric = metricFromText(q);
    const triage_tier = tierFromText(q, threshold);
    tools.push({
      name: "focus_hotspot",
      args: { threshold_cvi: threshold, triage_tier, metric },
    });
    citations.add("enu-grid");
    if (metric === "pmv") citations.add("iso-7730-pmv");
    camera = { lon: look.lon, lat: look.lat, hour: parseHour(q) ?? PEAK_HOUR, target: "building" };
  }

  const hosp = hospitalFromText(q);
  if (wantsCapacity(q) && hosp) {
    const hour = parseHour(q) ?? PEAK_HOUR;
    tools.push({
      name: "query_hospital_capacity",
      args: { cluster_id: hosp, hour_of_day: hour },
    });
    citations.add("mmc-erlang");
    const hp = hospitalLookAt(hosp);
    camera = { lon: hp.lon, lat: hp.lat, hour, target: "hospital" };
  }

  if (tools.length === 0) {
    tools.push({
      name: "focus_hotspot",
      args: { threshold_cvi: 70, triage_tier: "high", metric: "cvi" },
    });
    citations.add("enu-grid");
    camera = { lon: look.lon, lat: look.lat, hour: PEAK_HOUR, target: "district" };
  }

  const unique: ToolCall[] = [];
  const seen = new Set<string>();
  for (const tool of tools) {
    if (seen.has(tool.name)) continue;
    seen.add(tool.name);
    unique.push(tool);
  }

  citations.add("neon-run");
  const narrative = buildNarrative(q, unique, context);
  return AgentPlanSchema.parse({
    tools: unique.slice(0, 4),
    narrative,
    citations: Array.from(citations).slice(0, 8),
    camera,
  });
}

function buildNarrative(query: string, tools: ToolCall[], context: AgentContext): string {
  const bits: string[] = [];
  bits.push(`Interpreting “${query.slice(0, 140)}” against the live Kowloon West twin.`);
  for (const tool of tools) {
    if (tool.name === "run_counterfactual") {
      bits.push(
        `Counterfactual on ${tool.args.district}: AC rejector −${tool.args.ac_reduction_pct.toFixed(0)}%, cool-roof penetration ${(tool.args.cool_roof_penetration * 100).toFixed(0)}% of stock, ambient ${tool.args.ambient_delta >= 0 ? "+" : ""}${tool.args.ambient_delta.toFixed(1)}°C. Absorbed roof flux follows [Sol-Air Equation: Eq. 3]; indoor strain is [Gagge two-node: S = M − W − E − R − C] with outdoor heat as [ISO 7243 WBGT]. Targeting uses [Cool-roof 0/1 knapsack] via [DuckDB Footprint Aggregation].`,
      );
    } else if (tool.name === "focus_hotspot") {
      bits.push(
        `Hotspot filter: CVI ≥ ${tool.args.threshold_cvi.toFixed(0)} (${tool.args.triage_tier}) ranked by ${tool.args.metric}. Spatial membership is [ENU SpatialGrid]; vulnerability is [Gagge two-node: S = M − W − E − R − C] folded into CVI.`,
      );
    } else if (tool.name === "query_hospital_capacity") {
      bits.push(
        `${tool.args.cluster_id} occupancy at ${String(Math.floor(tool.args.hour_of_day)).padStart(2, "0")}:${String(Math.round((tool.args.hour_of_day % 1) * 60)).padStart(2, "0")} HKT from [M/M/c Erlang-C] with 120% overflow onto PMH/QEH.`,
      );
    } else if (tool.name === "compare_scenarios") {
      bits.push(
        `Comparing ${tool.args.scenario_a_id} vs ${tool.args.scenario_b_id} at peak hour. Green/red polygons are CVI(B)−CVI(A). Relative risk uses [Bishai DLNM-style RR 0.22/°C]; heat is [ISO 7243 WBGT].`,
      );
    }
  }
  bits.push(
    context.simId
      ? `Snapshot ${context.simId.slice(0, 8)} is [Neon Simulation Run].`
      : `Share the HUD to mint a [Neon Simulation Run] uuid.`,
  );
  return bits.join(" ");
}

export function defaultCitations(): string[] {
  return Object.keys(CITATION_CATALOG);
}
