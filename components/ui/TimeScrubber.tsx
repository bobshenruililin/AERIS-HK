"use client";

import { Pause, Play } from "lucide-react";
import { useSimulation } from "@/components/simulation/SimulationProvider";
import { formatHourLabel } from "@/lib/utils";
import { solarElevationDeg } from "@/lib/solar";
import type { PlaybackSpeed } from "@/lib/types";
import { GlassPanel } from "./GlassPanel";

const SPEEDS: PlaybackSpeed[] = [1, 2, 5];

export function TimeScrubber() {
  const { hour, setHour, playing, setPlaying, speed, setSpeed } = useSimulation();
  const elev = solarElevationDeg(hour);
  const solarTicks = Array.from({ length: 24 }, (_, h) => ({
    h,
    elev: solarElevationDeg(h + 0.5),
  }));

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 p-3 md:p-4">
      <GlassPanel className="mx-auto max-w-4xl">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPlaying(!playing)}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-400/20 text-cyan-100 ring-1 ring-cyan-300/40 hover:bg-cyan-400/30"
              aria-label={playing ? "Pause diurnal playback" : "Play diurnal playback"}
            >
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </button>
            <div>
              <div className="font-mono text-lg text-cyan-50" data-testid="sim-hour">{formatHourLabel(hour)} HKT</div>
              <div className="text-[10px] uppercase tracking-widest text-slate-400">
                24-hour thermal inertia timeline
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 rounded-full bg-black/30 p-1">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSpeed(s)}
                className={`rounded-full px-2.5 py-1 text-[11px] ${
                  speed === s ? "bg-cyan-400 text-slate-950" : "text-slate-300 hover:text-white"
                }`}
              >
                {s}x
              </button>
            ))}
          </div>
        </div>
        <div className="mb-1 flex h-8 items-end gap-px">
          {solarTicks.map((tick) => (
            <div
              key={tick.h}
              className="flex-1 rounded-t-sm bg-gradient-to-t from-cyan-500/10 to-amber-300/80"
              style={{ height: `${Math.max(8, ((tick.elev + 5) / 90) * 100)}%`, opacity: tick.elev > 0 ? 0.9 : 0.25 }}
              title={`${String(tick.h).padStart(2, "0")}:00 solar ${tick.elev.toFixed(0)}°`}
            />
          ))}
        </div>
        <input
          type="range"
          min={0}
          max={23.99}
          step={0.01}
          value={hour}
          onChange={(e) => {
            setPlaying(false);
            setHour(Number(e.target.value));
          }}
          className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-700 accent-cyan-400"
          aria-label="Diurnal hour scrubber"
        />
        <div className="mt-1 flex justify-between text-[10px] text-slate-500">
          <span>00:00</span>
          <span>06:00</span>
          <span>12:00</span>
          <span>15:00 peak</span>
          <span>21:00 inertia</span>
          <span>23:00</span>
        </div>
        <p className="mt-1 text-[10px] text-slate-400">
          Solar elevation {elev.toFixed(1)}° · canyon lag sustains indoor heat after sunset in high-density tong lau.
        </p>
      </GlassPanel>
    </div>
  );
}
