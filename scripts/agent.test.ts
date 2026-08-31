import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  AgentPlanSchema,
  TOOL_DEFINITIONS,
  parseAgentPlan,
  parseIntent,
  planToPatch,
  peakThermalHour,
  compareScenarioDiff,
  copilotDiffRgba,
  shiftEnvelopeTemp,
  splitCitedText,
  enrichNarrative,
  formatDuckDbCitation,
  formatNeonCitation,
  citationByBracket,
  flyTo,
} from "../lib/agent";
import { getBuildings } from "../lib/spatial-data";
import { DEFAULT_POLICY } from "../lib/types";
import type { HkoDiurnalEnvelope } from "../lib/types";
import { evaluateSystemAtHour, precomputeHourlyCache } from "../lib/epidemiology-engine";

const stubEnvelope: HkoDiurnalEnvelope = {
  generatedAt: "2026-08-30T00:00:00.000Z",
  timezone: "Asia/Hong_Kong",
  source: "hko-open-data",
  degraded: false,
  degradeReason: null,
  nowHour: 15,
  kowloonAirTempC: 33,
  kowloonRhFrac: 0.7,
  stations: [{ name: "Sham Shui Po", airTempC: 33, rhPercent: 70 }],
  warning: {
    veryHotWeatherWarning: false,
    actionCode: null,
    code: null,
    nameEn: "",
    nameZh: "",
    issueTime: null,
    updateTime: null,
  },
  forecast: null,
  hours: Array.from({ length: 24 }, (_, hour) => ({
    hour,
    airTempC: 28 + (hour === 15 ? 6 : 0),
    rhFrac: 0.7,
    origin: "observed" as const,
  })),
  observedHours: 24,
  forecastHours: 0,
  blendedHours: 0,
};

const buildings = getBuildings();
const cache = precomputeHourlyCache(DEFAULT_POLICY, buildings, stubEnvelope);
const snapshot = evaluateSystemAtHour(15, DEFAULT_POLICY, buildings, cache, stubEnvelope);

describe("structured tool definitions", () => {
  it("exports four Zod-backed tools with the contracted argument names", () => {
    assert.deepEqual(
      TOOL_DEFINITIONS.map((t) => t.name),
      ["run_counterfactual", "focus_hotspot", "query_hospital_capacity", "compare_scenarios"],
    );
    const byName = Object.fromEntries(TOOL_DEFINITIONS.map((t) => [t.name, t]));
    assert.deepEqual(byName.run_counterfactual.parameters.required, [
      "district",
      "ac_reduction_pct",
      "cool_roof_penetration",
      "ambient_delta",
    ]);
    assert.deepEqual(byName.focus_hotspot.parameters.required, ["threshold_cvi", "triage_tier", "metric"]);
    assert.deepEqual(byName.query_hospital_capacity.parameters.required, ["cluster_id", "hour_of_day"]);
    assert.deepEqual(byName.compare_scenarios.parameters.required, ["scenario_a_id", "scenario_b_id"]);
  });

  it("rejects an empty tool list", () => {
    assert.throws(() =>
      parseAgentPlan({
        tools: [],
        narrative: "x",
        citations: ["gagge"],
        camera: { lon: 114.16, lat: 22.33, hour: 15, target: "district" },
      }),
    );
  });
});

describe("deterministic intent parser", () => {
  it("routes compare july vs blackout into compare_scenarios in mention order", () => {
    const plan = parseIntent("compare july vs blackout");
    const cmp = plan.tools.find((t) => t.name === "compare_scenarios");
    assert.ok(cmp);
    assert.equal(cmp?.name, "compare_scenarios");
    if (cmp?.name === "compare_scenarios") {
      assert.equal(cmp.args.scenario_a_id, "july-2022-heatwave");
      assert.equal(cmp.args.scenario_b_id, "district-blackout");
    }
    assert.match(plan.narrative, /\[ISO 7243 WBGT\]/);
  });

  it("routes CMC at 15:00 into query_hospital_capacity", () => {
    const plan = parseIntent("CMC at 15:00");
    const q = plan.tools.find((t) => t.name === "query_hospital_capacity");
    assert.ok(q);
    if (q?.name === "query_hospital_capacity") {
      assert.equal(q.args.cluster_id, "CMC");
      assert.equal(q.args.hour_of_day, 15);
    }
    assert.match(plan.narrative, /\[M\/M\/c Erlang-C\]/);
  });

  it("routes hotspot CVI ≥ 70 critical", () => {
    const plan = parseIntent("Focus CVI ≥ 70 critical hotspots");
    const h = plan.tools.find((t) => t.name === "focus_hotspot");
    assert.ok(h);
    if (h?.name === "focus_hotspot") {
      assert.equal(h.args.threshold_cvi, 70);
      assert.equal(h.args.triage_tier, "critical");
      assert.equal(h.args.metric, "cvi");
    }
  });

  it("routes cool-roof counterfactual with AC percent and penetration", () => {
    const plan = parseIntent("What if Sham Shui Po cool-roof 40% and AC −20%");
    const t = plan.tools.find((x) => x.name === "run_counterfactual");
    assert.ok(t);
    if (t?.name === "run_counterfactual") {
      assert.equal(t.args.district, "Sham Shui Po");
      assert.equal(t.args.ac_reduction_pct, 20);
      assert.ok(Math.abs(t.args.cool_roof_penetration - 0.4) < 1e-9);
    }
    assert.match(plan.narrative, /\[Sol-Air Equation: Eq\. 3\]/);
  });
});

describe("plan → HUD patch", () => {
  it("compare_scenarios injects green/red signed CVI diffs and flies the camera", () => {
    const plan = parseIntent("compare july vs blackout");
    const patch = planToPatch(plan, {
      buildings,
      snapshot,
      cache,
      policy: DEFAULT_POLICY,
      envelope: stubEnvelope,
      totalRoofM2: 80_000,
      query: "compare july vs blackout",
    });
    assert.ok(patch.copilot.diff && patch.copilot.diff.length === buildings.length);
    const hotter = patch.copilot.diff!.filter((d) => d.delta > 0.05);
    const cooler = patch.copilot.diff!.filter((d) => d.delta < -0.05);
    assert.ok(hotter.length + cooler.length > 0);
    for (const cell of patch.copilot.diff!) {
      const rgba = copilotDiffRgba(cell.delta);
      if (cell.delta < -0.05) assert.equal(rgba[1], 185);
      if (cell.delta > 0.05) assert.equal(rgba[0], 239);
    }
    assert.equal(patch.playing, false);
    assert.ok(patch.hour >= 0 && patch.hour < 24);
    assert.ok(patch.lookAt.lon > 114.13 && patch.lookAt.lon < 114.19);
  });

  it("run_counterfactual sets AC bylaw, cool-roof budget, and ambient ΔT", () => {
    const plan = parseIntent("What if Sham Shui Po cool-roof 40% and AC −20%");
    const totalRoofM2 = 50_000;
    const patch = planToPatch(plan, {
      buildings,
      snapshot,
      cache,
      policy: DEFAULT_POLICY,
      envelope: stubEnvelope,
      totalRoofM2,
      query: "What if Sham Shui Po cool-roof 40% and AC −20%",
    });
    assert.equal(patch.policyPatch.acDeflectionBylaw, true);
    assert.ok(Math.abs((patch.policyPatch.coolRoofBudgetM2 ?? 0) - 0.4 * totalRoofM2) < 1);
    assert.equal(patch.copilot.district, "Sham Shui Po");
  });

  it("query_hospital_capacity scrubs the requested hour and flies to CMC", () => {
    const plan = parseIntent("CMC at 15:00");
    const patch = planToPatch(plan, {
      buildings,
      snapshot,
      cache,
      policy: DEFAULT_POLICY,
      envelope: stubEnvelope,
      totalRoofM2: 80_000,
      query: "CMC at 15:00",
    });
    assert.equal(patch.hour, 15);
    assert.equal(patch.focusedHospital, "CMC");
    assert.ok(patch.lookAt.lat > 22.29);
  });

  it("focus_hotspot keeps CVI ≥ threshold", () => {
    const plan = parseIntent("Focus CVI ≥ 70 critical hotspots");
    const patch = planToPatch(plan, {
      buildings,
      snapshot,
      cache,
      policy: DEFAULT_POLICY,
      envelope: stubEnvelope,
      totalRoofM2: 80_000,
      query: "Focus CVI ≥ 70 critical hotspots",
    });
    assert.equal(patch.copilot.cviMin, 70);
    for (const id of patch.copilot.highlightIds) {
      const row = snapshot.buildings.find((b) => b.buildingId === id);
      assert.ok(row && row.cvi >= 70);
    }
  });

  it("peakThermalHour prefers the hottest mean CVI hour", () => {
    const peak = peakThermalHour(buildings, cache, 12);
    assert.ok(peak >= 0 && peak <= 23);
  });
});

describe("citations and envelope", () => {
  it("splits Sol-Air / DuckDB / Neon brackets onto clickable specs", () => {
    const parts = splitCitedText(
      "Roof flux [Sol-Air Equation: Eq. 3] from [DuckDB 168 Footprint Aggregation · 24,000 ENU vectors] and [Neon Simulation Run #a8f9].",
    );
    const cites = parts.filter((p) => p.type === "cite");
    assert.equal(cites.length, 3);
    assert.equal(cites[0]?.spec?.id, "sol-air-eq-3");
    assert.equal(cites[1]?.spec?.highlight, "duckdb");
    assert.equal(cites[2]?.spec?.highlight, "neon");
    assert.equal(citationByBracket("Gagge two-node: S = M − W − E − R − C")?.id, "gagge");
  });

  it("uses live footprint/vector counts instead of a fake 12,400", () => {
    const duck = formatDuckDbCitation(168, 24_000);
    assert.match(duck, /168/);
    assert.doesNotMatch(duck, /12,400|12400/);
    const neon = formatNeonCitation("a8f9-xxxx-uuid");
    assert.equal(neon, "[Neon Simulation Run #a8f9]");
    const enriched = enrichNarrative("See [DuckDB Footprint Aggregation] and [Neon Simulation Run].", {
      simId: "a8f9-1111",
      footprints: 168,
      vectors: 24_000,
    });
    assert.match(enriched, /168/);
    assert.match(enriched, /#a8f9/);
  });

  it("shiftEnvelopeTemp adds ambient ΔT to every hour", () => {
    const shifted = shiftEnvelopeTemp(stubEnvelope, 2);
    assert.ok(shifted);
    assert.equal(shifted!.kowloonAirTempC, stubEnvelope.kowloonAirTempC + 2);
    assert.equal(shifted!.hours[15].airTempC, stubEnvelope.hours[15].airTempC + 2);
  });
});

describe("SSR safety", () => {
  it("does not export the server-only runtime from the client barrel", () => {
    const barrel = readFileSync(new URL("../lib/agent/index.ts", import.meta.url), "utf8");
    assert.doesNotMatch(barrel, /runtime/);
    const runtime = readFileSync(new URL("../lib/agent/runtime.ts", import.meta.url), "utf8");
    assert.match(runtime, /server-only/);
    const ui = readFileSync(new URL("../components/copilot/PolicyAgent.tsx", import.meta.url), "utf8");
    assert.doesNotMatch(ui, /lib\/agent\/runtime/);
    const apply = readFileSync(new URL("../lib/agent/apply.ts", import.meta.url), "utf8");
    assert.doesNotMatch(apply, /from "ai"|@ai-sdk/);
  });

  it("flyTo is a no-op without window", () => {
    assert.equal(typeof window, "undefined");
    flyTo(114.16, 22.33);
  });

  it("AgentPlanSchema round-trips a validated plan", () => {
    const plan = parseIntent("CMC at 15:00");
    const again = AgentPlanSchema.parse(JSON.parse(JSON.stringify(plan)));
    assert.equal(again.tools[0]?.name, plan.tools[0]?.name);
  });
});

describe("compareScenarioDiff sign convention", () => {
  it("delta is CVI(B) − CVI(A) so green means B is cooler", () => {
    const diff = compareScenarioDiff(
      buildings.slice(0, 12),
      DEFAULT_POLICY,
      stubEnvelope,
      "july-2022-heatwave",
      "district-blackout",
      15,
    );
    assert.equal(diff.length, 12);
    for (const cell of diff) {
      assert.ok(Number.isFinite(cell.delta));
      assert.equal(cell.delta, cell.cviB - cell.cviA);
    }
  });
});
