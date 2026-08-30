import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import {
  fetchSimulationList,
  fetchSimulationSnapshot,
  invalidateSimulationCache,
  simulationCacheStats,
} from "../lib/sim-cache";

describe("simulation SWR cache", () => {
  const originalFetch = globalThis.fetch;

  after(() => {
    globalThis.fetch = originalFetch;
    invalidateSimulationCache();
  });

  it("dedupes in-flight list fetches and serves a TTL hit", async () => {
    invalidateSimulationCache();
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 20));
      return new Response(
        JSON.stringify({ neon: true, buildingCount: 168, runs: [], neonError: null }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const [a, b] = await Promise.all([fetchSimulationList(), fetchSimulationList()]);
    assert.equal(calls, 1, "in-flight list requests must share one HTTP round-trip");
    assert.equal(a.buildingCount, 168);
    assert.equal(b.buildingCount, 168);
    const c = await fetchSimulationList();
    assert.equal(calls, 1, "TTL cache must skip a redundant list query");
    assert.equal(c.buildingCount, 168);
    assert.equal(simulationCacheStats().listCached, true);
  });

  it("caches snapshots by id and invalidates on demand", async () => {
    invalidateSimulationCache();
    let calls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      calls += 1;
      const url = String(input);
      if (url.includes("/api/simulations/run-1")) {
        return new Response(
          JSON.stringify({
            id: "run-1",
            scenario_name: "cached",
            created_at: new Date().toISOString(),
            ambient_temp_c: 33,
            relative_humidity: 0.7,
            wind_speed_ms: 1,
            ac_failure_rate: 0,
            policy_modifiers: {},
            total_averted_ed_visits: 1,
            hourly: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("missing", { status: 404 });
    }) as typeof fetch;

    const first = await fetchSimulationSnapshot("run-1");
    const second = await fetchSimulationSnapshot("run-1");
    assert.ok(first);
    assert.equal(first?.id, second?.id);
    assert.equal(calls, 1);
    assert.equal(simulationCacheStats().snapshotCount, 1);
    invalidateSimulationCache("run-1");
    assert.equal(simulationCacheStats().snapshotCount, 0);
  });
});
