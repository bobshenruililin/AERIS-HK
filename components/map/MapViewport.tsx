"use client";

import dynamic from "next/dynamic";

const AERISMap = dynamic(() => import("./AERISMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-[#05070c]">
      <div className="text-center">
        <div className="mb-2 font-mono text-[11px] tracking-[0.35em] text-cyan-400">AERIS-HK</div>
        <div className="text-sm text-cyan-100/80">Mounting WebGL spatial twin…</div>
        <div className="mt-2 text-[11px] text-slate-500">Deck.gl v9 · MapLibre · EPSG:4326 display CRS</div>
      </div>
    </div>
  ),
});

export function MapViewport() {
  return (
    <div className="absolute inset-0 bg-[#05070c]">
      <AERISMap />
    </div>
  );
}
