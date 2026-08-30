"use client";

import { Activity, Radio } from "lucide-react";
import { useSimulation } from "@/components/simulation/SimulationProvider";
import { FormulaTip } from "@/components/ui/FormulaTooltip";
import {
  idwInterpolate,
  LIVE_MONITORING_LABEL,
  PREDICTIVE_TWIN_LABEL,
  SENSOR_COUNT,
} from "@/lib/telemetry";
import { TWIN_ORIGIN } from "@/lib/twin-camera";
import { cn } from "@/lib/utils";

export function LiveOpsToggle() {
  const {
    opsMode,
    enterLiveMonitoring,
    enterPredictiveTwin,
    liveFeed,
    liveFeedError,
    awsStations,
    sensorMesh,
    snapshot,
  } = useSimulation();
  const live = opsMode === "live";
  const stations = awsStations;
  const ssp = stations.find((s) => s.id === "ssp");
  const kp = stations.find((s) => s.id === "kp");
  const kt = stations.find((s) => s.id === "kt");
  const origin = awsStations.length
    ? idwInterpolate(awsStations, TWIN_ORIGIN.lon, TWIN_ORIGIN.lat)
    : null;

  return (
    <div className="pointer-events-none absolute left-3 top-[9.5rem] z-30 flex max-w-[min(100%,22rem)] flex-col gap-1.5 md:left-4 md:top-[9.75rem]">
      <div
        className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-cyan-300/30 bg-slate-950/78 p-1 shadow-[0_0_36px_rgba(8,145,178,0.18)] backdrop-blur-2xl"
        data-testid="live-ops-toggle"
        role="group"
        aria-label="Live operations versus predictive twin"
      >
        <button
          type="button"
          data-testid="ops-mode-live"
          aria-pressed={live}
          onClick={enterLiveMonitoring}
          className={cn(
            "flex items-center gap-1 rounded-full px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.16em]",
            live ? "bg-emerald-400 text-slate-950" : "text-slate-400 hover:bg-white/10 hover:text-emerald-100",
          )}
        >
          <Radio className="h-3 w-3" />
          {LIVE_MONITORING_LABEL}
        </button>
        <button
          type="button"
          data-testid="ops-mode-predictive"
          aria-pressed={!live}
          onClick={enterPredictiveTwin}
          className={cn(
            "flex items-center gap-1 rounded-full px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-[0.16em]",
            !live ? "bg-amber-300 text-slate-950" : "text-slate-400 hover:bg-white/10 hover:text-amber-100",
          )}
        >
          <Activity className="h-3 w-3" />
          {PREDICTIVE_TWIN_LABEL}
        </button>
      </div>

      <div
        className="pointer-events-auto rounded-2xl border border-cyan-300/20 bg-slate-950/70 px-3 py-2 font-mono text-[10px] text-slate-300 shadow-[0_0_28px_rgba(8,145,178,0.12)] backdrop-blur-2xl"
        data-testid="live-ops-strip"
      >
        <div className="flex items-center justify-between gap-2 text-[9px] uppercase tracking-[0.18em] text-cyan-200/80">
          <span>{live ? "HKO AWS · IDW field" : "Heatwave plate · synthetic mesh"}</span>
          <FormulaTip id="idw" />
        </div>
        <div className="mt-1.5 grid grid-cols-3 gap-2" data-testid="hko-aws-stations">
          <StationChip label="深水埗 SSP" temp={ssp?.airTempC} rh={ssp?.rhFrac} wind={ssp?.windSpeedMs} solar={ssp?.solarWm2} />
          <StationChip label="京士柏 KP" temp={kp?.airTempC} rh={kp?.rhFrac} wind={kp?.windSpeedMs} solar={kp?.solarWm2} />
          <StationChip label="啟德 KT" temp={kt?.airTempC} rh={kt?.rhFrac} wind={kt?.windSpeedMs} solar={kt?.solarWm2} />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-slate-400">
          <span data-testid="lorawan-mesh-count">
            LoRaWAN 劏房 {sensorMesh.count}/{SENSOR_COUNT}
          </span>
          <span data-testid="lorawan-mean-indoor">
            T<sub>in</sub> {sensorMesh.meanIndoorC.toFixed(1)}°C
          </span>
          <FormulaTip id="lorawan-lag" />
          <span>
            T<sub>idw</sub> {origin?.airTempC != null ? origin.airTempC.toFixed(1) : "—"}°C
          </span>
          <span>WBGT {snapshot.regionalMeanWbgt.toFixed(1)}°C</span>
          {liveFeed?.degraded ? <span className="text-amber-300">degraded</span> : null}
          {liveFeedError ? <span className="text-rose-300">{liveFeedError}</span> : null}
        </div>
      </div>
    </div>
  );
}

function StationChip({
  label,
  temp,
  rh,
  wind,
  solar,
}: {
  label: string;
  temp: number | null | undefined;
  rh: number | null | undefined;
  wind: number | null | undefined;
  solar: number | null | undefined;
}) {
  return (
    <div className="rounded-lg bg-white/5 px-1.5 py-1">
      <div className="text-[8px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-[11px] text-cyan-50">
        {temp != null ? `${temp.toFixed(1)}°C` : "—"}
      </div>
      <div className="text-[8px] text-slate-500">
        RH {rh != null ? `${Math.round(rh * 100)}%` : "—"} · {wind != null ? `${wind.toFixed(1)} m/s` : "—"}
        {solar != null ? ` · ${Math.round(solar)} W` : ""}
      </div>
    </div>
  );
}
