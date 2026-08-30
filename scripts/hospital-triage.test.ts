import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BED_OVERFLOW_THRESHOLD,
  NATHAN_ROAD,
  PATIENTS_PER_AMBULANCE,
  WEST_KOWLOON_CORRIDOR,
  assertArterialWgs84,
  createAmbulanceParticles,
  excessInpatients,
  pathForTransfer,
  pointAlongPolyline,
  rebalanceClusterLoad,
} from "../lib/hospital-triage";
import { HOSPITALS, hospitalByCode } from "../lib/hospitals";
import type { HospitalCode, HospitalHourState } from "../lib/types";
import { DEFAULT_POLICY } from "../lib/types";
import { applyScenarioEnvelope, scenarioById } from "../lib/scenarios";
import { evaluateSystemAtHour } from "../lib/epidemiology-engine";
import { getBuildings } from "../lib/spatial-data";

function stubHospital(code: HospitalCode, occupancy: number): HospitalHourState {
  const spec = hospitalByCode(code);
  return {
    code,
    nameEn: spec.nameEn,
    nameZh: spec.nameZh,
    hour: 15,
    arrivals: { category1: 1, category2: 3, category3: 9, total: 13 },
    edQueue: {
      lambda: 13,
      mu: spec.muPerHour,
      servers: spec.edServers,
      utilization: 0.82,
      probabilityWait: 0.4,
      queueLength: 2.1,
      waitHours: 0.35,
    },
    bedOccupancy: occupancy,
    bedDeficitPct: Math.max(0, (occupancy - 1) * 100),
    relativeMortalityIndex: 1.12,
    calibratedMu: spec.muPerHour,
    calibratedServers: spec.edServers,
    occupancySource: "model",
    waitCat3P50Minutes: null,
    nowcastDelayMinutes: null,
    occupancyPreTransfer: occupancy,
    occupancyPostTransfer: occupancy,
    transferredIn: 0,
    transferredOut: 0,
  };
}

describe("multi-cluster load rebalancing", () => {
  it("ships PMH as a transfer receiver without replacing CMC / KWH / QEH", () => {
    assert.deepEqual(
      HOSPITALS.map((h) => h.code),
      ["CMC", "KWH", "QEH", "PMH"],
    );
    assert.equal(hospitalByCode("PMH").latitude, 22.3409);
    assert.ok(hospitalByCode("PMH").catchmentWeight["Sham Shui Po"] <= 0.1);
  });

  it("moves CMC inpatients above 120% onto PMH and QEH and conserves census", () => {
    const excess = excessInpatients(1.28, hospitalByCode("CMC").staffedAcuteBeds);
    assert.ok(Math.abs(excess - 0.08 * 420) < 1e-6);
    const { hospitals, plan } = rebalanceClusterLoad([
      stubHospital("CMC", 1.28),
      stubHospital("KWH", 0.95),
      stubHospital("QEH", 0.93),
      stubHospital("PMH", 0.9),
    ]);
    assert.equal(BED_OVERFLOW_THRESHOLD, 1.2);
    assert.ok(plan.triggered);
    assert.ok(plan.totalTransferred > 30);
    const cmc = hospitals.find((h) => h.code === "CMC")!;
    const pmh = hospitals.find((h) => h.code === "PMH")!;
    const qeh = hospitals.find((h) => h.code === "QEH")!;
    assert.ok(cmc.occupancyPreTransfer >= 1.2);
    assert.ok(cmc.occupancyPostTransfer <= 1.201);
    assert.ok(cmc.transferredOut > 30);
    assert.ok(pmh.transferredIn + qeh.transferredIn > 30);
    const out = hospitals.reduce((s, h) => s + h.transferredOut, 0);
    const inn = hospitals.reduce((s, h) => s + h.transferredIn, 0);
    assert.ok(Math.abs(out - inn) < 1e-6);
    assert.ok(Math.abs(out - plan.totalTransferred) < 1e-6);
    assert.ok(plan.legs.every((leg) => leg.from === "CMC" || leg.from === "KWH"));
    assert.ok(plan.legs.every((leg) => leg.to === "PMH" || leg.to === "QEH"));
  });

  it("sends overflow to PMH when QEH itself exceeds 120%", () => {
    const { hospitals, plan } = rebalanceClusterLoad([
      stubHospital("CMC", 1.3),
      stubHospital("KWH", 0.9),
      stubHospital("QEH", 1.22),
      stubHospital("PMH", 0.88),
    ]);
    const qehIn = hospitals.find((h) => h.code === "QEH")!.transferredIn;
    const pmhIn = hospitals.find((h) => h.code === "PMH")!.transferredIn;
    assert.ok(qehIn < 0.05, `QEH received ${qehIn}`);
    assert.ok(pmhIn > 40, `PMH received ${pmhIn}`);
    assert.ok(plan.legs.every((leg) => leg.to === "PMH"));
  });

  it("routes ambulance particles on WGS84 West Kowloon Corridor and Nathan Road", () => {
    assertArterialWgs84(WEST_KOWLOON_CORRIDOR, "WKC");
    assertArterialWgs84(NATHAN_ROAD, "Nathan");
    const wkc = pathForTransfer("CMC", "QEH");
    const nathan = pathForTransfer("KWH", "QEH");
    assert.equal(wkc.arterial, "west-kowloon-corridor");
    assert.equal(nathan.arterial, "nathan-road");
    const mid = pointAlongPolyline(wkc.path, 0.5);
    assert.ok(mid[0] < 200 && mid[1] < 200);
    const { plan } = rebalanceClusterLoad([
      stubHospital("CMC", 1.28),
      stubHospital("KWH", 1.25),
      stubHospital("QEH", 0.9),
      stubHospital("PMH", 0.9),
    ]);
    const particles = createAmbulanceParticles(plan);
    assert.ok(particles.length >= 1);
    const expected = plan.legs.reduce((s, leg) => s + Math.max(1, Math.round(leg.patients / PATIENTS_PER_AMBULANCE)), 0);
    assert.equal(particles.length, expected);
    assert.ok(particles.every((p) => p.lon > 114 && p.lon < 114.4 && p.lat > 22.2 && p.lat < 22.4));
  });

  it("triggers CMC overflow on the Super Typhoon + Post-Storm Heat Surge plate", () => {
    const scenario = scenarioById("super-typhoon-heat-surge");
    assert.ok(scenario);
    const env = applyScenarioEnvelope(null, scenario);
    const snap = evaluateSystemAtHour(15, DEFAULT_POLICY, getBuildings(), undefined, env, null, scenario.forcing);
    const cmc = snap.hospitals.find((h) => h.code === "CMC")!;
    assert.ok(
      cmc.occupancyPreTransfer > 1.2,
      `CMC pre-transfer ${cmc.occupancyPreTransfer} should exceed 120% under coastal flood`,
    );
    assert.ok(snap.triage.triggered);
    assert.ok(snap.triage.totalTransferred > 0);
    assert.ok(snap.hospitals.some((h) => h.code === "PMH"));
  });
});
