import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PEI_HO_CANYON_AXIS_DEG,
  PEI_HO_CANYON_HW,
  SOLAR_ENGINE_LAT,
  SOLAR_ENGINE_LON,
  canyonDirectBeamFraction,
  canyonInsolation,
  peiHoCanyonInsolation,
  solarPositionHk,
} from "../lib/solar-engine";

describe("solar-engine HK centroid", () => {
  it("uses 22.3193 N, 114.1694 E", () => {
    assert.equal(SOLAR_ENGINE_LAT, 22.3193);
    assert.equal(SOLAR_ENGINE_LON, 114.1694);
  });

  it("puts the sun above the horizon at 15:00 HKT in July", () => {
    const noon = solarPositionHk(12);
    const peak = solarPositionHk(15);
    assert.ok(noon.elevationDeg > 70, `noon el ${noon.elevationDeg}`);
    assert.ok(peak.elevationDeg > 40, `15:00 el ${peak.elevationDeg}`);
    assert.ok(peak.azimuthDeg > 180, "afternoon sun is west of south");
  });

  it("is below the horizon at 02:00 HKT", () => {
    const night = solarPositionHk(2);
    assert.ok(night.elevationDeg < 0);
  });

  it("shadows the Pei Ho H/W 3.5 canyon floor at low sun", () => {
    const dawn = solarPositionHk(7.2);
    const frac = canyonDirectBeamFraction({
      elevationDeg: dawn.elevationDeg,
      azimuthDeg: dawn.azimuthDeg,
      canyonHw: PEI_HO_CANYON_HW,
      canyonAxisDeg: PEI_HO_CANYON_AXIS_DEG,
    });
    assert.ok(frac < 0.5, `dawn beam ${frac} at el ${dawn.elevationDeg}`);
  });

  it("lets noon beam through the same canyon", () => {
    const insol = peiHoCanyonInsolation(12.2);
    assert.ok(insol.directBeamFrac > 0.8, `noon beam ${insol.directBeamFrac}`);
    assert.equal(insol.shadowed, false);
    assert.ok(insol.totalWm2 > insol.diffuseWm2);
  });

  it("reduces insolation when cloud cover is 1", () => {
    const clear = canyonInsolation({
      hourHkt: 13,
      canyonHw: PEI_HO_CANYON_HW,
      canyonAxisDeg: PEI_HO_CANYON_AXIS_DEG,
      cloudCover: 0,
    });
    const overcast = canyonInsolation({
      hourHkt: 13,
      canyonHw: PEI_HO_CANYON_HW,
      canyonAxisDeg: PEI_HO_CANYON_AXIS_DEG,
      cloudCover: 1,
    });
    assert.ok(overcast.directBeamWm2 < clear.directBeamWm2);
  });
});
