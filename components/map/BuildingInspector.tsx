"use client";

import { useSimulation, useSelectedBuildingState } from "@/components/simulation/SimulationProvider";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { INDOOR_HAZARD_C } from "@/lib/constants";

export function BuildingInspector() {
  const { buildings, selectedId, hoveredId, setSelectedId, policy, coolRoofCandidates } = useSimulation();
  const state = useSelectedBuildingState();
  const id = selectedId ?? hoveredId;
  const feature = buildings.find((b) => b.properties.id === id);

  if (!feature || !state) {
    return null;
  }

  const p = feature.properties;
  const indoorHot = state.indoorTa >= INDOOR_HAZARD_C;
  const g = state.gagge;
  const fluxes = [
    { k: "M", v: g.metabolicRate, c: "bg-amber-400" },
    { k: "E", v: g.evaporativeLoss, c: "bg-cyan-400" },
    { k: "R", v: g.radiativeLoss, c: "bg-orange-400" },
    { k: "C", v: g.convectiveLoss, c: "bg-sky-500" },
    { k: "S", v: g.heatStorage, c: "bg-rose-400" },
  ];
  const maxAbs = Math.max(1, ...fluxes.map((f) => Math.abs(f.v)));
  const candidate = coolRoofCandidates.find((row) => row.buildingId === p.id);
  const targeted = policy.coolRoofTargetIds.includes(p.id);
  const rank =
    candidate == null
      ? null
      : [...coolRoofCandidates].sort((a, b) => b.efficiency - a.efficiency).findIndex((row) => row.buildingId === p.id) +
        1;

  return (
    <div className="pointer-events-none absolute bottom-36 left-1/2 z-20 w-full max-w-lg -translate-x-1/2 p-3 md:p-4">
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
        <div className="mt-2 font-mono text-[10px] text-slate-400">
          S = M − W − E − R − C · {g.heatStorage.toFixed(1)} = {g.metabolicRate.toFixed(1)} − {g.externalWork.toFixed(1)} −{" "}
          {g.evaporativeLoss.toFixed(1)} − {g.radiativeLoss.toFixed(1)} − {g.convectiveLoss.toFixed(1)} W/m²
        </div>
        <div className="mt-1.5 flex h-8 items-end gap-1">
          {fluxes.map((f) => (
            <div key={f.k} className="flex flex-1 flex-col items-center justify-end">
              <div
                className={`w-full rounded-sm ${f.c}`}
                style={{ height: `${Math.max(8, (Math.abs(f.v) / maxAbs) * 100)}%`, opacity: f.v < 0 ? 0.4 : 1 }}
              />
              <div className="mt-0.5 text-[9px] text-slate-500">{f.k}</div>
            </div>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
          <Stat label="Micro-WBGT" value={`${state.microWbgt.toFixed(1)}°C`} warn={state.microWbgt >= 30} />
          <Stat label="Indoor inertia" value={`${state.indoorTa.toFixed(1)}°C`} warn={indoorHot} />
          <Stat label="CVI" value={state.cvi.toFixed(1)} warn={state.cvi >= 70} />
          <Stat label="Sky-view Φ" value={state.skyViewFactor.toFixed(2)} />
          <Stat label="Canyon H/W" value={state.canyonAspect.toFixed(2)} />
          <Stat label="Roof SW" value={`${state.roofAbsorbedWm2.toFixed(0)} W/m²`} />
          <Stat label="Roof area" value={`${p.roofAreaM2.toFixed(0)} m²`} />
          <Stat label="Target rank" value={rank ? `#${rank}` : "—"} />
          <Stat label="Cool roof" value={targeted ? "LOCKED" : "—"} warn={targeted} />
        </div>
        {candidate ? (
          <div className="mt-2 font-mono text-[10px] text-amber-100/80">
            Local averted {candidate.admissionsAverted.toFixed(3)} / 24h · η {candidate.efficiency.toExponential(2)} per m²
          </div>
        ) : null}
        <div className="mt-1 font-mono text-[10px] text-slate-500">
          HK80 E {p.hk80.easting.toFixed(1)} N {p.hk80.northing.toFixed(1)} · lag {state.thermalLagHours.toFixed(2)} h ·
          core {g.coreTempC.toFixed(2)}°C
        </div>
      </GlassPanel>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`rounded-lg px-2 py-1.5 ${warn ? "bg-amber-500/15 text-amber-100" : "bg-white/5 text-slate-200"}`}>
      <div className="text-[9px] uppercase tracking-wider text-slate-400">{label}</div>
      <div className="font-mono text-xs">{value}</div>
    </div>
  );
}
