import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FORMULAS, FORMULA_IDS, formulaById } from "../lib/formulas";
import { interpretHudKey } from "../lib/hotkeys";
import {
  WASM_PROBE_BYTES,
  canUseDuckDbWasm,
  canUseMonteCarloWorker,
  canUseParetoWorker,
  isBrowser,
  probeHealthyWebGL2,
  wasmSupported,
  workerAvailable,
} from "../lib/runtime-guards";
import { HEAT_RR_PER_C } from "../lib/decade";
import { MC_HEAT_RR_PER_C } from "../lib/monte-carlo";
import { fangerPmvPpd, solveWbgtDifferential } from "../lib/biophysics";

describe("runtime guards", () => {
  it("does not claim a browser or WebGL2 context under Node", () => {
    assert.equal(isBrowser(), false);
    assert.equal(probeHealthyWebGL2(), false);
    assert.equal(canUseDuckDbWasm(), false);
  });

  it("validates a minimal WASM module and never throws", () => {
    assert.equal(WASM_PROBE_BYTES[0], 0x00);
    assert.equal(WASM_PROBE_BYTES[1], 0x61);
    assert.equal(wasmSupported(), WebAssembly.validate(WASM_PROBE_BYTES));
    assert.equal(typeof workerAvailable(), "boolean");
    assert.equal(canUseMonteCarloWorker(), isBrowser() && workerAvailable());
    assert.equal(canUseParetoWorker(), isBrowser() && workerAvailable());
  });
});

describe("HUD keyboard grammar", () => {
  const idle = { typing: false, paletteOpen: false };

  it("maps 1–4 to dock presets", () => {
    for (const id of [1, 2, 3, 4] as const) {
      assert.deepEqual(interpretHudKey({ key: String(id), metaKey: false, ctrlKey: false, altKey: false }, idle), {
        type: "preset",
        id,
      });
    }
  });

  it("maps Space to timeline toggle", () => {
    assert.deepEqual(
      interpretHudKey({ key: " ", code: "Space", metaKey: false, ctrlKey: false, altKey: false }, idle),
      { type: "timeline-toggle" },
    );
  });

  it("maps Cmd+K / Ctrl+K to search even while typing", () => {
    assert.deepEqual(
      interpretHudKey({ key: "k", metaKey: true, ctrlKey: false, altKey: false }, { typing: true, paletteOpen: false }),
      { type: "search" },
    );
    assert.deepEqual(
      interpretHudKey({ key: "K", metaKey: false, ctrlKey: true, altKey: false }, idle),
      { type: "search" },
    );
  });

  it("maps Esc to dismiss", () => {
    assert.deepEqual(interpretHudKey({ key: "Escape", metaKey: false, ctrlKey: false, altKey: false }, idle), {
      type: "dismiss",
    });
  });

  it("ignores presets while the palette is open or the user is typing", () => {
    assert.equal(
      interpretHudKey({ key: "1", metaKey: false, ctrlKey: false, altKey: false }, { typing: false, paletteOpen: true }),
      null,
    );
    assert.equal(
      interpretHudKey({ key: " ", metaKey: false, ctrlKey: false, altKey: false }, { typing: true, paletteOpen: false }),
      null,
    );
  });
});

describe("formula catalog identities", () => {
  it("covers UTCI, PMV, and DLNM relative risk", () => {
    assert.ok(FORMULA_IDS.includes("utci"));
    assert.ok(FORMULA_IDS.includes("pmv"));
    assert.ok(FORMULA_IDS.includes("dlnm-rr"));
    assert.match(FORMULAS.utci.identity, /0\.7 Tw \+ 0\.2 Tg \+ 0\.1 Ta/);
    assert.match(FORMULAS.utci.identity, /ISO 7243/);
    assert.match(FORMULAS.utci.note, /Fiala/);
    assert.match(FORMULAS.pmv.identity, /PPD/);
    assert.match(FORMULAS.pmv.identity, /0\.303/);
    assert.match(FORMULAS["dlnm-rr"].identity, /0\.22/);
    assert.match(FORMULAS["dlnm-rr"].note, /DLNM/);
    assert.equal(formulaById("gagge").identity.includes("S = M"), true);
  });

  it("quotes the same RR coefficient the engines use", () => {
    assert.equal(HEAT_RR_PER_C, 0.22);
    assert.equal(MC_HEAT_RR_PER_C, 0.22);
    assert.match(FORMULAS["dlnm-rr"].identity, new RegExp(String(HEAT_RR_PER_C)));
  });

  it("ISO 7243 outdoor mix matches the WBGT solver", () => {
    const solved = solveWbgtDifferential({ ta: 34, rhFrac: 0.7, tg: 36, indoor: false });
    const expected = 0.7 * solved.tw + 0.2 * solved.tg + 0.1 * solved.ta;
    assert.ok(Math.abs(solved.wbgt - expected) < 1e-9);
    const indoor = solveWbgtDifferential({ ta: 34, rhFrac: 0.7, tg: 36, indoor: true });
    assert.ok(Math.abs(indoor.wbgt - (0.7 * indoor.tw + 0.3 * indoor.tg)) < 1e-9);
  });

  it("Fanger PPD is the ISO 7730 logistic of PMV", () => {
    const r = fangerPmvPpd({
      airTempC: 30,
      meanRadiantC: 31,
      airVelocityMs: 0.1,
      rhFrac: 0.65,
      met: 1.1,
      clo: 0.5,
    });
    const expected = 100 - 95 * Math.exp(-0.03353 * r.pmv ** 4 - 0.2179 * r.pmv ** 2);
    assert.ok(Math.abs(r.ppd - Math.min(100, Math.max(5, expected))) < 1e-6);
  });
});
