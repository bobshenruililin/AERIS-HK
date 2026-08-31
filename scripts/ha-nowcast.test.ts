import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { calibrateEdServers, mmcQueue } from "../lib/epidemiology-engine";
import { calibrateMuFromMix, mixFromWaitRow, parseHaUpdateTimeMs, parseWaitToMinutes } from "../lib/ha/parse";
import { assertNoPatientIdentifiers, stripUnknownKeys, AGGREGATE_WEBHOOK_KEYS } from "../lib/ha/privacy";
import { parseWebhookOccupancy } from "../lib/ha/ingest";
import { delayedCmsOccupancy } from "../lib/ha/occupancy-mock";

describe("HA wait parsing", () => {
  it("parses minute, hour, and less-than bands", () => {
    assert.equal(parseWaitToMinutes("0 minute"), 0);
    assert.equal(parseWaitToMinutes("less than 15 minutes"), 10);
    assert.equal(parseWaitToMinutes("19 minutes"), 19);
    assert.equal(parseWaitToMinutes("1.5 hours"), 90);
    assert.equal(parseWaitToMinutes("Managing multiple resuscitation cases"), null);
  });

  it("parses HA updateTime as HKT", () => {
    const ms = parseHaUpdateTimeMs("30/8/2026 8:15PM");
    const hkt = new Date(ms + 8 * 3600 * 1000);
    assert.equal(hkt.getUTCFullYear(), 2026);
    assert.equal(hkt.getUTCMonth(), 7);
    assert.equal(hkt.getUTCDate(), 30);
    assert.equal(hkt.getUTCHours(), 20);
    assert.equal(hkt.getUTCMinutes(), 15);
  });
});

describe("M/M/c calibration from Cat 1–3 mix", () => {
  it("lowers μ when the mix is more Cat 1", () => {
    const light = calibrateMuFromMix({ p1: 0.02, p2: 0.12, p3: 0.86 });
    const heavy = calibrateMuFromMix({ p1: 0.16, p2: 0.28, p3: 0.56 });
    assert.ok(heavy < light, `Cat-1 heavy μ ${heavy} should be < Cat-3 heavy μ ${light}`);
    assert.ok(light > 2.2 && light < 3.2);
  });

  it("infers a higher Cat 1 share when the board is in resuscitation", () => {
    const calm = mixFromWaitRow({ hospName: "Kwong Wah Hospital", manageT1case: "N", t3p50: "20 minutes" });
    const resus = mixFromWaitRow({
      hospName: "Kwong Wah Hospital",
      manageT1case: "N/A",
      t1wt: "Managing multiple resuscitation cases",
      t3p50: "40 minutes",
    });
    assert.ok(resus.p1 > calm.p1);
  });

  it("solves c so modelled wait tracks observed Cat 3 p50", () => {
    const mix = { p1: 0.03, p2: 0.12, p3: 0.85 };
    const mu = calibrateMuFromMix(mix);
    const lambda = 22;
    const targetHours = 19 / 60;
    const c = calibrateEdServers(lambda, mu, targetHours, 16);
    const q = mmcQueue(lambda, mu, c);
    assert.ok(q.utilization < 0.995);
    assert.ok(Math.abs(q.waitHours - targetHours) < 0.35, `wait ${q.waitHours} vs target ${targetHours} at c=${c}`);
  });
});

describe("Privacy: hospital aggregates only", () => {
  it("rejects HKID-shaped tokens and patient keys", () => {
    assert.throws(() => assertNoPatientIdentifiers({ hkid: "A123456(7)" }), /patient-level|HKID/i);
    assert.throws(() => assertNoPatientIdentifiers({ patientId: "x" }), /patient-level/i);
    assert.doesNotThrow(() =>
      assertNoPatientIdentifiers({
        code: "CMC",
        occupancyFrac: 0.91,
        cat1PerHour: 1.2,
        cat2PerHour: 4.4,
        cat3PerHour: 11.0,
      }),
    );
  });

  it("strips non-allowlisted webhook keys", () => {
    const stripped = stripUnknownKeys(
      { code: "KWH", occupancyFrac: 0.9, cat1PerHour: 2, cat2PerHour: 5, cat3PerHour: 12, patientName: "x", asOf: "t" },
      AGGREGATE_WEBHOOK_KEYS,
    );
    assert.equal("patientName" in stripped, false);
    assert.equal(stripped.code, "KWH");
  });

  it("rejects a patients array on the occupancy webhook", () => {
    assert.throws(
      () => parseWebhookOccupancy([{ code: "CMC", patients: [{ name: "x" }] }]),
      /patient/i,
    );
  });

  it("delayed occupancy mock is hospital-level and lagged", () => {
    const now = Date.parse("2026-08-30T12:15:00+08:00");
    const sample = delayedCmsOccupancy({
      code: "CMC",
      waitCat3Minutes: 19,
      waitCat45Minutes: 90,
      nowMs: now,
      waitBoardMs: now,
    });
    assert.equal(sample.code, "CMC");
    assert.ok(sample.occupancyFrac > 0.6 && sample.occupancyFrac < 1.3);
    assert.ok(Date.parse(sample.asOf) <= now - 10 * 60 * 1000);
    assert.doesNotThrow(() => assertNoPatientIdentifiers(sample));
  });
});
