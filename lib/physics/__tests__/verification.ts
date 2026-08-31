import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fangerPmvPpd, solveWbgtDifferential } from "../../biophysics";
import { SOL_AIR_HO_WM2K, roofAbsorbedShortwaveWm2, solAirTempC, solarElevationDeg } from "../../solar";
import { probabilityMass, runMonteCarlo } from "../../monte-carlo";
import { dominates, nonDominatedSort, type Nsga2Individual } from "../../optimization/nsga2";
import {
  ISO_7243_OUTDOOR,
  ISO_7730_CASES,
  VDI_3787_2_OUTDOOR_WBGT,
  VERIFICATION_CATALOG,
  evaluateIso7730Case,
  iso7243IndoorWbgt,
  iso7243OutdoorWbgt,
  iso7730PpdFromPmv,
  solAirIdentity,
  solAirNightCollocated,
} from "../verification";

describe("Sol-Air (Eq. 3)", () => {
  it("is collocated with T_a when the sun is down", () => {
    const night = solAirNightCollocated(2, 28.4, false);
    assert.ok(night.elevationDeg <= 0, `elevation ${night.elevationDeg}`);
    assert.equal(night.absorbed, 0);
    assert.equal(night.tsa, 28.4);
  });

  it("matches T_sa = T_a + q_abs / 22 for asphalt and cool roofs", () => {
    assert.equal(SOL_AIR_HO_WM2K, 22);
    const hour = 15;
    const ta = 34.2;
    const asphalt = roofAbsorbedShortwaveWm2(hour, false);
    const cool = roofAbsorbedShortwaveWm2(hour, true);
    assert.ok(asphalt > cool, `asphalt ${asphalt} cool ${cool}`);
    assert.ok(Math.abs(solAirTempC(ta, asphalt) - solAirIdentity(ta, asphalt)) < 1e-12);
    assert.ok(Math.abs(solAirTempC(ta, cool) - (ta + cool / 22)) < 1e-12);
    assert.ok(solarElevationDeg(hour) > 30);
    assert.match(VERIFICATION_CATALOG.solAir, /h_o=22/);
  });
});

describe("ISO 7243 / VDI 3787-2 WBGT (operational UTCI analogue)", () => {
  it("uses the ISO 7243 outdoor mix 0.7 Tw + 0.2 Tg + 0.1 Ta", () => {
    const solved = solveWbgtDifferential({ ta: 34, rhFrac: 0.7, tg: 36, indoor: false });
    const mix = iso7243OutdoorWbgt(solved.tw, solved.tg, solved.ta);
    assert.ok(Math.abs(solved.wbgt - mix) < 1e-9);
    assert.deepEqual(VDI_3787_2_OUTDOOR_WBGT, ISO_7243_OUTDOOR);
    assert.match(VERIFICATION_CATALOG.utciAnalogue, /ISO 7243/);
  });

  it("uses the ISO 7243 indoor mix 0.7 Tw + 0.3 Tg", () => {
    const solved = solveWbgtDifferential({ ta: 32, rhFrac: 0.65, tg: 33.5, indoor: true });
    assert.ok(Math.abs(solved.wbgt - iso7243IndoorWbgt(solved.tw, solved.tg)) < 1e-9);
  });
});

describe("ISO 7730 Fanger PMV–PPD", () => {
  for (const fixture of ISO_7730_CASES) {
    it(`annex-style ${fixture.id} stays inside published bands`, () => {
      const { result, logistic } = evaluateIso7730Case(fixture.id);
      assert.ok(result.pmv >= fixture.pmvMin, `${fixture.id} pmv ${result.pmv} < ${fixture.pmvMin}`);
      assert.ok(result.pmv <= fixture.pmvMax, `${fixture.id} pmv ${result.pmv} > ${fixture.pmvMax}`);
      const ppd = Math.min(100, Math.max(5, logistic));
      assert.ok(Math.abs(result.ppd - ppd) < 1e-6);
      if ("ppdMax" in fixture && fixture.ppdMax != null) {
        assert.ok(result.ppd <= fixture.ppdMax, `${fixture.id} ppd ${result.ppd}`);
      }
      if ("ppdMin" in fixture && fixture.ppdMin != null) {
        assert.ok(result.ppd >= fixture.ppdMin, `${fixture.id} ppd ${result.ppd}`);
      }
    });
  }

  it("PPD is the ISO 7730 logistic and is 5% at PMV = 0", () => {
    assert.ok(Math.abs(iso7730PpdFromPmv(0) - 5) < 1e-9);
    const r = fangerPmvPpd({
      airTempC: 24.5,
      meanRadiantC: 24.5,
      airVelocityMs: 0.12,
      rhFrac: 0.5,
      met: 1.1,
      clo: 0.5,
    });
    const expected = Math.min(100, Math.max(5, iso7730PpdFromPmv(r.pmv)));
    assert.ok(Math.abs(r.ppd - expected) < 1e-6);
  });
});

describe("NSGA-II Pareto dominance", () => {
  it("minimising vectors: a dominates b iff a is ≤ all and < at least one", () => {
    assert.equal(dominates([1, 2], [2, 3]), true);
    assert.equal(dominates([2, 3], [1, 2]), false);
    assert.equal(dominates([1, 3], [2, 2]), false);
    assert.equal(dominates([2, 2], [1, 3]), false);
    assert.equal(dominates([1, 1], [1, 1]), false);
    assert.equal(dominates([0, 2], [1, 2]), true);
  });

  it("non-dominated sort isolates the Pareto front", () => {
    const pop: Nsga2Individual[] = [
      { x: [0], f: [1, 4], rank: -1, crowding: 0 },
      { x: [1], f: [2, 3], rank: -1, crowding: 0 },
      { x: [2], f: [4, 1], rank: -1, crowding: 0 },
      { x: [3], f: [3, 3.5], rank: -1, crowding: 0 },
    ];
    const fronts = nonDominatedSort(pop);
    assert.ok(fronts.length >= 2);
    const front0 = new Set(fronts[0].map((ind) => ind.f.join(",")));
    assert.equal(front0.has("1,4"), true);
    assert.equal(front0.has("2,3"), true);
    assert.equal(front0.has("4,1"), true);
    assert.equal(front0.has("3,3.5"), false);
    assert.equal(fronts[1].length, 1);
    assert.deepEqual(fronts[1][0].f, [3, 3.5]);
  });
});

describe("Monte Carlo hospital-capacity probability mass", () => {
  it("admissions and bed PMFs integrate to 1.0", () => {
    const result = runMonteCarlo({
      scenarioAdmissions24h: 120,
      scenarioBedDeficitPct: 4.2,
      acFailProbability: 0.12,
      iterations: 1000,
      seed: 20220719,
    });
    const adm = result.admissionsPmf.reduce((s, v) => s + v, 0);
    const beds = result.bedsPmf.reduce((s, v) => s + v, 0);
    assert.ok(Math.abs(adm - 1) < 1e-12, `admissions PMF ${adm}`);
    assert.ok(Math.abs(beds - 1) < 1e-12, `beds PMF ${beds}`);
    const empty = probabilityMass([], 16);
    assert.equal(empty.reduce((s, v) => s + v, 0), 1);
  });
});
