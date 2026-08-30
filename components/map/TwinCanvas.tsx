"use client";

import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useSimulation } from "@/components/simulation/SimulationProvider";
import { EXTRUSION_SCALE } from "@/lib/constants";
import { cviRgbaInto } from "@/lib/gpu/color-lut";
import { estimateGpuVramMb } from "@/lib/gpu/context-lifecycle";
import { recordFrameSample } from "@/lib/runtime-diagnostics";
import { HOSPITALS, hospitalByCode } from "@/lib/hospitals";
import { isDaylight, solarElevationDeg, sunDirectionVecInto } from "@/lib/solar";
import { streetSpinesFromBuildings } from "@/lib/streets";
import { buildingCentroid } from "@/lib/spatial-data";
import { aggregateHeatPlumes } from "@/lib/h3-index";
import type { BuildingFeature, DistrictName, HospitalCode, SystemHourSnapshot } from "@/lib/types";
import type { CopilotSpatialState } from "@/lib/agent";
import type { HudLayers } from "@/lib/hud";
import { advectWindParticles, createWindParticles, type WindParticle } from "@/lib/wind-field";
import {
  advectAmbulanceParticles,
  arterialStrokes,
  createAmbulanceParticles,
  planFingerprint,
  type AmbulanceParticle,
} from "@/lib/hospital-triage";
import { solarPositionHk, sunEnuFromLookAtInto } from "@/lib/solar-engine";
import {
  fillHourInstanceCursor,
  lodFromDistanceM,
  packedCursorColorInto,
  packInstanceExtrusions,
  type HourInstanceCursor,
  type LodLevel,
} from "@/lib/instance-mesh";
import { wrapHour } from "@/lib/utils";
import {
  HARBOUR_TWIN_VIEW,
  KOWLOON_TWIN_VIEW,
  TWIN_FLYIN_EVENT,
  TWIN_KEYFRAME_EVENT,
  TWIN_LOOKAT_EVENT,
  TWIN_ORBIT_EVENT,
  cameraBasisInto,
  copyTwinView,
  lerpViewInto,
  orbitViewInto,
  pickNearestId,
  projectEnuInto,
  wgs84ToEnuInto,
  type CameraBasis,
  type EnuPoint,
  type ProjectedPoint,
  type TwinView,
} from "@/lib/twin-camera";
import {
  HARBOUR_ENU,
  HARBOUR_PROJECTED,
  LAND_ENU,
  LAND_PROJECTED,
  buildMeshBuildings,
  bumpDrawCalls,
  depthSortMeshes,
  diffMap,
  fillCviMap,
  fillShadowScratch,
  getDrawCallCount,
  highlightSetOf,
  projectParticle,
  projectRingInto,
  resetDrawCalls,
  targetedSet,
  windowOnlySet,
  type MeshBuilding,
} from "@/lib/twin-draw";

function rgba(color: [number, number, number, number], alpha = color[3] / 255): string {
  return `rgba(${color[0]},${color[1]},${color[2]},${alpha})`;
}

const SHADE_SCRATCH: [number, number, number] = [0, 0, 0];

function shadeRgb(
  color: [number, number, number, number],
  normal: EnuPoint,
  sun: [number, number, number],
  ambient: number,
): [number, number, number] {
  const ndot = Math.max(0, -(normal.east * sun[0] + normal.north * sun[1] + normal.up * sun[2]));
  const lit = ambient + 0.72 * ndot;
  SHADE_SCRATCH[0] = Math.round(color[0] * lit);
  SHADE_SCRATCH[1] = Math.round(color[1] * lit);
  SHADE_SCRATCH[2] = Math.round(color[2] * lit);
  return SHADE_SCRATCH;
}

function fillPoly(ctx: CanvasRenderingContext2D, pts: ProjectedPoint[], fill: string, stroke?: string, width = 1) {
  if (pts.length < 3) return;
  for (let i = 0; i < pts.length; i += 1) {
    if (!pts[i].visible && pts[i].depth < 8) return;
  }
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  bumpDrawCalls();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke();
    bumpDrawCalls();
  }
}

const COLOR_SCRATCH: [number, number, number, number] = [16, 185, 129, 210];
const HEX_ENU: EnuPoint[] = [];
const HEX_PROJ: ProjectedPoint[] = [];
const FACE_PROJ: ProjectedPoint[] = [];
const ROOF_ENU: EnuPoint = { east: 0, north: 0, up: 0 };
const ROOF_PROJ: ProjectedPoint = { x: 0, y: 0, depth: 0, visible: false };
const TIP_ENU: EnuPoint = { east: 0, north: 0, up: 0 };
const TIP_PROJ: ProjectedPoint = { x: 0, y: 0, depth: 0, visible: false };
const BASE_PROJ: ProjectedPoint = { x: 0, y: 0, depth: 0, visible: false };
const SUN_POS_ENU: EnuPoint = { east: 0, north: 0, up: 0 };
const SUN_POS_PROJ: ProjectedPoint = { x: 0, y: 0, depth: 0, visible: false };
const GROUND_ENU: EnuPoint = { east: 0, north: 0, up: 0 };
const GROUND_PROJ: ProjectedPoint = { x: 0, y: 0, depth: 0, visible: false };
const ROOF_MID_ENU: EnuPoint = { east: 0, north: 0, up: 0 };
const ROOF_MID_PROJ: ProjectedPoint = { x: 0, y: 0, depth: 0, visible: false };
const ARC_SRC_PROJ: ProjectedPoint = { x: 0, y: 0, depth: 0, visible: false };
const ARC_DST_PROJ: ProjectedPoint = { x: 0, y: 0, depth: 0, visible: false };
const LABEL_ENU: EnuPoint = { east: 0, north: 0, up: 0 };
const FRAME_BASIS: CameraBasis = {
  cam: { east: 0, north: 0, up: 0 },
  right: { east: 0, north: 0, up: 0 },
  up: { east: 0, north: 0, up: 0 },
  forward: { east: 0, north: 0, up: 0 },
};
const SUN_DIR: [number, number, number] = [0, 0, -1];
const INSTANCE_CURSOR: HourInstanceCursor = {
  count: 0,
  colorOffset: 0,
  elevOffset: 0,
  positions: new Float32Array(0),
  colors: new Uint8Array(0),
  elevations: new Float32Array(0),
  acWatts: new Float32Array(0),
};
const PICK_SCRATCH: Array<{ id: string; x: number; y: number; depth: number; visible: boolean }> = [];
const HOSPITAL_PICK: Array<{ id: string; x: number; y: number; depth: number; visible: boolean }> = HOSPITALS.map(
  (h) => ({ id: h.code, x: 0, y: 0, depth: 0, visible: false }),
);
const HIGHLIGHT_INSTANCES = new Set<string>();

function primaryHospitalForDistrict(district: DistrictName): (typeof HOSPITALS)[number] {
  let best = HOSPITALS[0];
  let weight = -1;
  for (let i = 0; i < HOSPITALS.length; i += 1) {
    const w = HOSPITALS[i].catchmentWeight[district];
    if (w > weight) {
      weight = w;
      best = HOSPITALS[i];
    }
  }
  return best;
}

function ensureEnu(n: number, buf: EnuPoint[]): EnuPoint[] {
  while (buf.length < n) buf.push({ east: 0, north: 0, up: 0 });
  buf.length = n;
  return buf;
}

export function TwinCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sim = useSimulation();
  const simRef = useRef(sim);
  simRef.current = sim;
  const viewRef = useRef<TwinView>({ ...HARBOUR_TWIN_VIEW });
  const flyRef = useRef({ t0: 0, active: true });
  const lookRef = useRef<{ t0: number; from: TwinView; to: TwinView; durationMs: number } | null>(null);
  const orbitRef = useRef<{ active: boolean; t0: number; base: TwinView } | null>(null);
  const particlesRef = useRef<WindParticle[]>(createWindParticles());
  const ambulanceRef = useRef<AmbulanceParticle[]>([]);
  const ambulancePlanKeyRef = useRef("");
  const pickRef = useRef<Array<{ id: string; x: number; y: number; depth: number; visible: boolean }>>([]);

  const meshes = useMemo<MeshBuilding[]>(() => buildMeshBuildings(sim.buildings), [sim.buildings]);

  const spines = useMemo(() => streetSpinesFromBuildings(sim.buildings), [sim.buildings]);
  const instancePack = useMemo(() => packInstanceExtrusions(sim.buildings, sim.cache), [sim.buildings, sim.cache]);
  const hourFloor = Math.floor(wrapHour(sim.hour)) % 24;
  const hourStates = useMemo(
    () =>
      sim.buildings
        .map((b) => sim.cache.get(`${b.properties.id}:${hourFloor}`))
        .filter((row): row is NonNullable<typeof row> => Boolean(row)),
    [sim.buildings, sim.cache, hourFloor],
  );
  const hexes9 = useMemo(
    () => (sim.hudLayers.h3Hexes ? aggregateHeatPlumes(sim.buildings, hourStates, 9) : []),
    [sim.buildings, hourStates, sim.hudLayers.h3Hexes],
  );
  const hexes10 = useMemo(
    () => (sim.hudLayers.h3Hexes ? aggregateHeatPlumes(sim.buildings, hourStates, 10) : []),
    [sim.buildings, hourStates, sim.hudLayers.h3Hexes],
  );
  const packRef = useRef(instancePack);
  packRef.current = instancePack;
  const hexes9Ref = useRef(hexes9);
  hexes9Ref.current = hexes9;
  const hexes10Ref = useRef(hexes10);
  hexes10Ref.current = hexes10;

  const startFlyIn = useCallback(() => {
    orbitRef.current = null;
    copyTwinView(viewRef.current, HARBOUR_TWIN_VIEW);
    flyRef.current = { t0: performance.now(), active: true };
  }, []);

  useEffect(() => {
    startFlyIn();
    const onFly = () => startFlyIn();
    const onLook = (event: Event) => {
      const detail = (event as CustomEvent<{ lon: number; lat: number }>).detail;
      if (!detail) return;
      orbitRef.current = null;
      wgs84ToEnuInto(LABEL_ENU, detail.lon, detail.lat, 0);
      lookRef.current = {
        t0: performance.now(),
        from: { ...viewRef.current },
        to: {
          ...viewRef.current,
          targetEast: LABEL_ENU.east,
          targetNorth: LABEL_ENU.north,
          targetUp: 22,
          distance: Math.min(viewRef.current.distance, 480),
        },
        durationMs: 900,
      };
      flyRef.current.active = false;
    };
    const onOrbit = () => {
      if (orbitRef.current?.active) {
        orbitRef.current = null;
        return;
      }
      flyRef.current.active = false;
      lookRef.current = null;
      orbitRef.current = { active: true, t0: performance.now(), base: { ...viewRef.current } };
    };
    const onKeyframe = (event: Event) => {
      const detail = (event as CustomEvent<{ view?: TwinView; durationMs?: number }>).detail;
      if (!detail?.view) return;
      orbitRef.current = null;
      flyRef.current.active = false;
      lookRef.current = {
        t0: performance.now(),
        from: { ...viewRef.current },
        to: { ...detail.view },
        durationMs: Math.max(120, detail.durationMs ?? 2600),
      };
    };
    window.addEventListener(TWIN_FLYIN_EVENT, onFly);
    window.addEventListener(TWIN_LOOKAT_EVENT, onLook);
    window.addEventListener(TWIN_ORBIT_EVENT, onOrbit);
    window.addEventListener(TWIN_KEYFRAME_EVENT, onKeyframe);
    return () => {
      window.removeEventListener(TWIN_FLYIN_EVENT, onFly);
      window.removeEventListener(TWIN_LOOKAT_EVENT, onLook);
      window.removeEventListener(TWIN_ORBIT_EVENT, onOrbit);
      window.removeEventListener(TWIN_KEYFRAME_EVENT, onKeyframe);
    };
  }, [startFlyIn]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    let raf = 0;
    let last = performance.now();

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const state = simRef.current;
      if (flyRef.current.active) {
        const t = (now - flyRef.current.t0) / 4200;
        if (t >= 1) {
          copyTwinView(viewRef.current, KOWLOON_TWIN_VIEW);
          flyRef.current.active = false;
        } else {
          lerpViewInto(viewRef.current, HARBOUR_TWIN_VIEW, KOWLOON_TWIN_VIEW, t);
        }
      } else if (lookRef.current) {
        const t = (now - lookRef.current.t0) / Math.max(120, lookRef.current.durationMs);
        if (t >= 1) {
          copyTwinView(viewRef.current, lookRef.current.to);
          lookRef.current = null;
        } else {
          lerpViewInto(viewRef.current, lookRef.current.from, lookRef.current.to, t);
        }
      } else if (orbitRef.current?.active) {
        orbitViewInto(viewRef.current, orbitRef.current.base, now - orbitRef.current.t0);
      }
      const hour = state.hourClockRef.current;
      const lod = lodFromDistanceM(viewRef.current.distance);
      if (lod > 0) {
        advectWindParticles(
          particlesRef.current,
          dt,
          hour,
          state.buildings,
          state.forcing,
        );
        const key = planFingerprint(state.snapshot.triage);
        if (key !== ambulancePlanKeyRef.current) {
          ambulancePlanKeyRef.current = key;
          ambulanceRef.current = createAmbulanceParticles(state.snapshot.triage);
        } else if (ambulanceRef.current.length > 0) {
          advectAmbulanceParticles(ambulanceRef.current, dt);
        }
      }
      fillHourInstanceCursor(INSTANCE_CURSOR, packRef.current, hour, lod);
      resetDrawCalls();
      drawFrame(ctx, canvas, {
        view: viewRef.current,
        meshes,
        spines,
        buildings: state.buildings,
        snapshot: state.snapshot,
        policyIds: state.policy.coolRoofTargetIds,
        windowIds: state.coolRoofPlan?.windowSelectedIds ?? [],
        hour,
        hoveredId: state.hoveredId,
        selectedId: state.selectedId,
        focusedHospital: state.focusedHospital,
        particles: particlesRef.current,
        ambulances: ambulanceRef.current,
        now,
        pickRef,
        layers: state.hudLayers,
        lod,
        instanceCursor: INSTANCE_CURSOR,
        hexes: lod === 0 ? hexes9Ref.current : hexes10Ref.current,
        copilot: state.copilot,
        parentIds: packRef.current.parentIds,
        sensors: state.sensorLod,
      });
      const pack = packRef.current;
      recordFrameSample({
        frameMs: dt * 1000,
        drawCalls: getDrawCallCount(),
        vramEstimateMb: estimateGpuVramMb({
          canvasWidth: canvas.width,
          canvasHeight: canvas.height,
          instanceBytes:
            pack.instancePositions.byteLength + pack.instanceColors.byteLength + pack.instanceElevations.byteLength,
          particleBytes: particlesRef.current.length * 48,
        }),
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [meshes, spines]);

  const toLocal = (event: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  };

  return (
    <canvas
      ref={canvasRef}
      data-testid="twin-canvas"
      className="absolute inset-0 h-full w-full cursor-grab active:cursor-grabbing"
      onPointerMove={(event) => {
        const pt = toLocal(event);
        if (!pt) return;
        const id = pickNearestId(pt.x, pt.y, pickRef.current);
        if (id !== sim.hoveredId) sim.setHoveredId(id);
      }}
      onPointerLeave={() => sim.setHoveredId(null)}
      onClick={(event) => {
        const pt = toLocal(event);
        if (!pt) return;
        const hospital = pickNearestId(pt.x, pt.y, HOSPITAL_PICK, 44);
        if (hospital) {
          sim.setFocusedHospital(sim.focusedHospital === hospital ? null : (hospital as HospitalCode));
          return;
        }
        const id = pickNearestId(pt.x, pt.y, pickRef.current);
        if (id) {
          sim.setFocusedHospital(null);
          sim.setSelectedId(id);
          sim.setInspectorAnchor({ x: event.clientX, y: event.clientY });
        }
      }}
    />
  );
}

function drawDistrictInstances(
  ctx: CanvasRenderingContext2D,
  cursor: HourInstanceCursor,
  view: TwinView,
  w: number,
  h: number,
  basis: ReturnType<typeof cameraBasisInto>,
  dpr: number,
  now: number,
  highlightIds: string[],
  parentIds: string[],
): void {
  const pulse = 0.55 + 0.45 * Math.sin(now / 420);
  const highlightSet = highlightIds.length > 0 ? HIGHLIGHT_INSTANCES : null;
  if (highlightSet) {
    highlightSet.clear();
    for (let i = 0; i < highlightIds.length; i += 1) highlightSet.add(highlightIds[i]);
  }
  for (let i = 0; i < cursor.count; i += 1) {
    const lon = cursor.positions[i * 3];
    const lat = cursor.positions[i * 3 + 1];
    const elev = cursor.elevations[cursor.elevOffset + i];
    wgs84ToEnuInto(ROOF_ENU, lon, lat, elev * 0.45);
    projectEnuInto(ROOF_PROJ, ROOF_ENU, view, w, h, basis);
    if (!ROOF_PROJ.visible) continue;
    packedCursorColorInto(COLOR_SCRATCH, cursor, i);
    const size = Math.max(1.4 * dpr, (elev / Math.max(80, view.distance)) * h * 0.42);
    const id = parentIds[i];
    const dimmed = Boolean(highlightSet && id && !highlightSet.has(id));
    ctx.fillStyle = `rgba(${COLOR_SCRATCH[0]},${COLOR_SCRATCH[1]},${COLOR_SCRATCH[2]},${dimmed ? 0.18 : 0.55 + 0.2 * pulse})`;
    ctx.fillRect(ROOF_PROJ.x - size * 0.28, ROOF_PROJ.y - size, size * 0.56, size);
  }
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  args: {
    view: TwinView;
    meshes: MeshBuilding[];
    spines: ReturnType<typeof streetSpinesFromBuildings>;
    buildings: BuildingFeature[];
    snapshot: SystemHourSnapshot;
    policyIds: string[];
    windowIds: string[];
    hour: number;
    hoveredId: string | null;
    selectedId: string | null;
    focusedHospital: HospitalCode | null;
    particles: WindParticle[];
    ambulances: AmbulanceParticle[];
    now: number;
    pickRef: MutableRefObject<Array<{ id: string; x: number; y: number; depth: number; visible: boolean }>>;
    layers: HudLayers;
    lod: LodLevel;
    instanceCursor: HourInstanceCursor;
    hexes: ReturnType<typeof aggregateHeatPlumes>;
    copilot: CopilotSpatialState;
    parentIds: string[];
    sensors: Array<{ lon: number; lat: number; indoorC: number; acOn: boolean }>;
  },
) {
  const parent = canvas.parentElement;
  const cssW = parent?.clientWidth ?? window.innerWidth;
  const cssH = parent?.clientHeight ?? window.innerHeight;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== Math.floor(cssW * dpr) || canvas.height !== Math.floor(cssH * dpr)) {
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
  }
  const w = canvas.width;
  const h = canvas.height;
  const view = args.view;
  const basis = cameraBasisInto(FRAME_BASIS, view);
  const day = isDaylight(args.hour);
  const elev = Math.max(0, solarElevationDeg(args.hour));
  const sun = sunDirectionVecInto(SUN_DIR, args.hour);
  const targeted = targetedSet(args.policyIds);
  const windowOnly = windowOnlySet(args.windowIds, targeted);
  const cvi = fillCviMap(args.snapshot.buildings);
  const pulse = 0.55 + 0.45 * Math.sin(args.now / 420);
  const highlightSet = highlightSetOf(args.copilot.highlightIds);
  const diffById = diffMap(args.copilot.diff ?? []);
  const citeRoofs = args.copilot.citationHighlight === "roofs";

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const skyTop = day ? "#071525" : "#02040c";
  const skyHorizon = day
    ? `rgb(${28 + elev * 0.7}, ${48 + elev * 0.9}, ${72 + elev * 0.4})`
    : "#0a1630";
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, skyTop);
  sky.addColorStop(0.55, skyHorizon);
  sky.addColorStop(1, day ? "#0b2430" : "#031018");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  const astro = solarPositionHk(args.hour);
  if (astro.elevationDeg > 1) {
    sunEnuFromLookAtInto(
      SUN_POS_ENU,
      view.targetEast,
      view.targetNorth,
      astro.elevationDeg,
      astro.azimuthDeg,
      2200,
    );
    projectEnuInto(SUN_POS_PROJ, SUN_POS_ENU, view, w, h, basis);
    GROUND_ENU.east = view.targetEast;
    GROUND_ENU.north = view.targetNorth;
    GROUND_ENU.up = 4;
    projectEnuInto(GROUND_PROJ, GROUND_ENU, view, w, h, basis);
    if (SUN_POS_PROJ.visible) {
      const ray = ctx.createLinearGradient(SUN_POS_PROJ.x, SUN_POS_PROJ.y, GROUND_PROJ.x, GROUND_PROJ.y);
      ray.addColorStop(0, `rgba(255, 214, 140, ${0.5 + 0.2 * pulse})`);
      ray.addColorStop(1, "rgba(255, 180, 80, 0)");
      ctx.strokeStyle = ray;
      ctx.lineWidth = 2.4 * dpr;
      ctx.beginPath();
      ctx.moveTo(SUN_POS_PROJ.x, SUN_POS_PROJ.y);
      ctx.lineTo(GROUND_PROJ.x, GROUND_PROJ.y);
      ctx.stroke();
      const disc = ctx.createRadialGradient(SUN_POS_PROJ.x, SUN_POS_PROJ.y, 2 * dpr, SUN_POS_PROJ.x, SUN_POS_PROJ.y, 28 * dpr);
      disc.addColorStop(0, "rgba(255, 244, 200, 0.95)");
      disc.addColorStop(1, "rgba(255, 180, 60, 0)");
      ctx.fillStyle = disc;
      ctx.beginPath();
      ctx.arc(SUN_POS_PROJ.x, SUN_POS_PROJ.y, 28 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (!day) {
    ctx.fillStyle = "rgba(186,230,253,0.35)";
    for (let i = 0; i < 48; i += 1) {
      const x = ((i * 97 + args.now * 0.002) % w);
      const y = (i * 53) % Math.floor(h * 0.45);
      ctx.fillRect(x, y, 1.2, 1.2);
    }
  }

  const harbour = projectRingInto(HARBOUR_ENU, HARBOUR_PROJECTED, view, w, h, basis);
  fillPoly(ctx, harbour, day ? "rgba(8, 64, 82, 0.92)" : "rgba(4, 24, 38, 0.95)", "rgba(34,211,238,0.18)", 1.2);
  ctx.save();
  ctx.beginPath();
  if (harbour[0]) {
    ctx.moveTo(harbour[0].x, harbour[0].y);
    for (let i = 1; i < harbour.length; i += 1) ctx.lineTo(harbour[i].x, harbour[i].y);
    ctx.closePath();
    ctx.clip();
    ctx.strokeStyle = "rgba(125, 211, 252, 0.12)";
    ctx.lineWidth = 1;
    for (let i = 0; i < 18; i += 1) {
      const y = ((args.now * 0.03 + i * 28) % (h * 0.55)) + h * 0.4;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y + 8);
      ctx.stroke();
    }
  }
  ctx.restore();

  const land = projectRingInto(LAND_ENU, LAND_PROJECTED, view, w, h, basis);
  fillPoly(ctx, land, day ? "rgba(12, 18, 28, 0.96)" : "rgba(8, 12, 20, 0.97)", "rgba(15,23,42,0.8)", 1);

  if (diffById.size > 0) {
    for (const mesh of args.meshes) {
      const cell = diffById.get(mesh.id);
      if (!cell || Math.abs(cell.delta) < 0.05) continue;
      const projected = projectRingInto(mesh.ground, mesh.projectScratch, view, w, h, basis);
      const mag = Math.min(0.58, 0.14 + Math.abs(cell.delta) / 36);
      const fill = cell.delta < 0 ? `rgba(16,185,129,${mag})` : `rgba(239,68,68,${mag})`;
      const stroke = cell.delta < 0 ? "rgba(16,185,129,0.95)" : "rgba(239,68,68,0.95)";
      fillPoly(ctx, projected, fill, stroke, 1.8 * dpr);
    }
  }

  if (day && elev > 4 && args.lod === 2) {
    for (const mesh of args.meshes) {
      const shadow = fillShadowScratch(mesh, sun);
      const projected = projectRingInto(shadow, mesh.projectScratch, view, w, h, basis);
      fillPoly(ctx, projected, "rgba(2, 8, 18, 0.4)");
    }
  }

  if (args.layers.h3Hexes) {
    for (const cell of args.hexes) {
      const ring = ensureEnu(cell.boundary.length, HEX_ENU);
      for (let i = 0; i < cell.boundary.length; i += 1) {
        const [lon, lat] = cell.boundary[i];
        ring[i].east = 0;
        wgs84ToEnuInto(ring[i], lon, lat, 1.4);
      }
      const projected = projectRingInto(ring, HEX_PROJ, view, w, h, basis);
      fillPoly(ctx, projected, rgba(cell.color, 0.2), rgba(cell.color, 0.55), 1.1 * dpr);
    }
  }

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (args.lod > 0) {
    for (const spine of args.spines) {
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < spine.path.length; i += 1) {
        const q = projectParticle(spine.path[i][0], spine.path[i][1], 1.2, view, w, h, basis);
        if (!q.visible) continue;
        if (!started) {
          ctx.moveTo(q.x, q.y);
          started = true;
        } else {
          ctx.lineTo(q.x, q.y);
        }
      }
      if (!started) continue;
      ctx.strokeStyle = day ? "rgba(148,163,184,0.28)" : "rgba(34,211,238,0.22)";
      ctx.lineWidth = 2.4 * dpr;
      ctx.stroke();
    }
  }

  let pickN = 0;

  if (args.lod === 0) {
    drawDistrictInstances(
      ctx,
      args.instanceCursor,
      view,
      w,
      h,
      basis,
      dpr,
      args.now,
      args.copilot.highlightIds,
      args.parentIds,
    );
  } else {
  const order = depthSortMeshes(args.meshes, view, w, h, basis);

  for (let oi = 0; oi < order.length; oi += 1) {
    const mesh = args.meshes[order[oi]];
    cviRgbaInto(cvi.get(mesh.id) ?? 0, COLOR_SCRATCH);
    const color = COLOR_SCRATCH;
    const highlight = args.selectedId === mesh.id || args.hoveredId === mesh.id;
    const dimmed = Boolean(highlightSet && !highlightSet.has(mesh.id));
    const gold = targeted.has(mesh.id) || (citeRoofs && !dimmed);
    const greedyGhost = windowOnly.has(mesh.id);
    const roofUp = mesh.height;
    const faces = mesh.faces;
    for (const face of faces) {
      const projected = projectRingInto(face.pts, FACE_PROJ, view, w, h, basis);
      const ambient = day ? 0.32 : 0.22;
      if (face.roof && gold) {
        fillPoly(
          ctx,
          projected,
          `rgba(253, 230, 120, ${0.82 + 0.15 * pulse})`,
          "rgba(255, 220, 80, 1)",
          2.2 * dpr,
        );
        let eastSum = 0;
        let northSum = 0;
        for (let pi = 0; pi < face.pts.length; pi += 1) {
          eastSum += face.pts[pi].east;
          northSum += face.pts[pi].north;
        }
        ROOF_MID_ENU.east = eastSum / face.pts.length;
        ROOF_MID_ENU.north = northSum / face.pts.length;
        ROOF_MID_ENU.up = roofUp + 3;
        projectEnuInto(ROOF_MID_PROJ, ROOF_MID_ENU, view, w, h, basis);
        if (ROOF_MID_PROJ.visible) {
          const glow = ctx.createRadialGradient(ROOF_MID_PROJ.x, ROOF_MID_PROJ.y, 2 * dpr, ROOF_MID_PROJ.x, ROOF_MID_PROJ.y, 28 * dpr);
          glow.addColorStop(0, `rgba(253, 224, 71, ${0.55 * pulse})`);
          glow.addColorStop(1, "rgba(253, 224, 71, 0)");
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(ROOF_MID_PROJ.x, ROOF_MID_PROJ.y, 28 * dpr, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (face.roof && greedyGhost) {
        shadeRgb(color, face.normal, sun, ambient);
        fillPoly(
          ctx,
          projected,
          `rgba(${SHADE_SCRATCH[0]},${SHADE_SCRATCH[1]},${SHADE_SCRATCH[2]},0.88)`,
          "rgba(226,232,240,0.7)",
          1.2 * dpr,
        );
      } else if (args.layers.buildingWireframes) {
        fillPoly(ctx, projected, "rgba(8,20,32,0.12)", highlight ? "rgba(34,211,238,0.95)" : "rgba(125,211,252,0.45)", 1.1 * dpr);
      } else {
        const [r, g, b] = shadeRgb(color, face.normal, sun, ambient);
        const edge = highlight ? "rgba(34,211,238,0.95)" : gold ? "rgba(251,191,36,0.7)" : "rgba(15,23,42,0.55)";
        const alpha = dimmed ? 0.22 : face.roof ? 0.96 : 0.9;
        fillPoly(ctx, projected, `rgba(${r},${g},${b},${alpha})`, edge, highlight ? 2.2 * dpr : 1);
        if (args.lod === 2 && !day && !face.roof && projected.length >= 4) {
          ctx.fillStyle = "rgba(255, 214, 130, 0.42)";
          for (let k = 1; k <= 4; k += 1) {
            const t = k / 5;
            const x1 = projected[0].x * (1 - t) + projected[3].x * t;
            const y1 = projected[0].y * (1 - t) + projected[3].y * t;
            const x2 = projected[1].x * (1 - t) + projected[2].x * t;
            const y2 = projected[1].y * (1 - t) + projected[2].y * t;
            ctx.fillRect((x1 + x2) / 2 - dpr, (y1 + y2) / 2 - dpr, 2.2 * dpr, 1.4 * dpr);
          }
        }
      }
    }
    ROOF_ENU.east = mesh.centroid.east;
    ROOF_ENU.north = mesh.centroid.north;
    ROOF_ENU.up = roofUp;
    projectEnuInto(ROOF_PROJ, ROOF_ENU, view, w, h, basis);
    let pick = PICK_SCRATCH[pickN];
    if (!pick) {
      pick = { id: mesh.id, x: ROOF_PROJ.x, y: ROOF_PROJ.y, depth: ROOF_PROJ.depth, visible: ROOF_PROJ.visible };
      PICK_SCRATCH[pickN] = pick;
    } else {
      pick.id = mesh.id;
      pick.x = ROOF_PROJ.x;
      pick.y = ROOF_PROJ.y;
      pick.depth = ROOF_PROJ.depth;
      pick.visible = ROOF_PROJ.visible;
    }
    pickN += 1;
    const cviVal = cvi.get(mesh.id) ?? 0;
    if (args.layers.thermalShimmer && cviVal >= 58) {
      projectEnuInto(BASE_PROJ, ROOF_ENU, view, w, h, basis);
      TIP_ENU.east = mesh.centroid.east + Math.sin(args.now / 240 + mesh.centroid.north * 0.01) * 6;
      TIP_ENU.north = mesh.centroid.north;
      TIP_ENU.up = roofUp + (cviVal - 50) * 2.6;
      projectEnuInto(TIP_PROJ, TIP_ENU, view, w, h, basis);
      if (BASE_PROJ.visible && TIP_PROJ.visible) {
        const plume = ctx.createLinearGradient(BASE_PROJ.x, BASE_PROJ.y, TIP_PROJ.x, TIP_PROJ.y);
        plume.addColorStop(0, rgba(color, 0.08));
        plume.addColorStop(1, rgba(color, 0.42 * pulse));
        ctx.strokeStyle = plume;
        ctx.lineWidth = 6 * dpr;
        ctx.beginPath();
        ctx.moveTo(BASE_PROJ.x, BASE_PROJ.y);
        const waves = 6;
        for (let i = 1; i <= waves; i += 1) {
          const t = i / waves;
          const x = BASE_PROJ.x + (TIP_PROJ.x - BASE_PROJ.x) * t + Math.sin(args.now / 180 + t * 8 + mesh.centroid.east * 0.01) * 7 * dpr * t;
          const y = BASE_PROJ.y + (TIP_PROJ.y - BASE_PROJ.y) * t;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
  }
  }
  for (let i = pickN; i < PICK_SCRATCH.length; i += 1) PICK_SCRATCH[i].visible = false;
  args.pickRef.current = PICK_SCRATCH;

  if (args.lod === 2) {
    const destHospital = args.focusedHospital ? hospitalByCode(args.focusedHospital) : null;
    for (let bi = 0; bi < args.buildings.length; bi += 1) {
      const building = args.buildings[bi];
      const dest = destHospital
        ? destHospital
        : primaryHospitalForDistrict(building.properties.district);
      if (destHospital) {
        if ((dest.catchmentWeight[building.properties.district] ?? 0) < 0.28) continue;
      } else if (!targeted.has(building.properties.id)) {
        continue;
      }
      const wgt = dest.catchmentWeight[building.properties.district];
      if (wgt < 0.2) continue;
      const [lon, lat] = buildingCentroid(building);
      wgs84ToEnuInto(ROOF_ENU, lon, lat, building.properties.height * EXTRUSION_SCALE);
      projectEnuInto(ARC_SRC_PROJ, ROOF_ENU, view, w, h, basis);
      wgs84ToEnuInto(TIP_ENU, dest.longitude, dest.latitude, 36);
      projectEnuInto(ARC_DST_PROJ, TIP_ENU, view, w, h, basis);
      if (!ARC_SRC_PROJ.visible && !ARC_DST_PROJ.visible) continue;
      const mx = (ARC_SRC_PROJ.x + ARC_DST_PROJ.x) / 2;
      const my = Math.min(ARC_SRC_PROJ.y, ARC_DST_PROJ.y) - 80 * dpr * wgt;
      ctx.beginPath();
      ctx.moveTo(ARC_SRC_PROJ.x, ARC_SRC_PROJ.y);
      ctx.quadraticCurveTo(mx, my, ARC_DST_PROJ.x, ARC_DST_PROJ.y);
      ctx.strokeStyle = args.focusedHospital ? "rgba(34,211,238,0.45)" : "rgba(251,191,36,0.5)";
      ctx.lineWidth = (1.2 + 3 * wgt) * dpr;
      ctx.stroke();
    }
  }

  if (args.layers.windVectors && args.lod > 0) {
    for (const p of args.particles) {
      const fade = Math.max(0.08, 0.62 * (1 - p.age / p.maxAge));
      if (args.lod === 2 && p.trailLen >= 2) {
        ctx.beginPath();
        let started = false;
        for (let ti = 0; ti < p.trailLen; ti += 1) {
          const q = projectParticle(p.trail[ti][0], p.trail[ti][1], 6, view, w, h, basis);
          if (!q.visible) continue;
          if (!started) {
            ctx.moveTo(q.x, q.y);
            started = true;
          } else {
            ctx.lineTo(q.x, q.y);
          }
        }
        if (started) {
          ctx.strokeStyle = p.stalled
            ? `rgba(148,163,184,${fade * 0.45})`
            : p.venturi > 1.25
              ? `rgba(251,191,36,${fade})`
              : `rgba(34,211,238,${fade})`;
          ctx.lineWidth = (p.stalled ? 0.7 : 1.05 + 0.7 * Math.min(1.4, p.venturi - 1)) * dpr;
          ctx.stroke();
        }
      }
      const q = projectParticle(p.lon, p.lat, 6, view, w, h, basis);
      if (!q.visible) continue;
      ctx.fillStyle = p.venturi > 1.25 ? `rgba(251,191,36,${fade})` : `rgba(34,211,238,${fade})`;
      ctx.beginPath();
      ctx.arc(q.x, q.y, (1.4 + p.speed * 0.38) * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (args.lod > 0) {
    const strokes = arterialStrokes(args.snapshot.triage);
    for (const stroke of strokes) {
      ctx.beginPath();
      let started = false;
      for (let pi = 0; pi < stroke.path.length; pi += 1) {
        const q = projectParticle(stroke.path[pi][0], stroke.path[pi][1], 8, view, w, h, basis);
        if (!q.visible) continue;
        if (!started) {
          ctx.moveTo(q.x, q.y);
          started = true;
        } else {
          ctx.lineTo(q.x, q.y);
        }
      }
      if (started) {
        ctx.strokeStyle =
          stroke.arterial === "nathan-road" ? "rgba(251,146,60,0.85)" : "rgba(244,63,94,0.85)";
        ctx.lineWidth = (2.2 + Math.min(4, stroke.patients * 0.08)) * dpr;
        ctx.stroke();
      }
    }
    for (const p of args.ambulances) {
      const q = projectParticle(p.lon, p.lat, 10, view, w, h, basis);
      if (!q.visible) continue;
      ctx.beginPath();
      ctx.arc(q.x, q.y, 3.4 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = p.arterial === "nathan-road" ? "rgba(254,215,170,0.95)" : "rgba(254,202,202,0.95)";
      ctx.fill();
      ctx.strokeStyle = "rgba(15,23,42,0.9)";
      ctx.lineWidth = 1.1 * dpr;
      ctx.stroke();
    }
  }

  if (args.lod > 0 && args.sensors.length > 0) {
    for (const sensor of args.sensors) {
      const q = projectParticle(sensor.lon, sensor.lat, 12 + (sensor.indoorC - 28) * 0.4, view, w, h, basis);
      if (!q.visible) continue;
      const hot = Math.max(0, Math.min(1, (sensor.indoorC - 28) / 8));
      ctx.beginPath();
      ctx.arc(q.x, q.y, (1.6 + hot) * dpr, 0, Math.PI * 2);
      ctx.fillStyle = sensor.acOn
        ? `rgba(52,211,153,${0.45 + 0.4 * hot})`
        : `rgba(251,146,60,${0.4 + 0.5 * hot})`;
      ctx.fill();
    }
  }

  ctx.font = `${11 * dpr}px ui-monospace, monospace`;
  ctx.textAlign = "center";
  for (let hi = 0; hi < HOSPITALS.length; hi += 1) {
    const hospital = HOSPITALS[hi];
    const p = projectParticle(hospital.longitude, hospital.latitude, 28, view, w, h, basis);
    const slot = HOSPITAL_PICK[hi];
    slot.id = hospital.code;
    slot.x = p.x;
    slot.y = p.y;
    slot.depth = p.depth;
    slot.visible = p.visible;
    if (!p.visible) continue;
    const on = args.focusedHospital === hospital.code;
    ctx.beginPath();
    ctx.arc(p.x, p.y, (on ? 11 : 8) * dpr, 0, Math.PI * 2);
    ctx.fillStyle = on ? "rgba(251,191,36,0.95)" : "rgba(186,230,253,0.92)";
    ctx.fill();
    ctx.strokeStyle = "rgba(8,145,178,1)";
    ctx.lineWidth = 2 * dpr;
    ctx.stroke();
    ctx.fillStyle = "rgba(226,232,240,0.92)";
    ctx.fillText(`${hospital.code} · ${hospital.nameZh}`, p.x, p.y - 14 * dpr);
  }

  const ssp = projectParticle(114.1629, 22.3312, 8, view, w, h, basis);
  const sspX = ssp.x;
  const sspY = ssp.y;
  const sspVis = ssp.visible;
  const ytm = projectParticle(114.1708, 22.3104, 8, view, w, h, basis);
  const ytmX = ytm.x;
  const ytmY = ytm.y;
  const ytmVis = ytm.visible;
  const harbourLabel = projectParticle(114.172, 22.294, 0, view, w, h, basis);
  const harbourX = harbourLabel.x;
  const harbourY = harbourLabel.y;
  const harbourVis = harbourLabel.visible;
  ctx.fillStyle = "rgba(148,163,184,0.75)";
  ctx.font = `${10 * dpr}px ui-monospace, monospace`;
  if (sspVis) ctx.fillText("SHAM SHUI PO  深水埗", sspX, sspY);
  if (ytmVis) ctx.fillText("YAU TSIM MONG  油尖旺", ytmX, ytmY);
  if (harbourVis) ctx.fillText("VICTORIA HARBOUR", harbourX, harbourY);

  const vig = ctx.createRadialGradient(w * 0.5, h * 0.45, h * 0.15, w * 0.5, h * 0.5, h * 0.85);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(2,6,12,0.38)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = "rgba(34,211,238,0.55)";
  for (let y = 0; y < h; y += 4 * dpr) {
    ctx.globalAlpha = 0.035;
    ctx.fillRect(0, y, w, dpr);
  }
  ctx.globalAlpha = 1;

  ctx.textAlign = "left";
  ctx.font = `${10 * dpr}px ui-monospace, monospace`;
  ctx.fillStyle = "rgba(125,211,252,0.7)";
  ctx.fillText("SOFTWARE TWIN · WGS84 → ENU m · solar rays · Venturi streaks · no HK80 on the projector", 16 * dpr, h - 16 * dpr);
}
