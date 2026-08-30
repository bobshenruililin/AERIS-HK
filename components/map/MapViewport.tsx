"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { TwinCanvas } from "./TwinCanvas";

const AERISMap = dynamic(() => import("./AERISMap"), {
  ssr: false,
  loading: () => null,
});

function probeWebGL(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 8;
    canvas.height = 8;
    const gl =
      canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: true }) ??
      canvas.getContext("webgl", { failIfMajorPerformanceCaveat: true });
    if (!gl || gl.isContextLost()) return false;
    return gl.drawingBufferWidth >= 8 && gl.drawingBufferHeight >= 8;
  } catch {
    return false;
  }
}

export function MapViewport() {
  const [gpu, setGpu] = useState(false);
  useEffect(() => {
    setGpu(probeWebGL());
  }, []);

  return (
    <div className="absolute inset-0 bg-[#05070c]" data-testid="map-viewport">
      <TwinCanvas />
      {gpu ? (
        <div className="absolute inset-0" data-testid="gpu-twin">
          <AERISMap />
        </div>
      ) : (
        <div className="pointer-events-none absolute bottom-24 left-1/2 z-[5] -translate-x-1/2 rounded-full border border-cyan-300/20 bg-slate-950/50 px-3 py-1 font-mono text-[10px] text-cyan-100/80">
          Software twin · GPU Deck.gl standby
        </div>
      )}
    </div>
  );
}
