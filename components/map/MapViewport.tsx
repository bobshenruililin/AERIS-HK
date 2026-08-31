"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { TwinCanvas } from "./TwinCanvas";
import { CinematicPlate } from "@/components/assets/CinematicPlate";
import { ErrorBoundary } from "@/components/system/ErrorBoundary";
import { AERIS_GPU_FAILED_EVENT, probeHealthyWebGL2 } from "@/lib/runtime-guards";
import {
  AERIS_GPU_RESTORED_EVENT,
  handleWebGlContextLost,
  handleWebGlContextRestored,
  probeWebGPU,
  webgpuSupportedSync,
} from "@/lib/gpu/context-lifecycle";
import { recordGpuFlags } from "@/lib/runtime-diagnostics";
import { wantsGpuTwin } from "@/lib/presentation/earth-mode";

const AERISMap = dynamic(() => import("./AERISMap"), {
  ssr: false,
  loading: () => null,
});

type GpuState = "software" | "promoted" | "failover";

/**
 * Deck.gl + MapLibre (Mapbox-compatible style) mount only when the caller
 * asked (`?gpu=1`, `/earth`, or theater query) *and* a real non-software
 * WebGL2 context can clear and read back a pixel. Mapbox GL JS is never
 * instantiated; MapLibre is the basemap. TwinCanvas (Canvas2D ENU) is always
 * the picture underneath.
 *
 * webglcontextlost calls preventDefault so webglcontextrestored can remount
 * Deck.gl without a page reload.
 */
export function MapViewport() {
  const [gpu, setGpu] = useState<GpuState>("software");
  const [askedGpu, setAskedGpu] = useState(false);
  const [gpuEpoch, setGpuEpoch] = useState(0);

  useEffect(() => {
    const asked = wantsGpuTwin(window.location.pathname, window.location.search);
    setAskedGpu(asked);
    recordGpuFlags({ webgl2: probeHealthyWebGL2(), webgpu: webgpuSupportedSync(), contextLost: false });
    void probeWebGPU().then((probe) => {
      recordGpuFlags({ webgpu: probe.available && probe.adapter, contextLost: probe.lost });
    });
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
    const demote = () => {
      setGpu((s) => (s === "promoted" ? "failover" : s));
      recordGpuFlags({ contextLost: true, webgl2: false });
    };
    const onLost = (event: Event) => {
      handleWebGlContextLost(event);
      demote();
    };
    const onRestored = () => {
      handleWebGlContextRestored();
      const asked = wantsGpuTwin(window.location.pathname, window.location.search);
      if (!asked) return;
      if (!probeHealthyWebGL2()) {
        setGpu("failover");
        recordGpuFlags({ webgl2: false, contextLost: true });
        return;
      }
      recordGpuFlags({ webgl2: true, contextLost: false });
      setGpu("promoted");
      setGpuEpoch((n) => n + 1);
    };
    window.addEventListener(AERIS_GPU_FAILED_EVENT, demote);
    window.addEventListener("webglcontextlost", onLost);
    window.addEventListener("webglcontextrestored", onRestored);
    window.addEventListener(AERIS_GPU_RESTORED_EVENT, onRestored);
    return () => {
      window.removeEventListener(AERIS_GPU_FAILED_EVENT, demote);
      window.removeEventListener("webglcontextlost", onLost);
      window.removeEventListener("webglcontextrestored", onRestored);
      window.removeEventListener(AERIS_GPU_RESTORED_EVENT, onRestored);
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
            <AERISMap key={gpuEpoch} />
          </div>
        </ErrorBoundary>
      ) : null}
      {askedGpu && gpu === "failover" ? (
        <div
          className="pointer-events-none absolute left-1/2 top-14 z-40 -translate-x-1/2 rounded-full border border-amber-300/30 bg-slate-950/90 px-3 py-1 font-mono text-[10px] text-amber-100 shadow-[0_0_24px_rgba(251,191,36,0.25)]"
          data-testid="gpu-failover"
        >
          WebGL / MapLibre unavailable · software ENU twin
        </div>
      ) : null}
    </div>
  );
}
