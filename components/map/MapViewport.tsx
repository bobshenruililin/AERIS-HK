"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { TwinCanvas } from "./TwinCanvas";
import { CinematicPlate } from "@/components/assets/CinematicPlate";
import { ErrorBoundary } from "@/components/system/ErrorBoundary";
import { AERIS_GPU_FAILED_EVENT, probeHealthyWebGL2 } from "@/lib/runtime-guards";

const AERISMap = dynamic(() => import("./AERISMap"), {
  ssr: false,
  loading: () => null,
});

type GpuState = "software" | "promoted" | "failover";

/**
 * Deck.gl + MapLibre (Mapbox-compatible style) mount only when the caller
 * asked (?gpu=1) *and* a real non-software WebGL2 context can clear and read
 * back a pixel. Mapbox GL JS is never instantiated; MapLibre is the basemap.
 * TwinCanvas (Canvas2D ENU) is always the picture underneath.
 */
export function MapViewport() {
  const [gpu, setGpu] = useState<GpuState>("software");
  const [askedGpu, setAskedGpu] = useState(false);

  useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get("gpu") === "1";
    setAskedGpu(asked);
    if (!asked) {
      setGpu("software");
      return;
    }
    if (!probeHealthyWebGL2()) {
      setGpu("failover");
      return;
    }
    setGpu("promoted");
  }, []);

  useEffect(() => {
    const demote = () => setGpu((s) => (s === "promoted" ? "failover" : s));
    window.addEventListener(AERIS_GPU_FAILED_EVENT, demote);
    window.addEventListener("webglcontextlost", demote);
    return () => {
      window.removeEventListener(AERIS_GPU_FAILED_EVENT, demote);
      window.removeEventListener("webglcontextlost", demote);
    };
  }, []);

  return (
    <div className="absolute inset-0 bg-[#05070c]" data-testid="map-viewport">
      <CinematicPlate />
      <ErrorBoundary fallback={null}>
        <TwinCanvas />
      </ErrorBoundary>
      {gpu === "promoted" ? (
        <ErrorBoundary
          fallback={null}
          onError={() => setGpu("failover")}
        >
          <div className="absolute inset-0" data-testid="gpu-twin">
            <AERISMap />
          </div>
        </ErrorBoundary>
      ) : null}
      {askedGpu && gpu === "failover" ? (
        <div
          className="pointer-events-none absolute bottom-28 left-1/2 z-20 -translate-x-1/2 rounded-full border border-amber-300/30 bg-slate-950/80 px-3 py-1 font-mono text-[10px] text-amber-100"
          data-testid="gpu-failover"
        >
          WebGL / MapLibre unavailable · software ENU twin
        </div>
      ) : null}
    </div>
  );
}
