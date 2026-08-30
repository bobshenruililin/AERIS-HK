"use client";

import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { useSimulation } from "@/components/simulation/SimulationProvider";
import { EXTRUSION_SCALE } from "@/lib/constants";
import { cviColor } from "@/lib/epidemiology-engine";
import { HOSPITALS } from "@/lib/hospitals";
import { isDaylight, solarElevationDeg, sunDirectionVec } from "@/lib/solar";
import { streetSpinesFromBuildings } from "@/lib/streets";
import { buildingCentroid } from "@/lib/spatial-data";
import type { BuildingFeature, HospitalCode, SystemHourSnapshot } from "@/lib/types";
import { advectWindParticles, createWindParticles, type WindParticle } from "@/lib/wind-field";
import {
  HARBOUR_TWIN_VIEW,
  KOWLOON_TWIN_VIEW,
  TWIN_FLYIN_EVENT,
  cameraBasis,
  lerpView,
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

  const startFlyIn = useCallback(() => {
    viewRef.current = { ...HARBOUR_TWIN_VIEW };
    flyRef.current = { t0: performance.now(), active: true };
  }, []);

  useEffect(() => {
    startFlyIn();
    const onFly = () => startFlyIn();
    window.addEventListener(TWIN_FLYIN_EVENT, onFly);
    return () => window.removeEventListener(TWIN_FLYIN_EVENT, onFly);
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
      }
      particlesRef.current = advectWindParticles(particlesRef.current, dt, state.hour, state.buildings);
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
        }
      }}
    />
  );
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

  ctx.lineCap = "round";
  ctx.lineJoin = "round";
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

  const ordered = [...args.meshes].sort((a, b) => {
    const da = projectEnu(a.centroid, view, w, h, basis).depth;
    const db = projectEnu(b.centroid, view, w, h, basis).depth;
    return db - da;
  });

  const picks: Array<{ id: string; x: number; y: number; depth: number; visible: boolean }> = [];

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
          `rgba(253, 224, 71, ${0.72 + 0.2 * pulse})`,
          "rgba(251,191,36,0.95)",
          1.6 * dpr,
        );
      } else if (face.roof && greedyGhost) {
        const [r, g, b] = shadeRgb(color, face.normal, sun, ambient);
        fillPoly(ctx, projected, `rgba(${r},${g},${b},0.88)`, "rgba(226,232,240,0.7)", 1.2 * dpr);
      } else {
        const [r, g, b] = shadeRgb(color, face.normal, sun, ambient);
        const edge = highlight ? "rgba(34,211,238,0.95)" : gold ? "rgba(251,191,36,0.7)" : "rgba(15,23,42,0.55)";
        fillPoly(ctx, projected, `rgba(${r},${g},${b},${face.roof ? 0.96 : 0.9})`, edge, highlight ? 2.2 * dpr : 1);
      }
    }
    const roofPick = projectEnu({ ...mesh.centroid, up: roofUp }, view, w, h, basis);
    picks.push({ id: mesh.id, ...roofPick });
    const cviVal = cvi.get(mesh.id) ?? 0;
    if (cviVal >= 58) {
      const base = projectEnu({ ...mesh.centroid, up: roofUp }, view, w, h, basis);
      const tip = projectEnu({ ...mesh.centroid, up: roofUp + (cviVal - 50) * 2.6 }, view, w, h, basis);
      if (base.visible && tip.visible) {
        const plume = ctx.createLinearGradient(base.x, base.y, tip.x, tip.y);
        plume.addColorStop(0, rgba(color, 0.08));
        plume.addColorStop(1, rgba(color, 0.38 * pulse));
        ctx.strokeStyle = plume;
        ctx.lineWidth = 6 * dpr;
        ctx.beginPath();
        ctx.moveTo(base.x, base.y);
        ctx.lineTo(tip.x, tip.y);
        ctx.stroke();
      }
    }
  }
  args.pickRef.current = picks;

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

  ctx.fillStyle = day ? "rgba(34,211,238,0.45)" : "rgba(186,230,253,0.55)";
  for (const p of args.particles) {
    const q = projectEnu(wgs84ToEnu(p.lon, p.lat, 6), view, w, h, basis);
    if (!q.visible) continue;
    const a = Math.max(0.08, 0.55 * (1 - p.age / p.maxAge));
    ctx.globalAlpha = a;
    ctx.beginPath();
    ctx.arc(q.x, q.y, (1.6 + p.speed * 0.4) * dpr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

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
  ctx.fillText("SOFTWARE TWIN · WGS84 → ENU m · no HK80 on the projector", 16 * dpr, h - 16 * dpr);
}
