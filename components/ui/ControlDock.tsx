"use client";

import { Box, Crosshair, GitBranch, Globe2, Hexagon, Pause, Play, Share2, Sparkles, ThermometerSun, Wind } from "lucide-react";
import { useSimulation } from "@/components/simulation/SimulationProvider";
import { HUD_PRESETS, type HudLayers, type HudPresetId } from "@/lib/hud";
import { STRESS_SCENARIOS, type StressScenarioId } from "@/lib/scenarios";
import { TWIN_FLYIN_EVENT, TWIN_ORBIT_EVENT } from "@/lib/twin-camera";
import { formatHourLabel } from "@/lib/utils";
import { cn } from "@/lib/utils";

const LAYER_TOGGLES: Array<{ key: keyof HudLayers; label: string; testId: string; icon: typeof Wind }> = [
  { key: "windVectors", label: "Wind", testId: "layer-wind", icon: Wind },
  { key: "thermalShimmer", label: "Thermal", testId: "layer-thermal", icon: ThermometerSun },
  { key: "buildingWireframes", label: "Wire", testId: "layer-wire", icon: Box },
  { key: "h3Hexes", label: "H3", testId: "layer-h3", icon: Hexagon },
];

export function ControlDock() {
  const {
    hudPreset,
    setHudPreset,
    playing,
    setPlaying,
    setCommandPaletteOpen,
    scenarioId,
    applyScenario,
    clearScenario,
    hudLayers,
    setHudLayer,
    hour,
    setHour,
    saveSimulation,
    simulationSaving,
    simId,
    setCopilotPanelOpen,
    runParetoSolver,
    paretoRunning,
    paretoGeneration,
  } = useSimulation();

  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-3 z-30 flex justify-center px-3">
        <div
          className="pointer-events-auto flex items-center gap-1 rounded-full border border-cyan-300/30 bg-slate-950/72 p-1 shadow-[0_0_40px_rgba(8,145,178,0.2)] backdrop-blur-2xl"
          data-testid="control-dock"
          aria-keyshortcuts="Digit1 Digit2 Digit3 Digit4 Space Meta+K Control+K Escape"
        >
          {([1, 2, 3, 4] as HudPresetId[]).map((id) => {
            const spec = HUD_PRESETS[id];
            const on = hudPreset === id;
            return (
              <button
                key={id}
                type="button"
                data-testid={`hud-preset-${id}`}
                onClick={() => setHudPreset(id)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-left",
                  on ? "bg-cyan-400 text-slate-950" : "text-slate-300 hover:bg-white/10 hover:text-white",
                )}
              >
                <div className="font-mono text-[10px] leading-none">{id}</div>
                <div className="mt-0.5 max-w-[7.5rem] truncate text-[9px] uppercase tracking-wider">
                  {spec.nameEn}
                </div>
              </button>
            );
          })}
          <button
            type="button"
            data-testid="cmdk-open"
            onClick={() => setCommandPaletteOpen(true)}
            className="ml-1 rounded-full px-2.5 py-1.5 font-mono text-[10px] text-slate-400 hover:bg-white/10 hover:text-cyan-100"
          >
            ⌘K
          </button>
          <button
            type="button"
            data-testid="copilot-dock"
            onClick={() => setCopilotPanelOpen(true)}
            className="ml-0.5 flex items-center gap-1 rounded-full px-2.5 py-1.5 font-mono text-[10px] text-amber-100 hover:bg-amber-400/15"
          >
            <Sparkles className="h-3 w-3" />
            Copilot
          </button>
          <button
            type="button"
            data-testid="pareto-dock"
            onClick={() => void runParetoSolver()}
            className="ml-0.5 flex items-center gap-1 rounded-full px-2.5 py-1.5 font-mono text-[10px] text-emerald-100 hover:bg-emerald-400/15"
          >
            <GitBranch className="h-3 w-3" />
            {paretoRunning ? `P ${paretoGeneration}` : "Pareto"}
          </button>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-[7.5rem] z-30 flex justify-center px-3 md:bottom-[8.5rem]">
        <div
          className="pointer-events-auto flex max-w-[min(100%,52rem)] flex-wrap items-center justify-center gap-1 rounded-full border border-cyan-300/25 bg-slate-950/70 px-2 py-1.5 shadow-[0_0_36px_rgba(8,145,178,0.18)] backdrop-blur-2xl"
          data-testid="control-dock-pill"
        >
          <button
            type="button"
            onClick={() => setPlaying(!playing)}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-cyan-400/15 text-cyan-100"
            aria-label={playing ? "Pause" : "Play"}
            title="Space"
          >
            {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event(TWIN_FLYIN_EVENT))}
            className="flex h-7 w-7 items-center justify-center rounded-full text-slate-300 hover:text-white"
            aria-label="Focus / reset camera"
            data-testid="camera-reset"
          >
            <Crosshair className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event(TWIN_ORBIT_EVENT))}
            className="flex h-7 w-7 items-center justify-center rounded-full text-slate-300 hover:text-cyan-100"
            aria-label="Cinematic orbital camera"
            data-testid="camera-orbit"
          >
            <Globe2 className="h-3.5 w-3.5" />
          </button>

          <div className="mx-1 flex items-center gap-0.5" data-testid="dock-layers">
            {LAYER_TOGGLES.map((layer) => {
              const Icon = layer.icon;
              const on = hudLayers[layer.key];
              return (
                <button
                  key={layer.key}
                  type="button"
                  data-testid={layer.testId}
                  aria-pressed={on}
                  onClick={() => setHudLayer(layer.key, !on)}
                  className={cn(
                    "flex items-center gap-1 rounded-full px-2 py-1 text-[9px] uppercase tracking-wider",
                    on ? "bg-cyan-400/20 text-cyan-50" : "text-slate-500 hover:text-slate-200",
                  )}
                >
                  <Icon className="h-3 w-3" />
                  {layer.label}
                </button>
              );
            })}
          </div>

          <div className="flex min-w-[9rem] flex-1 items-center gap-2 px-1" data-testid="dock-playbar">
            <span className="font-mono text-[10px] text-cyan-100/80">{formatHourLabel(hour)}</span>
            <input
              type="range"
              min={0}
              max={23.99}
              step={0.05}
              value={hour}
              onChange={(e) => setHour(Number(e.target.value))}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-700 accent-cyan-400"
              aria-label="Diurnal playbar"
            />
          </div>

          <div className="flex items-center gap-0.5" data-testid="dock-scenarios">
            {STRESS_SCENARIOS.map((s) => {
              const on = scenarioId === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  data-testid={`scenario-${s.id}`}
                  onClick={() => (on ? clearScenario() : applyScenario(s.id as StressScenarioId))}
                  className={cn(
                    "rounded-full px-2 py-1 text-[9px] uppercase tracking-wider",
                    on ? "bg-amber-300 text-slate-950" : "text-slate-400 hover:bg-white/10 hover:text-amber-100",
                  )}
                >
                  {s.id === "july-2022-heatwave"
                    ? "Jul 2022"
                    : s.id === "typhoon-subsidence"
                      ? "Typhoon"
                      : s.id === "district-blackout"
                        ? "Blackout"
                        : s.id === "super-typhoon-heat-surge"
                          ? "Super TY"
                          : "3 AM"}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            data-testid="save-simulation"
            disabled={simulationSaving}
            onClick={() => void saveSimulation()}
            className="flex items-center gap-1 rounded-full bg-cyan-400/15 px-2 py-1 text-[9px] uppercase tracking-wider text-cyan-100 hover:bg-cyan-400/25 disabled:opacity-50"
          >
            <Share2 className="h-3 w-3" />
            {simulationSaving ? "Saving" : simId ? "Saved" : "Share"}
          </button>
        </div>
      </div>
    </>
  );
}
