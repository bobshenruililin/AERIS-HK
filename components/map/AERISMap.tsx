"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DeckGL from "@deck.gl/react";
import {
  AmbientLight,
  DirectionalLight,
  FlyToInterpolator,
  LightingEffect,
} from "@deck.gl/core";
import { ArcLayer, ColumnLayer, GeoJsonLayer, PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { MapViewState, PickingInfo } from "@deck.gl/core";
import { Map as MapLibreMap } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { useSimulation } from "@/components/simulation/SimulationProvider";
import {
  CARTO_DARK_MATTER_STYLE,
  CVI_COOL_ROOF_LINE,
  CVI_HOVER_LINE,
  CVI_IDLE_LINE,
  EXTRUSION_SCALE,
  HARBOUR_APPROACH_VIEW,
  KOWLOON_VIEW,
} from "@/lib/constants";
import { cviColor } from "@/lib/epidemiology-engine";
import { HOSPITALS } from "@/lib/hospitals";
import { advectWindParticles, createWindParticles, windStreaksFromParticles, type WindParticle } from "@/lib/wind-field";
import type { BuildingFeature, BuildingFeatureCollection, BuildingProperties, HospitalCode } from "@/lib/types";
import { buildingCentroid } from "@/lib/spatial-data";
import { streetSpinesFromBuildings } from "@/lib/streets";
import { isDaylight, solarElevationDeg, sunDirectionVec } from "@/lib/solar";
import { aggregateHeatPlumes } from "@/lib/h3-index";
import {
  acPulseFromHour,
  packedAcWattsAt,
  packedColorAt,
  packedElevationAt,
  packDiurnalGpuAttributes,
} from "@/lib/gpu-attributes";
import { ThermalShimmerExtension } from "@/lib/thermal-shimmer-extension";
import { VenturiStreamExtension } from "@/lib/venturi-stream-extension";

interface PlumeRow {
  id: string;
  position: [number, number];
  elevation: number;
  color: [number, number, number, number];
}

interface RoofDisc {
  id: string;
  position: [number, number, number];
  radius: number;
}

interface CatchmentArc {
  id: string;
  source: [number, number];
  target: [number, number];
  width: number;
}

export default function AERISMap() {
  const {
    buildings,
    snapshot,
    hour,
    hoveredId,
    selectedId,
    setHoveredId,
    setSelectedId,
    policy,
    focusedHospital,
    setFocusedHospital,
    hudLayers,
    forcing,
    setInspectorAnchor,
    cache,
  } = useSimulation();
  const [viewState, setViewState] = useState<MapViewState>({ ...HARBOUR_APPROACH_VIEW });
  const particlesRef = useRef<WindParticle[]>(createWindParticles());
  const [particles, setParticles] = useState<WindParticle[]>(particlesRef.current);
  const [gpuTime, setGpuTime] = useState(0);
  const userMoved = useRef(false);

  const targeted = useMemo(() => new Set(policy.coolRoofTargetIds), [policy.coolRoofTargetIds]);

  const centroidById = useMemo(() => {
    const map = new Map<string, [number, number]>();
    for (const feature of buildings) {
      map.set(feature.properties.id, buildingCentroid(feature));
    }
    return map;
  }, [buildings]);

  const collection = useMemo<BuildingFeatureCollection>(
    () => ({
      type: "FeatureCollection",
      crs: { type: "name", properties: { name: "EPSG:4326" } },
      features: buildings,
    }),
    [buildings],
  );

  const spines = useMemo(() => streetSpinesFromBuildings(buildings), [buildings]);
  const hourFloor = Math.floor(hour) % 24;
  const gpuPack = useMemo(() => packDiurnalGpuAttributes(buildings, cache), [buildings, cache]);
  const shimmerExtension = useMemo(() => new ThermalShimmerExtension(), []);
  const venturiExtension = useMemo(() => new VenturiStreamExtension(), []);
  const hexes = useMemo(
    () => (hudLayers.h3Hexes ? aggregateHeatPlumes(buildings, snapshot.buildings, 10) : []),
    [buildings, snapshot.buildings, hudLayers.h3Hexes],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (userMoved.current) return;
      setViewState({
        ...KOWLOON_VIEW,
        transitionDuration: 4200,
        transitionInterpolator: new FlyToInterpolator({ speed: 0.85 }),
      } as MapViewState);
    }, 280);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let emit = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      particlesRef.current = advectWindParticles(particlesRef.current, dt, hour, buildings, forcing);
      emit += dt;
      if (emit >= 1 / 28) {
        setParticles(particlesRef.current);
        setGpuTime(now / 1000);
        emit = 0;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [hour, buildings, forcing]);

  const lighting = useMemo(() => {
    const day = isDaylight(hour);
    const el = Math.max(0, solarElevationDeg(hour));
    const ambient = new AmbientLight({
      color: day ? [255, 252, 245] : [120, 160, 220],
      intensity: day ? 0.38 : 0.55,
    });
    const sun = new DirectionalLight({
      color: day ? [255, 236, 200] : [90, 140, 255],
      intensity: day ? 0.55 + 0.7 * Math.min(1, el / 50) : 0.35,
      direction: sunDirectionVec(hour),
    });
    return new LightingEffect({ ambientLight: ambient, sunLight: sun });
  }, [hour]);

  const plumes = useMemo<PlumeRow[]>(() => {
    return snapshot.buildings
      .filter((row) => row.cvi >= 58)
      .map((row) => {
        const pos = centroidById.get(row.buildingId) ?? [KOWLOON_VIEW.longitude, KOWLOON_VIEW.latitude];
        return {
          id: row.buildingId,
          position: pos,
          elevation: Math.max(8, (row.cvi - 50) * 2.8),
          color: cviColor(row.cvi),
        };
      });
  }, [snapshot.buildings, centroidById]);

  const roofDiscs = useMemo<RoofDisc[]>(() => {
    return buildings
      .filter((b) => targeted.has(b.properties.id))
      .map((b) => {
        const [lon, lat] = centroidById.get(b.properties.id) ?? [0, 0];
        return {
          id: b.properties.id,
          position: [lon, lat, b.properties.height * EXTRUSION_SCALE + 4],
          radius: Math.max(4.5, Math.sqrt(b.properties.roofAreaM2 / Math.PI) * 0.85),
        };
      });
  }, [buildings, targeted, centroidById]);

  const arcs = useMemo<CatchmentArc[]>(() => {
    const sourceBuildings = focusedHospital
      ? buildings.filter((b) => {
          const spec = HOSPITALS.find((h) => h.code === focusedHospital);
          return (spec?.catchmentWeight[b.properties.district] ?? 0) >= 0.28;
        })
      : buildings.filter((b) => targeted.has(b.properties.id));
    return sourceBuildings.flatMap((b) => {
      const [lon, lat] = centroidById.get(b.properties.id) ?? [0, 0];
      const ranked = [...HOSPITALS].sort(
        (a, c) => c.catchmentWeight[b.properties.district] - a.catchmentWeight[b.properties.district],
      );
      const dest = focusedHospital ? HOSPITALS.find((h) => h.code === focusedHospital) : ranked[0];
      if (!dest) return [];
      const w = dest.catchmentWeight[b.properties.district];
      if (w < 0.2) return [];
      return [
        {
          id: `${b.properties.id}-${dest.code}`,
          source: [lon, lat] as [number, number],
          target: [dest.longitude, dest.latitude] as [number, number],
          width: 1.2 + 3.2 * w,
        },
      ];
    });
  }, [buildings, targeted, focusedHospital, centroidById]);

  const streaks = useMemo(() => windStreaksFromParticles(particles), [particles]);

  const layers = useMemo(() => {
    const highlightId = selectedId ?? hoveredId;
    const night = !isDaylight(hour);
    return [
      new PathLayer({
        id: "street-spines",
        data: spines,
        getPath: (d) => d.path,
        getColor: night ? [34, 211, 238, 70] : [148, 163, 184, 50],
        getWidth: 7,
        widthUnits: "meters",
        capRounded: true,
        jointRounded: true,
      }),
      new GeoJsonLayer({
        id: "h3-microclimate",
        data: {
          type: "FeatureCollection",
          features: hexes.map((cell) => ({
            type: "Feature" as const,
            properties: cell,
            geometry: {
              type: "Polygon" as const,
              coordinates: [
                (() => {
                  const ring = cell.boundary;
                  if (ring.length === 0) return ring;
                  const [fx, fy] = ring[0];
                  const [lx, ly] = ring[ring.length - 1];
                  return fx === lx && fy === ly ? ring : [...ring, ring[0]];
                })(),
              ],
            },
          })),
        },
        extruded: true,
        pickable: false,
        opacity: 0.55,
        getFillColor: (f: { properties: { color: [number, number, number, number] } }) => [
          f.properties.color[0],
          f.properties.color[1],
          f.properties.color[2],
          110,
        ],
        getElevation: (f: { properties: { elevation: number } }) => f.properties.elevation,
        visible: hudLayers.h3Hexes,
        updateTriggers: {
          getFillColor: hourFloor,
          getElevation: hourFloor,
        },
      }),
      new GeoJsonLayer<BuildingProperties>({
        id: "aeris-buildings",
        data: collection,
        extruded: true,
        filled: !hudLayers.buildingWireframes,
        wireframe: true,
        pickable: true,
        opacity: hudLayers.buildingWireframes ? 0.35 : 0.96,
        getElevation: (f) => packedElevationAt(gpuPack, f.properties.id, hourFloor),
        getFillColor: (f) => packedColorAt(gpuPack, f.properties.id, hourFloor),
        getLineColor: (f) =>
          f.properties.id === highlightId
            ? CVI_HOVER_LINE
            : targeted.has(f.properties.id)
              ? CVI_COOL_ROOF_LINE
              : CVI_IDLE_LINE,
        lineWidthMinPixels: 1,
        getLineWidth: (f) =>
          f.properties.id === highlightId ? 2.4 : targeted.has(f.properties.id) ? 1.8 : 0.6,
        material: {
          ambient: 0.28,
          diffuse: 0.72,
          shininess: 48,
          specularColor: [120, 230, 255],
        },
        extensions: hudLayers.thermalShimmer ? [shimmerExtension] : [],
        updateTriggers: {
          getFillColor: hourFloor,
          getElevation: hourFloor,
          getAcWatts: hourFloor,
          getLineColor: `${highlightId}:${policy.coolRoofTargetIds.join(",")}`,
          getLineWidth: `${highlightId}:${policy.coolRoofTargetIds.join(",")}`,
        },
        acPulse: acPulseFromHour(hour, hudLayers.thermalShimmer),
        getAcWatts: (f: { properties: BuildingProperties }) => packedAcWattsAt(gpuPack, f.properties.id, hourFloor),
      } as ConstructorParameters<typeof GeoJsonLayer<BuildingProperties>>[0]),
      new ColumnLayer<PlumeRow>({
        id: "cvi-heat-plumes",
        data: hudLayers.thermalShimmer ? plumes : [],
        diskResolution: 6,
        radius: 4.2,
        extruded: true,
        pickable: false,
        getPosition: (d) => d.position,
        getFillColor: (d) => [d.color[0], d.color[1], d.color[2], 70],
        getElevation: (d) => d.elevation,
        elevationScale: 1,
      }),
      new ScatterplotLayer<RoofDisc>({
        id: "cool-roof-discs",
        data: roofDiscs,
        getPosition: (d) => d.position,
        getRadius: (d) => d.radius,
        radiusUnits: "meters",
        getFillColor: [255, 236, 160, 230],
        stroked: true,
        getLineColor: CVI_COOL_ROOF_LINE,
        lineWidthMinPixels: 1.5,
      }),
      new GeoJsonLayer<BuildingProperties>({
        id: "aeris-buildings-hover-glow",
        data: {
          type: "FeatureCollection",
          features: highlightId ? buildings.filter((b) => b.properties.id === highlightId) : [],
        },
        extruded: true,
        filled: false,
        wireframe: true,
        pickable: false,
        getElevation: (f) => f.properties.height * EXTRUSION_SCALE + 6,
        getLineColor: CVI_HOVER_LINE,
        lineWidthMinPixels: 3,
        updateTriggers: { getElevation: highlightId },
      }),
      new ArcLayer<CatchmentArc>({
        id: "catchment-arcs",
        data: arcs,
        getSourcePosition: (d) => d.source,
        getTargetPosition: (d) => d.target,
        getSourceColor: focusedHospital ? [34, 211, 238, 160] : [251, 191, 36, 180],
        getTargetColor: [186, 230, 253, 140],
        getWidth: (d) => d.width,
        widthUnits: "pixels",
        greatCircle: false,
      }),
      new PathLayer({
        id: "venturi-streamlines",
        data: hudLayers.windVectors ? streaks : [],
        getPath: (d: { path: [number, number][] }) => d.path,
        getColor: (d: { stalled: boolean; venturi: number; alpha: number }) =>
          d.stalled
            ? [148, 163, 184, Math.round(90 * d.alpha)]
            : d.venturi > 1.25
              ? [251, 191, 36, Math.round(210 * d.alpha)]
              : [34, 211, 238, Math.round(180 * d.alpha)],
        getWidth: (d: { stalled: boolean; venturi: number }) =>
          d.stalled ? 3 : 4 + 6 * Math.min(1.5, Math.max(0, d.venturi - 1)),
        widthUnits: "meters",
        capRounded: true,
        jointRounded: true,
        extensions: [venturiExtension],
        venturiTime: gpuTime,
        updateTriggers: { getColor: gpuTime, getWidth: gpuTime },
      } as ConstructorParameters<typeof PathLayer>[0]),
      new ScatterplotLayer<WindParticle>({
        id: "canyon-wind-particles",
        data: hudLayers.windVectors ? particles : [],
        getPosition: (d) => [d.lon, d.lat],
        getRadius: (d) => 1.4 + d.speed * 0.35,
        radiusUnits: "meters",
        radiusMinPixels: 1.2,
        radiusMaxPixels: 5,
        getFillColor: (d) => {
          const fade = Math.max(50, 230 * (1 - d.age / d.maxAge));
          if (d.stalled) return [148, 163, 184, fade * 0.55];
          return d.venturi > 1.25 ? [251, 191, 36, fade] : [34, 211, 238, fade];
        },
      }),
      new ScatterplotLayer<(typeof HOSPITALS)[number]>({
        id: "ha-hospitals",
        data: HOSPITALS,
        pickable: true,
        getPosition: (d) => [d.longitude, d.latitude],
        getRadius: (d) => (focusedHospital === d.code ? 32 : 22),
        radiusUnits: "meters",
        radiusMinPixels: 6,
        getFillColor: (d) =>
          focusedHospital === d.code ? [251, 191, 36, 240] : [186, 230, 253, 230],
        stroked: true,
        getLineColor: [8, 145, 178, 255],
        lineWidthMinPixels: 2,
        updateTriggers: { getRadius: focusedHospital, getFillColor: focusedHospital },
      }),
    ];
  }, [
    collection,
    gpuPack,
    hourFloor,
    hexes,
    shimmerExtension,
    venturiExtension,
    gpuTime,
    streaks,
    hour,
    hoveredId,
    selectedId,
    buildings,
    particles,
    targeted,
    policy.coolRoofTargetIds,
    plumes,
    roofDiscs,
    arcs,
    spines,
    focusedHospital,
    hudLayers,
  ]);

  const onViewStateChange = useCallback((params: { viewState: Record<string, unknown> }) => {
    const next = params.viewState;
    const longitude = Number(next.longitude);
    const latitude = Number(next.latitude);
    const zoom = Number(next.zoom);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || !Number.isFinite(zoom)) {
      return;
    }
    userMoved.current = true;
    setViewState({
      longitude,
      latitude,
      zoom,
      pitch: typeof next.pitch === "number" ? next.pitch : KOWLOON_VIEW.pitch,
      bearing: typeof next.bearing === "number" ? next.bearing : KOWLOON_VIEW.bearing,
      maxPitch: KOWLOON_VIEW.maxPitch,
      minZoom: KOWLOON_VIEW.minZoom,
      maxZoom: KOWLOON_VIEW.maxZoom,
    });
  }, []);

  const onHover = useCallback(
    (info: PickingInfo<BuildingFeature>) => {
      if (info.layer?.id === "ha-hospitals") return;
      const id = info.object?.properties?.id ?? null;
      setHoveredId(id);
    },
    [setHoveredId],
  );

  const onClick = useCallback(
    (info: PickingInfo<BuildingFeature | (typeof HOSPITALS)[number]>) => {
      if (info.layer?.id === "ha-hospitals") {
        const code = (info.object as (typeof HOSPITALS)[number] | undefined)?.code as HospitalCode | undefined;
        if (code) {
          setFocusedHospital(focusedHospital === code ? null : code);
        }
        return;
      }
      const id = (info.object as BuildingFeature | undefined)?.properties?.id;
      if (id) {
        setFocusedHospital(null);
        setSelectedId(id);
        const feature = buildings.find((b) => b.properties.id === id);
        if (feature) {
          const [longitude, latitude] = buildingCentroid(feature);
          userMoved.current = true;
          setViewState((prev) => ({ ...prev, longitude, latitude, zoom: Math.max(prev.zoom, 16.6) }));
          setInspectorAnchor({ x: info.x ?? 0, y: info.y ?? 0 });
        }
      }
    },
    [buildings, setSelectedId, focusedHospital, setFocusedHospital, setInspectorAnchor],
  );

  return (
    <DeckGL
      viewState={viewState}
      onViewStateChange={(params) => onViewStateChange(params)}
      controller
      layers={layers}
      effects={[lighting]}
      onHover={onHover}
      onClick={onClick}
      getCursor={({ isHovering, isDragging }) =>
        isDragging ? "grabbing" : isHovering ? "pointer" : "grab"
      }
      style={{ position: "absolute", inset: "0" }}
    >
      <MapLibreMap mapStyle={CARTO_DARK_MATTER_STYLE} attributionControl={false} reuseMaps />
    </DeckGL>
  );
}
