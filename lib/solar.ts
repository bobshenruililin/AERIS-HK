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
