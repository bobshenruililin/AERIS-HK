"use client";

import { HOSPITALS } from "@/lib/hospitals";
import { useSimulation } from "@/components/simulation/SimulationProvider";
import { GlassPanel } from "./GlassPanel";
import { HudDrawer, HudPill } from "./HudDrawer";
import { FormulaTip } from "./FormulaTooltip";
import { CitationMark } from "@/components/copilot/useCitationPulse";

export function HospitalBoard() {
  const { snapshot, haNowcast, haError, focusedHospital, setFocusedHospital, isDrawerExpanded, toggleDrawer } =
    useSimulation();
  const delay =
    haNowcast?.hospitals.reduce((m, h) => Math.max(m, h.occupancyDelayMinutes), 0) ??
    haNowcast?.waitBoardDelayMinutes ??
    null;
  const headerExpanded = isDrawerExpanded("header");
  const occSpark = snapshot.hospitals.map((h) => h.bedOccupancy * 100);
  const meanOcc = snapshot.clusterBedStress * 100;

  return (
    <HudDrawer
      drawerId="hospital"
      className={`pointer-events-none absolute left-0 z-20 w-full max-w-sm p-3 md:p-4 ${headerExpanded ? "top-[22rem]" : "top-24"}`}
      pill={
        <HudPill
          testId="hospital-pill"
          label="HA surge"
          value={`${meanOcc.toFixed(0)}% beds`}
          spark={occSpark}
          formulaId="mmc"
          onClick={() => toggleDrawer("hospital")}
        />
      }
    >
      <GlassPanel>
        <CitationMark highlight="queue" block>
        <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-300">
          <FormulaTip id="mmc">HA Kowloon West surge</FormulaTip>
        </div>
        <h2 className="mb-1 text-sm font-semibold text-white">CMC · KWH · PMH · QEH overflow</h2>
        <div className="mb-2 text-[10px] text-slate-400">
          {haNowcast
            ? `Anonymised A&E nowcast · ${delay ?? 0} min CMS lag · hospital aggregates only · click a node to light catchment arcs`
            : haError
              ? `HA nowcast error: ${haError}`
              : "HA CMS / A&E nowcast ingest…"}
        </div>
        {snapshot.triage?.triggered ? (
          <div className="mb-2 rounded-lg bg-amber-400/10 px-2 py-1 text-[10px] text-amber-100" data-testid="load-balance-banner">
            120% overflow · {snapshot.triage.totalTransferred.toFixed(1)} boarded CMC/KWH → PMH/QEH along West
            Kowloon Corridor / Nathan Road
          </div>
        ) : null}
        <div className="space-y-2">
          {snapshot.hospitals.map((h) => {
            const spec = HOSPITALS.find((s) => s.code === h.code);
            const live = haNowcast?.hospitals.find((n) => n.code === h.code);
            const occ = h.bedOccupancy * 100;
            const tone = occ >= 100 ? "bg-red-400" : occ >= 92 ? "bg-amber-400" : "bg-emerald-400";
            return (
              <div
                key={h.code}
                className={`rounded-xl p-2.5 ${focusedHospital === h.code ? "bg-amber-400/15 ring-1 ring-amber-300/40" : "bg-white/5"}`}
              >
                <button
                  type="button"
                  className="flex w-full items-baseline justify-between text-left"
                  onClick={() => setFocusedHospital(focusedHospital === h.code ? null : h.code)}
                >
                  <div className="text-xs font-medium text-cyan-50">
                    {h.code} · {h.nameZh}
                  </div>
                  <div className="font-mono text-[11px] text-slate-300">RMR {h.relativeMortalityIndex.toFixed(2)}</div>
                </button>
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
                  Beds {occ.toFixed(1)}%
                  {h.occupancyPreTransfer > 0 && Math.abs(h.occupancyPreTransfer - h.bedOccupancy) > 0.002
                    ? ` (${(h.occupancyPreTransfer * 100).toFixed(1)}% pre-xfer)`
                    : ""}{" "}
                  ({h.occupancySource === "delayed-nowcast" ? "delayed census" : "model"}) · wait{" "}
                  {h.edQueue.waitHours.toFixed(2)} h · μ {h.calibratedMu.toFixed(2)} / c {h.calibratedServers}
                </div>
                {h.transferredOut > 0.05 || h.transferredIn > 0.05 ? (
                  <div className="text-[10px] text-amber-200/90" data-testid={`transfer-${h.code}`}>
                    {h.transferredOut > 0.05 ? `−${h.transferredOut.toFixed(1)} boarded out` : ""}
                    {h.transferredOut > 0.05 && h.transferredIn > 0.05 ? " · " : ""}
                    {h.transferredIn > 0.05 ? `+${h.transferredIn.toFixed(1)} received` : ""}
                  </div>
                ) : null}
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
        </CitationMark>
      </GlassPanel>
    </HudDrawer>
  );
}
