"use client";

import { useSimulation } from "@/components/simulation/SimulationProvider";
import { GlassPanel } from "./GlassPanel";
import { classifyCvi } from "@/lib/epidemiology-engine";

export function CriticalList() {
  const { analytics, setSelectedId, selectedId, snapshot } = useSimulation();
  const rows =
    analytics?.topCritical?.length
      ? analytics.topCritical
      : snapshot.buildings
          .slice()
          .sort((a, b) => b.cvi - a.cvi)
          .slice(0, 10)
          .map((b) => ({
            buildingId: b.buildingId,
            nameEn: b.buildingId,
            nameZh: "",
            district: "Sham Shui Po" as const,
            hour: snapshot.hour,
            cvi: b.cvi,
            microWbgt: b.microWbgt,
            indoorTa: b.indoorTa,
            cviTier: classifyCvi(b.cvi),
          }));

  return (
    <div className="pointer-events-none absolute bottom-36 left-0 z-20 hidden w-full max-w-sm p-3 md:block md:p-4">
      <GlassPanel padded={false} className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
          <div className="text-[10px] uppercase tracking-[0.18em] text-cyan-300">Top thermal-CVD buildings</div>
          <div className="text-[10px] text-slate-500">
            {analytics ? `${analytics.engine} · ${analytics.queryLatencyMs.toFixed(1)}ms` : "local"}
          </div>
        </div>
        <ol className="max-h-44 overflow-y-auto">
          {rows.map((row, i) => (
            <li key={row.buildingId}>
              <button
                type="button"
                onClick={() => setSelectedId(row.buildingId)}
                className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-[11px] hover:bg-cyan-400/10 ${
                  selectedId === row.buildingId ? "bg-cyan-400/15" : ""
                }`}
              >
                <span className="truncate pr-2 text-slate-200">
                  {i + 1}. {row.nameEn || row.buildingId}
                </span>
                <span className="font-mono text-amber-200">{row.cvi.toFixed(1)}</span>
              </button>
            </li>
          ))}
        </ol>
      </GlassPanel>
    </div>
  );
}
