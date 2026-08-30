"use client";

import { HeartPulse } from "lucide-react";
import { AERIS_FULL_TITLE } from "@/lib/constants";
import { hkoStatusLabel } from "@/lib/epidemiology-engine";
import { useSimulation } from "@/components/simulation/SimulationProvider";
import { formatHourLabel } from "@/lib/utils";
import { solarElevationDeg } from "@/lib/solar";
import { ExportReport } from "@/components/ui/ExportReport";
import { CausalStrip } from "@/components/ui/CausalStrip";
import { BriefingButton } from "@/components/simulation/BriefingTour";

export function Header() {
  const {
    snapshot,
    analytics,
    hour,
    envelope,
    envelopeError,
    spatial,
    spatialIndex,
    haNowcast,
    haError,
    coolRoofPlan,
    policy,
    impact,
    episodeId,
    isDrawerExpanded,
    toggleDrawer,
    scenarioId,
    forcing,
  } = useSimulation();
  const label = hkoStatusLabel(snapshot.hkoStatus);
  const elev = solarElevationDeg(hour);
  const bedPct = snapshot.clusterBedStress * 100;
  const ssp = envelope?.stations.find((s) => s.name === "Sham Shui Po");
  const officialWhot = envelope?.warning.veryHotWeatherWarning ?? false;
  const badge =
    snapshot.hkoStatus === "SPECIAL_HEAT_STRESS_BLACK"
      ? "bg-red-500/20 text-red-200 border-red-400/40"
      : snapshot.hkoStatus === "EXTREME_HEAT_AMBER"
        ? "bg-amber-500/20 text-amber-100 border-amber-400/40"
        : snapshot.hkoStatus === "VERY_HOT_WEATHER_WARNING"
          ? "bg-orange-500/20 text-orange-100 border-orange-400/40"
          : "bg-emerald-500/20 text-emerald-100 border-emerald-400/40";

  const spark = impact.hourlyScenarioArrivals ?? [];
  const sparkBase = impact.hourlyBaselineArrivals ?? [];
  const maxSpark = Math.max(1, ...spark, ...sparkBase);
  const playhead = wrapPct(hour / 24);
  const compact = !isDrawerExpanded("header");

  return (
    <header className="pointer-events-none absolute inset-x-0 top-14 z-20 p-3 md:top-16 md:p-4">
      <div className="pointer-events-auto rounded-2xl border border-cyan-300/25 bg-slate-950/78 px-4 py-3 shadow-[0_0_50px_rgba(6,182,212,0.16)] backdrop-blur-2xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button type="button" className="flex items-center gap-3 text-left" onClick={() => toggleDrawer("header")}>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-400/15 ring-1 ring-cyan-300/40">
              <HeartPulse className="h-5 w-5 text-cyan-300" />
            </div>
            <div>
              <h1 className="text-sm font-semibold tracking-[0.18em] text-cyan-50 md:text-base">
                {AERIS_FULL_TITLE}
              </h1>
              <p className="text-[11px] text-slate-400">
                Kowloon West heat-health digital twin · 深水埗 / 油尖旺 · first-principles Gagge + M/M/c
                {scenarioId ? ` · ${scenarioId}` : ""}
              </p>
            </div>
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <BriefingButton />
            <ExportReport />
            <div className={`rounded-full border px-3 py-1 text-[11px] font-medium ${badge}`}>
              {label.zh} · {label.en}
            </div>
          </div>
        </div>

        {compact ? (
          <div className="mt-2 flex flex-wrap items-center gap-3 font-mono text-[10px] text-slate-400">
            <span>{impact.admissionsAverted.toFixed(1)} averted</span>
            <span>{snapshot.regionalMeanWbgt.toFixed(1)}° WBGT</span>
            <span>{(snapshot.clusterBedStress * 100).toFixed(1)}% beds</span>
            <span>solar {elev.toFixed(1)}° · breeze {(forcing.seaBreezeScale * 100).toFixed(0)}%</span>
            <button type="button" className="text-cyan-300" onClick={() => toggleDrawer("header")}>
              expand telemetry
            </button>
          </div>
        ) : null}

        <div className={compact ? "sr-only" : ""}>
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5" data-testid="mission-strip">
          <Hero
            label="24h admissions averted"
            zh="24小時急症避免"
            value={impact.admissionsAverted.toFixed(1)}
            testId="mission-admissions-averted"
            tone="emerald"
          />
          <Hero
            label="Roofs locked"
            zh="鎖定屋頂"
            value={`${policy.coolRoofTargetIds.length}`}
            sub={`/ ${coolRoofPlan ? String(Math.round(coolRoofPlan.totalRoofM2)).replace(/\B(?=(\d{3})+(?!\d))/g, ",") : "—"} m² stock`}
            testId="mission-roofs"
            tone="amber"
          />
          <Hero
            label="Albedo budget used"
            zh="反照率預算"
            value={`${Math.round(coolRoofPlan?.selectedAreaM2 ?? 0)}`}
            sub={`m² of ${Math.round(policy.coolRoofBudgetM2)}`}
            tone="amber"
          />
          <Hero label="Micro-WBGT" zh="微氣候濕球黑球" value={`${snapshot.regionalMeanWbgt.toFixed(1)}°`} tone="cyan" />
          <Hero label="HA bed stress" zh="病床壓力" value={`${bedPct.toFixed(1)}%`} tone={bedPct >= 100 ? "red" : "cyan"} />
        </div>

        <div className="relative mt-2 flex h-10 items-end gap-px rounded-lg bg-black/40 px-1 pt-1" title="Baseline (dim) vs scenario Cat 1–3 arrivals">
          {Array.from({ length: 24 }, (_, h) => {
            const base = sparkBase[h] ?? 0;
            const scen = spark[h] ?? 0;
            return (
              <div key={h} className="relative flex h-full flex-1 items-end">
                <div
                  className="w-full rounded-t-sm bg-slate-500/50"
                  style={{ height: `${(base / maxSpark) * 100}%` }}
                />
                <div
                  className="absolute bottom-0 w-full rounded-t-sm bg-emerald-400/80"
                  style={{ height: `${(scen / maxSpark) * 100}%` }}
                />
              </div>
            );
          })}
          <div
            className="pointer-events-none absolute h-8 w-px bg-cyan-200"
            style={{ left: `calc(${playhead * 100}% + 4px)` }}
          />
        </div>

        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-slate-400">
          <span>{formatHourLabel(hour)} HKT · solar {elev.toFixed(1)}°</span>
          <span>
            {officialWhot ? "HKO WHOT IN FORCE" : "WHOT inactive"}
            {envelope ? ` · Kowloon ${envelope.kowloonAirTempC.toFixed(1)}°C RH ${(envelope.kowloonRhFrac * 100).toFixed(0)}%` : envelopeError ? ` · ${envelopeError}` : " · HKO…"}
          </span>
          <span>{ssp?.airTempC != null ? `SSP ${ssp.airTempC.toFixed(1)}°C` : "SSP pending"}</span>
          <span>
            {haNowcast
              ? `HA aggregates · ${haNowcast.hospitals[0]?.occupancyDelayMinutes ?? 0} min lag · no patient IDs`
              : haError
                ? `HA ${haError}`
                : "HA ingest…"}
          </span>
          <span>
            {analytics
              ? `${analytics.engine}${analytics.arrowIpc ? " IPC" : ""} ${analytics.queryLatencyMs.toFixed(0)} ms`
              : "DuckDB warming"}
          </span>
          <span data-testid="spatial-grid-stats">
            ENU grid {spatialIndex.vectorCount.toLocaleString()} · bbox {spatialIndex.bboxMs.toFixed(2)} ms · kNN{" "}
            {spatialIndex.knnMs.toFixed(2)} ms
          </span>
          <span>
            {spatial.authority === "postgis-hk80"
              ? `PostGIS HK80 · ${spatial.buildingCount} footprints`
              : `Seed HK80 · ${spatial.buildingCount}`}
          </span>
          <span>
            {coolRoofPlan
              ? `exact knapsack · ${coolRoofPlan.rankEngine === "duckdb-wasm" ? "DuckDB windows rank" : "JS rank"}`
              : "optimiser…"}
          </span>
          <span>episode {episodeId}</span>
        </div>
        <CausalStrip />
        </div>
      </div>
    </header>
  );
}

function wrapPct(t: number): number {
  const x = t % 1;
  return x < 0 ? x + 1 : x;
}

function Hero({
  label,
  zh,
  value,
  sub,
  testId,
  tone,
}: {
  label: string;
  zh: string;
  value: string;
  sub?: string;
  testId?: string;
  tone: "emerald" | "amber" | "cyan" | "red";
}) {
  const color =
    tone === "emerald"
      ? "text-emerald-300"
      : tone === "amber"
        ? "text-amber-200"
        : tone === "red"
          ? "text-red-300"
          : "text-cyan-100";
  return (
    <div className="rounded-xl bg-white/5 px-3 py-2">
      <div className="text-[9px] uppercase tracking-[0.16em] text-slate-500">{label}</div>
      <div className={`font-mono text-xl leading-tight ${color}`} data-testid={testId}>
        {value}
      </div>
      <div className="text-[10px] text-slate-500">{zh}{sub ? ` · ${sub}` : ""}</div>
    </div>
  );
}
