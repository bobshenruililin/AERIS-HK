"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Briefcase, Printer, X } from "lucide-react";
import { AERIS_FULL_TITLE } from "@/lib/constants";
import { compileExecutiveBriefing, formatHkd, formatRoi } from "@/lib/executive-briefing";
import { useSimulation } from "@/components/simulation/SimulationProvider";
import { formatHourLabel } from "@/lib/utils";
import { scenarioById } from "@/lib/scenarios";

export function ExecutiveBriefing() {
  const { snapshot, impact, policy, hour, buildings, scenarioId, envelope } = useSimulation();
  const [open, setOpen] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);
  const [generatedAt, setGeneratedAt] = useState(() => new Date().toISOString());

  useEffect(() => {
    if (open) setGeneratedAt(new Date().toISOString());
  }, [open]);

  const briefing = useMemo(
    () =>
      compileExecutiveBriefing({
        snapshot,
        buildings,
        impact,
        policy,
        scenarioName: scenarioId ? scenarioById(scenarioId)?.nameEn : "Live HKO twin",
        generatedAt,
      }),
    [snapshot, buildings, impact, policy, scenarioId, generatedAt],
  );

  const maxSpark = Math.max(
    1,
    ...briefing.hourlyScenarioArrivals,
    ...briefing.hourlyBaselineArrivals,
    ...briefing.hourlyScenarioBedDeficitBeds,
  );
  const maxOcc = Math.max(1.05, ...briefing.hospitals.map((h) => Math.max(h.occupancyPre, h.occupancyPost)));

  const printReport = () => {
    const node = printRef.current;
    if (!node) return;
    const frame = document.createElement("iframe");
    frame.style.position = "fixed";
    frame.style.right = "0";
    frame.style.bottom = "0";
    frame.style.width = "0";
    frame.style.height = "0";
    frame.style.border = "0";
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    if (!doc) return;
    doc.open();
    doc.write(`<!doctype html><html><head><title>AERIS-HK Executive Briefing</title>
      <style>
        body { font-family: "Iowan Old Style", "Palatino Linotype", Palatino, serif; color: #0f172a; margin: 24px; }
        h1 { font-size: 22px; margin: 0 0 4px; }
        h2 { font-size: 13px; margin: 16px 0 8px; border-bottom: 1px solid #94a3b8; padding-bottom: 4px; letter-spacing: .08em; text-transform: uppercase; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; }
        th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
        th { background: #0f172a; color: #fff; }
        .hero { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin: 12px 0; }
        .card { border: 1px solid #cbd5e1; padding: 10px 12px; }
        .k { font-size: 10px; letter-spacing: .14em; text-transform: uppercase; color: #64748b; }
        .v { font-size: 22px; font-family: ui-monospace, monospace; }
        .banner { background: #0f172a; color: #fff; padding: 14px 16px; margin-bottom: 12px; }
      </style></head><body>${node.innerHTML}</body></html>`);
    doc.close();
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    setTimeout(() => frame.remove(), 1000);
  };

  return (
    <>
      <button
        type="button"
        data-testid="executive-briefing"
        onClick={() => setOpen(true)}
        className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-amber-300/40 bg-slate-950/70 px-3 py-1.5 text-[11px] text-amber-100 backdrop-blur hover:bg-amber-400/10"
      >
        <Briefcase className="h-3.5 w-3.5" />
        Executive Briefing Mode
      </button>
      {open ? (
        <div
          className="pointer-events-auto fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/85 p-3 backdrop-blur-md md:p-6"
          data-testid="executive-briefing-panel"
        >
          <div className="relative w-full max-w-5xl rounded-2xl border border-amber-300/25 bg-slate-950 text-slate-100 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-amber-200/80">HA / DH decision brief</div>
                <div className="text-sm font-semibold">Executive Briefing Mode</div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={printReport}
                  className="inline-flex items-center gap-1 rounded-full bg-amber-300 px-3 py-1 text-xs text-slate-950"
                >
                  <Printer className="h-3.5 w-3.5" /> Print / PDF
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-full p-1 hover:bg-white/10"
                  aria-label="Close executive briefing"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div ref={printRef} className="max-h-[80vh] overflow-y-auto bg-white p-6 text-slate-900">
              <div className="banner">
                <h1>{AERIS_FULL_TITLE}</h1>
                <div>Kowloon West cluster — population at risk, HA bed deficit, ROI per intervention dollar</div>
              </div>
              <p className="text-[11px] text-slate-500">
                {briefing.scenarioName} · {formatHourLabel(hour)} HKT · generated {generatedAt}
                {envelope ? ` · Kowloon ${envelope.kowloonAirTempC.toFixed(1)}°C RH ${(envelope.kowloonRhFrac * 100).toFixed(0)}%` : ""}
              </p>

              <div className="hero mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="card rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="k text-[10px] uppercase tracking-[0.16em] text-slate-500">Total population at risk</div>
                  <div className="v font-mono text-3xl text-slate-900" data-testid="executive-pop-at-risk">
                    {Math.round(briefing.populationAtRisk).toLocaleString("en-HK")}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    CVI ≥ 70 or indoor ≥ 32°C or indoor WBGT ≥ 28 · {briefing.populationAtRiskPct.toFixed(1)}% of{" "}
                    {Math.round(briefing.populationCatchment).toLocaleString("en-HK")} catchment
                  </div>
                </div>
                <div className="card rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="k text-[10px] uppercase tracking-[0.16em] text-slate-500">Projected HA bed deficit</div>
                  <div className="v font-mono text-3xl text-slate-900" data-testid="executive-bed-deficit">
                    {briefing.projectedHaBedDeficitBeds.toFixed(1)}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Post-rebalance overflow beds now · 24h mean {briefing.projectedHaBedDeficit24hMean.toFixed(1)} beds
                  </div>
                </div>
                <div className="card rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="k text-[10px] uppercase tracking-[0.16em] text-slate-500">ROI per intervention dollar</div>
                  <div className="v font-mono text-3xl text-slate-900" data-testid="executive-roi">
                    {formatRoi(briefing.roiPerInterventionDollar)}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Benefit {formatHkd(briefing.benefit.totalHkd)} / spend {formatHkd(briefing.spend.totalHkd)}
                  </div>
                </div>
              </div>

              <h2 className="mt-5 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">
                24-hour Cat 1–3 arrivals (baseline dim / scenario)
              </h2>
              <div className="relative mt-2 flex h-24 items-end gap-px rounded-lg bg-slate-100 px-1 pt-1">
                {Array.from({ length: 24 }, (_, h) => {
                  const base = briefing.hourlyBaselineArrivals[h] ?? 0;
                  const scen = briefing.hourlyScenarioArrivals[h] ?? 0;
                  return (
                    <div key={h} className="relative flex h-full flex-1 items-end">
                      <div className="w-full rounded-t-sm bg-slate-400/50" style={{ height: `${(base / maxSpark) * 100}%` }} />
                      <div
                        className="absolute bottom-0 w-full rounded-t-sm bg-emerald-600/80"
                        style={{ height: `${(scen / maxSpark) * 100}%` }}
                      />
                    </div>
                  );
                })}
              </div>

              <h2 className="mt-5 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">
                Hospital occupancy before / after transfer (120% CMC · KWH trigger)
              </h2>
              <div className="mt-2 space-y-2">
                {briefing.hospitals.map((h) => (
                  <div key={h.code} className="rounded-lg border border-slate-200 p-2">
                    <div className="flex justify-between text-[12px]">
                      <span className="font-medium">
                        {h.code} · {h.nameEn} / {h.nameZh}
                      </span>
                      <span className="font-mono text-slate-600">
                        {(h.occupancyPre * 100).toFixed(1)}% → {(h.occupancyPost * 100).toFixed(1)}%
                        {h.transferredOut > 0.05 ? ` · −${h.transferredOut.toFixed(1)} out` : ""}
                        {h.transferredIn > 0.05 ? ` · +${h.transferredIn.toFixed(1)} in` : ""}
                      </span>
                    </div>
                    <div className="relative mt-1 h-2 rounded-full bg-slate-200">
                      <div
                        className="absolute inset-y-0 left-0 rounded-full bg-slate-400/70"
                        style={{ width: `${Math.min(100, (h.occupancyPre / maxOcc) * 100)}%` }}
                      />
                      <div
                        className="absolute inset-y-0 left-0 rounded-full bg-cyan-700/80"
                        style={{ width: `${Math.min(100, (h.occupancyPost / maxOcc) * 100)}%` }}
                      />
                      <div
                        className="absolute top-0 h-full w-px bg-red-500"
                        style={{ left: `${Math.min(100, (1.2 / maxOcc) * 100)}%` }}
                        title="120% trigger"
                      />
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                Inter-hospital transfers this hour: {briefing.totalTransferred.toFixed(1)} patients
                {briefing.remainingUnplaced > 0.05
                  ? ` · ${briefing.remainingUnplaced.toFixed(1)} unplaced (receivers at 118% cap)`
                  : " · PMH / QEH absorbed overflow"}
                .
              </p>

              <h2 className="mt-5 text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">
                ROI stack (HKD)
              </h2>
              <table className="mt-2 w-full text-[12px]">
                <thead>
                  <tr>
                    <th>Line</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Cool-roof budget ({Math.round(policy.coolRoofBudgetM2)} m² × 480)</td>
                    <td>{formatHkd(briefing.spend.coolRoofHkd)}</td>
                  </tr>
                  <tr>
                    <td>Night shelters ({policy.coolingShelters} × 18,000)</td>
                    <td>{formatHkd(briefing.spend.sheltersHkd)}</td>
                  </tr>
                  <tr>
                    <td>DHC outreach ({policy.dhcOutreach}% × 2,400)</td>
                    <td>{formatHkd(briefing.spend.dhcHkd)}</td>
                  </tr>
                  <tr>
                    <td>Ambulance transfers ({briefing.totalTransferred.toFixed(1)} × 2,150)</td>
                    <td>{formatHkd(briefing.spend.ambulanceHkd)}</td>
                  </tr>
                  <tr>
                    <td>
                      <strong>Intervention spend</strong>
                    </td>
                    <td>
                      <strong>{formatHkd(briefing.spend.totalHkd)}</strong>
                    </td>
                  </tr>
                  <tr>
                    <td>Averted Cat 1–3 episodes ({impact.admissionsAverted.toFixed(1)} × 12,800)</td>
                    <td>{formatHkd(briefing.benefit.avertedAdmissionsHkd)}</td>
                  </tr>
                  <tr>
                    <td>Bed-days saved ({briefing.benefit.bedDaysSaved.toFixed(2)} × 5,600)</td>
                    <td>{formatHkd(briefing.benefit.bedDaysSavedHkd)}</td>
                  </tr>
                  <tr>
                    <td>
                      <strong>Monetised benefit</strong>
                    </td>
                    <td>
                      <strong>{formatHkd(briefing.benefit.totalHkd)}</strong>
                    </td>
                  </tr>
                </tbody>
              </table>
              <p className="mt-3 text-[11px] text-slate-500">
                Priors are HA / DH planning figures for Kowloon West, not patient records. Synthetic morphology, live HKO
                envelope, anonymised A&amp;E aggregates. Not an official product.
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
