/**
 * Local east-north-up camera for the software Kowloon twin.
 * Display coordinates are metres from a WGS84 origin — never HK80 eastings.
 */
import { metersPerDegree } from "./crs";
import { HARBOUR_APPROACH_VIEW, KOWLOON_VIEW } from "./constants";
import { clamp, lerp } from "./utils";

export const TWIN_ORIGIN = { lon: 114.1628, lat: 22.3307 } as const;

export const TWIN_FLYIN_EVENT = "aeris-twin-flyin";

export interface EnuPoint {
  east: number;
  north: number;
  up: number;
}

export interface TwinView {
  targetEast: number;
  targetNorth: number;
  targetUp: number;
  distance: number;
  bearingDeg: number;
  pitchDeg: number;
  fovDeg: number;
}

export interface ProjectedPoint {
  x: number;
  y: number;
  depth: number;
  visible: boolean;
}

export interface CameraBasis {
  cam: EnuPoint;
  right: EnuPoint;
  up: EnuPoint;
  forward: EnuPoint;
}

export function zoomToDistanceM(zoom: number): number {
  return 720 * 2 ** (16.2 - zoom);
}

export function wgs84ToEnu(lon: number, lat: number, up = 0, origin = TWIN_ORIGIN): EnuPoint {
  const { metersPerDegLat, metersPerDegLng } = metersPerDegree((lat + origin.lat) / 2);
  return {
    east: (lon - origin.lon) * metersPerDegLng,
    north: (lat - origin.lat) * metersPerDegLat,
    up,
  };
}

export function viewFromMapState(view: {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
}): TwinView {
  const target = wgs84ToEnu(view.longitude, view.latitude, 0);
  return {
    targetEast: target.east,
    targetNorth: target.north,
    targetUp: 18,
    distance: zoomToDistanceM(view.zoom),
    bearingDeg: view.bearing,
    pitchDeg: Math.min(66, view.pitch + 4),
    fovDeg: 46,
  };
}

export const HARBOUR_TWIN_VIEW = viewFromMapState(HARBOUR_APPROACH_VIEW);
export const KOWLOON_TWIN_VIEW = viewFromMapState(KOWLOON_VIEW);

export function smoothstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

export function lerpView(a: TwinView, b: TwinView, t: number): TwinView {
  const u = smoothstep(t);
  return {
    targetEast: lerp(a.targetEast, b.targetEast, u),
    targetNorth: lerp(a.targetNorth, b.targetNorth, u),
    targetUp: lerp(a.targetUp, b.targetUp, u),
    distance: lerp(a.distance, b.distance, u),
    bearingDeg: lerp(a.bearingDeg, b.bearingDeg, u),
    pitchDeg: lerp(a.pitchDeg, b.pitchDeg, u),
    fovDeg: lerp(a.fovDeg, b.fovDeg, u),
  };
}

function hypot3(a: EnuPoint): number {
  return Math.hypot(a.east, a.north, a.up);
}

function scale(a: EnuPoint, s: number): EnuPoint {
  return { east: a.east * s, north: a.north * s, up: a.up * s };
}

function add(a: EnuPoint, b: EnuPoint): EnuPoint {
  return { east: a.east + b.east, north: a.north + b.north, up: a.up + b.up };
}

function sub(a: EnuPoint, b: EnuPoint): EnuPoint {
  return { east: a.east - b.east, north: a.north - b.north, up: a.up - b.up };
}

function dot(a: EnuPoint, b: EnuPoint): number {
  return a.east * b.east + a.north * b.north + a.up * b.up;
}

function cross(a: EnuPoint, b: EnuPoint): EnuPoint {
  return {
    east: a.north * b.up - a.up * b.north,
    north: a.up * b.east - a.east * b.up,
    up: a.east * b.north - a.north * b.east,
  };
}

function normalize(a: EnuPoint): EnuPoint {
  const len = hypot3(a) || 1;
  return scale(a, 1 / len);
}

export function cameraPosition(view: TwinView): EnuPoint {
  const pitch = (view.pitchDeg * Math.PI) / 180;
  const bearing = (view.bearingDeg * Math.PI) / 180;
  const horiz = view.distance * Math.sin(pitch);
  const vert = view.distance * Math.cos(pitch);
  return {
    east: view.targetEast - Math.sin(bearing) * horiz,
    north: view.targetNorth - Math.cos(bearing) * horiz,
    up: view.targetUp + vert,
  };
}

export function cameraBasis(view: TwinView): CameraBasis {
  const cam = cameraPosition(view);
  const target: EnuPoint = {
    east: view.targetEast,
    north: view.targetNorth,
    up: view.targetUp,
  };
  const forward = normalize(sub(target, cam));
  const worldUp: EnuPoint = { east: 0, north: 0, up: 1 };
  let right = cross(forward, worldUp);
  if (hypot3(right) < 1e-6) {
    right = { east: 1, north: 0, up: 0 };
  } else {
    right = normalize(right);
  }
  const up = normalize(cross(right, forward));
  return { cam, right, up, forward };
}

export function projectEnu(
  point: EnuPoint,
  view: TwinView,
  width: number,
  height: number,
  basis?: CameraBasis,
): ProjectedPoint {
  const frame = basis ?? cameraBasis(view);
  const rel = sub(point, frame.cam);
  const cx = dot(rel, frame.right);
  const cy = dot(rel, frame.up);
  const cz = dot(rel, frame.forward);
  if (cz < 8) {
    return { x: 0, y: 0, depth: cz, visible: false };
  }
  const f = 1 / Math.tan(((view.fovDeg * Math.PI) / 180) / 2);
  const aspect = Math.max(0.4, width / Math.max(1, height));
  const ndcX = ((cx / cz) * f) / aspect;
  const ndcY = (cy / cz) * f;
  return {
    x: (ndcX * 0.5 + 0.5) * width,
    y: (0.5 - ndcY * 0.5) * height,
    depth: cz,
    visible: Math.abs(ndcX) < 1.45 && Math.abs(ndcY) < 1.45,
  };
}

export function pickNearestId(
  screenX: number,
  screenY: number,
  projected: Array<{ id: string; x: number; y: number; depth: number; visible: boolean }>,
  radiusPx = 36,
): string | null {
  let best: { id: string; d2: number; depth: number } | null = null;
  const r2 = radiusPx * radiusPx;
  for (const row of projected) {
    if (!row.visible) continue;
    const dx = row.x - screenX;
    const dy = row.y - screenY;
    const d2 = dx * dx + dy * dy;
    if (d2 > r2) continue;
    if (!best || d2 < best.d2 - 4 || (Math.abs(d2 - best.d2) < 4 && row.depth < best.depth)) {
      best = { id: row.id, d2, depth: row.depth };
    }
  }
  return best?.id ?? null;
}

export { add as addEnu, sub as subEnu, dot as dotEnu, normalize as normalizeEnu, hypot3 as hypotEnu };
