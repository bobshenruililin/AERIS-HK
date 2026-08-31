/**
 * Formal identities and analytical fixtures for the scientific verification harness.
 * Operational outdoor heat is ISO 7243 WBGT (VDI 3787-2 uses the same mix).
 * AERIS does not evaluate the Fiala UTCI polynomial or Klima-Michel PET.
 */
import { fangerPmvPpd } from "../biophysics";
import { SOL_AIR_HO_WM2K, roofAbsorbedShortwaveWm2, solAirTempC, solarElevationDeg } from "../solar";
import { FORMULAS } from "../formulas";

export const ISO_7243_OUTDOOR = { tw: 0.7, tg: 0.2, ta: 0.1 } as const;
export const ISO_7243_INDOOR = { tw: 0.7, tg: 0.3, ta: 0 } as const;

/** VDI 3787 Part 2 outdoor WBGT coefficients — identical to ISO 7243 outdoor. */
export const VDI_3787_2_OUTDOOR_WBGT = ISO_7243_OUTDOOR;

export function iso7243OutdoorWbgt(tw: number, tg: number, ta: number): number {
  return ISO_7243_OUTDOOR.tw * tw + ISO_7243_OUTDOOR.tg * tg + ISO_7243_OUTDOOR.ta * ta;
}

export function iso7243IndoorWbgt(tw: number, tg: number): number {
  return ISO_7243_INDOOR.tw * tw + ISO_7243_INDOOR.tg * tg;
}

export function iso7730PpdFromPmv(pmv: number): number {
  return 100 - 95 * Math.exp(-0.03353 * pmv ** 4 - 0.2179 * pmv ** 2);
}

/**
 * ISO 7730 Annex-style sedentary cases. Tolerances cover Newton Tcl iteration
 * differences versus the printed tables; PPD is the closed-form logistic.
 */
export const ISO_7730_CASES = [
  {
    id: "annex-neutral-office",
    airTempC: 22,
    meanRadiantC: 22,
    airVelocityMs: 0.1,
    rhFrac: 0.5,
    met: 1.2,
    clo: 0.5,
    pmvMin: -1.2,
    pmvMax: 0.15,
    ppdMax: 35,
  },
  {
    id: "annex-warm-still",
    airTempC: 27,
    meanRadiantC: 27,
    airVelocityMs: 0.1,
    rhFrac: 0.5,
    met: 1.2,
    clo: 0.5,
    pmvMin: 0.4,
    pmvMax: 1.6,
    ppdMin: 8,
  },
  {
    id: "annex-cool",
    airTempC: 20,
    meanRadiantC: 20,
    airVelocityMs: 0.1,
    rhFrac: 0.4,
    met: 1.2,
    clo: 0.5,
    pmvMin: -1.8,
    pmvMax: -0.2,
    ppdMin: 6,
  },
] as const;

export function evaluateIso7730Case(id: (typeof ISO_7730_CASES)[number]["id"]) {
  const fixture = ISO_7730_CASES.find((c) => c.id === id);
  if (!fixture) throw new Error(`unknown ISO 7730 case ${id}`);
  const result = fangerPmvPpd({
    airTempC: fixture.airTempC,
    meanRadiantC: fixture.meanRadiantC,
    airVelocityMs: fixture.airVelocityMs,
    rhFrac: fixture.rhFrac,
    met: fixture.met,
    clo: fixture.clo,
  });
  const logistic = iso7730PpdFromPmv(result.pmv);
  return { fixture, result, logistic };
}

export function solAirIdentity(outdoorTaC: number, absorbedWm2: number, ho = SOL_AIR_HO_WM2K): number {
  return outdoorTaC + absorbedWm2 / Math.max(1, ho);
}

export function solAirNightCollocated(hour: number, outdoorTaC: number, coolRoof: boolean): {
  elevationDeg: number;
  absorbed: number;
  tsa: number;
} {
  const elevationDeg = solarElevationDeg(hour);
  const absorbed = roofAbsorbedShortwaveWm2(hour, coolRoof);
  return { elevationDeg, absorbed, tsa: solAirTempC(outdoorTaC, absorbed) };
}

export const VERIFICATION_CATALOG = {
  solAir: FORMULAS["sol-air"].identity,
  utciAnalogue: FORMULAS.utci.identity,
  fanger: FORMULAS.pmv.identity,
  nsga2: FORMULAS.nsga2.identity,
  gagge: FORMULAS.gagge.identity,
} as const;
