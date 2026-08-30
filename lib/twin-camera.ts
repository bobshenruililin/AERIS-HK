/**
 * Local east-north-up camera for the software Kowloon twin.
 * Display coordinates are metres from a WGS84 origin — never HK80 eastings.
 */
import { metersPerDegree } from "./crs";
import { HARBOUR_APPROACH_VIEW, KOWLOON_VIEW } from "./constants";
import { clamp, lerp } from "./utils";

export const TWIN_ORIGIN = { lon: 114.1628, lat: 22.3307 } as const;

export const TWIN_FLYIN_EVENT = "aeris-twin-flyin";
export const TWIN_LOOKAT_EVENT = "aeris-twin-lookat";
export const TWIN_ORBIT_EVENT = "aeris-twin-orbit";
export const TWIN_KEYFRAME_EVENT = "aeris-twin-keyframe";

export interface TwinKeyframeDetail {
  view: TwinView;
  durationMs?: number;
}

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

const REL_SCRATCH: EnuPoint = { east: 0, north: 0, up: 0 };
const TARGET_SCRATCH: EnuPoint = { east: 0, north: 0, up: 0 };
const WORLD_UP: EnuPoint = { east: 0, north: 0, up: 1 };
const BASIS_SCRATCH: CameraBasis = {
  cam: { east: 0, north: 0, up: 0 },
  right: { east: 0, north: 0, up: 0 },
  up: { east: 0, north: 0, up: 0 },
  forward: { east: 0, north: 0, up: 0 },
};

export function copyTwinView(out: TwinView, src: TwinView): TwinView {
  out.targetEast = src.targetEast;
  out.targetNorth = src.targetNorth;
  out.targetUp = src.targetUp;
  out.distance = src.distance;
  out.bearingDeg = src.bearingDeg;
  out.pitchDeg = src.pitchDeg;
  out.fovDeg = src.fovDeg;
  return out;
}

export function lerpViewInto(out: TwinView, a: TwinView, b: TwinView, t: number): TwinView {
  const u = smoothstep(t);
  out.targetEast = lerp(a.targetEast, b.targetEast, u);
  out.targetNorth = lerp(a.targetNorth, b.targetNorth, u);
  out.targetUp = lerp(a.targetUp, b.targetUp, u);
  out.distance = lerp(a.distance, b.distance, u);
  out.bearingDeg = lerp(a.bearingDeg, b.bearingDeg, u);
  out.pitchDeg = lerp(a.pitchDeg, b.pitchDeg, u);
  out.fovDeg = lerp(a.fovDeg, b.fovDeg, u);
  return out;
}

export function orbitViewInto(out: TwinView, base: TwinView, elapsedMs: number, periodMs = 16000): TwinView {
  const turns = elapsedMs / Math.max(1, periodMs);
  const tau = turns * Math.PI * 2;
  out.targetEast = base.targetEast;
  out.targetNorth = base.targetNorth;
  out.targetUp = base.targetUp;
  out.bearingDeg = base.bearingDeg + turns * 360;
  out.pitchDeg = clamp(base.pitchDeg + 5.5 * Math.sin(tau), 38, 72);
  out.distance = base.distance * (1 + 0.08 * Math.sin(tau * 0.5));
  out.fovDeg = base.fovDeg;
  return out;
}

export function wgs84ToEnuInto(
  out: EnuPoint,
  lon: number,
  lat: number,
  up = 0,
  origin = TWIN_ORIGIN,
): EnuPoint {
  const { metersPerDegLat, metersPerDegLng } = metersPerDegree((lat + origin.lat) / 2);
  out.east = (lon - origin.lon) * metersPerDegLng;
  out.north = (lat - origin.lat) * metersPerDegLat;
  out.up = up;
  return out;
}

export function wgs84ToEnu(lon: number, lat: number, up = 0, origin = TWIN_ORIGIN): EnuPoint {
  return wgs84ToEnuInto({ east: 0, north: 0, up: 0 }, lon, lat, up, origin);
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

export function viewLookingAt(
  lon: number,
  lat: number,
  opts: { zoom: number; pitch: number; bearing: number; targetUp?: number },
): TwinView {
  const view = viewFromMapState({
    longitude: lon,
    latitude: lat,
    zoom: opts.zoom,
    pitch: opts.pitch,
    bearing: opts.bearing,
  });
  if (opts.targetUp != null) view.targetUp = opts.targetUp;
  return view;
}

export function smoothstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

export function orbitView(base: TwinView, elapsedMs: number, periodMs = 16000): TwinView {
  return orbitViewInto(
    {
      targetEast: 0,
      targetNorth: 0,
      targetUp: 0,
      distance: 0,
      bearingDeg: 0,
      pitchDeg: 0,
      fovDeg: 0,
    },
    base,
    elapsedMs,
    periodMs,
  );
}

export function lerpView(a: TwinView, b: TwinView, t: number): TwinView {
  return lerpViewInto(
    {
      targetEast: 0,
      targetNorth: 0,
      targetUp: 0,
      distance: 0,
      bearingDeg: 0,
      pitchDeg: 0,
      fovDeg: 0,
    },
    a,
    b,
    t,
  );
}

function hypot3(a: EnuPoint): number {
  return Math.hypot(a.east, a.north, a.up);
}

function setEnu(out: EnuPoint, east: number, north: number, up: number): EnuPoint {
  out.east = east;
  out.north = north;
  out.up = up;
  return out;
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

function normalize(a: EnuPoint): EnuPoint {
  const len = hypot3(a) || 1;
  return scale(a, 1 / len);
}

function crossInto(out: EnuPoint, a: EnuPoint, b: EnuPoint): EnuPoint {
  return setEnu(
    out,
    a.north * b.up - a.up * b.north,
    a.up * b.east - a.east * b.up,
    a.east * b.north - a.north * b.east,
  );
}

function normalizeInto(out: EnuPoint): EnuPoint {
  const len = hypot3(out) || 1;
  out.east /= len;
  out.north /= len;
  out.up /= len;
  return out;
}

export function cameraPositionInto(out: EnuPoint, view: TwinView): EnuPoint {
  const pitch = (view.pitchDeg * Math.PI) / 180;
  const bearing = (view.bearingDeg * Math.PI) / 180;
  const horiz = view.distance * Math.sin(pitch);
  const vert = view.distance * Math.cos(pitch);
  return setEnu(
    out,
    view.targetEast - Math.sin(bearing) * horiz,
    view.targetNorth - Math.cos(bearing) * horiz,
    view.targetUp + vert,
  );
}

export function cameraPosition(view: TwinView): EnuPoint {
  return cameraPositionInto({ east: 0, north: 0, up: 0 }, view);
}

/** Mutates `out`. TwinCanvas rAF must pass a frame-local basis, never a shared global. */
export function cameraBasisInto(out: CameraBasis, view: TwinView): CameraBasis {
  cameraPositionInto(out.cam, view);
  setEnu(TARGET_SCRATCH, view.targetEast, view.targetNorth, view.targetUp);
  setEnu(
    out.forward,
    TARGET_SCRATCH.east - out.cam.east,
    TARGET_SCRATCH.north - out.cam.north,
    TARGET_SCRATCH.up - out.cam.up,
  );
  normalizeInto(out.forward);
  crossInto(out.right, out.forward, WORLD_UP);
  if (hypot3(out.right) < 1e-6) {
    setEnu(out.right, 1, 0, 0);
  } else {
    normalizeInto(out.right);
  }
  crossInto(out.up, out.right, out.forward);
  normalizeInto(out.up);
  return out;
}

export function cameraBasis(view: TwinView): CameraBasis {
  return cameraBasisInto(
    {
      cam: { east: 0, north: 0, up: 0 },
      right: { east: 0, north: 0, up: 0 },
      up: { east: 0, north: 0, up: 0 },
      forward: { east: 0, north: 0, up: 0 },
    },
    view,
  );
}

export function projectEnuInto(
  out: ProjectedPoint,
  point: EnuPoint,
  view: TwinView,
  width: number,
  height: number,
  basis?: CameraBasis,
): ProjectedPoint {
  const frame = basis ?? cameraBasisInto(BASIS_SCRATCH, view);
  REL_SCRATCH.east = point.east - frame.cam.east;
  REL_SCRATCH.north = point.north - frame.cam.north;
  REL_SCRATCH.up = point.up - frame.cam.up;
  const cx = dot(REL_SCRATCH, frame.right);
  const cy = dot(REL_SCRATCH, frame.up);
  const cz = dot(REL_SCRATCH, frame.forward);
  if (cz < 8) {
    out.x = 0;
    out.y = 0;
    out.depth = cz;
    out.visible = false;
    return out;
  }
  const f = 1 / Math.tan(((view.fovDeg * Math.PI) / 180) / 2);
  const aspect = Math.max(0.4, width / Math.max(1, height));
  const ndcX = ((cx / cz) * f) / aspect;
  const ndcY = (cy / cz) * f;
  out.x = (ndcX * 0.5 + 0.5) * width;
  out.y = (0.5 - ndcY * 0.5) * height;
  out.depth = cz;
  out.visible = Math.abs(ndcX) < 1.45 && Math.abs(ndcY) < 1.45;
  return out;
}

export function projectEnu(
  point: EnuPoint,
  view: TwinView,
  width: number,
  height: number,
  basis?: CameraBasis,
): ProjectedPoint {
  return projectEnuInto({ x: 0, y: 0, depth: 0, visible: false }, point, view, width, height, basis);
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
