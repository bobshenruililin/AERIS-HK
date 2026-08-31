import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getBuildings } from "../lib/spatial-data";
import { evaluateSystemAtHour, precomputeHourlyCache } from "../lib/epidemiology-engine";
import { DEFAULT_POLICY } from "../lib/types";
import {
  HARBOUR_TWIN_VIEW,
  KOWLOON_TWIN_VIEW,
  cameraPosition,
  lerpView,
  orbitView,
  pickNearestId,
  projectEnu,
  wgs84ToEnu,
  zoomToDistanceM,
} from "../lib/twin-camera";
import { metersPerDegree } from "../lib/crs";
import { HARBOUR_APPROACH_VIEW, KOWLOON_VIEW } from "../lib/constants";

describe("software twin camera", () => {
  it("maps the WGS84 origin to ENU (0,0)", () => {
    const p = wgs84ToEnu(114.1628, 22.3307, 0);
    assert.ok(Math.abs(p.east) < 0.2);
    assert.ok(Math.abs(p.north) < 0.2);
  });

  it("puts a point 100 m east at about +100 easting", () => {
    const { metersPerDegLng } = metersPerDegree(22.3307);
    const origin = wgs84ToEnu(114.1628, 22.3307);
    const east = wgs84ToEnu(114.1628 + 100 / metersPerDegLng, 22.3307);
    const de = east.east - origin.east;
    assert.ok(Math.abs(de - 100) < 1.5, `Δeast ${de}`);
  });

  it("places the harbour camera south of the Kowloon look-at", () => {
    const cam = cameraPosition(HARBOUR_TWIN_VIEW);
    assert.ok(cam.north < HARBOUR_TWIN_VIEW.targetNorth, "harbour camera must sit south of Kowloon");
    assert.ok(cam.up > 80, "harbour camera must be aloft");
  });

  it("zooms in as the fly-in interpolates to the street view", () => {
    const mid = lerpView(HARBOUR_TWIN_VIEW, KOWLOON_TWIN_VIEW, 0.5);
    assert.ok(mid.distance < HARBOUR_TWIN_VIEW.distance);
    assert.ok(mid.distance > KOWLOON_TWIN_VIEW.distance);
    assert.ok(zoomToDistanceM(KOWLOON_VIEW.zoom) < zoomToDistanceM(HARBOUR_APPROACH_VIEW.zoom));
  });

  it("orbits bearing through a full cinematic turn without collapsing distance", () => {
    const a = orbitView(KOWLOON_TWIN_VIEW, 0);
    const b = orbitView(KOWLOON_TWIN_VIEW, 8000);
    const c = orbitView(KOWLOON_TWIN_VIEW, 16000);
    assert.ok(Math.abs(b.bearingDeg - a.bearingDeg) > 90);
    assert.ok(Math.abs(c.bearingDeg - a.bearingDeg - 360) < 1e-6);
    assert.ok(b.distance > 200);
    assert.ok(b.pitchDeg >= 38 && b.pitchDeg <= 72);
  });

  it("projects a western building left of an eastern one when looking north", () => {
    const view = {
      ...KOWLOON_TWIN_VIEW,
      bearingDeg: 0,
      pitchDeg: 55,
      distance: 900,
      targetEast: 0,
      targetNorth: 0,
    };
    const west = projectEnu({ east: -80, north: 40, up: 20 }, view, 1600, 900);
    const east = projectEnu({ east: 80, north: 40, up: 20 }, view, 1600, 900);
    assert.ok(west.visible && east.visible);
    assert.ok(west.x < east.x, `west ${west.x} should be left of east ${east.x}`);
  });

  it("picks the nearer projected centroid inside the hit radius", () => {
    const id = pickNearestId(100, 100, [
      { id: "far", x: 108, y: 104, depth: 400, visible: true },
      { id: "near", x: 102, y: 101, depth: 120, visible: true },
    ]);
    assert.equal(id, "near");
  });
});

describe("Gagge identity on the live twin", () => {
  it("keeps S = M − W − E − R − C on every footprint at 15:00", () => {
    const buildings = getBuildings();
    const cache = precomputeHourlyCache(DEFAULT_POLICY, buildings, null);
    const snap = evaluateSystemAtHour(15, DEFAULT_POLICY, buildings, cache, null, null);
    assert.ok(snap.buildings.length >= 50);
    for (const row of snap.buildings) {
      const g = row.gagge;
      const reconstructed = g.metabolicRate - g.externalWork - g.evaporativeLoss - g.radiativeLoss - g.convectiveLoss;
      assert.ok(
        Math.abs(reconstructed - g.heatStorage) < 1e-6,
        `${row.buildingId} S ${g.heatStorage} ≠ ${reconstructed}`,
      );
    }
  });
});
