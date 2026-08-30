"use client";

import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useSimulation } from "@/components/simulation/SimulationProvider";
import { EXTRUSION_SCALE } from "@/lib/constants";
import { cviColor } from "@/lib/epidemiology-engine";
import { HOSPITALS } from "@/lib/hospitals";
import { isDaylight, solarElevationDeg, sunDirectionVec } from "@/lib/solar";
import { streetSpinesFromBuildings } from "@/lib/streets";
import { buildingCentroid } from "@/lib/spatial-data";
import { aggregateHeatPlumes } from "@/lib/h3-index";
import type { BuildingFeature, HospitalCode, SystemHourSnapshot } from "@/lib/types";
import type { HudLayers } from "@/lib/hud";
import { advectWindParticles, createWindParticles, type WindParticle } from "@/lib/wind-field";
import { castGroundShadow, solarPositionHk, sunEnuFromLookAt } from "@/lib/solar-engine";
import {
  lodFromDistanceM,
  packedInstanceColor,
  packInstanceExtrusions,
  sliceHourInstances,
  type HourInstanceSlice,
  type LodLevel,
} from "@/lib/instance-mesh";
import { wrapHour } from "@/lib/utils";
import {
  HARBOUR_TWIN_VIEW,
  KOWLOON_TWIN_VIEW,
  TWIN_FLYIN_EVENT,
  TWIN_LOOKAT_EVENT,
  TWIN_ORBIT_EVENT,
  cameraBasis,
  lerpView,
  orbitView,
  pickNearestId,
  projectEnu,
  wgs84ToEnu,
  type EnuPoint,
  type ProjectedPoint,
  type TwinView,
} from "@/lib/twin-camera";

interface MeshBuilding {
  id: string;
  ground: EnuPoint[];
  height: number;
  centroid: EnuPoint;
}

const HARBOUR_RING: Array<[number, number]> = [
  [114.148, 22.278],
  [114.205, 22.276],
  [114.198, 22.305],
  [114.176, 22.311],
  [114.149, 22.318],
];

const LAND_RING: Array<[number, number]> = [
  [114.1485, 22.318],
  [114.176, 22.311],
  [114.1785, 22.322],
  [114.175, 22.338],
  [114.158, 22.341],
  [114.151, 22.334],
];

function rgba(color: [number, number, number, number], alpha = color[3] / 255): string {
  return `rgba(${color[0]},${color[1]},${color[2]},${alpha})`;
}

function shadeRgb(
  color: [number, number, number, number],
  normal: EnuPoint,
  sun: [number, number, number],
  ambient: number,
): [number, number, number] {
  const ndot = Math.max(0, -(normal.east * sun[0] + normal.north * sun[1] + normal.up * sun[2]));
  const lit = ambient + 0.72 * ndot;
  return [
    Math.round(color[0] * lit),
    Math.round(color[1] * lit),
    Math.round(color[2] * lit),
  ];
}

function fillPoly(ctx: CanvasRenderingContext2D, pts: ProjectedPoint[], fill: string, stroke?: string, width = 1) {
  if (pts.length < 3 || pts.some((p) => !p.visible && p.depth < 8)) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke();
  }
}

function projectRing(
  ring: EnuPoint[],
  view: TwinView,
  w: number,
  h: number,
  basis: ReturnType<typeof cameraBasis>,
): ProjectedPoint[] {
  return ring.map((p) => projectEnu(p, view, w, h, basis));
}

export function TwinCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sim = useSimulation();
  const simRef = useRef(sim);
  simRef.current = sim;
  const viewRef = useRef<TwinView>({ ...HARBOUR_TWIN_VIEW });
  const flyRef = useRef({ t0: 0, active: true });
  const lookRef = useRef<{ t0: number; from: TwinView; to: TwinView } | null>(null);
  const orbitRef = useRef<{ active: boolean; t0: number; base: TwinView } | null>(null);
  const particlesRef = useRef<WindParticle[]>(createWindParticles());
  const pickRef = useRef<Array<{ id: string; x: number; y: number; depth: number; visible: boolean }>>([]);

  const meshes = useMemo<MeshBuilding[]>(() => {
    return sim.buildings.map((feature) => {
      const ring = feature.geometry.coordinates[0];
      const ground: EnuPoint[] = [];
      const n = Math.max(1, ring.length - 1);
      for (let i = 0; i < n; i += 1) {
        ground.push(wgs84ToEnu(ring[i][0], ring[i][1], 0));
      }
      const [lon, lat] = buildingCentroid(feature);
      return {
        id: feature.properties.id,
        ground,
        height: feature.properties.height * EXTRUSION_SCALE,
        centroid: wgs84ToEnu(lon, lat, feature.properties.height * EXTRUSION_SCALE * 0.5),
      };
    });
  }, [sim.buildings]);

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
    viewRef.current = { ...HARBOUR_TWIN_VIEW };
    flyRef.current = { t0: performance.now(), active: true };
  }, []);

  useEffect(() => {
    startFlyIn();
    const onFly = () => startFlyIn();
    const onLook = (event: Event) => {
      const detail = (event as CustomEvent<{ lon: number; lat: number }>).detail;
      if (!detail) return;
      orbitRef.current = null;
      const enu = wgs84ToEnu(detail.lon, detail.lat, 0);
      lookRef.current = {
        t0: performance.now(),
        from: { ...viewRef.current },
        to: {
          ...viewRef.current,
          targetEast: enu.east,
          targetNorth: enu.north,
          targetUp: 22,
          distance: Math.min(viewRef.current.distance, 480),
        },
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
    window.addEventListener(TWIN_FLYIN_EVENT, onFly);
    window.addEventListener(TWIN_LOOKAT_EVENT, onLook);
    window.addEventListener(TWIN_ORBIT_EVENT, onOrbit);
    return () => {
      window.removeEventListener(TWIN_FLYIN_EVENT, onFly);
      window.removeEventListener(TWIN_LOOKAT_EVENT, onLook);
      window.removeEventListener(TWIN_ORBIT_EVENT, onOrbit);
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
          viewRef.current = { ...KOWLOON_TWIN_VIEW };
          flyRef.current.active = false;
        } else {
          viewRef.current = lerpView(HARBOUR_TWIN_VIEW, KOWLOON_TWIN_VIEW, t);
        }
      } else if (lookRef.current) {
        const t = (now - lookRef.current.t0) / 900;
        if (t >= 1) {
          viewRef.current = lookRef.current.to;
          lookRef.current = null;
        } else {
          viewRef.current = lerpView(lookRef.current.from, lookRef.current.to, t);
        }
      } else if (orbitRef.current?.active) {
        viewRef.current = orbitView(orbitRef.current.base, now - orbitRef.current.t0);
      }
      const lod = lodFromDistanceM(viewRef.current.distance);
      if (lod > 0) {
        particlesRef.current = advectWindParticles(
          particlesRef.current,
          dt,
          state.hour,
          state.buildings,
          state.forcing,
        );
      }
      const slice = sliceHourInstances(packRef.current, state.hour, lod);
      drawFrame(ctx, canvas, {
        view: viewRef.current,
        meshes,
        spines,
        buildings: state.buildings,
        snapshot: state.snapshot,
        policyIds: state.policy.coolRoofTargetIds,
        windowIds: state.coolRoofPlan?.windowSelectedIds ?? [],
        hour: state.hour,
        hoveredId: state.hoveredId,
        selectedId: state.selectedId,
        focusedHospital: state.focusedHospital,
        particles: particlesRef.current,
        now,
        pickRef,
        layers: state.hudLayers,
        lod,
        instanceSlice: slice,
        hexes: lod === 0 ? hexes9Ref.current : hexes10Ref.current,
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
        const hospital = pickNearestId(
          pt.x,
          pt.y,
          HOSPITALS.map((h) => {
            const enu = wgs84ToEnu(h.longitude, h.latitude, 40);
            const p = projectEnu(enu, viewRef.current, canvasRef.current?.width ?? 1, canvasRef.current?.height ?? 1);
            return { id: h.code, ...p };
          }),
          44,
        );
        if (hospital && (hospital === "CMC" || hospital === "KWH" || hospital === "QEH")) {
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
  slice: HourInstanceSlice,
  view: TwinView,
  w: number,
  h: number,
  basis: ReturnType<typeof cameraBasis>,
  dpr: number,
  now: number,
): void {
  const pulse = 0.55 + 0.45 * Math.sin(now / 420);
  for (let i = 0; i < slice.count; i += 1) {
    const lon = slice.instancePositions[i * 3];
    const lat = slice.instancePositions[i * 3 + 1];
    const elev = slice.instanceElevations[i];
    const enu = wgs84ToEnu(lon, lat, elev * 0.45);
    const p = projectEnu(enu, view, w, h, basis);
    if (!p.visible) continue;
    const color = packedInstanceColor(slice, i);
    const size = Math.max(1.4 * dpr, (elev / Math.max(80, view.distance)) * h * 0.42);
    ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},${0.55 + 0.2 * pulse})`;
    ctx.fillRect(p.x - size * 0.28, p.y - size, size * 0.56, size);
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
    now: number;
    pickRef: MutableRefObject<Array<{ id: string; x: number; y: number; depth: number; visible: boolean }>>;
    layers: HudLayers;
    lod: LodLevel;
    instanceSlice: HourInstanceSlice;
    hexes: ReturnType<typeof aggregateHeatPlumes>;
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
  const basis = cameraBasis(view);
  const day = isDaylight(args.hour);
  const elev = Math.max(0, solarElevationDeg(args.hour));
  const sun = sunDirectionVec(args.hour);
  const targeted = new Set(args.policyIds);
  const windowOnly = new Set(args.windowIds.filter((id) => !targeted.has(id)));
  const cvi = new Map(args.snapshot.buildings.map((row) => [row.buildingId, row.cvi]));
  const pulse = 0.55 + 0.45 * Math.sin(args.now / 420);

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
    const sunPos = sunEnuFromLookAt(
      view.targetEast,
      view.targetNorth,
      astro.elevationDeg,
      astro.azimuthDeg,
      2200,
    );
    const sunP = projectEnu(sunPos, view, w, h, basis);
    const ground = projectEnu({ east: view.targetEast, north: view.targetNorth, up: 4 }, view, w, h, basis);
    if (sunP.visible) {
      const ray = ctx.createLinearGradient(sunP.x, sunP.y, ground.x, ground.y);
      ray.addColorStop(0, `rgba(255, 214, 140, ${0.5 + 0.2 * pulse})`);
      ray.addColorStop(1, "rgba(255, 180, 80, 0)");
      ctx.strokeStyle = ray;
      ctx.lineWidth = 2.4 * dpr;
      ctx.beginPath();
      ctx.moveTo(sunP.x, sunP.y);
      ctx.lineTo(ground.x, ground.y);
      ctx.stroke();
      const disc = ctx.createRadialGradient(sunP.x, sunP.y, 2 * dpr, sunP.x, sunP.y, 28 * dpr);
      disc.addColorStop(0, "rgba(255, 244, 200, 0.95)");
      disc.addColorStop(1, "rgba(255, 180, 60, 0)");
      ctx.fillStyle = disc;
      ctx.beginPath();
      ctx.arc(sunP.x, sunP.y, 28 * dpr, 0, Math.PI * 2);
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

  const harbour = projectRing(
    HARBOUR_RING.map(([lon, lat]) => wgs84ToEnu(lon, lat, 0)),
    view,
    w,
    h,
    basis,
  );
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

  const land = projectRing(
    LAND_RING.map(([lon, lat]) => wgs84ToEnu(lon, lat, 0.4)),
    view,
    w,
    h,
    basis,
  );
  fillPoly(ctx, land, day ? "rgba(12, 18, 28, 0.96)" : "rgba(8, 12, 20, 0.97)", "rgba(15,23,42,0.8)", 1);

  if (day && elev > 4 && args.lod === 2) {
    for (const mesh of args.meshes) {
      const roofUp = mesh.height;
      const shadow = mesh.ground.map((p) => castGroundShadow({ ...p, up: roofUp }, sun));
      const projected = projectRing(shadow, view, w, h, basis);
      fillPoly(ctx, projected, "rgba(2, 8, 18, 0.4)");
    }
  }

  if (args.layers.h3Hexes) {
    for (const cell of args.hexes) {
      const ring = cell.boundary.map(([lon, lat]) => wgs84ToEnu(lon, lat, 1.4));
      const projected = projectRing(ring, view, w, h, basis);
      fillPoly(ctx, projected, rgba(cell.color, 0.2), rgba(cell.color, 0.55), 1.1 * dpr);
    }
  }

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (args.lod > 0) {
    for (const spine of args.spines) {
      const path = spine.path.map(([lon, lat]) => projectEnu(wgs84ToEnu(lon, lat, 1.2), view, w, h, basis));
      if (path.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(path[0].x, path[0].y);
      for (let i = 1; i < path.length; i += 1) ctx.lineTo(path[i].x, path[i].y);
      ctx.strokeStyle = day ? "rgba(148,163,184,0.28)" : "rgba(34,211,238,0.22)";
      ctx.lineWidth = 2.4 * dpr;
      ctx.stroke();
    }
  }

  const picks: Array<{ id: string; x: number; y: number; depth: number; visible: boolean }> = [];

  if (args.lod === 0) {
    drawDistrictInstances(ctx, args.instanceSlice, view, w, h, basis, dpr, args.now);
  } else {
  const ordered = [...args.meshes].sort((a, b) => {
    const da = projectEnu(a.centroid, view, w, h, basis).depth;
    const db = projectEnu(b.centroid, view, w, h, basis).depth;
    return db - da;
  });

  for (const mesh of ordered) {
    const color = cviColor(cvi.get(mesh.id) ?? 0);
    const highlight = args.selectedId === mesh.id || args.hoveredId === mesh.id;
    const gold = targeted.has(mesh.id);
    const greedyGhost = windowOnly.has(mesh.id);
    const roofUp = mesh.height;
    const roof = mesh.ground.map((p) => ({ ...p, up: roofUp }));
    const faces: Array<{ pts: EnuPoint[]; normal: EnuPoint; roof?: boolean }> = [];
    for (let i = 0; i < mesh.ground.length; i += 1) {
      const a = mesh.ground[i];
      const b = mesh.ground[(i + 1) % mesh.ground.length];
      const dx = b.east - a.east;
      const dy = b.north - a.north;
      const normal = { east: dy, north: -dx, up: 0 };
      const nlen = Math.hypot(normal.east, normal.north) || 1;
      faces.push({
        pts: [a, b, { ...b, up: roofUp }, { ...a, up: roofUp }],
        normal: { east: normal.east / nlen, north: normal.north / nlen, up: 0 },
      });
    }
    faces.push({
      pts: roof,
      normal: { east: 0, north: 0, up: 1 },
      roof: true,
    });
    faces.sort((a, b) => {
      const da = a.pts.reduce((s, p) => s + projectEnu(p, view, w, h, basis).depth, 0) / a.pts.length;
      const db = b.pts.reduce((s, p) => s + projectEnu(p, view, w, h, basis).depth, 0) / b.pts.length;
      return db - da;
    });
    for (const face of faces) {
      const projected = projectRing(face.pts, view, w, h, basis);
      const ambient = day ? 0.32 : 0.22;
      if (face.roof && gold) {
        fillPoly(
          ctx,
          projected,
          `rgba(253, 230, 120, ${0.82 + 0.15 * pulse})`,
          "rgba(255, 220, 80, 1)",
          2.2 * dpr,
        );
        const roofMid = projectEnu(
          {
            east: face.pts.reduce((s, p) => s + p.east, 0) / face.pts.length,
            north: face.pts.reduce((s, p) => s + p.north, 0) / face.pts.length,
            up: roofUp + 3,
          },
          view,
          w,
          h,
          basis,
        );
        if (roofMid.visible) {
          const glow = ctx.createRadialGradient(roofMid.x, roofMid.y, 2 * dpr, roofMid.x, roofMid.y, 28 * dpr);
          glow.addColorStop(0, `rgba(253, 224, 71, ${0.55 * pulse})`);
          glow.addColorStop(1, "rgba(253, 224, 71, 0)");
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(roofMid.x, roofMid.y, 28 * dpr, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (face.roof && greedyGhost) {
        const [r, g, b] = shadeRgb(color, face.normal, sun, ambient);
        fillPoly(ctx, projected, `rgba(${r},${g},${b},0.88)`, "rgba(226,232,240,0.7)", 1.2 * dpr);
      } else if (args.layers.buildingWireframes) {
        fillPoly(ctx, projected, "rgba(8,20,32,0.12)", highlight ? "rgba(34,211,238,0.95)" : "rgba(125,211,252,0.45)", 1.1 * dpr);
      } else {
        const [r, g, b] = shadeRgb(color, face.normal, sun, ambient);
        const edge = highlight ? "rgba(34,211,238,0.95)" : gold ? "rgba(251,191,36,0.7)" : "rgba(15,23,42,0.55)";
        fillPoly(ctx, projected, `rgba(${r},${g},${b},${face.roof ? 0.96 : 0.9})`, edge, highlight ? 2.2 * dpr : 1);
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
    const roofPick = projectEnu({ ...mesh.centroid, up: roofUp }, view, w, h, basis);
    picks.push({ id: mesh.id, ...roofPick });
    const cviVal = cvi.get(mesh.id) ?? 0;
    if (args.layers.thermalShimmer && cviVal >= 58) {
      const base = projectEnu({ ...mesh.centroid, up: roofUp }, view, w, h, basis);
      const tip = projectEnu(
        {
          ...mesh.centroid,
          east: mesh.centroid.east + Math.sin(args.now / 240 + mesh.centroid.north * 0.01) * 6,
          up: roofUp + (cviVal - 50) * 2.6,
        },
        view,
        w,
        h,
        basis,
      );
      if (base.visible && tip.visible) {
        const plume = ctx.createLinearGradient(base.x, base.y, tip.x, tip.y);
        plume.addColorStop(0, rgba(color, 0.08));
        plume.addColorStop(1, rgba(color, 0.42 * pulse));
        ctx.strokeStyle = plume;
        ctx.lineWidth = 6 * dpr;
        ctx.beginPath();
        ctx.moveTo(base.x, base.y);
        const waves = 6;
        for (let i = 1; i <= waves; i += 1) {
          const t = i / waves;
          const x = base.x + (tip.x - base.x) * t + Math.sin(args.now / 180 + t * 8 + mesh.centroid.east * 0.01) * 7 * dpr * t;
          const y = base.y + (tip.y - base.y) * t;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
  }
  }
  args.pickRef.current = picks;

  if (args.lod === 2) {
  const arcSources = args.focusedHospital
    ? args.buildings.filter((b) => {
        const spec = HOSPITALS.find((h) => h.code === args.focusedHospital);
        return (spec?.catchmentWeight[b.properties.district] ?? 0) >= 0.28;
      })
    : args.buildings.filter((b) => targeted.has(b.properties.id));
  for (const building of arcSources) {
    const [lon, lat] = buildingCentroid(building);
    const dest = args.focusedHospital
      ? HOSPITALS.find((h) => h.code === args.focusedHospital)
      : [...HOSPITALS].sort(
          (a, c) =>
            c.catchmentWeight[building.properties.district] - a.catchmentWeight[building.properties.district],
        )[0];
    if (!dest) continue;
    const wgt = dest.catchmentWeight[building.properties.district];
    if (wgt < 0.2) continue;
    const src = projectEnu(wgs84ToEnu(lon, lat, building.properties.height * EXTRUSION_SCALE), view, w, h, basis);
    const dst = projectEnu(wgs84ToEnu(dest.longitude, dest.latitude, 36), view, w, h, basis);
    if (!src.visible && !dst.visible) continue;
    const mx = (src.x + dst.x) / 2;
    const my = Math.min(src.y, dst.y) - 80 * dpr * wgt;
    ctx.beginPath();
    ctx.moveTo(src.x, src.y);
    ctx.quadraticCurveTo(mx, my, dst.x, dst.y);
    ctx.strokeStyle = args.focusedHospital ? "rgba(34,211,238,0.45)" : "rgba(251,191,36,0.5)";
    ctx.lineWidth = (1.2 + 3 * wgt) * dpr;
    ctx.stroke();
  }
  }

  if (args.layers.windVectors && args.lod > 0) {
    for (const p of args.particles) {
      const fade = Math.max(0.08, 0.62 * (1 - p.age / p.maxAge));
      if (args.lod === 2 && p.trail.length >= 2) {
        ctx.beginPath();
        let started = false;
        for (const [lon, lat] of p.trail) {
          const q = projectEnu(wgs84ToEnu(lon, lat, 6), view, w, h, basis);
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
      const q = projectEnu(wgs84ToEnu(p.lon, p.lat, 6), view, w, h, basis);
      if (!q.visible) continue;
      ctx.fillStyle = p.venturi > 1.25 ? `rgba(251,191,36,${fade})` : `rgba(34,211,238,${fade})`;
      ctx.beginPath();
      ctx.arc(q.x, q.y, (1.4 + p.speed * 0.38) * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.font = `${11 * dpr}px ui-monospace, monospace`;
  ctx.textAlign = "center";
  for (const hospital of HOSPITALS) {
    const p = projectEnu(wgs84ToEnu(hospital.longitude, hospital.latitude, 28), view, w, h, basis);
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

  const ssp = projectEnu(wgs84ToEnu(114.1629, 22.3312, 8), view, w, h, basis);
  const ytm = projectEnu(wgs84ToEnu(114.1708, 22.3104, 8), view, w, h, basis);
  const harbourLabel = projectEnu(wgs84ToEnu(114.172, 22.294, 0), view, w, h, basis);
  ctx.fillStyle = "rgba(148,163,184,0.75)";
  ctx.font = `${10 * dpr}px ui-monospace, monospace`;
  if (ssp.visible) ctx.fillText("SHAM SHUI PO  深水埗", ssp.x, ssp.y);
  if (ytm.visible) ctx.fillText("YAU TSIM MONG  油尖旺", ytm.x, ytm.y);
  if (harbourLabel.visible) ctx.fillText("VICTORIA HARBOUR", harbourLabel.x, harbourLabel.y);

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
