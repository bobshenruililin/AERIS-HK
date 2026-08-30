"use client";

import { Crosshair, Pause, Play } from "lucide-react";
import { useSimulation } from "@/components/simulation/SimulationProvider";
import { HUD_PRESETS, type HudPresetId } from "@/lib/hud";
import { TWIN_FLYIN_EVENT } from "@/lib/twin-camera";
import { cn } from "@/lib/utils";

export function ControlDock() {
  const { hudPreset, setHudPreset, playing, setPlaying, setCommandPaletteOpen, scenarioId } = useSimulation();

  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-3 z-30 flex justify-center px-3">
        <div
          className="pointer-events-auto flex items-center gap-1 rounded-full border border-cyan-300/30 bg-slate-950/72 p-1 shadow-[0_0_40px_rgba(8,145,178,0.2)] backdrop-blur-2xl"
          data-testid="control-dock"
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
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-[7.5rem] z-30 flex justify-center px-3 md:bottom-[8.5rem]">
        <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-cyan-300/20 bg-slate-950/60 px-2 py-1 backdrop-blur-xl">
          <button
            type="button"
            onClick={() => setPlaying(!playing)}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-cyan-400/15 text-cyan-100"
            aria-label={playing ? "Pause" : "Play"}
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
          <div className="px-2 font-mono text-[9px] uppercase tracking-[0.16em] text-slate-500">
            Space play · F focus · 1–4 presets
            {scenarioId ? ` · ${scenarioId}` : ""}
          </div>
        </div>
      </div>
    </>
  );
}
