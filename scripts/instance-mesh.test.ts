import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getBuildings } from "../lib/spatial-data";
import { precomputeHourlyCache } from "../lib/epidemiology-engine";
import { DEFAULT_POLICY } from "../lib/types";
import {
  INSTANCE_TARGET,
  lodFromDistanceM,
  lodFromZoom,
  packInstanceExtrusions,
  sliceHourInstances,
  visibleInstanceCount,
} from "../lib/instance-mesh";

describe("instanced extrusion pack", () => {
  it("packs ≥20,480 instances with hour-major zero-copy slices", () => {
    const buildings = getBuildings();
    const cache = precomputeHourlyCache(DEFAULT_POLICY, buildings, null);
    const pack = packInstanceExtrusions(buildings, cache);
    assert.ok(pack.count >= INSTANCE_TARGET, `count ${pack.count}`);
    assert.equal(pack.parentCount, buildings.length);
    assert.equal(pack.instancePositions.length, pack.count * 3);
    assert.equal(pack.instanceColors.length, 24 * pack.count * 4);
    assert.equal(pack.instanceElevations.length, 24 * pack.count);

    const street = sliceHourInstances(pack, 15, 2);
    assert.equal(street.count, pack.parentCount);
    assert.equal(street.instancePositions.buffer, pack.instancePositions.buffer);
    assert.equal(street.instanceColors.buffer, pack.instanceColors.buffer);
    assert.equal(street.instanceElevations.buffer, pack.instanceElevations.buffer);

    const canyon = sliceHourInstances(pack, 15, 1);
    const district = sliceHourInstances(pack, 15, 0);
    assert.equal(district.count, pack.count);
    assert.ok(canyon.count < district.count, `canyon ${canyon.count} vs district ${district.count}`);
    assert.ok(street.count < canyon.count, `street ${street.count} vs canyon ${canyon.count}`);
    assert.equal(visibleInstanceCount(0, pack.count, pack.parentCount), pack.count);
  });

  it("maps zoom and camera distance onto district / canyon / street LoD", () => {
    assert.equal(lodFromZoom(13.35), 0);
    assert.equal(lodFromZoom(15.0), 1);
    assert.equal(lodFromZoom(16.2), 2);
    assert.equal(lodFromDistanceM(2400), 0);
    assert.equal(lodFromDistanceM(1200), 1);
    assert.equal(lodFromDistanceM(400), 2);
  });

  it("does not allocate a new positions buffer when scrubbing hours", () => {
    const buildings = getBuildings();
    const cache = precomputeHourlyCache(DEFAULT_POLICY, buildings, null);
    const pack = packInstanceExtrusions(buildings, cache);
    const a = sliceHourInstances(pack, 3, 0);
    const b = sliceHourInstances(pack, 15, 0);
    assert.equal(a.instancePositions.buffer, b.instancePositions.buffer);
    assert.equal(a.count, b.count);
    assert.notEqual(a.instanceColors.byteOffset, b.instanceColors.byteOffset);
  });
});
