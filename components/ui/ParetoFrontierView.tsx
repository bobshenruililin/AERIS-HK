"use client";

import { memo, useMemo, useState } from "react";
import { GitBranch, Loader2, RotateCcw } from "lucide-react";
import { FormulaTip } from "./FormulaTooltip";
import { useParetoSolver } from "@/components/simulation/SimulationProvider";
import type { ParetoPoint } from "@/lib/optimization";
import { NSGA2_GENERATIONS } from "@/lib/optimization";

function formatHkd(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}k`;
  return `$${Math.round(value)}`;
}

function ChartSvg({
  front,
  selectedId,
  mode,
  onSelect,
}: {
  front: ParetoPoint[];
  selectedId: string | null;
  mode: "2d" | "3d";
  onSelect: (id: string) => void;
}) {
  const W = 320;
  const H = 188;
  const pad = { l: 42, r: 12, t: 10, b: 28 };

  const xs = front.map((p) => p.objectives.costHkd);
  const ys = front.map((p) => p.objectives.admissionsAverted);
  const zs = front.map((p) => p.objectives.giniReduction);
  const mws = front.map((p) => p.objectives.peakPowerMw);
  const minX = Math.min(0, ...xs);
  const maxX = Math.max(1, ...xs);
  const minY = Math.min(0, ...ys);
  const maxY = Math.max(1, ...ys);
  const minZ = Math.min(0, ...zs, 0);
  const maxZ = Math.max(1e-6, ...zs);
  const minMw = Math.min(...mws, 0);
  const maxMw = Math.max(...mws, 1);

  const nx = (v: number) => (v - minX) / (maxX - minX || 1);
  const ny = (v: number) => (v - minY) / (maxY - minY || 1);
  const nz = (v: number) => (v - minZ) / (maxZ - minZ || 1);

  const project = (p: ParetoPoint) => {
    const u = nx(p.objectives.costHkd);
    const v = ny(p.objectives.admissionsAverted);
    const w = nz(p.objectives.giniReduction);
    if (mode === "2d") {
      return {
        x: pad.l + u * (W - pad.l - pad.r),
        y: H - pad.b - v * (H - pad.t - pad.b),
      };
    }
    const x = pad.l + u * 196 + w * 52;
    const y = H - pad.b - v * 118 - w * 28;
    return { x, y };
  };

  const sorted = [...front].sort((a, b) => a.objectives.costHkd - b.objectives.costHkd);
  const polyline = sorted.map((p) => {
    const { x, y } = project(p);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-44 w-full" data-testid="pareto-chart" aria-label="Pareto frontier">
      <rect x="0" y="0" width={W} height={H} fill="transparent" />
      {mode === "3d" ? (
        <>
          <path
            d={`M ${pad.l} ${H - pad.b} L ${pad.l + 196} ${H - pad.b} L ${pad.l + 248} ${H - pad.b - 28} L ${pad.l + 52} ${H - pad.b - 28} Z`}
            fill="rgba(34,211,238,0.06)"
            stroke="rgba(34,211,238,0.25)"
            strokeWidth="0.6"
          />
          <line
            x1={pad.l}
            y1={H - pad.b}
            x2={pad.l}
            y2={H - pad.b - 118}
            stroke="rgba(148,163,184,0.45)"
            strokeWidth="0.8"
          />
        </>
      ) : (
        <>
          <line
            x1={pad.l}
            y1={H - pad.b}
            x2={W - pad.r}
            y2={H - pad.b}
            stroke="rgba(148,163,184,0.45)"
            strokeWidth="0.8"
          />
          <line
            x1={pad.l}
            y1={pad.t}
            x2={pad.l}
            y2={H - pad.b}
            stroke="rgba(148,163,184,0.45)"
            strokeWidth="0.8"
          />
        </>
      )}
      {polyline.length > 1 ? (
        <polyline
          points={polyline.join(" ")}
          fill="none"
          stroke="rgb(52,211,153)"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      ) : null}
      {front.map((p) => {
        const { x, y } = project(p);
        const tMw = 1 - (p.objectives.peakPowerMw - minMw) / (maxMw - minMw || 1);
        const r = 3.2 + tMw * 3.4;
        const giniT = nz(p.objectives.giniReduction);
        const fill = `rgb(${Math.round(16 + (1 - giniT) * 200)},${Math.round(185 + giniT * 26)},${Math.round(129 + (1 - giniT) * 40)})`;
        const selected = p.id === selectedId;
        return (
          <g key={p.id}>
            <circle
              cx={x}
              cy={y}
              r={r + (selected ? 2.4 : 0)}
              fill={fill}
              stroke={selected ? "rgb(251,191,36)" : "rgba(15,23,42,0.85)"}
              strokeWidth={selected ? 1.8 : 0.7}
              className="cursor-pointer"
              data-testid={`pareto-point-${p.id}`}
              onClick={() => onSelect(p.id)}
            >
              <title>
                {`${formatHkd(p.objectives.costHkd)} · ${p.objectives.admissionsAverted.toFixed(2)} averted · ΔGini ${p.objectives.giniReduction.toFixed(4)} · ${p.objectives.peakPowerMw.toFixed(3)} MW`}
              </title>
            </circle>
          </g>
        );
      })}
      <text x={W / 2} y={H - 6} textAnchor="middle" fill="rgb(148,163,184)" fontSize="8">
        Municipal + household cost (HKD)
      </text>
      <text
        x="10"
        y={H / 2}
        textAnchor="middle"
        fill="rgb(148,163,184)"
        fontSize="8"
        transform={`rotate(-90 10 ${H / 2})`}
      >
        Cat 1–3 ED visits averted
      </text>
    </svg>
  );
}

const MemoChart = memo(ChartSvg);

export function ParetoFrontierView() {
  const {
    paretoFront,
    paretoRunning,
    paretoGeneration,
    selectedParetoId,
    paretoEngine,
    runParetoSolver,
    applyParetoPoint,
  } = useParetoSolver();
  const [mode, setMode] = useState<"2d" | "3d">("2d");

  const selected = useMemo(
    () => paretoFront.find((p) => p.id === selectedParetoId) ?? null,
    [paretoFront, selectedParetoId],
  );

  return (
    <div
      className="mt-3 rounded-xl border border-emerald-300/20 bg-emerald-400/5 px-3 py-2"
      data-testid="pareto-frontier"
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-emerald-200">
          <GitBranch className="h-3 w-3" />
          <FormulaTip id="nsga2">Pareto frontier</FormulaTip>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            data-testid="pareto-mode-2d"
            onClick={() => setMode("2d")}
            className={`rounded-full px-2 py-0.5 text-[9px] ${mode === "2d" ? "bg-emerald-300 text-slate-950" : "text-slate-400"}`}
          >
            2D
          </button>
          <button
            type="button"
            data-testid="pareto-mode-3d"
            onClick={() => setMode("3d")}
            className={`rounded-full px-2 py-0.5 text-[9px] ${mode === "3d" ? "bg-emerald-300 text-slate-950" : "text-slate-400"}`}
          >
            3D
          </button>
        </div>
      </div>
      <p className="mb-1 text-[10px] text-slate-400">
        NSGA-II · {NSGA2_GENERATIONS} gen · min cost · max Cat 1–3 averted · max{" "}
        <FormulaTip id="gini">ΔGini</FormulaTip> · min <FormulaTip id="hvac-mw">MW</FormulaTip>
        {paretoEngine ? ` · ${paretoEngine}` : ""}
      </p>
      {paretoFront.length > 0 ? (
        <MemoChart
          front={paretoFront}
          selectedId={selectedParetoId}
          mode={mode}
          onSelect={applyParetoPoint}
        />
      ) : (
        <div className="flex h-24 items-center justify-center text-[11px] text-slate-500">
          {paretoRunning ? "Evolving non-dominated set…" : "Run the solver to map the trade-off curve."}
        </div>
      )}
      <div className="mt-1 flex items-center justify-between gap-2">
        <button
          type="button"
          data-testid="pareto-run"
          disabled={paretoRunning}
          onClick={() => void runParetoSolver()}
          className="inline-flex items-center gap-1 rounded-full bg-emerald-400/20 px-2.5 py-1 text-[10px] text-emerald-100 hover:bg-emerald-400/30 disabled:opacity-50"
        >
          {paretoRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
          {paretoRunning ? `Gen ${paretoGeneration}/${NSGA2_GENERATIONS}` : "Run Pareto solver"}
        </button>
        {paretoRunning ? (
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full bg-emerald-400"
              style={{ width: `${Math.min(100, (100 * paretoGeneration) / NSGA2_GENERATIONS)}%` }}
              data-testid="pareto-progress"
            />
          </div>
        ) : (
          <span className="text-[10px] text-slate-500">{paretoFront.length} non-dominated</span>
        )}
      </div>
      {selected ? (
        <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono text-[10px] text-emerald-100/90" data-testid="pareto-selected">
          <span>Cost {formatHkd(selected.objectives.costHkd)}</span>
          <span>Averted {selected.objectives.admissionsAverted.toFixed(2)}</span>
          <span>ΔGini {selected.objectives.giniReduction.toFixed(4)}</span>
          <span>{selected.objectives.peakPowerMw.toFixed(3)} MW</span>
          <span>Roof {selected.levers.coolRoofRebatePct.toFixed(0)}%</span>
          <span>Canopy {selected.levers.canopyGreeneryPercent.toFixed(0)}%</span>
          <span>AC grant {selected.levers.acEfficiencyGrantPct.toFixed(0)}%</span>
          <span>Shelters {Math.round(selected.levers.coolingShelters)}</span>
        </div>
      ) : null}
      <p className="mt-1 text-[9px] leading-relaxed text-slate-500">
        Click a vertex to write those four levers into the twin. The 3D map, Gagge cache, knapsack, and
        M/M/c board recompute on the HUD thread — the genetic loop never runs inside rAF.
      </p>
    </div>
  );
}
