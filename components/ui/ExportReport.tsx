"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Printer, X } from "lucide-react";
import { AERIS_FULL_TITLE, HEAT_EPISODE_LABEL } from "@/lib/constants";
import { hkoStatusLabel } from "@/lib/epidemiology-engine";
import { useSimulation } from "@/components/simulation/SimulationProvider";
import { formatHourLabel } from "@/lib/utils";
import { useAerisEscape } from "@/components/system/useAerisEscape";

export function ExportReport() {
  const { snapshot, impact, policy, hour, analytics, envelope, buildings, spatial, haNowcast, coolRoofPlan, hudPreset, setHudPreset } =
    useSimulation();
  const [open, setOpen] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);
  const label = hkoStatusLabel(snapshot.hkoStatus);
  const [generatedAt, setGeneratedAt] = useState("");
  const closeBriefing = useCallback(() => {
    setOpen(false);
    if (hudPreset === 4) setHudPreset(1);
  }, [hudPreset, setHudPreset]);
  useAerisEscape(open, closeBriefing);

  useEffect(() => {
    if (hudPreset === 4) setOpen(true);
  }, [hudPreset]);

  useEffect(() => {
    if (open) {
      setGeneratedAt(new Date().toISOString());
    }
  }, [open]);

  const critical = snapshot.buildings
    .filter((b) => b.cvi >= 70)
    .sort((a, b) => b.cvi - a.cvi)
    .slice(0, 8);

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
    doc.write(`<!doctype html><html><head><title>AERIS-HK Heat Contingency Brief</title>
      <style>
        body { font-family: "Iowan Old Style", "Palatino Linotype", Palatino, serif; color: #0f172a; margin: 28px; }
        h1 { font-size: 20px; margin: 0 0 4px; }
        h2 { font-size: 14px; margin: 18px 0 8px; border-bottom: 1px solid #94a3b8; padding-bottom: 4px; text-transform: uppercase; letter-spacing: .08em; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; }
        th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
        th { background: #0f172a; color: #fff; }
        .meta { font-size: 11px; color: #475569; }
        .banner { background: #0e7490; color: #fff; padding: 10px 12px; margin-bottom: 12px; }
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
        onClick={() => setOpen(true)}
        className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-cyan-300/30 bg-slate-950/70 px-3 py-1.5 text-[11px] text-cyan-100 backdrop-blur hover:bg-cyan-400/10"
      >
        <FileText className="h-3.5 w-3.5" />
        DH / WHO briefing
      </button>
      {open ? (
        <div className="pointer-events-auto fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/80 p-4 backdrop-blur" data-testid="clinical-briefing">
          <div className="relative w-full max-w-3xl rounded-2xl border border-cyan-300/20 bg-slate-950 text-slate-100 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div className="text-sm font-semibold">Clinical policy surveillance briefing</div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={printReport}
                  className="inline-flex items-center gap-1 rounded-full bg-cyan-400 px-3 py-1 text-xs text-slate-950"
                >
                  <Printer className="h-3.5 w-3.5" /> Print / PDF
                </button>
                <button
                  type="button"
                  onClick={closeBriefing}
                  className="rounded-full p-1 hover:bg-white/10"
                  aria-label="Close briefing"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div ref={printRef} className="max-h-[75vh] overflow-y-auto p-5 text-sm text-slate-800 bg-white">
              <div className="banner">
                <h1>{AERIS_FULL_TITLE}</h1>
                <div>Hong Kong Department of Health / WHO-style outbreak & heat contingency brief</div>
              </div>
              <p className="meta">
                Situation report ID AERIS-KWC-{generatedAt.slice(0, 10).replaceAll("-", "")}-H{formatHourLabel(hour).replace(":", "")}
                · Generated {generatedAt} · Episode: {HEAT_EPISODE_LABEL}
              </p>
              <h2>1. Situation overview</h2>
              <p>
                AERIS-HK is modelling street-canyon heat trapping across {buildings.length} tong lau and high-rise
                footprints in Sham Shui Po and Yau Tsim Mong, coupled to Hospital Authority Kowloon West Cluster
                (CMC, KWH) with Queen Elizabeth Hospital as regional overflow. Current HKO-analogue status:{" "}
                <strong>{label.en} ({label.zh})</strong>. Official HKO Very Hot Weather Warning is{" "}
                {envelope?.warning.veryHotWeatherWarning ? "IN FORCE" : "not in force"}. Kowloon AWS mean air
                temperature is {envelope ? `${envelope.kowloonAirTempC.toFixed(1)}°C` : "pending"} with RH{" "}
                {envelope ? `${(envelope.kowloonRhFrac * 100).toFixed(0)}%` : "pending"}. Regional mean micro-WBGT is{" "}
                {snapshot.regionalMeanWbgt.toFixed(1)}°C with cluster CVI {snapshot.regionalMeanCvi.toFixed(1)}.
              </p>
              <h2>2. Immediate risk (WHO heat-health / IHR framing)</h2>
              <ul>
                <li>Hazard: urban micro-WBGT and indoor thermal inertia &gt;32°C from 21:00–03:00 in high subdivided-density units.</li>
                <li>Exposure: elderly and subdivided-flat residents along Pei Ho, Apliu, Temple and Shanghai Streets.</li>
                <li>Vulnerability: baseline CVD prevalence 7.8–21.4 / 1,000; Gagge heat storage and Bishai-style strain.</li>
                <li>Health system: Cat 1–3 arrival rate {snapshot.totalCat13Arrivals.toFixed(1)} / hour; mean bed stress {(snapshot.clusterBedStress * 100).toFixed(1)}%.</li>
              </ul>
              <h2>3. Hospital Authority surge matrix (M/M/c)</h2>
              <table>
                <thead>
                  <tr>
                    <th>Hospital</th>
                    <th>Cat 1</th>
                    <th>Cat 2</th>
                    <th>Cat 3</th>
                    <th>ED utilisation</th>
                    <th>Wait (h)</th>
                    <th>μ</th>
                    <th>c</th>
                    <th>Bed occ.</th>
                    <th>RMR</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.hospitals.map((h) => (
                    <tr key={h.code}>
                      <td>{h.nameEn} / {h.nameZh}</td>
                      <td>{h.arrivals.category1.toFixed(2)}</td>
                      <td>{h.arrivals.category2.toFixed(2)}</td>
                      <td>{h.arrivals.category3.toFixed(2)}</td>
                      <td>{(h.edQueue.utilization * 100).toFixed(1)}%</td>
                      <td>{h.edQueue.waitHours.toFixed(2)}</td>
                      <td>{h.calibratedMu.toFixed(2)}</td>
                      <td>{h.calibratedServers}</td>
                      <td>{(h.bedOccupancy * 100).toFixed(1)}%</td>
                      <td>{h.relativeMortalityIndex.toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <h2>4. Policy package currently on the board</h2>
              <p>
                Night cooling shelters: {policy.coolingShelters}/30 · DHC nurse outreach: {policy.dhcOutreach}% ·
                Cool-roof albedo budget: {Math.round(policy.coolRoofBudgetM2)} m² targeting {policy.coolRoofTargetIds.length}{" "}
                roofs via exact 0/1 knapsack ({Math.round(coolRoofPlan?.selectedAreaM2 ?? 0)} m² selected, district albedo{" "}
                {policy.coolRoofPercent.toFixed(1)}/50, rank engine {coolRoofPlan?.rankEngine ?? "pending"}) · AC heat deflection
                bylaw: {policy.acDeflectionBylaw ? "IN FORCE" : "not enacted"}.
              </p>
              <p>
                24-hour A&E cardiovascular presentations averted: <strong>{impact.admissionsAverted.toFixed(1)}</strong>
                {" "}(baseline {impact.baselineAdmissions24h.toFixed(1)} → scenario {impact.scenarioAdmissions24h.toFixed(1)}).
                Bed deficit averted: {impact.bedDeficitAvertedPct.toFixed(2)} percentage points.
                Preventable mortality: {impact.preventableMortalityPer100k.toFixed(3)} per 100,000 catchment residents.
              </p>
              <h2>5. Priority buildings (CVI ≥ 70 at {formatHourLabel(hour)})</h2>
              <table>
                <thead>
                  <tr>
                    <th>Building</th>
                    <th>District</th>
                    <th>CVI</th>
                    <th>Micro-WBGT</th>
                    <th>Indoor °C</th>
                  </tr>
                </thead>
                <tbody>
                  {critical.map((row) => {
                    const meta = buildings.find((b) => b.properties.id === row.buildingId);
                    return (
                      <tr key={row.buildingId}>
                        <td>{meta?.properties.nameEn} / {meta?.properties.nameZh}</td>
                        <td>{meta?.properties.district}</td>
                        <td>{row.cvi.toFixed(1)}</td>
                        <td>{row.microWbgt.toFixed(1)}</td>
                        <td>{row.indoorTa.toFixed(1)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <h2>5b. Cool-roof targeting set (DuckDB window greedy)</h2>
              <p className="meta">
                Budget {Math.round(policy.coolRoofBudgetM2)} m² of roof. Ranked by 24-hour catchment-weighted
                admissions averted per m² with ROW_NUMBER / running SUM(roof_m2) OVER. Selected area{" "}
                {Math.round(coolRoofPlan?.selectedAreaM2 ?? 0)} m² · local ranking averted{" "}
                {(coolRoofPlan?.predictedAdmissionsAverted ?? 0).toFixed(2)}.
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Building</th>
                    <th>District</th>
                    <th>Roof m²</th>
                  </tr>
                </thead>
                <tbody>
                  {policy.coolRoofTargetIds.slice(0, 16).map((id) => {
                    const meta = buildings.find((b) => b.properties.id === id);
                    return (
                      <tr key={id}>
                        <td>
                          {meta?.properties.nameEn} / {meta?.properties.nameZh}
                        </td>
                        <td>{meta?.properties.district}</td>
                        <td>{meta ? meta.properties.roofAreaM2.toFixed(0) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <h2>6. Recommended operational actions</h2>
              <ol>
                <li>Activate additional designated night cooling shelters within 400 m of Pei Ho / Apliu and Temple Street canyons before 19:00 HKT.</li>
                <li>Scale DHC / CGAT community nurse wellness calls to buildings with elderly ratio ≥ 0.45 and indoor T ≥ 32°C.</li>
                <li>Pre-alert CMC A&E and KWH medical wards; auto-rebalance inpatients above 120% occupancy onto PMH and QEH via West Kowloon Corridor / Nathan Road ambulance vectors.</li>
                <li>Issue targeted heat-health SMS in 繁中 / EN to subdivided-flat blocks with CVI ≥ 70.</li>
              </ol>
              <h2>7. Methods (surveillance metadata)</h2>
              <p>
                Micro-WBGT from Gagge 2-node balance S = M − W − E − R − C, canyon air with AC rejector load, and a
                six-hour thermal-inertia lag scaled by subdivided density. CVI(t) = 0.35·WBGT/35 + 0.28·density +
                0.22·elderly + 0.15·blockage, indexed 0–100. ED demand uses M/M/c queues. Analytics engine:{" "}
                {analytics?.engine ?? "pending"} ({analytics ? `${analytics.queryLatencyMs.toFixed(2)} ms` : "n/a"}
                {analytics?.arrowIpc ? ", Arrow IPC" : ""}).
                Cool-roof targeting ranks footprints by 24-hour catchment-weighted admissions averted per m² of
                roof and selects a prefix whose running SUM(roof_m2) stays within the budget (DuckDB window
                functions, greedy fallback if WASM is unavailable).
                Authoritative footprints live in PostGIS as HK80 (EPSG:2326) with dual-write WGS84 (EPSG:4326)
                for Deck.gl ({spatial.authority}, {spatial.buildingCount} buildings
                {spatial.dualWrite ? ", dual-write on" : ""}). Meteorological forcing is a rolling 24-hour HKO
                envelope (observed AWS + 9-day FND anchors) ingested server-side from data.weather.gov.hk via
                /api/hko/envelope and /api/hko/ingest. Kowloon West A&E nowcast is hospital-level only (no patient
                identifiers): live HA Open Data waits plus a delayed CMS occupancy aggregate calibrate M/M/c μ from
                the Cat 1–3 mix and c from Cat 3 p50 wait
                {haNowcast ? ` (board ${haNowcast.waitBoardAsOf ?? "n/a"}, occupancy lag ${haNowcast.hospitals[0]?.occupancyDelayMinutes ?? "?"} min)` : ""}.
              </p>
              <p className="meta">
                Disclaimer: Synthetic tong lau morphology stored in PostGIS as HK80 (EPSG:2326) with dual-write
                WGS84 for mapping, live HKO Open Data meteorology, and anonymised HA A&E wait/occupancy aggregates.
                Not an official HKO or HA product. No patient-level identifiers are ingested or stored.
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
