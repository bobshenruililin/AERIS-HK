import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getBuildings } from "../lib/spatial-data";
import { advectWindParticles, createWindParticles, WIND_TRAIL_CAP } from "../lib/wind-field";
import { advectAmbulanceParticles, createAmbulanceParticles, EMPTY_LOAD_BALANCE_PLAN, pathForTransfer } from "../lib/hospital-triage";
import type { LoadBalancePlan } from "../lib/types";
import { BASELINE_POLICY } from "../lib/types";
import { packWindParticles, createParticleGpuBuffers } from "../lib/gpu/particle-buffers";
import { handleWebGlContextLost } from "../lib/gpu/context-lifecycle";
import { interpretHudKey } from "../lib/hotkeys";
import { cameraBasisInto, copyTwinView, HARBOUR_TWIN_VIEW, KOWLOON_TWIN_VIEW, lerpViewInto, type CameraBasis, type TwinView } from "../lib/twin-camera";
import { fillHourInstanceCursor, packInstanceExtrusions, type HourInstanceCursor } from "../lib/instance-mesh";
import { evaluateSystemAtHour, precomputeHourlyCache } from "../lib/epidemiology-engine";

describe("zero-allocation wind / ambulance advect", () => {
  it("mutates the same particle array and trail buffers", () => {
    const particles = createWindParticles(3);
    const first = particles[0];
    const trail = first.trail;
    const trail0 = trail[0];
    const out = advectWindParticles(particles, 0.016, 15, getBuildings());
    assert.equal(out, particles);
    assert.equal(out[0], first);
    assert.equal(out[0].trail, trail);
    assert.equal(out[0].trail[0], trail0);
    assert.equal(out[0].trail.length, WIND_TRAIL_CAP);
    assert.ok(out[0].trailLen >= 1 && out[0].trailLen <= WIND_TRAIL_CAP);
  });

  it("packs wind positions into a reused Float32Array", () => {
    const particles = createWindParticles(1);
    const buf = createParticleGpuBuffers(16);
    packWindParticles(particles, buf);
    const pos = buf.positions;
    packWindParticles(particles, buf);
    assert.equal(buf.positions, pos);
    assert.equal(buf.count, particles.length);
    assert.equal(buf.positions[0], Math.fround(particles[0].lon));
    assert.equal(buf.positions[1], Math.fround(particles[0].lat));
  });

  it("advects ambulances in place", () => {
    const { arterial, path } = pathForTransfer("CMC", "PMH");
    const plan: LoadBalancePlan = {
      ...EMPTY_LOAD_BALANCE_PLAN,
      triggered: true,
      legs: [
        {
          from: "CMC",
          to: "PMH",
          patients: 4,
          arterial,
          path,
        },
      ],
      totalTransferred: 4,
    };
    const particles = createAmbulanceParticles(plan);
    assert.ok(particles.length > 0);
    const first = particles[0];
    const out = advectAmbulanceParticles(particles, 0.05);
    assert.equal(out, particles);
    assert.equal(out[0], first);
    assert.ok(out[0].pathLengthM > 0);
  });
});

describe("WebGL lifecycle", () => {
  it("preventDefault on context lost so restore can fire", () => {
    let prevented = false;
    const event = {
      preventDefault() {
        prevented = true;
      },
    } as Event;
    handleWebGlContextLost(event);
    assert.equal(prevented, true);
  });
});

describe("diagnostics hotkey", () => {
  it("maps Ctrl+Shift+D and Cmd+Shift+D before the modifier guard", () => {
    const idle = { typing: false, paletteOpen: false };
    assert.deepEqual(
      interpretHudKey(
        { key: "d", metaKey: false, ctrlKey: true, altKey: false, shiftKey: true },
        idle,
      ),
      { type: "diagnostics" },
    );
    assert.deepEqual(
      interpretHudKey(
        { key: "D", metaKey: true, ctrlKey: false, altKey: false, shiftKey: true },
        idle,
      ),
      { type: "diagnostics" },
    );
  });
});

describe("pooled camera / instance cursor", () => {
  it("mutates the same CameraBasis and TwinView", () => {
    const basis: CameraBasis = {
      cam: { east: 0, north: 0, up: 0 },
      right: { east: 0, north: 0, up: 0 },
      up: { east: 0, north: 0, up: 0 },
      forward: { east: 0, north: 0, up: 0 },
    };
    const out = cameraBasisInto(basis, KOWLOON_TWIN_VIEW);
    assert.equal(out, basis);
    assert.ok(basis.cam.up > 10);
    const view: TwinView = { ...HARBOUR_TWIN_VIEW };
    const same = lerpViewInto(view, HARBOUR_TWIN_VIEW, KOWLOON_TWIN_VIEW, 0.5);
    assert.equal(same, view);
    assert.ok(view.distance < HARBOUR_TWIN_VIEW.distance);
    copyTwinView(view, KOWLOON_TWIN_VIEW);
    assert.equal(view.distance, KOWLOON_TWIN_VIEW.distance);
  });

  it("reuses an instance cursor instead of subarraying every scrub", () => {
    const buildings = getBuildings().slice(0, 4);
    const cache = precomputeHourlyCache(BASELINE_POLICY, buildings);
    const pack = packInstanceExtrusions(buildings, cache, 8);
    const cursor: HourInstanceCursor = {
      count: 0,
      colorOffset: 0,
      elevOffset: 0,
      positions: new Float32Array(0),
      colors: new Uint8Array(0),
      elevations: new Float32Array(0),
      acWatts: new Float32Array(0),
    };
    const a = fillHourInstanceCursor(cursor, pack, 15, 2);
    const pos = a.positions;
    const b = fillHourInstanceCursor(cursor, pack, 16, 2);
    assert.equal(a, cursor);
    assert.equal(b, cursor);
    assert.equal(b.positions, pos);
    assert.ok(b.count > 0);
    assert.notEqual(a.colorOffset, 0);
  });
});

describe("evaluateSystemAtHour clone-on-publish", () => {
  it("does not alias pooled building states across successive hours", () => {
    const buildings = getBuildings().slice(0, 3);
    const cache = precomputeHourlyCache(BASELINE_POLICY, buildings);
    const a = evaluateSystemAtHour(15, BASELINE_POLICY, buildings, cache);
    const cviA = a.buildings[0].cvi;
    const idA = a.buildings[0];
    const b = evaluateSystemAtHour(3, BASELINE_POLICY, buildings, cache);
    assert.notEqual(a.buildings[0], b.buildings[0]);
    assert.equal(idA.cvi, cviA);
  });
});
