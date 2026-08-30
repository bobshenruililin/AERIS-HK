/**
 * ISO 7730 Fanger PMV-PPD and a Newton WBGT differential solver,
 * plus the 劏房 uninsulated-concrete 4-hour thermal battery.
 *
 * Gagge two-node (S = M − W − E − R − C) stays in epidemiology-engine.ts.
 * This module is additive: comfort indices, wet-bulb globe, night lag.
 */
import { clamp, lerp, wrapHour } from "./utils";

/** Concrete fabric time constant for uninsulated tong-lau / subdivided flats (hours). */
export const CONCRETE_THERMAL_BATTERY_TAU_H = 4;

/** Indoor hazard that must persist until 03:00 HKT in dense 劏房 after a hot afternoon. */
export const SUBDIVIDED_NIGHT_HAZARD_C = 34;

/** Last charging hour for AC-rejector + fabric storage (HKT). */
export const BATTERY_CHARGE_HOUR = 23;

export interface FangerInput {
  airTempC: number;
  meanRadiantC: number;
  airVelocityMs: number;
  rhFrac: number;
  /** Metabolic rate in met (1 met = 58.15 W/m²). */
  met: number;
  clo: number;
  externalWorkMet?: number;
}

export interface FangerResult {
  pmv: number;
  ppd: number;
  clothingTempC: number;
  iterations: number;
}

export interface WbgtSolution {
  tw: number;
  tg: number;
  ta: number;
  wbgt: number;
  dWbgtDTa: number;
  dWbgtDRh: number;
  indoor: boolean;
}

function satVaporPa(tempC: number): number {
  return 1000 * Math.exp(16.6536 - 4030.183 / (tempC + 235));
}

/**
 * ISO 7730 / ASHRAE 55 Fanger PMV with iterative clothing-surface temperature.
 */
export function fangerPmvPpd(input: FangerInput): FangerResult {
  const ta = input.airTempC;
  const tr = input.meanRadiantC;
  const vel = Math.max(0.05, input.airVelocityMs);
  const rhPct = clamp(input.rhFrac, 0.01, 0.99) * 100;
  const met = Math.max(0.7, input.met);
  const clo = Math.max(0.01, input.clo);
  const wme = input.externalWorkMet ?? 0;

  const pa = rhPct * 10 * Math.exp(16.6536 - 4030.183 / (ta + 235));
  const icl = 0.155 * clo;
  const m = met * 58.15;
  const w = wme * 58.15;
  const mw = m - w;

  const fcl = icl <= 0.078 ? 1 + 1.29 * icl : 1.05 + 0.645 * icl;
  const hcf = 12.1 * Math.sqrt(vel);
  const taa = ta + 273;
  const tra = tr + 273;

  const p1 = icl * fcl;
  const p2 = p1 * 3.96;
  const p3 = p1 * 100;
  const p4 = p1 * taa;
  const p5 = 308.7 - 0.028 * mw + p2 * (tra / 100) ** 4;

  let xf = (taa + (35.5 - ta) / (3.5 * icl + 0.1)) / 50;
  let xn = xf / 2;
  let n = 0;
  const eps = 0.00015;
  let hc = hcf;
  while (Math.abs(xn - xf) > eps && n < 160) {
    xf = (xf + xn) / 2;
    hc = 2.38 * Math.abs(100 * xf - taa) ** 0.25;
    if (hcf > hc) hc = hcf;
    xn = (p5 + p4 * hc - p2 * xf ** 4) / (100 + p3 * hc);
    n += 1;
  }

  const tcl = 100 * xn - 273;
  const hl1 = 3.05 * 0.001 * (5733 - 6.99 * mw - pa);
  const hl2 = mw > 58.15 ? 0.42 * (mw - 58.15) : 0;
  const hl3 = 1.7e-5 * m * (5867 - pa);
  const hl4 = 0.0014 * m * (34 - ta);
  const hl5 = 3.96 * fcl * (xn ** 4 - (tra / 100) ** 4);
  const hl6 = fcl * hc * (tcl - ta);
  const ts = 0.303 * Math.exp(-0.036 * m) + 0.028;
  const pmv = clamp(ts * (mw - hl1 - hl2 - hl3 - hl4 - hl5 - hl6), -3, 3);
  const ppd = clamp(100 - 95 * Math.exp(-0.03353 * pmv ** 4 - 0.2179 * pmv ** 2), 5, 100);

  return { pmv, ppd, clothingTempC: tcl, iterations: n };
}

/**
 * Psychrometric wet-bulb via Newton on the Stull residual + ISO 7243 WBGT mix.
 * Returns local derivatives dWBGT/dTa and dWBGT/dRH for the differential solver.
 */
export function solveWbgtDifferential(opts: {
  ta: number;
  rhFrac: number;
  tg: number;
  indoor?: boolean;
}): WbgtSolution {
  const ta = opts.ta;
  const rh = clamp(opts.rhFrac, 0.05, 0.99);
  const tg = opts.tg;
  const indoor = Boolean(opts.indoor);

  let tw = stullWetBulb(ta, rh);
  for (let i = 0; i < 8; i += 1) {
    const residual = wetBulbResidual(ta, rh, tw);
    const dRes = (wetBulbResidual(ta, rh, tw + 0.05) - residual) / 0.05;
    tw -= residual / (Math.abs(dRes) < 1e-6 ? 1 : dRes);
  }
  tw = clamp(tw, ta - 14, ta);

  const wbgt = indoor ? 0.7 * tw + 0.3 * tg : 0.7 * tw + 0.2 * tg + 0.1 * ta;
  const epsT = 0.15;
  const epsR = 0.01;
  const wbgtT = isoWbgt(ta + epsT, rh, tg + 0.4 * epsT, indoor);
  const wbgtR = isoWbgt(ta, clamp(rh + epsR, 0.05, 0.99), tg, indoor);
  return {
    tw,
    tg,
    ta,
    wbgt,
    dWbgtDTa: (wbgtT - wbgt) / epsT,
    dWbgtDRh: (wbgtR - wbgt) / epsR,
    indoor,
  };
}

function isoWbgt(ta: number, rh: number, tg: number, indoor: boolean): number {
  const tw = stullWetBulb(ta, rh);
  return indoor ? 0.7 * tw + 0.3 * tg : 0.7 * tw + 0.2 * tg + 0.1 * ta;
}

function wetBulbResidual(ta: number, rh: number, tw: number): number {
  const pa = rh * satVaporPa(ta);
  const pTw = satVaporPa(tw);
  const guessed = pTw - 66.5 * (1 + 0.00115 * tw) * (ta - tw);
  return guessed - pa;
}

export function stullWetBulb(ta: number, rhFrac: number): number {
  const rh = clamp(rhFrac * 100, 5, 99);
  return (
    ta * Math.atan(0.151977 * Math.sqrt(rh + 8.313659)) +
    Math.atan(ta + rh) -
    Math.atan(rh - 1.676331) +
    0.00391838 * rh ** 1.5 * Math.atan(0.023101 * rh) -
    4.686035
  );
}

/**
 * Night-only weight so 15:00 cool-roof tests are unchanged (daytime live canyon dominates).
 */
export function nightBatteryWeight(hour: number): number {
  const h = wrapHour(hour);
  if (h >= 21 || h <= 5) return 1;
  if (h > 5 && h < 8) return clamp((8 - h) / 3, 0, 1);
  if (h >= 18 && h < 21) return clamp((h - 18) / 3, 0, 1);
  return 0;
}

export function hoursSinceCharge(hour: number, chargeHour = BATTERY_CHARGE_HOUR): number {
  const h = wrapHour(hour);
  return (h - chargeHour + 24) % 24;
}

/**
 * Uninsulated concrete 劏房 thermal battery: heat stored from the evening AC-rejector
 * peak decays with τ = 4 h, so indoor air stays above 34°C through 03:00 HKT in
 * high-density flats after a hot afternoon — without flooring daytime indoor T.
 */
export function subdividedFlatThermalBatteryC(opts: {
  hour: number;
  liveIndoorC: number;
  chargeIndoorC: number;
  subdividedFlatDensity: number;
}): number {
  const density = clamp(opts.subdividedFlatDensity, 0, 1);
  const night = nightBatteryWeight(opts.hour);
  if (night <= 1e-6 || density < 0.35) return 0;
  const dt = hoursSinceCharge(opts.hour);
  const decay = Math.exp(-dt / CONCRETE_THERMAL_BATTERY_TAU_H);
  const stored = Math.max(0, opts.chargeIndoorC - opts.liveIndoorC);
  const trap = 3.15 * density * decay;
  return night * (stored * density * decay + trap);
}

export function applySubdividedFlatThermalLag(
  hour: number,
  liveIndoorC: number,
  chargeIndoorC: number,
  subdividedFlatDensity: number,
): { indoorC: number; batteryC: number } {
  const batteryC = subdividedFlatThermalBatteryC({
    hour,
    liveIndoorC,
    chargeIndoorC,
    subdividedFlatDensity,
  });
  return { indoorC: liveIndoorC + batteryC, batteryC };
}

export function summerClo(hour: number): number {
  const h = wrapHour(hour);
  return h >= 22 || h <= 6 ? 0.4 : 0.5;
}

export function metFromGaggeWm2(metabolicRateWm2: number): number {
  return metabolicRateWm2 / 58.15;
}

export function ppdArrivalMultiplier(ppd: number): number {
  return 1 + 0.1 * clamp(ppd / 100, 0, 1);
}

/** Comfort / hazard blend used by inspector telemetry. */
export function wbgtSpreadC(outdoorWbgt: number, indoorWbgt: number): number {
  return indoorWbgt - outdoorWbgt;
}

export function lerpFanger(a: FangerResult, b: FangerResult, t: number): FangerResult {
  return {
    pmv: lerp(a.pmv, b.pmv, t),
    ppd: lerp(a.ppd, b.ppd, t),
    clothingTempC: lerp(a.clothingTempC, b.clothingTempC, t),
    iterations: Math.round(lerp(a.iterations, b.iterations, t)),
  };
}
