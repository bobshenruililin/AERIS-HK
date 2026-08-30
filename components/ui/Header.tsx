"use client";

import type { ReactNode } from "react";
import { Activity, Building2, HeartPulse, Sun, Thermometer } from "lucide-react";
import { motion } from "framer-motion";
import { AERIS_FULL_TITLE } from "@/lib/constants";
import { hkoStatusLabel } from "@/lib/epidemiology-engine";
import { useSimulation } from "@/components/simulation/SimulationProvider";
import { formatHourLabel } from "@/lib/utils";
import { solarElevationDeg } from "@/lib/solar";
import { ExportReport } from "@/components/ui/ExportReport";

export function Header() {
  const { snapshot, analytics, hour, envelope, envelopeError, spatial, haNowcast, haError } = useSimulation();
  const label = hkoStatusLabel(snapshot.hkoStatus);
  const elev = solarElevationDeg(hour);
  const bedPct = snapshot.clusterBedStress * 100;
  const ssp = envelope?.stations.find((s) => s.name === "Sham Shui Po");
  const kp = envelope?.stations.find((s) => s.name === "King's Park");
  const officialWhot = envelope?.warning.veryHotWeatherWarning ?? false;
  const badge =
    snapshot.hkoStatus === "SPECIAL_HEAT_STRESS_BLACK"
      ? "bg-red-500/20 text-red-200 border-red-400/40"
      : snapshot.hkoStatus === "EXTREME_HEAT_AMBER"
        ? "bg-amber-500/20 text-amber-100 border-amber-400/40"
        : snapshot.hkoStatus === "VERY_HOT_WEATHER_WARNING"
          ? "bg-orange-500/20 text-orange-100 border-orange-400/40"
          : "bg-emerald-500/20 text-emerald-100 border-emerald-400/40";

  const ticker = [
    officialWhot
      ? `HKO WHOT IN FORCE · ${envelope?.warning.nameZh}`
      : `HKO WHOT inactive · ${envelope?.warning.nameZh ?? "酷熱天氣警告未發出"}`,
    envelope
      ? `Kowloon T ${envelope.kowloonAirTempC.toFixed(1)}°C · RH ${(envelope.kowloonRhFrac * 100).toFixed(0)}%`
      : envelopeError
        ? `HKO ingest error: ${envelopeError}`
        : "HKO envelope ingest…",
    ssp?.airTempC != null ? `SSP ${ssp.airTempC.toFixed(1)}°C` : "SSP pending",
    kp?.airTempC != null ? `KP ${kp.airTempC.toFixed(1)}°C` : "KP pending",
    envelope?.forecast
      ? `FND ${envelope.forecast.date} ${envelope.forecast.minTempC}–${envelope.forecast.maxTempC}°C`
      : "FND pending",
    `Regional mean micro-WBGT ${snapshot.regionalMeanWbgt.toFixed(1)}°C`,
    `Kowloon West + overflow bed stress ${bedPct.toFixed(1)}%`,
    `Cluster CVI ${snapshot.regionalMeanCvi.toFixed(1)}`,
    analytics
      ? `${analytics.engine}${analytics.arrowIpc ? " Arrow IPC" : ""} query ${analytics.queryLatencyMs.toFixed(2)} ms`
      : "Columnar engine warming",
    spatial.authority === "postgis-hk80"
      ? `PostGIS HK80 EPSG:2326 · dual-write EPSG:4326 · ${spatial.buildingCount} footprints${spatial.arrowBytes ? ` · ${spatial.arrowBytes} B IPC` : ""}`
      : `Synthetic HK80 seed · ${spatial.buildingCount} footprints${spatial.error ? ` · ${spatial.error}` : ""}`,
    analytics?.footprintsLoaded
      ? `DuckDB footprints JOIN ${analytics.footprintCount}`
      : "DuckDB footprints pending",
    haNowcast
      ? `HA A&E nowcast ${haNowcast.waitBoardAsOf ?? "live"} · ${haNowcast.hospitals.length} hospitals · μ/c from Cat 1–3 mix · ${haNowcast.hospitals[0]?.occupancyDelayMinutes ?? 0} min occupancy lag · no patient IDs`
      : haError
        ? `HA nowcast error: ${haError}`
        : "HA CMS / A&E nowcast ingest…",
    `Solar elevation ${elev.toFixed(1)}° · ${formatHourLabel(hour)} HKT`,
  ];

  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-20 p-3 md:p-4">
      <div className="pointer-events-auto flex flex-col gap-2 rounded-2xl border border-cyan-300/25 bg-slate-950/70 px-4 py-3 shadow-[0_0_50px_rgba(6,182,212,0.16)] backdrop-blur-2xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-400/15 ring-1 ring-cyan-300/40">
              <HeartPulse className="h-5 w-5 text-cyan-300" />
            </div>
            <div>
              <h1 className="text-sm font-semibold tracking-[0.18em] text-cyan-50 md:text-base">
                {AERIS_FULL_TITLE}
              </h1>
              <p className="text-[11px] text-slate-400">
                Atmospheric & Epidemiological Risk Inference System · Sham Shui Po / Yau Tsim Mong digital twin
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ExportReport />
            <div className={`rounded-full border px-3 py-1 text-[11px] font-medium ${badge}`}>
              {label.zh} · {label.en}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Metric icon={<Thermometer className="h-3.5 w-3.5" />} label="Mean WBGT" value={`${snapshot.regionalMeanWbgt.toFixed(1)}°C`} />
          <Metric icon={<Activity className="h-3.5 w-3.5" />} label="Cluster CVI" value={snapshot.regionalMeanCvi.toFixed(1)} />
          <Metric icon={<Building2 className="h-3.5 w-3.5" />} label="HA bed stress" value={`${bedPct.toFixed(1)}%`} />
          <Metric icon={<Sun className="h-3.5 w-3.5" />} label="Solar elev." value={`${elev.toFixed(1)}°`} />
        </div>
        <div className="overflow-hidden rounded-lg border border-white/5 bg-black/30 py-1">
          <motion.div
            className="flex whitespace-nowrap text-[11px] text-cyan-100/80"
            animate={{ x: ["0%", "-50%"] }}
            transition={{ duration: 28, repeat: Infinity, ease: "linear" }}
          >
            {[...ticker, ...ticker].map((item, i) => (
              <span key={`${item}-${i}`} className="px-4">
                {item}
                <span className="mx-3 text-cyan-500/50">◆</span>
              </span>
            ))}
          </motion.div>
        </div>
      </div>
    </header>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-white/5 px-2.5 py-1.5">
      <span className="text-cyan-300">{icon}</span>
      <div>
        <div className="text-[10px] uppercase tracking-wider text-slate-400">{label}</div>
        <div className="font-mono text-sm text-cyan-50">{value}</div>
      </div>
    </div>
  );
}
