"use client";

import { useSimulation } from "@/components/simulation/SimulationProvider";
import { GlassPanel } from "./GlassPanel";

export function CriticalList() {
  const { coolRoofCandidates, policy, setSelectedId, selectedId, coolRoofPlan, buildings } = useSimulation();
  const selected = new Set(policy.coolRoofTargetIds);
  const ranked = [...coolRoofCandidates].sort((a, b) => b.efficiency - a.efficiency).slice(0, 10);
  const maxEff = Math.max(1e-9, ranked[0]?.efficiency ?? 0);

  return (
    <div className="pointer-events-none absolute bottom-36 left-0 z-20 hidden w-full max-w-sm p-3 md:block md:p-4">
      <GlassPanel padded={false} className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-amber-300">Albedo targeting</div>
            <div className="text-[10px] text-slate-500">涼屋頂效率序 · exact 0/1 knapsack</div>
          </div>
          <div className="font-mono text-[10px] text-slate-500">
            {coolRoofPlan?.rankEngine === "duckdb-wasm" ? "DuckDB rank" : "JS rank"}
          </div>
        </div>
        <ol className="max-h-48 overflow-y-auto">
          {ranked.map((row, i) => {
            const meta = buildings.find((b) => b.properties.id === row.buildingId);
            const on = selected.has(row.buildingId);
            return (
              <li key={row.buildingId}>
                <button
                  type="button"
                  onClick={() => setSelectedId(row.buildingId)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-amber-400/10 ${
                    selectedId === row.buildingId ? "bg-amber-400/15" : ""
                  }`}
                >
                  <span className="w-4 font-mono text-slate-500">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-200">
                    {on ? "● " : "○ "}
                    {meta?.properties.nameEn ?? row.buildingId}
                  </span>
                  <span className="w-16">
                    <span
                      className={`block h-1 rounded-full ${on ? "bg-amber-300" : "bg-slate-600"}`}
                      style={{ width: `${Math.max(8, (row.efficiency / maxEff) * 100)}%` }}
                    />
                  </span>
                  <span className="w-10 text-right font-mono text-amber-200">{row.admissionsAverted.toFixed(2)}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </GlassPanel>
    </div>
  );
}
