import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { join } from "node:path";
import {
  BRIEFING_BEAT_COUNT,
  BRIEFING_BEATS,
  briefingBeat,
  lerpHourCinematic,
  lerpHourForward,
  pickFukWaTrapBuilding,
} from "../lib/presentation/beats";
import { buildA4Pdf, jpegDimensions, modelFromTwin, zipStore } from "../lib/presentation/a4-brief";
import { droneFrequencyHz, droneGain, SOL_AIR_TICK_C } from "../lib/audio/sonification";
import { roofAbsorbedShortwaveWm2, solAirTempC, SOL_AIR_CRITICAL_C, SOL_AIR_HO_WM2K } from "../lib/solar";
import { interpretHudKey } from "../lib/hotkeys";
import { getBuildings } from "../lib/spatial-data";
import { DEFAULT_POLICY } from "../lib/types";
import { evaluateSystemAtHour, precomputeHourlyCache } from "../lib/epidemiology-engine";
import { runMonteCarlo } from "../lib/monte-carlo";

const idle = { typing: false, paletteOpen: false };

describe("cinematic briefing beats", () => {
  it("curates four narrative beats at 14:00, 23:00, 02:00, and 15:00 HKT", () => {
    assert.equal(BRIEFING_BEAT_COUNT, 4);
    assert.equal(BRIEFING_BEATS.length, 4);
    assert.equal(briefingBeat(0).id, "regional-heatwave");
    assert.equal(briefingBeat(0).hour, 14);
    assert.match(briefingBeat(0).titleEn, /Regional Heatwave Overview/);
    assert.equal(briefingBeat(1).id, "street-canyon-trap");
    assert.equal(briefingBeat(1).hour, 23);
    assert.equal(briefingBeat(1).streetEn, "Fuk Wa Street");
    assert.match(briefingBeat(1).narrative, /Subdivided units on Fuk Wa Street/);
    assert.equal(briefingBeat(2).id, "hospital-triage-deficit");
    assert.equal(briefingBeat(2).hour, 2);
    assert.equal(briefingBeat(2).focusHospital, "KWH");
    assert.match(briefingBeat(2).narrative, /Kwong Wah/);
    assert.equal(briefingBeat(3).id, "optimal-counterfactual");
    assert.equal(briefingBeat(3).hour, 15);
    assert.equal(briefingBeat(3).applyOptimalPolicy, true);
    assert.equal(briefingBeat(4).id, briefingBeat(0).id);
    assert.equal(briefingBeat(-1).id, briefingBeat(3).id);
  });

  it("wraps diurnal time forward from 23:00 to 02:00 rather than interpolating backwards", () => {
    assert.equal(lerpHourForward(23, 2, 0), 23);
    assert.equal(lerpHourForward(23, 2, 1), 2);
    const mid = lerpHourForward(23, 2, 0.5);
    assert.ok(mid < 1 || mid > 22, `forward wrap mid=${mid}`);
    assert.ok(Math.abs(lerpHourForward(14, 14, 0.4) - 14) < 1e-9);
    assert.ok(Math.abs(lerpHourCinematic(15, 14, 1) - 14) < 1e-9);
    const midBack = lerpHourCinematic(15, 14, 0.5);
    assert.ok(midBack > 13.4 && midBack < 14.6, `short backstep mid=${midBack}`);
  });

  it("picks a Fuk Wa Street 劏房 trap with high subdivided density", () => {
    const trap = pickFukWaTrapBuilding(getBuildings());
    assert.ok(trap);
    assert.equal(trap!.properties.streetEn, "Fuk Wa Street");
    assert.ok(trap!.properties.subdividedFlatDensity >= 0.4);
  });
});

describe("sol-air hover threshold", () => {
  it("collocates T_sa = T_a + q_abs / 22 and exceeds 40 °C on a hot roof at 14:00", () => {
    assert.equal(SOL_AIR_HO_WM2K, 22);
    assert.equal(SOL_AIR_CRITICAL_C, 40);
    assert.equal(SOL_AIR_TICK_C, 40);
    const q = roofAbsorbedShortwaveWm2(14, false);
    const tsa = solAirTempC(35, q);
    assert.ok(q > 400, `q_abs ${q}`);
    assert.ok(tsa > 40, `T_sa ${tsa}`);
    assert.equal(solAirTempC(32, 0), 32);
    assert.ok(solAirTempC(32, 0) < SOL_AIR_TICK_C);
  });
});

describe("spatial sonification", () => {
  it("does not construct AudioContext at module load", () => {
    const src = readFileSync(join(process.cwd(), "lib/audio/sonification.ts"), "utf8");
    assert.equal(src.includes("new AudioContext"), false);
    assert.match(src, /async unlock\(/);
    assert.match(src, /new Ctor\(\)/);
    const topLevel = src.split("export class HeatSoundscape")[0] ?? "";
    assert.equal(topLevel.includes("window."), false);
  });

  it("raises drone frequency and gain with district WBGT (UTCI analogue)", () => {
    assert.ok(droneFrequencyHz(38) > droneFrequencyHz(24));
    assert.ok(droneGain(38) > droneGain(24));
    assert.ok(droneFrequencyHz(24) >= 46);
    assert.ok(droneFrequencyHz(40) <= 80);
  });
});

describe("A4 vector briefing", () => {
  it("emits a %PDF-1.4 with Monte Carlo CI and HA rows", () => {
    const buildings = getBuildings();
    const cache = precomputeHourlyCache(DEFAULT_POLICY, buildings);
    const snap = evaluateSystemAtHour(14, DEFAULT_POLICY, buildings, cache);
    const mc = runMonteCarlo({
      scenarioAdmissions24h: 42,
      scenarioBedDeficitPct: 8,
      acFailProbability: 0.1,
      iterations: 64,
      seed: 7,
    });
    const model = modelFromTwin({
      beatTitle: "The Regional Heatwave Overview",
      hourLabel: "14:00",
      scenarioName: "July 2022 Historic Heatwave",
      generatedAt: "2026-08-30T18:00",
      kowloonAirTempC: 35.2,
      regionalWbgt: snap.regionalMeanWbgt,
      cviMean: snap.regionalMeanCvi,
      admissionsAverted: 6.4,
      mapJpeg: null,
      monteCarlo: mc,
      hospitals: snap.hospitals,
    });
    const pdf = buildA4Pdf(model);
    const head = new TextDecoder().decode(pdf.slice(0, 8));
    assert.equal(head.startsWith("%PDF-1.4"), true);
    const text = new TextDecoder("latin1").decode(pdf);
    assert.match(text, /Monte Carlo 95% CI/);
    assert.match(text, /Hospital Authority risk breakdown/);
    assert.match(text, /KWH/);
    assert.match(text, /CMC/);
    assert.match(text, /%%EOF/);
    const zip = zipStore([
      { name: "briefing.pdf", data: pdf },
      { name: "briefing.png", data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) },
    ]);
    assert.equal(zip[0], 0x50);
    assert.equal(zip[1], 0x4b);
    assert.equal(zip[2], 0x03);
    assert.equal(zip[3], 0x04);
    assert.equal(jpegDimensions(new Uint8Array([0xff, 0xd8, 0xff, 0xd9])), null);
  });
});

describe("HUD arrow keys", () => {
  it("maps ArrowRight / ArrowLeft to briefing beat steps without stealing 1–4", () => {
    assert.deepEqual(interpretHudKey({ key: "ArrowRight", metaKey: false, ctrlKey: false, altKey: false }, idle), {
      type: "beat-next",
    });
    assert.deepEqual(interpretHudKey({ key: "ArrowLeft", metaKey: false, ctrlKey: false, altKey: false }, idle), {
      type: "beat-prev",
    });
    assert.deepEqual(interpretHudKey({ key: "1", metaKey: false, ctrlKey: false, altKey: false }, idle), {
      type: "preset",
      id: 1,
    });
    assert.equal(
      interpretHudKey({ key: "ArrowRight", metaKey: false, ctrlKey: false, altKey: false }, { typing: true, paletteOpen: false }),
      null,
    );
  });
});
