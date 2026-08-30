"use client";

import { useSimulation, useSelectedBuildingState } from "@/components/simulation/SimulationProvider";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { INDOOR_HAZARD_C } from "@/lib/constants";

export function BuildingInspector() {
  const { buildings, selectedId, hoveredId, setSelectedId, policy } = useSimulation();
  const state = useSelectedBuildingState();
  const id = selectedId ?? hoveredId;
  const feature = buildings.find((b) => b.properties.id === id);

  if (!feature || !state) {
    return null;
  }

  const p = feature.properties;
  const indoorHot = state.indoorTa >= INDOOR_HAZARD_C;

  return (
    <div className="pointer-events-none absolute bottom-36 left-1/2 z-20 w-full max-w-md -translate-x-1/2 p-3 md:p-4">
      <GlassPanel>
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-300">{p.district}</div>
            <h3 className="text-sm font-semibold text-white">{p.nameEn}</h3>
            <div className="text-xs text-cyan-100/80">{p.nameZh}</div>
          </div>
          {selectedId ? (
            <button
              type="button"
              className="pointer-events-auto text-[10px] text-slate-400 hover:text-white"
              onClick={() => setSelectedId(null)}
            >
              clear
            </button>
          ) : null}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
          <Stat label="Micro-WBGT" value={`${state.microWbgt.toFixed(1)}°C`} warn={state.microWbgt >= 30} />
          <Stat label="Indoor inertia" value={`${state.indoorTa.toFixed(1)}°C`} warn={indoorHot} />
          <Stat label="Subdivided index" value={p.subdividedFlatDensity.toFixed(2)} />
          <Stat label="AC rejector" value={`${p.acAnthropogenicHeat.toFixed(0)} W/m²`} />
          <Stat label="CVI" value={state.cvi.toFixed(1)} warn={state.cvi >= 70} />
          <Stat label="24-hr CVD tier" value={state.cviTier.toUpperCase()} warn={state.cviTier === "high" || state.cviTier === "critical"} />
          <Stat label="Roof area" value={`${p.roofAreaM2.toFixed(0)} m²`} />
          <Stat
            label="Cool-roof target"
            value={policy.coolRoofTargetIds.includes(p.id) ? "SELECTED" : "—"}
          />
        </div>
        <div className="mt-2 font-mono text-[10px] text-slate-500">
          HK80 E {p.hk80.easting.toFixed(1)} N {p.hk80.northing.toFixed(1)} · lag {state.thermalLagHours.toFixed(2)} h ·
          core {state.gagge.coreTempC.toFixed(2)}°C · S {state.gagge.heatStorage.toFixed(1)} W/m²
        </div>
      </GlassPanel>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`rounded-lg px-2 py-1.5 ${warn ? "bg-red-500/15 text-red-100" : "bg-white/5 text-slate-200"}`}>
      <div className="text-[9px] uppercase tracking-wider text-slate-400">{label}</div>
      <div className="font-mono text-xs">{value}</div>
    </div>
  );
}
