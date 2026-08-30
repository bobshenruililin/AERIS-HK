"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DeckGL from "@deck.gl/react";
import { GeoJsonLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { MapViewState, PickingInfo } from "@deck.gl/core";
import { Map as MapLibreMap } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { useSimulation } from "@/components/simulation/SimulationProvider";
import {
  CARTO_DARK_MATTER_STYLE,
  CVI_HOVER_LINE,
  CVI_IDLE_LINE,
  EXTRUSION_SCALE,
  KOWLOON_VIEW,
} from "@/lib/constants";
import { cviColor } from "@/lib/epidemiology-engine";
import { HOSPITALS } from "@/lib/hospitals";
import { advectWindParticles, createWindParticles, type WindParticle } from "@/lib/wind-field";
import type { BuildingFeature, BuildingFeatureCollection, BuildingProperties } from "@/lib/types";
import { buildingCentroid } from "@/lib/spatial-data";

export default function AERISMap() {
  const { buildings, snapshot, hour, hoveredId, selectedId, setHoveredId, setSelectedId } = useSimulation();
  const [viewState, setViewState] = useState<MapViewState>({ ...KOWLOON_VIEW });
  const particlesRef = useRef<WindParticle[]>(createWindParticles());
  const [particles, setParticles] = useState<WindParticle[]>(particlesRef.current);

  const cviById = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of snapshot.buildings) {
      map.set(row.buildingId, row.cvi);
    }
    return map;
  }, [snapshot.buildings]);

  const collection = useMemo<BuildingFeatureCollection>(
    () => ({
      type: "FeatureCollection",
      crs: { type: "name", properties: { name: "EPSG:4326" } },
      features: buildings,
    }),
    [buildings],
  );

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let emit = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      particlesRef.current = advectWindParticles(particlesRef.current, dt, hour, buildings);
      emit += dt;
      if (emit >= 1 / 28) {
        setParticles(particlesRef.current);
        emit = 0;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [hour, buildings]);

  const layers = useMemo(() => {
    const highlightId = selectedId ?? hoveredId;
    return [
      new GeoJsonLayer<BuildingProperties>({
        id: "aeris-buildings",
        data: collection,
        extruded: true,
        filled: true,
        wireframe: true,
        pickable: true,
        opacity: 0.95,
        getElevation: (f) => f.properties.height * EXTRUSION_SCALE,
        getFillColor: (f) => cviColor(cviById.get(f.properties.id) ?? 0),
        getLineColor: (f) =>
          f.properties.id === highlightId ? CVI_HOVER_LINE : CVI_IDLE_LINE,
        lineWidthMinPixels: 1,
        getLineWidth: (f) => (f.properties.id === highlightId ? 2.4 : 0.6),
        material: {
          ambient: 0.32,
          diffuse: 0.68,
          shininess: 40,
          specularColor: [90, 220, 255],
        },
        updateTriggers: {
          getFillColor: snapshot.hour,
          getLineColor: highlightId,
          getLineWidth: highlightId,
        },
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
      new ScatterplotLayer<WindParticle>({
        id: "canyon-wind-particles",
        data: particles,
        getPosition: (d) => [d.lon, d.lat],
        getRadius: (d) => 1.4 + d.speed * 0.35,
        radiusUnits: "meters",
        radiusMinPixels: 1.2,
        radiusMaxPixels: 5,
        getFillColor: (d) => {
          const fade = Math.max(50, 230 * (1 - d.age / d.maxAge));
          return d.speed > 2.1 ? [34, 211, 238, fade] : [148, 163, 184, fade * 0.7];
        },
      }),
      new ScatterplotLayer<(typeof HOSPITALS)[number]>({
        id: "ha-hospitals",
        data: HOSPITALS,
        pickable: true,
        getPosition: (d) => [d.longitude, d.latitude],
        getRadius: 22,
        radiusUnits: "meters",
        radiusMinPixels: 6,
        getFillColor: [186, 230, 253, 230],
        stroked: true,
        getLineColor: [8, 145, 178, 255],
        lineWidthMinPixels: 2,
      }),
    ];
  }, [collection, cviById, snapshot.hour, hoveredId, selectedId, buildings, particles]);

  const onViewStateChange = useCallback((params: { viewState: Record<string, unknown> }) => {
    const next = params.viewState;
    const longitude = Number(next.longitude);
    const latitude = Number(next.latitude);
    const zoom = Number(next.zoom);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || !Number.isFinite(zoom)) {
      return;
    }
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
      const id = info.object?.properties?.id ?? null;
      setHoveredId(id);
    },
    [setHoveredId],
  );

  const onClick = useCallback(
    (info: PickingInfo<BuildingFeature>) => {
      const id = info.object?.properties?.id;
      if (id) {
        setSelectedId(id);
        const feature = buildings.find((b) => b.properties.id === id);
        if (feature) {
          const [longitude, latitude] = buildingCentroid(feature);
          setViewState((prev) => ({ ...prev, longitude, latitude, zoom: Math.max(prev.zoom, 16.6) }));
        }
      }
    },
    [buildings, setSelectedId],
  );

  return (
    <DeckGL
      viewState={viewState}
      onViewStateChange={(params) => onViewStateChange(params)}
      controller
      layers={layers}
      onHover={onHover}
      onClick={onClick}
      getCursor={({ isHovering, isDragging }) =>
        isDragging ? "grabbing" : isHovering ? "pointer" : "grab"
      }
      style={{ position: "absolute", inset: "0" }}
    >
      <MapLibreMap
        mapStyle={CARTO_DARK_MATTER_STYLE}
        attributionControl={false}
        reuseMaps
      />
    </DeckGL>
  );
}
