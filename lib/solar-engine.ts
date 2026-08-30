/**
 * Astronomical solar ray & canyon-shadow engine for Hong Kong.
 *
 * Coordinates are the territory centroid requested by the overnight brief
 * (22.3193° N, 114.1694° E), distinct from the Kowloon twin look-at in
 * lib/solar.ts. Both engines remain: solar.ts keeps Deck.gl lighting;
 * this module drives canyon insolation and the diurnal scrubber HUD.
 */
import { clamp, wrapHour, wrap360 } from "./utils";

export const SOLAR_ENGINE_LAT = 22.3193;
export const SOLAR_ENGINE_LON = 114.1694;
export const SOLAR_ENGINE_TZ = 8;
/** 19 July 2022 — historic heatwave day-of-year. */
export const SOLAR_ENGINE_DOY = 200;
/** Pei Ho Street canyon aspect (H/W) from the overnight brief. */
export const PEI_HO_CANYON_HW = 3.5;
/** Pei Ho Street runs ~N–S (degrees clockwise from north). */
export const PEI_HO_CANYON_AXIS_DEG = 8;
/** Extra-terrestrial solar constant, W/m². */
export const SOLAR_CONSTANT_WM2 = 1367;
/** Typical asphalt-roof peak absorbed shortwave used by the twin. */
export const CANYON_BEAM_PEAK_WM2 = 890;

export interface SolarPosition {
  elevationDeg: number;
  azimuthDeg: number;
  zenithDeg: number;
  hourAngleDeg: number;
  declinationDeg: number;
  airMass: number;
}

export interface CanyonInsolation {
  elevationDeg: number;
  azimuthDeg: number;
  canyonHw: number;
  canyonAxisDeg: number;
  /** Remaining direct-beam fraction on the canyon floor (0–1). */
  directBeamFrac: number;
  /** True when the floor is in geometric shadow. */
  shadowed: boolean;
  /** Direct beam after canyon occlusion, W/m². */
  directBeamWm2: number;
  /** Diffuse (SVF-scaled) remainder, W/m². */
  diffuseWm2: number;
  /** Combined canyon shortwave, W/m². */
  totalWm2: number;
}

function declinationRad(dayOfYear: number): number {
  return 0.4093 * Math.sin((2 * Math.PI * (284 + dayOfYear)) / 365);
}

function equationOfTimeMin(dayOfYear: number): number {
  const b = (2 * Math.PI * (dayOfYear - 81)) / 364;
  return 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
}

/**
 * NOAA-style solar position at the Hong Kong centroid, HKT local hour.
 */
export function solarPositionHk(
  hourHkt: number,
  dayOfYear = SOLAR_ENGINE_DOY,
  latDeg = SOLAR_ENGINE_LAT,
  lonDeg = SOLAR_ENGINE_LON,
): SolarPosition {
  const h = wrapHour(hourHkt);
  const lat = (latDeg * Math.PI) / 180;
  const dec = declinationRad(dayOfYear);
  const lstm = 15 * SOLAR_ENGINE_TZ;
  const eot = equationOfTimeMin(dayOfYear);
  const tc = 4 * (lonDeg - lstm) + eot;
  const lst = h + tc / 60;
  const hourAngleDeg = 15 * (lst - 12);
  const hourAngle = (hourAngleDeg * Math.PI) / 180;
  const sinEl = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(hourAngle);
  const elevationDeg = (Math.asin(clamp(sinEl, -1, 1)) * 180) / Math.PI;
  const zenithDeg = 90 - elevationDeg;
  const elev = (elevationDeg * Math.PI) / 180;
  const cosAz =
    (Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.sin(lat) * Math.cos(hourAngle)) /
    Math.max(1e-6, Math.cos(elev));
  const azSouth = Math.acos(clamp(cosAz, -1, 1));
  const az = hourAngle > 0 ? Math.PI + azSouth : Math.PI - azSouth;
  const azimuthDeg = wrap360((az * 180) / Math.PI);
  const zRad = (Math.max(0, zenithDeg) * Math.PI) / 180;
  const airMass =
    elevationDeg <= 0 ? 40 : 1 / Math.max(0.04, Math.cos(zRad) + 0.50572 * (96.07995 - zenithDeg) ** -1.6364);
  return {
    elevationDeg,
    azimuthDeg,
    zenithDeg,
    hourAngleDeg,
    declinationDeg: (dec * 180) / Math.PI,
    airMass,
  };
}

/**
 * Direct-beam transmittance through an infinite street canyon (Oke / Arnfield).
 * Floor is sunlit when tan(elevation) exceeds (H/W) · |sin(azimuth − street axis)|.
 */
export function canyonDirectBeamFraction(opts: {
  elevationDeg: number;
  azimuthDeg: number;
  canyonHw: number;
  canyonAxisDeg: number;
}): number {
  if (opts.elevationDeg <= 0.15) return 0;
  const el = (opts.elevationDeg * Math.PI) / 180;
  const hw = Math.max(0.15, opts.canyonHw);
  const delta = ((opts.azimuthDeg - opts.canyonAxisDeg) * Math.PI) / 180;
  const wallFactor = Math.max(0.08, Math.abs(Math.sin(delta)));
  const threshold = Math.atan(hw * wallFactor);
  if (el >= threshold) return 1;
  const ratio = Math.tan(el) / Math.max(1e-4, hw * wallFactor);
  return clamp(ratio, 0, 1);
}

export function canyonShadowed(opts: {
  elevationDeg: number;
  azimuthDeg: number;
  canyonHw: number;
  canyonAxisDeg: number;
}): boolean {
  return canyonDirectBeamFraction(opts) < 0.5;
}

/** Clear-sky direct normal irradiance (Ineichen-lite), W/m². */
export function clearSkyDniWm2(position: SolarPosition, cloudCover = 0): number {
  if (position.elevationDeg <= 0) return 0;
  const am = clamp(position.airMass, 1, 38);
  const turbidity = 3.2;
  const dni = SOLAR_CONSTANT_WM2 * Math.exp(-0.14 * turbidity * am) * Math.max(0, Math.sin((position.elevationDeg * Math.PI) / 180));
  return dni * (1 - 0.84 * clamp(cloudCover, 0, 1));
}

export function canyonInsolation(opts: {
  hourHkt: number;
  canyonHw: number;
  canyonAxisDeg: number;
  cloudCover?: number;
  dayOfYear?: number;
}): CanyonInsolation {
  const pos = solarPositionHk(opts.hourHkt, opts.dayOfYear);
  const frac = canyonDirectBeamFraction({
    elevationDeg: pos.elevationDeg,
    azimuthDeg: pos.azimuthDeg,
    canyonHw: opts.canyonHw,
    canyonAxisDeg: opts.canyonAxisDeg,
  });
  const dni = clearSkyDniWm2(pos, opts.cloudCover ?? 0);
  const beam = dni * frac;
  const svf = 1 / Math.sqrt(1 + opts.canyonHw * opts.canyonHw);
  const diffuse = 0.22 * CANYON_BEAM_PEAK_WM2 * Math.max(0, pos.elevationDeg / 90) * svf * (1 - 0.45 * (opts.cloudCover ?? 0));
  return {
    elevationDeg: pos.elevationDeg,
    azimuthDeg: pos.azimuthDeg,
    canyonHw: opts.canyonHw,
    canyonAxisDeg: opts.canyonAxisDeg,
    directBeamFrac: frac,
    shadowed: frac < 0.5,
    directBeamWm2: beam,
    diffuseWm2: diffuse,
    totalWm2: beam + diffuse,
  };
}

/** Convenience: Pei Ho Street H/W ≈ 3.5 at the live scrubber hour. */
export function peiHoCanyonInsolation(hourHkt: number, cloudCover = 0): CanyonInsolation {
  return canyonInsolation({
    hourHkt,
    canyonHw: PEI_HO_CANYON_HW,
    canyonAxisDeg: PEI_HO_CANYON_AXIS_DEG,
    cloudCover,
  });
}

export interface EnuShadowPoint {
  east: number;
  north: number;
  up: number;
}

/**
 * Intersect a roof/wall vertex with the ground plane along the incoming
 * solar travel vector (Deck.gl z-up, same convention as `sunDirectionVec`).
 */
export function castGroundShadowInto(
  out: EnuShadowPoint,
  point: EnuShadowPoint,
  sunTravel: [number, number, number],
): EnuShadowPoint {
  const sz = sunTravel[2];
  if (sz >= -1e-4 || point.up <= 0.05) {
    out.east = point.east;
    out.north = point.north;
    out.up = 0;
    return out;
  }
  const t = -point.up / sz;
  out.east = point.east + t * sunTravel[0];
  out.north = point.north + t * sunTravel[1];
  out.up = 0.05;
  return out;
}

export function castGroundShadow(
  point: EnuShadowPoint,
  sunTravel: [number, number, number],
): EnuShadowPoint {
  return castGroundShadowInto({ east: 0, north: 0, up: 0 }, point, sunTravel);
}

/** Apparent sun position in local ENU metres from a look-at. Azimuth clockwise from north. */
export function sunEnuFromLookAtInto(
  out: EnuShadowPoint,
  originEast: number,
  originNorth: number,
  elevationDeg: number,
  azimuthDeg: number,
  distanceM = 2400,
): EnuShadowPoint {
  const el = (elevationDeg * Math.PI) / 180;
  const az = (azimuthDeg * Math.PI) / 180;
  const horiz = Math.cos(el) * distanceM;
  out.east = originEast + Math.sin(az) * horiz;
  out.north = originNorth + Math.cos(az) * horiz;
  out.up = Math.max(28, Math.sin(el) * distanceM);
  return out;
}

export function sunEnuFromLookAt(
  originEast: number,
  originNorth: number,
  elevationDeg: number,
  azimuthDeg: number,
  distanceM = 2400,
): EnuShadowPoint {
  return sunEnuFromLookAtInto({ east: 0, north: 0, up: 0 }, originEast, originNorth, elevationDeg, azimuthDeg, distanceM);
}

/** Roof still sees the sky; only the beam is cloud-scaled. */
export function roofAbsorbedWithCloudWm2(hourHkt: number, coolRoof: boolean, cloudCover = 0): number {
  const pos = solarPositionHk(hourHkt);
  if (pos.elevationDeg <= 0) return 0;
  const index = Math.pow(Math.sin((pos.elevationDeg * Math.PI) / 180), 1.15);
  const albedo = coolRoof ? 0.65 : 0.18;
  return CANYON_BEAM_PEAK_WM2 * index * (1 - albedo) * (1 - 0.72 * clamp(cloudCover, 0, 1));
}
