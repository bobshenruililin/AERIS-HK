import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DECADE_EPISODES,
  applyEpisodeAnomaly,
  counterfactualAverted,
  decadeCumulativeAverted,
  episodeById,
  episodeRelativeRisk,
} from "../lib/decade";
import { knapsackEnsembleBand } from "../lib/ensemble";
import { getBuildings } from "../lib/spatial-data";
import type { CoolRoofCandidate, HkoDiurnalEnvelope } from "../lib/types";

describe("decade observatory", () => {
  it("archives eleven summers 2016–2026", () => {
    assert.equal(DECADE_EPISODES.length, 11);
    assert.equal(DECADE_EPISODES[0].year, 2016);
    assert.equal(DECADE_EPISODES[10].year, 2026);
    assert.equal(episodeById("2023").hkoStatus, "SPECIAL_HEAT_STRESS_BLACK");
  });

  it("makes 2023 hotter than the live 2026 envelope", () => {
    assert.ok(episodeById("2023").anomalyC > episodeById("2026").anomalyC);
    assert.ok(episodeRelativeRisk(episodeById("2023")) > episodeRelativeRisk(episodeById("2026")));
  });

  it("scales counterfactual averted with relative risk and sums the decade", () => {
    const live = 100;
    const y2023 = counterfactualAverted(live, episodeById("2023"));
    assert.ok(y2023 > live);
    const sum = decadeCumulativeAverted(live);
    assert.ok(sum > live * 8);
  });

  it("shifts the HKO envelope air temperature by the episode anomaly", () => {
    const envelope: HkoDiurnalEnvelope = {
      generatedAt: "2026-08-30T00:00:00.000Z",
      timezone: "Asia/Hong_Kong",
      source: "hko-open-data",
      degraded: false,
      degradeReason: null,
      nowHour: 15,
      kowloonAirTempC: 30,
      kowloonRhFrac: 0.8,
      stations: [{ name: "Sham Shui Po", airTempC: 31, rhPercent: 80 }],
      warning: {
        veryHotWeatherWarning: false,
        actionCode: null,
        code: null,
        nameEn: "",
        nameZh: "",
        issueTime: null,
        updateTime: null,
      },
      forecast: null,
      hours: [{ hour: 15, airTempC: 33, rhFrac: 0.7, origin: "observed" }],
      observedHours: 1,
      forecastHours: 0,
      blendedHours: 0,
    };
    const shifted = applyEpisodeAnomaly(envelope, episodeById("2023"));
    assert.ok(shifted);
    assert.ok(Math.abs((shifted?.kowloonAirTempC ?? 0) - (30 + episodeById("2023").anomalyC)) < 1e-9);
  });
});

describe("knapsack ensemble", () => {
  it("reports p10 ≤ p50 ≤ p90", () => {
    const candidates: CoolRoofCandidate[] = [
      { buildingId: "a", roofM2: 60, admissionsAverted: 12, efficiency: 12 / 60 },
      { buildingId: "b", roofM2: 50, admissionsAverted: 5, efficiency: 5 / 50 },
      { buildingId: "c", roofM2: 40, admissionsAverted: 2, efficiency: 2 / 40 },
    ];
    const band = knapsackEnsembleBand(candidates, 100, 150, 24, 7);
    assert.ok(band.p10 <= band.p50 + 1e-9);
    assert.ok(band.p50 <= band.p90 + 1e-9);
    assert.equal(band.draws, 24);
  });
});

describe("city-scale infill", () => {
  it("densifies the twin well past the original 88 footprints", () => {
    const n = getBuildings().length;
    assert.ok(n >= 150, `expected ≥150 buildings, got ${n}`);
  });
});
