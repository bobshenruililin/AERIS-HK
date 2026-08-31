"use client";

import { useSimulation } from "@/components/simulation/SimulationProvider";

const STAGES = [
  { k: "heat", en: "HKO heat", zh: "熱力" },
  { k: "gagge", en: "Gagge S", zh: "熱儲" },
  { k: "cvi", en: "CVI", zh: "脆弱" },
  { k: "ae", en: "A&E λ", zh: "急症" },
  { k: "queue", en: "M/M/c", zh: "排隊" },
  { k: "roof", en: "knapsack", zh: "屋頂" },
] as const;

export function CausalStrip() {
  const { snapshot, envelope, impact, coolRoofPlan, policy } = useSimulation();
  const meanS =
    snapshot.buildings.reduce((s, b) => s + b.gagge.heatStorage, 0) / Math.max(1, snapshot.buildings.length);
  const meanSw =
    snapshot.buildings.reduce((s, b) => s + b.roofAbsorbedWm2, 0) / Math.max(1, snapshot.buildings.length);
  const values: Record<(typeof STAGES)[number]["k"], string> = {
    heat: envelope
      ? `${envelope.kowloonAirTempC.toFixed(1)}°C`
      : `${snapshot.regionalMeanWbgt.toFixed(1)}° WBGT`,
    gagge: `${meanS.toFixed(1)} W/m²`,
    cvi: snapshot.regionalMeanCvi.toFixed(1),
    ae: snapshot.totalCat13Arrivals.toFixed(1),
    queue: `${(snapshot.clusterBedStress * 100).toFixed(0)}% beds`,
    roof: `${impact.admissionsAverted.toFixed(1)} Δ`,
  };
  const hints: Record<(typeof STAGES)[number]["k"], string> = {
    heat: `roof SW ${meanSw.toFixed(0)} W/m²`,
    gagge: "S = M − W − E − R − C",
    cvi: "WBGT · 劏房 · elderly · blockage",
    ae: "catchment-weighted Poisson",
    queue: "CMC · KWH · QEH",
    roof: `${policy.coolRoofTargetIds.length} roofs · ${Math.round(coolRoofPlan?.selectedAreaM2 ?? 0)} m²`,
  };

  return (
    <div className="mt-2 grid grid-cols-2 gap-1 md:grid-cols-6" data-testid="causal-strip">
      {STAGES.map((stage, i) => (
        <div key={stage.k} className="relative rounded-xl bg-white/5 px-2.5 py-1.5">
          {i < STAGES.length - 1 ? (
            <div className="absolute -right-1 top-1/2 hidden h-px w-2 bg-cyan-400/40 md:block" />
          ) : null}
          <div className="text-[9px] uppercase tracking-[0.14em] text-slate-500">
            {stage.en} · {stage.zh}
          </div>
          <div className="font-mono text-sm text-cyan-100" data-testid={`causal-${stage.k}`}>
            {values[stage.k]}
          </div>
          <div className="truncate text-[9px] text-slate-500">{hints[stage.k]}</div>
        </div>
      ))}
    </div>
  );
}
