import { wrapHour } from "./utils";

const HK_LAT = 22.3307;
const HK_LON = 114.1628;
const HK_TZ = 8;
const HEAT_EPISODE_DOY = 202;

function declinationRad(dayOfYear: number): number {
  return 0.4093 * Math.sin((2 * Math.PI * (284 + dayOfYear)) / 365);
}

export function solarElevationDeg(hour: number, dayOfYear = HEAT_EPISODE_DOY): number {
  const h = wrapHour(hour);
  const lat = (HK_LAT * Math.PI) / 180;
  const dec = declinationRad(dayOfYear);
  const lstm = 15 * HK_TZ;
  const b = (2 * Math.PI * (dayOfYear - 81)) / 364;
  const eot = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
  const tc = 4 * (HK_LON - lstm) + eot;
  const lst = h + tc / 60;
  const hourAngle = 15 * (lst - 12) * (Math.PI / 180);
  const sinEl =
    Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(hourAngle);
  return (Math.asin(Math.max(-1, Math.min(1, sinEl))) * 180) / Math.PI;
}

export function solarRadiationIndex(hour: number): number {
  const el = solarElevationDeg(hour);
  if (el <= 0) return 0;
  return Math.pow(Math.sin((el * Math.PI) / 180), 1.15);
}

export function isDaylight(hour: number): boolean {
  return solarElevationDeg(hour) > 0;
}

/** Solar azimuth in degrees clockwise from north. */
export function solarAzimuthDeg(hour: number, dayOfYear = HEAT_EPISODE_DOY): number {
  const h = wrapHour(hour);
  const lat = (HK_LAT * Math.PI) / 180;
  const dec = declinationRad(dayOfYear);
  const lstm = 15 * HK_TZ;
  const b = (2 * Math.PI * (dayOfYear - 81)) / 364;
  const eot = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
  const tc = 4 * (HK_LON - lstm) + eot;
  const lst = h + tc / 60;
  const hourAngle = 15 * (lst - 12) * (Math.PI / 180);
  const elev = solarElevationDeg(h, dayOfYear) * (Math.PI / 180);
  const cosAz =
    (Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.sin(lat) * Math.cos(hourAngle)) /
    Math.max(1e-6, Math.cos(elev));
  const azSouth = Math.acos(Math.max(-1, Math.min(1, cosAz)));
  const az = hourAngle > 0 ? Math.PI + azSouth : Math.PI - azSouth;
  return ((az * 180) / Math.PI + 360) % 360;
}

/** Deck.gl DirectionalLight vector (z-up): sunlight arriving from this direction. */
export function sunDirectionVec(hour: number): [number, number, number] {
  const el = (solarElevationDeg(hour) * Math.PI) / 180;
  const az = (solarAzimuthDeg(hour) * Math.PI) / 180;
  const cosEl = Math.cos(el);
  return [-Math.sin(az) * cosEl, -Math.cos(az) * cosEl, -Math.sin(Math.max(el, 0.02))];
}

/**
 * Sol-Air Equation: Eq. 3
 * q_abs = I_peak · sin^{1.15}(γ_s) · (1 − ρ)
 * ρ_asphalt = 0.18, ρ_cool = 0.65
 */
export const SOL_AIR_HO_WM2K = 22;
export const SOL_AIR_CRITICAL_C = 40;

export function roofAbsorbedShortwaveWm2(hour: number, coolRoof: boolean): number {
  const peak = 890;
  const albedo = coolRoof ? 0.65 : 0.18;
  return peak * solarRadiationIndex(hour) * (1 - albedo);
}

/** Sol-air temperature from absorbed shortwave and outdoor dry-bulb. */
export function solAirTempC(outdoorTaC: number, absorbedWm2: number, ho = SOL_AIR_HO_WM2K): number {
  return outdoorTaC + absorbedWm2 / Math.max(1, ho);
}
