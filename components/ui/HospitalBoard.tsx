"use client";

import { HOSPITALS } from "@/lib/hospitals";
import { useSimulation } from "@/components/simulation/SimulationProvider";
import { GlassPanel } from "./GlassPanel";

export function HospitalBoard() {
  const { snapshot, haNowcast, haError } = useSimulation();
  const delay =
    haNowcast?.hospitals.reduce((m, h) => Math.max(m, h.occupancyDelayMinutes), 0) ??
    haNowcast?.waitBoardDelayMinutes ??
    null;

  return (
    <div className="pointer-events-none absolute left-0 top-52 z-20 w-full max-w-sm p-3 md:p-4">
      <GlassPanel>
        <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-300">HA Kowloon West surge</div>
        <h2 className="mb-1 text-sm font-semibold text-white">CMC · KWH · QEH overflow</h2>
        <div className="mb-2 text-[10px] text-slate-400">
          {haNowcast
            ? `Anonymised A&E nowcast · ${delay ?? 0} min CMS lag · hospital aggregates only`
            : haError
              ? `HA nowcast error: ${haError}`
              : "HA CMS / A&E nowcast ingest…"}
        </div>
        <div className="space-y-2">
          {snapshot.hospitals.map((h) => {
            const spec = HOSPITALS.find((s) => s.code === h.code);
            const live = haNowcast?.hospitals.find((n) => n.code === h.code);
            const occ = h.bedOccupancy * 100;
            const tone = occ >= 100 ? "bg-red-400" : occ >= 92 ? "bg-amber-400" : "bg-emerald-400";
            return (
              <div key={h.code} className="rounded-xl bg-white/5 p-2.5">
                <div className="flex items-baseline justify-between">
                  <div className="text-xs font-medium text-cyan-50">
                    {h.code} · {h.nameZh}
                  </div>
                  <div className="font-mono text-[11px] text-slate-300">RMR {h.relativeMortalityIndex.toFixed(2)}</div>
                </div>
                <div className="text-[10px] text-slate-400">{spec?.nameEn}</div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-800">
                  <div className={`h-full ${tone}`} style={{ width: `${Math.min(100, occ)}%` }} />
                </div>
                <div className="mt-1 grid grid-cols-4 gap-1 font-mono text-[10px] text-slate-300">
                  <span>C1 {h.arrivals.category1.toFixed(1)}</span>
                  <span>C2 {h.arrivals.category2.toFixed(1)}</span>
                  <span>C3 {h.arrivals.category3.toFixed(1)}</span>
                  <span>ED {(h.edQueue.utilization * 100).toFixed(0)}%</span>
                </div>
                <div className="text-[10px] text-slate-500">
                  Beds {occ.toFixed(1)}% ({h.occupancySource === "delayed-nowcast" ? "delayed census" : "model"}) · wait{" "}
                  {h.edQueue.waitHours.toFixed(2)} h · μ {h.calibratedMu.toFixed(2)} / c {h.calibratedServers}
                </div>
                {live?.waitCat3P50Minutes != null ? (
                  <div className="text-[10px] text-cyan-200/80">
                    HA Cat 3 p50 {live.waitCat3P50Minutes} min
                    {live.managingMultipleResus ? " · multiple resus" : ""}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </GlassPanel>
    </div>
  );
}
