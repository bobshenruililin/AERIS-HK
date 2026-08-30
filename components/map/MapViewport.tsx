"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { TwinCanvas } from "./TwinCanvas";

const AERISMap = dynamic(() => import("./AERISMap"), {
  ssr: false,
  loading: () => null,
});

/**
 * Only promote Deck.gl when the caller asked (?gpu=1) *and* a real
 * non-software WebGL2 context can clear and read back a pixel.
 * Otherwise the Canvas2D ENU twin is the picture — MapLibre-without-extrusions
 * is a flat Carto sheet that hides the city.
 */
function probeHealthyWebGL2(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const gl = canvas.getContext("webgl2", {
      failIfMajorPerformanceCaveat: true,
      antialias: false,
      preserveDrawingBuffer: true,
    });
    if (!gl || gl.isContextLost() || gl.drawingBufferWidth < 32) return false;
    gl.clearColor(0.05, 0.82, 0.31, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const px = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px[1] > 160 && px[0] < 80;
  } catch {
    return false;
  }
}

export function MapViewport() {
  const [gpu, setGpu] = useState(false);
  useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get("gpu") === "1";
    setGpu(asked && probeHealthyWebGL2());
  }, []);

  return (
    <div className="absolute inset-0 bg-[#05070c]" data-testid="map-viewport">
      <TwinCanvas />
      {gpu ? (
        <div className="absolute inset-0" data-testid="gpu-twin">
          <AERISMap />
        </div>
      ) : null}
    </div>
  );
}
