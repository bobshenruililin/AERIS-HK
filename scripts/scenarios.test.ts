import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyScenarioEnvelope, scenarioById, STRESS_SCENARIOS } from "../lib/scenarios";
import { evaluateBuildingAtHour } from "../lib/epidemiology-engine";
import { getBuildings } from "../lib/spatial-data";
import { windAt } from "../lib/wind-field";
import { DEFAULT_POLICY } from "../lib/types";
import type { HkoDiurnalEnvelope } from "../lib/types";
import { HUD_PRESETS } from "../lib/hud";

const stubEnvelope: HkoDiurnalEnvelope = {
  generatedAt: "2026-08-30T00:00:00.000Z",
  timezone: "Asia/Hong_Kong",
  source: "hko-open-data",
  degraded: false,
  degradeReason: null,
  nowHour: 15,
  kowloonAirTempC: 32,
  kowloonRhFrac: 0.7,
  stations: [{ name: "Sham Shui Po", airTempC: 32, rhPercent: 70 }],
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
    airTempC: 30,
    rhFrac: 0.7,
    origin: "observed" as const,
  })),
  observedHours: 24,
  forecastHours: 0,
  blendedHours: 0,
};

describe("stress scenario matrix", () => {
  it("ships the three overnight historic / stress plates", () => {
    assert.equal(STRESS_SCENARIOS.length, 3);
    assert.ok(scenarioById("july-2022-heatwave"));
    assert.ok(scenarioById("typhoon-subsidence"));
    assert.ok(scenarioById("district-blackout"));
  });

  it("loads July 2022 at 37.4°C with 88% night RH and zero cloud", () => {
    const s = scenarioById("july-2022-heatwave")!;
    assert.equal(s.envelope.peakAirTempC, 37.4);
    assert.equal(s.envelope.nightRh, 0.88);
    assert.equal(s.forcing.cloudCover, 0);
    const env = applyScenarioEnvelope(stubEnvelope, s);
    assert.ok(env);
    const peak = env!.hours.reduce((m, h) => (h.airTempC > m.airTempC ? h : m));
    assert.ok(Math.abs(peak.airTempC - 37.4) < 0.15, `peak ${peak.airTempC}`);
    const night = env!.hours[2];
    assert.ok(night.rhFrac >= 0.87);
  });

  it("kills the sea breeze in the typhoon-subsidence trap", () => {
    const s = scenarioById("typhoon-subsidence")!;
    assert.equal(s.forcing.seaBreezeScale, 0);
    assert.ok(s.forcing.ozoneIndex > 0.8);
    const buildings = getBuildings();
    const live = windAt(114.163, 22.331, 15, buildings);
    const trap = windAt(114.163, 22.331, 15, buildings, s.forcing);
    assert.ok(trap.speed < live.speed * 0.35, `trap ${trap.speed} vs live ${live.speed}`);
  });

  it("pushes indoor wet-bulb past 36°C within 90 minutes of a district blackout", () => {
    const s = scenarioById("district-blackout")!;
    assert.equal(s.forcing.blackoutElapsedMin, 90);
    assert.equal(s.forcing.acGridFailure, 1);
    const buildings = getBuildings();
    const dense = buildings.find((b) => b.properties.subdividedFlatDensity >= 0.85) ?? buildings[0];
    const env = applyScenarioEnvelope(stubEnvelope, s);
    const state = evaluateBuildingAtHour(dense, 15, DEFAULT_POLICY, env, s.forcing);
    assert.ok(
      state.indoorWetBulbC >= 36,
      `${dense.properties.nameEn} indoor Tw ${state.indoorWetBulbC.toFixed(2)}`,
    );
  });
});

describe("HUD presets", () => {
  it("keeps four aerospace viewport plates and never drops a drawer", () => {
    assert.equal(Object.keys(HUD_PRESETS).length, 4);
    for (const id of [1, 2, 3, 4] as const) {
      const drawers = HUD_PRESETS[id].drawers;
      assert.ok(drawers.hospital);
      assert.ok(drawers.policy);
      assert.ok(drawers.critical);
      assert.ok(drawers.decade);
      assert.ok(drawers.inspector);
      assert.ok(drawers.header);
    }
    assert.equal(HUD_PRESETS[4].briefing, true);
  });
});
