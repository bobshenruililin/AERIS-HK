"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { AERIS_DIAGNOSTICS_EVENT, getFrameDiagnostics, subscribeDiagnostics, type FrameDiagnostics } from "@/lib/runtime-diagnostics";
import { runAutomatedSmokeTest } from "@/lib/runtime-smoke";
import type { SmokeTestReport } from "@/lib/runtime-diagnostics";

export function SystemHealthOverlay() {
  const [open, setOpen] = useState(false);
  const [frame, setFrame] = useState<FrameDiagnostics>(() => getFrameDiagnostics());
  const [smoke, setSmoke] = useState<SmokeTestReport | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => subscribeDiagnostics(setFrame), []);

  useEffect(() => {
    const toggle = () => setOpen((v) => !v);
    window.addEventListener(AERIS_DIAGNOSTICS_EVENT, toggle);
    return () => window.removeEventListener(AERIS_DIAGNOSTICS_EVENT, toggle);
  }, []);

  const runSmoke = useCallback(async () => {
    setRunning(true);
    try {
      const report = await runAutomatedSmokeTest();
      setSmoke(report);
    } finally {
      setRunning(false);
    }
  }, []);

  if (!open) return null;

  return (
    <div
      className="pointer-events-auto absolute bottom-16 left-3 z-[70] w-[min(22rem,calc(100vw-1.5rem))] rounded-xl border border-cyan-300/25 bg-slate-950/90 p-3 font-mono text-[10px] text-cyan-50 shadow-[0_0_32px_rgba(8,47,73,0.55)] backdrop-blur-md"
      data-testid="system-health-overlay"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-cyan-100">
          <Activity className="h-3.5 w-3.5 text-cyan-300" />
          SYSTEM HEALTH
        </span>
        <span className="text-[9px] uppercase tracking-wider text-slate-500">Ctrl+Shift+D</span>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-slate-300">
        <dt>FPS</dt>
        <dd className="text-right text-cyan-100" data-testid="health-fps">
          {frame.fps.toFixed(1)}
        </dd>
        <dt>Frame</dt>
        <dd className="text-right">{frame.frameMs.toFixed(2)} ms</dd>
        <dt>Draw calls</dt>
        <dd className="text-right" data-testid="health-draw-calls">
          {frame.drawCalls}
        </dd>
        <dt>GPU VRAM est.</dt>
        <dd className="text-right" data-testid="health-vram">
          {frame.vramEstimateMb.toFixed(1)} MB
        </dd>
        <dt>DuckDB query</dt>
        <dd className="text-right" data-testid="health-duckdb-ms">
          {frame.duckDbMs == null ? "—" : `${frame.duckDbMs.toFixed(1)} ms`}
        </dd>
        <dt>Arrow scrub</dt>
        <dd className="text-right">{frame.arrowScrubMs == null ? "—" : `${frame.arrowScrubMs.toFixed(2)} ms`}</dd>
        <dt>Web Workers</dt>
        <dd className="text-right" data-testid="health-workers">
          {frame.workerCount}
        </dd>
        <dt>Heap Δ</dt>
        <dd className="text-right" data-testid="health-heap-delta">
          {frame.heapDeltaMb >= 0 ? "+" : ""}
          {frame.heapDeltaMb.toFixed(1)} MB
        </dd>
        <dt>WebGL2 / WebGPU</dt>
        <dd className="text-right">
          {frame.webgl2 ? "GL2" : "—"} / {frame.webgpu ? "GPU" : "—"}
          {frame.contextLost ? " · LOST" : ""}
        </dd>
      </dl>
      <button
        type="button"
        className="mt-2 w-full rounded-md border border-cyan-400/40 bg-cyan-400/10 px-2 py-1.5 text-[10px] uppercase tracking-wider text-cyan-100 hover:bg-cyan-400/20 disabled:opacity-50"
        data-testid="health-smoke-run"
        disabled={running}
        onClick={() => {
          void runSmoke();
        }}
      >
        {running ? "Running…" : "Run Automated Smoke Test"}
      </button>
      {smoke ? (
        <div className="mt-2 space-y-1" data-testid="health-smoke-report">
          <div className={smoke.ok ? "text-emerald-300" : "text-amber-200"}>
            {smoke.ok ? "PASS" : "FAIL"} · {smoke.elapsedMs.toFixed(0)} ms
          </div>
          {smoke.checks.map((check) => (
            <div key={check.id} className="flex justify-between gap-2 text-slate-400" data-testid={`health-smoke-${check.id}`}>
              <span>
                {check.ok ? "✓" : "✗"} {check.id}
              </span>
              <span className="truncate text-right">
                {check.ms.toFixed(0)} ms · {check.detail}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
