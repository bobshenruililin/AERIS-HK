import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getBuildings } from "../lib/spatial-data";
import { DEFAULT_POLICY } from "../lib/types";
import { evaluateBuildingAtHour, indoorAirTemp } from "../lib/epidemiology-engine";
import {
  CONCRETE_THERMAL_BATTERY_TAU_H,
  SUBDIVIDED_NIGHT_HAZARD_C,
  applySubdividedFlatThermalLag,
  fangerPmvPpd,
  nightBatteryWeight,
  solveWbgtDifferential,
} from "../lib/biophysics";
import { applyScenarioEnvelope, scenarioById } from "../lib/scenarios";

describe("Fanger PMV-PPD", () => {
  it("is near-neutral in a temperate still-air office", () => {
    const result = fangerPmvPpd({
      airTempC: 24.5,
      meanRadiantC: 24.5,
      airVelocityMs: 0.12,
      rhFrac: 0.5,
      met: 1.1,
      clo: 0.5,
    });
    assert.ok(Math.abs(result.pmv) < 0.85, `pmv ${result.pmv}`);
    assert.ok(result.ppd >= 5 && result.ppd < 25, `ppd ${result.ppd}`);
  });

  it("is strongly warm in a 35°C subdivided flat", () => {
    const result = fangerPmvPpd({
      airTempC: 35,
      meanRadiantC: 36,
      airVelocityMs: 0.08,
      rhFrac: 0.7,
      met: 1.0,
      clo: 0.5,
    });
    assert.ok(result.pmv > 1.8, `pmv ${result.pmv}`);
    assert.ok(result.ppd > 60, `ppd ${result.ppd}`);
  });
});

describe("WBGT differential solver", () => {
  it("returns indoor WBGT between wet-bulb and globe", () => {
    const solved = solveWbgtDifferential({ ta: 32, rhFrac: 0.7, tg: 34, indoor: true });
    assert.ok(solved.tw < solved.ta);
    assert.ok(solved.wbgt > solved.tw && solved.wbgt < solved.tg + 0.5);
    assert.ok(solved.dWbgtDTa > 0);
  });
});

describe("劏房 4-hour thermal battery", () => {
  it("uses a 4-hour concrete time constant and is inert at 15:00", () => {
    assert.equal(CONCRETE_THERMAL_BATTERY_TAU_H, 4);
    assert.equal(nightBatteryWeight(15), 0);
    const day = applySubdividedFlatThermalLag(15, 33, 38, 0.91);
    assert.equal(day.batteryC, 0);
    assert.equal(day.indoorC, 33);
  });

  it("keeps dense uninsulated flats above 34°C at 03:00 HKT after a hot charge", () => {
    const night = applySubdividedFlatThermalLag(3, 31.2, 38.4, 0.93);
    assert.ok(night.indoorC > SUBDIVIDED_NIGHT_HAZARD_C, `indoor ${night.indoorC}`);
  });

  it("persists T_indoor > 34°C until 03:00 on a high-density Pei Ho tong lau in July 2022", () => {
    const building = getBuildings().find((b) => b.properties.subdividedFlatDensity >= 0.9);
    assert.ok(building, "need a dense 劏房");
    const scenario = scenarioById("july-2022-heatwave");
    assert.ok(scenario);
    const envelope = applyScenarioEnvelope(null, scenario);
    const state = evaluateBuildingAtHour(building, 3, DEFAULT_POLICY, envelope, scenario.forcing);
    assert.ok(
      state.indoorTa > SUBDIVIDED_NIGHT_HAZARD_C,
      `03:00 indoor ${state.indoorTa} battery ${state.thermalBatteryC}`,
    );
    assert.ok(state.aeSurgeCat1 + state.aeSurgeCat2 + state.aeSurgeCat3 > 0);
    assert.ok(state.ppd > 5);
  });

  it("does not floor 15:00 indoor temperature (cool-roof tests stay sensitive)", () => {
    const building = getBuildings()[0];
    const fifteen = indoorAirTemp(15, building, DEFAULT_POLICY);
    assert.ok(fifteen < 40);
    assert.ok(nightBatteryWeight(15) === 0);
  });
});
