/**
 * Hong Kong 1980 Grid (EPSG:2326) ↔ WGS84 (EPSG:4326)
 *
 * Pipeline:
 *   HK80 Grid  ↔  Transverse Mercator on International 1924  ↔  HK80 geographic
 *               ↔  7-parameter Helmert (EPSG:2326 TOWGS84)   ↔  WGS84 geographic
 *
 * Parameters follow the Lands Department / EPSG:2326 definition.
 */

export interface Wgs84Point {
  lon: number;
  lat: number;
}

export interface Hk80Point {
  easting: number;
  northing: number;
}

const DEG = Math.PI / 180;
const ARCSEC = Math.PI / 648000;

const INTL1924_A = 6378388.0;
const INTL1924_F = 1 / 297;
const INTL1924_B = INTL1924_A * (1 - INTL1924_F);
const INTL1924_E2 =
  (INTL1924_A * INTL1924_A - INTL1924_B * INTL1924_B) / (INTL1924_A * INTL1924_A);

const WGS84_A = 6378137.0;
const WGS84_F = 1 / 298.257223563;
const WGS84_B = WGS84_A * (1 - WGS84_F);
const WGS84_E2 = (WGS84_A * WGS84_A - WGS84_B * WGS84_B) / (WGS84_A * WGS84_A);

const TM_LAT0 = 22.31213333333334 * DEG;
const TM_LON0 = 114.1785555555556 * DEG;
const TM_K0 = 1.0;
const TM_FE = 836694.05;
const TM_FN = 819069.8;

const HELMERT = {
  dx: -162.619,
  dy: -276.959,
  dz: -161.764,
  rx: 0.067753 * ARCSEC,
  ry: -2.243649 * ARCSEC,
  rz: -1.158827 * ARCSEC,
  s: -1.094246e-6,
};

function geodeticToEcef(
  lonDeg: number,
  latDeg: number,
  a: number,
  e2: number,
  h = 0,
): [number, number, number] {
  const lon = lonDeg * DEG;
  const lat = latDeg * DEG;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const n = a / Math.sqrt(1 - e2 * sinLat * sinLat);
  const x = (n + h) * cosLat * Math.cos(lon);
  const y = (n + h) * cosLat * Math.sin(lon);
  const z = (n * (1 - e2) + h) * sinLat;
  return [x, y, z];
}

function ecefToGeodetic(
  x: number,
  y: number,
  z: number,
  a: number,
  e2: number,
): Wgs84Point {
  const lon = Math.atan2(y, x);
  const p = Math.hypot(x, y);
  let lat = Math.atan2(z, p * (1 - e2));
  for (let i = 0; i < 12; i += 1) {
    const sinLat = Math.sin(lat);
    const n = a / Math.sqrt(1 - e2 * sinLat * sinLat);
    const h = p / Math.cos(lat) - n;
    const latNext = Math.atan2(z, p * (1 - (e2 * n) / (n + h)));
    if (Math.abs(latNext - lat) < 1e-14) {
      lat = latNext;
      break;
    }
    lat = latNext;
  }
  return { lon: lon / DEG, lat: lat / DEG };
}

function applyHelmert(
  x: number,
  y: number,
  z: number,
  inverse: boolean,
): [number, number, number] {
  const { dx, dy, dz, rx, ry, rz, s } = HELMERT;
  if (!inverse) {
    const xp = x * (1 + s) + z * ry - y * rz + dx;
    const yp = y * (1 + s) - z * rx + x * rz + dy;
    const zp = z * (1 + s) + y * rx - x * ry + dz;
    return [xp, yp, zp];
  }
  const xm = x - dx;
  const ym = y - dy;
  const zm = z - dz;
  const xp = xm * (1 - s) - zm * ry + ym * rz;
  const yp = ym * (1 - s) + zm * rx - xm * rz;
  const zp = zm * (1 - s) - ym * rx + xm * ry;
  return [xp, yp, zp];
}

function meridionalArc(lat: number): number {
  const e2 = INTL1924_E2;
  const e4 = e2 * e2;
  const e6 = e4 * e2;
  const n = INTL1924_A;
  const A0 = 1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256;
  const A2 = (3 / 8) * (e2 + e4 / 4 + (15 * e6) / 128);
  const A4 = (15 / 256) * (e4 + (3 * e6) / 4);
  const A6 = (35 * e6) / 3072;
  return n * (A0 * lat - A2 * Math.sin(2 * lat) + A4 * Math.sin(4 * lat) - A6 * Math.sin(6 * lat));
}

export function hk80GeographicToGrid(lonDeg: number, latDeg: number): Hk80Point {
  const lat = latDeg * DEG;
  const lon = lonDeg * DEG;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const tanLat = Math.tan(lat);
  const e2 = INTL1924_E2;
  const ep2 = e2 / (1 - e2);
  const nu = INTL1924_A / Math.sqrt(1 - e2 * sinLat * sinLat);
  const rho =
    (INTL1924_A * (1 - e2)) / Math.pow(1 - e2 * sinLat * sinLat, 1.5);
  const eta2 = ep2 * cosLat * cosLat;
  const dLon = lon - TM_LON0;
  const m = meridionalArc(lat);
  const m0 = meridionalArc(TM_LAT0);
  const t2 = tanLat * tanLat;
  const t4 = t2 * t2;
  const cos2 = cosLat * cosLat;
  const cos3 = cos2 * cosLat;
  const cos5 = cos3 * cos2;

  const easting =
    TM_FE +
    TM_K0 *
      nu *
      (dLon * cosLat +
        ((dLon ** 3 * cos3) / 6) * (1 - t2 + eta2) +
        ((dLon ** 5 * cos5) / 120) *
          (5 - 18 * t2 + t4 + 14 * eta2 - 58 * t2 * eta2));

  const northing =
    TM_FN +
    TM_K0 *
      (m -
        m0 +
        nu *
          tanLat *
          ((dLon ** 2 * cos2) / 2 +
            ((dLon ** 4 * cos2 * cos2) / 24) * (5 - t2 + 9 * eta2 + 4 * eta2 * eta2) +
            ((dLon ** 6 * cos2 * cos2 * cos2) / 720) *
              (61 - 58 * t2 + t4)));

  void rho;
  return { easting, northing };
}

export function hk80GridToGeographic(easting: number, northing: number): Wgs84Point {
  const e1 = (1 - Math.sqrt(1 - INTL1924_E2)) / (1 + Math.sqrt(1 - INTL1924_E2));
  const m0 = meridionalArc(TM_LAT0);
  const m = m0 + (northing - TM_FN) / TM_K0;
  const mu =
    m /
    (INTL1924_A *
      (1 -
        INTL1924_E2 / 4 -
        (3 * INTL1924_E2 ** 2) / 64 -
        (5 * INTL1924_E2 ** 3) / 256));

  const j1 = (3 * e1) / 2 - (27 * e1 ** 3) / 32;
  const j2 = (21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32;
  const j3 = (151 * e1 ** 3) / 96;
  const j4 = (1097 * e1 ** 4) / 512;
  const fp =
    mu +
    j1 * Math.sin(2 * mu) +
    j2 * Math.sin(4 * mu) +
    j3 * Math.sin(6 * mu) +
    j4 * Math.sin(8 * mu);

  const sinFp = Math.sin(fp);
  const cosFp = Math.cos(fp);
  const tanFp = Math.tan(fp);
  const e2 = INTL1924_E2;
  const ep2 = e2 / (1 - e2);
  const nu = INTL1924_A / Math.sqrt(1 - e2 * sinFp * sinFp);
  const rho =
    (INTL1924_A * (1 - e2)) / Math.pow(1 - e2 * sinFp * sinFp, 1.5);
  const eta2 = ep2 * cosFp * cosFp;
  const dE = easting - TM_FE;
  const t2 = tanFp * tanFp;
  const t4 = t2 * t2;

  const lat =
    fp -
    ((nu * tanFp) / rho) *
      ((dE / (TM_K0 * nu)) ** 2 / 2 -
        ((dE / (TM_K0 * nu)) ** 4 / 24) *
          (5 + 3 * t2 + 10 * eta2 - 4 * eta2 * eta2 - 9 * ep2) +
        ((dE / (TM_K0 * nu)) ** 6 / 720) *
          (61 + 90 * t2 + 298 * eta2 + 45 * t4 - 252 * ep2 - 3 * eta2 * eta2));

  const lon =
    TM_LON0 +
    (dE / (TM_K0 * nu) -
      ((dE / (TM_K0 * nu)) ** 3 / 6) * (1 + 2 * t2 + eta2) +
      ((dE / (TM_K0 * nu)) ** 5 / 120) *
        (5 - 2 * eta2 + 28 * t2 - 3 * eta2 * eta2 + 8 * ep2 + 24 * t4)) /
      cosFp;

  return { lon: lon / DEG, lat: lat / DEG };
}

export function wgs84ToHk80(lon: number, lat: number): Hk80Point {
  const [x, y, z] = geodeticToEcef(lon, lat, WGS84_A, WGS84_E2);
  const [hx, hy, hz] = applyHelmert(x, y, z, true);
  const hk80Geo = ecefToGeodetic(hx, hy, hz, INTL1924_A, INTL1924_E2);
  return hk80GeographicToGrid(hk80Geo.lon, hk80Geo.lat);
}

export function hk80ToWgs84(easting: number, northing: number): Wgs84Point {
  const hk80Geo = hk80GridToGeographic(easting, northing);
  const [x, y, z] = geodeticToEcef(hk80Geo.lon, hk80Geo.lat, INTL1924_A, INTL1924_E2);
  const [wx, wy, wz] = applyHelmert(x, y, z, false);
  return ecefToGeodetic(wx, wy, wz, WGS84_A, WGS84_E2);
}

export function assertWgs84(lon: number, lat: number): void {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    throw new Error(`Invalid WGS84 coordinate: (${lon}, ${lat})`);
  }
  if (lon < 113.7 || lon > 114.5 || lat < 22.1 || lat > 22.6) {
    throw new Error(
      `Coordinate (${lon}, ${lat}) is outside the Hong Kong WGS84 operational envelope. Expected EPSG:4326 in Kowloon/HK waters.`,
    );
  }
}

export function metersPerDegree(latDeg: number): { metersPerDegLat: number; metersPerDegLng: number } {
  const lat = latDeg * DEG;
  const metersPerDegLat =
    111132.954 - 559.822 * Math.cos(2 * lat) + 1.175 * Math.cos(4 * lat);
  const metersPerDegLng =
    ((Math.PI / 180) * WGS84_A * Math.cos(lat)) /
    Math.sqrt(1 - WGS84_E2 * Math.sin(lat) * Math.sin(lat));
  return { metersPerDegLat, metersPerDegLng };
}
