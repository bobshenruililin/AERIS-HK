import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bandFromSamples, MC_ITERATIONS, quantileLinear, runMonteCarlo } from "../lib/monte-carlo";

describe("Monte Carlo policy stress-tester", () => {
  it("runs 1,000 draws with a nested 95% CI", () => {
    const t0 = Date.now();
    const result = runMonteCarlo({
      scenarioAdmissions24h: 120,
      scenarioBedDeficitPct: 4.2,
      acFailProbability: 0.12,
      iterations: MC_ITERATIONS,
      seed: 20220719,
    });
    const ms = Date.now() - t0;
    assert.equal(result.iterations, 1000);
    assert.ok(result.admissions.p025 <= result.admissions.p50);
    assert.ok(result.admissions.p50 <= result.admissions.p975);
    assert.ok(result.bedDeficitPct.p025 <= result.bedDeficitPct.p975);
    assert.equal(result.violinAdmissions.length, 32);
    assert.ok(ms < 400, `MC too slow: ${ms} ms`);
  });

  it("raises mean presentations when AC-grid failure probability is 1", () => {
    const calm = runMonteCarlo({
      scenarioAdmissions24h: 100,
      scenarioBedDeficitPct: 3,
      acFailProbability: 0,
      iterations: 800,
      seed: 7,
    });
    const blackout = runMonteCarlo({
      scenarioAdmissions24h: 100,
      scenarioBedDeficitPct: 3,
      acFailProbability: 1,
      iterations: 800,
      seed: 7,
    });
    assert.ok(blackout.admissions.mean > calm.admissions.mean);
    assert.ok(blackout.bedDeficitPct.mean > calm.bedDeficitPct.mean);
  });

  it("interpolates quantiles linearly", () => {
    const sorted = [0, 10, 20, 30];
    assert.equal(quantileLinear(sorted, 0), 0);
    assert.equal(quantileLinear(sorted, 1), 30);
    assert.ok(Math.abs(quantileLinear(sorted, 0.5) - 15) < 1e-9);
    const band = bandFromSamples([2, 4, 6, 8, 10]);
    assert.ok(band.p025 < band.p975);
  });
});
