"use client";

import type { MonteCarloResult } from "@/lib/monte-carlo";
import { FormulaTip } from "./FormulaTooltip";

function Violin({ values, color }: { values: number[]; color: string }) {
  const w = 220;
  const h = 36;
  const n = Math.max(1, values.length);
  const top = values
    .map((v, i) => {
      const x = (i / (n - 1 || 1)) * w;
      const y = h / 2 - v * (h / 2 - 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const bot = values
    .map((v, i) => {
      const x = (i / (n - 1 || 1)) * w;
      const y = h / 2 + v * (h / 2 - 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .reverse()
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-9 w-full" aria-hidden>
      <polygon points={`${top} ${bot}`} fill={color} opacity="0.35" />
      <polyline points={top} fill="none" stroke={color} strokeWidth="1.2" />
    </svg>
  );
}

export function MonteCarloPanel({
  result,
  running,
}: {
  result: MonteCarloResult | null;
  running: boolean;
}) {
  return (
    <div
      className="mt-3 rounded-xl border border-violet-300/20 bg-violet-400/5 px-3 py-2"
      data-testid="monte-carlo-panel"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-[0.16em] text-violet-200">
          <FormulaTip id="dlnm-rr">Monte Carlo 95% CI</FormulaTip>
        </div>
        <div className="font-mono text-[10px] text-slate-500">
          {running ? "sampling…" : result ? `${result.iterations} draws · ${result.engine}` : "idle"}
        </div>
      </div>
      {result ? (
        <>
          <div className="mt-1 font-mono text-[11px] text-violet-100" data-testid="mc-admissions-ci">
            CVD presentations {result.admissions.p025.toFixed(1)}–{result.admissions.p975.toFixed(1)}
            <span className="text-slate-500"> · p50 {result.admissions.p50.toFixed(1)}</span>
          </div>
          <FormulaTip id="dlnm-rr" className="block w-full">
            <Violin values={result.violinAdmissions} color="#c4b5fd" />
          </FormulaTip>
          <div className="font-mono text-[11px] text-violet-100" data-testid="mc-beds-ci">
            Bed deficit {result.bedDeficitPct.p025.toFixed(2)}–{result.bedDeficitPct.p975.toFixed(2)}%
            {result.duckdbMs != null ? ` · DuckDB ${result.duckdbMs.toFixed(0)} ms` : ""}
          </div>
          <FormulaTip id="dlnm-rr" className="block w-full">
            <Violin values={result.violinBeds} color="#67e8f9" />
          </FormulaTip>
          <p className="text-[9px] leading-relaxed text-slate-500">
            ±1.8°C micro-climate spikes and Bernoulli AC-grid failures; Bishai RR 0.22 / °C. Worker + DuckDB
            QUANTILE_CONT when WASM is available.
          </p>
        </>
      ) : (
        <div className="py-2 text-[10px] text-slate-500">Warming the 1,000-iteration worker…</div>
      )}
    </div>
  );
}
