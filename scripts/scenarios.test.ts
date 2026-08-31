import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyScenarioEnvelope, scenarioById, STRESS_SCENARIOS } from "../lib/scenarios";
import { evaluateBuildingAtHour, isShamShuiPoCoastalLowland } from "../lib/epidemiology-engine";
import { getBuildings, buildingCentroid } from "../lib/spatial-data";
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
  it("ships five historic / climate stress plates including Super Typhoon and 3 AM battery", () => {
    assert.equal(STRESS_SCENARIOS.length, 5);
    assert.ok(scenarioById("july-2022-heatwave"));
    assert.ok(scenarioById("typhoon-subsidence"));
    assert.ok(scenarioById("district-blackout"));
    assert.ok(scenarioById("super-typhoon-heat-surge"));
    assert.ok(scenarioById("subdivided-3am-battery"));
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

  it("floods Sham Shui Po lowlands and lifts post-storm humidity on Super Typhoon + Heat Surge", () => {
    const s = scenarioById("super-typhoon-heat-surge")!;
    assert.equal(s.forcing.coastalFloodM, 1.4);
    assert.ok(s.forcing.postStormRhBoost > 0);
    assert.ok(s.forcing.nightRhFloor >= 0.94);
    assert.ok(s.forcing.seaBreezeScale <= 0.15);
    const buildings = getBuildings();
    const lowland = buildings.find((b) => {
      const [lon, lat] = buildingCentroid(b);
      return isShamShuiPoCoastalLowland(b.properties.district, lon, lat);
    });
    const upland = buildings.find((b) => b.properties.district === "Yau Tsim Mong");
    assert.ok(lowland && upland);
    const env = applyScenarioEnvelope(stubEnvelope, s);
    const flooded = evaluateBuildingAtHour(lowland, 15, DEFAULT_POLICY, env, s.forcing);
    const control = evaluateBuildingAtHour(upland, 15, DEFAULT_POLICY, env, s.forcing);
    const dry = evaluateBuildingAtHour(lowland, 15, DEFAULT_POLICY, env, {
      ...s.forcing,
      coastalFloodM: 0,
    });
    assert.ok(
      flooded.indoorTa > dry.indoorTa + 0.6,
      `lowland indoor ${flooded.indoorTa.toFixed(2)} vs dry ${dry.indoorTa.toFixed(2)}`,
    );
    assert.ok(
      flooded.indoorTa > control.indoorTa,
      `SSP flood ${flooded.indoorTa.toFixed(2)} should exceed YTM ${control.indoorTa.toFixed(2)}`,
    );
  });

  it("keeps 劏房 indoor heat above 34°C at 03:00 on the concrete thermal-battery plate", () => {
    const s = scenarioById("subdivided-3am-battery")!;
    assert.equal(s.playheadHour, 3);
    assert.ok(s.forcing.batteryIntensity >= 1.65);
    assert.equal(s.envelope.troughAirTempC, 32.4);
    const buildings = getBuildings();
    const dense = buildings.find((b) => b.properties.subdividedFlatDensity >= 0.9) ?? buildings[0];
    const env = applyScenarioEnvelope(stubEnvelope, s);
    const night = evaluateBuildingAtHour(dense, 3, DEFAULT_POLICY, env, s.forcing);
    assert.ok(
      night.indoorTa > 34,
      `${dense.properties.nameEn} 03:00 indoor ${night.indoorTa.toFixed(2)} battery ${night.thermalBatteryC.toFixed(2)}`,
    );
    const day = evaluateBuildingAtHour(dense, 15, DEFAULT_POLICY, env, s.forcing);
    assert.ok(day.thermalBatteryC === 0, `15:00 battery must stay inert, got ${day.thermalBatteryC}`);
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
