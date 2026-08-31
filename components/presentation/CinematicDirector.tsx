"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Clapperboard } from "lucide-react";
import { useSimulation } from "@/components/simulation/SimulationProvider";
import { VectorBriefingExport } from "@/components/presentation/VectorBriefingExport";
import { useAerisEscape } from "@/components/system/useAerisEscape";
import { heatSoundscape, SOL_AIR_TICK_C } from "@/lib/audio/sonification";
import { solAirTempC } from "@/lib/solar";
import {
  BRIEFING_BEAT_COUNT,
  BRIEFING_BEAT_EVENT,
  BRIEFING_BEATS,
  KEYFRAME_MS,
  OPTIMAL_COUNTERFACTUAL_POLICY,
  briefingBeat,
  lerpHourCinematic,
  pickFukWaTrapBuilding,
  type BriefingBeat,
  type BriefingBeatEventDetail,
} from "@/lib/presentation/beats";
import { TWIN_KEYFRAME_EVENT } from "@/lib/twin-camera";
import type { PolicyState } from "@/lib/types";
import { cn } from "@/lib/utils";

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

const LIVE_HINT = "Soundscape live · drone = district WBGT · ticks = Sol-Air > 40 °C";

export function CinematicDirector() {
  const sim = useSimulation();
  const simRef = useRef(sim);
  simRef.current = sim;
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  const [beatIndex, setBeatIndex] = useState(0);
  const beatIndexRef = useRef(0);
  const [audioOn, setAudioOn] = useState(false);
  const [audioHint, setAudioHint] = useState("AudioContext waits for a click");
  const hourAnimRef = useRef<number | null>(null);
  const policyBackupRef = useRef<PolicyState | null>(null);

  const stopHourAnim = () => {
    if (hourAnimRef.current != null) {
      cancelAnimationFrame(hourAnimRef.current);
      hourAnimRef.current = null;
    }
  };

  const restorePolicy = useCallback(() => {
    const backup = policyBackupRef.current;
    if (backup) simRef.current.setPolicy({ ...backup });
  }, []);

  const closeDirector = useCallback(() => {
    stopHourAnim();
    restorePolicy();
    openRef.current = false;
    setOpen(false);
    setAudioOn(false);
    void heatSoundscape.close();
  }, [restorePolicy]);

  useAerisEscape(open, closeDirector);

  const applyBeat = useCallback((rawIndex: number) => {
    const s = simRef.current;
    const beat = briefingBeat(rawIndex);
    beatIndexRef.current = beat.index;
    setBeatIndex(beat.index);
    openRef.current = true;
    setOpen(true);

    if (beat.applyHeatwave && s.scenarioId !== "july-2022-heatwave") {
      s.applyScenario("july-2022-heatwave");
    }

    if (beat.applyOptimalPolicy) {
      const roof = s.totalRoofM2 || 1_200_000;
      s.setPolicy({
        ...OPTIMAL_COUNTERFACTUAL_POLICY,
        coolRoofBudgetM2: Math.round(roof * 0.22),
      });
    } else if (policyBackupRef.current) {
      s.setPolicy({ ...policyBackupRef.current });
    }

    if (beat.streetEn === "Fuk Wa Street") {
      const trap = pickFukWaTrapBuilding(s.buildings);
      if (trap) s.setSelectedId(trap.properties.id);
    } else {
      s.setSelectedId(null);
    }

    s.setFocusedHospital(beat.focusHospital);
    s.setPlaying(false);

    window.dispatchEvent(
      new CustomEvent(TWIN_KEYFRAME_EVENT, {
        detail: { view: beat.view, durationMs: KEYFRAME_MS },
      }),
    );

    stopHourAnim();
    const fromH = s.hour;
    const toH = beat.hour;
    const t0 = performance.now();
    let lastPosted = Number.NaN;
    const step = (now: number) => {
      const u = Math.min(1, (now - t0) / KEYFRAME_MS);
        const hour = lerpHourCinematic(fromH, toH, easeInOutCubic(u));
      if (Number.isNaN(lastPosted) || Math.abs(hour - lastPosted) >= 0.04 || u >= 1) {
        lastPosted = hour;
        simRef.current.setHour(hour);
      }
      if (u < 1) hourAnimRef.current = requestAnimationFrame(step);
      else hourAnimRef.current = null;
    };
    hourAnimRef.current = requestAnimationFrame(step);
  }, []);

  useEffect(() => {
    const onBeat = (ev: Event) => {
      const d = (ev as CustomEvent<BriefingBeatEventDetail>).detail ?? { source: "ui" as const };
      if (!openRef.current) {
        const s = simRef.current;
        policyBackupRef.current = { ...s.policy };
      }
      if (typeof d.index === "number") {
        applyBeat(d.index);
      } else if (!openRef.current) {
        applyBeat(d.direction === "prev" ? BRIEFING_BEAT_COUNT - 1 : 0);
      } else if (d.direction === "prev") {
        applyBeat(beatIndexRef.current - 1);
      } else {
        applyBeat(beatIndexRef.current + 1);
      }
      if (d.source === "ui") {
        void heatSoundscape.unlock().then((ok) => {
          setAudioOn(ok);
          setAudioHint(ok ? LIVE_HINT : "Click Enable audio (browser blocked Autoplay)");
        });
      }
    };
    window.addEventListener(BRIEFING_BEAT_EVENT, onBeat);
    return () => window.removeEventListener(BRIEFING_BEAT_EVENT, onBeat);
  }, [applyBeat]);

  useEffect(() => {
    if (!audioOn) return;
    heatSoundscape.setUtciWbgt(sim.snapshot.regionalMeanWbgt);
  }, [audioOn, sim.snapshot.regionalMeanWbgt]);

  useEffect(() => {
    if (!audioOn) return undefined;
    const pulse = () => {
      const s = simRef.current;
      if (!s.hoveredId) return;
      const b = s.snapshot.buildings.find((row) => row.buildingId === s.hoveredId);
      if (!b) return;
      if (solAirTempC(b.outdoorTa, b.roofAbsorbedWm2) > SOL_AIR_TICK_C) {
        heatSoundscape.tickSolAir();
      }
    };
    pulse();
    const id = window.setInterval(pulse, 380);
    return () => window.clearInterval(id);
  }, [audioOn, sim.hoveredId]);

  useEffect(() => {
    return () => {
      stopHourAnim();
      void heatSoundscape.close();
    };
  }, []);

  const unlockAudio = async () => {
    const ok = await heatSoundscape.unlock();
    setAudioOn(ok);
    setAudioHint(ok ? LIVE_HINT : "AudioContext blocked");
  };

  if (!open) {
    return <div className="hidden" data-testid="cinematic-director" data-open="0" />;
  }

  const beat: BriefingBeat = BRIEFING_BEATS[beatIndex]!;

  return (
    <div className="pointer-events-none absolute inset-0 z-40" data-testid="cinematic-director" data-open="1">
      <div className="pointer-events-auto absolute bottom-28 left-3 w-[min(92vw,26rem)] rounded-2xl border border-cyan-300/30 bg-slate-950/92 p-3 shadow-[0_0_40px_rgba(8,145,178,0.22)] backdrop-blur-2xl md:left-4">
        <div className="flex items-center justify-between gap-2">
          <p className="inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-amber-200">
            <Clapperboard className="h-3 w-3" />
            Cinematic director
          </p>
          <button type="button" className="font-mono text-[9px] uppercase text-slate-500" onClick={closeDirector}>
            Close
          </button>
        </div>
        <p className="mt-2 text-sm font-semibold text-cyan-50">{beat.titleEn}</p>
        <p className="font-mono text-[10px] text-amber-200/90">
          Beat {beat.index + 1}/{BRIEFING_BEAT_COUNT} · {String(Math.round(beat.hour)).padStart(2, "0")}:00 HKT · {beat.titleZh}
        </p>
        <p className="mt-1 text-[11px] leading-snug text-slate-400">{beat.narrative}</p>
        <div className="mt-3 grid grid-cols-4 gap-1" role="tablist" aria-label="Narrative beats">
          {BRIEFING_BEATS.map((b, i) => (
            <button
              key={b.id}
              type="button"
              role="tab"
              aria-selected={i === beatIndex}
              data-testid={`briefing-beat-${i}`}
              onClick={() => applyBeat(i)}
              className={cn(
                "rounded-lg border px-1 py-1.5 font-mono text-[8px] uppercase leading-tight",
                i === beatIndex
                  ? "border-amber-300/50 bg-amber-400/15 text-amber-100"
                  : "border-white/10 text-slate-500 hover:border-cyan-300/30 hover:text-cyan-100",
              )}
            >
              {i + 1}. {b.shortLabel}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="briefing-prev"
            className="rounded-full border border-white/10 px-2.5 py-1 font-mono text-[10px] text-slate-300 hover:bg-white/5"
            onClick={() => applyBeat(beatIndex - 1)}
          >
            ← Prev
          </button>
          <button
            type="button"
            data-testid="briefing-next"
            className="rounded-full border border-white/10 px-2.5 py-1 font-mono text-[10px] text-slate-300 hover:bg-white/5"
            onClick={() => applyBeat(beatIndex + 1)}
          >
            Next →
          </button>
          <button
            type="button"
            data-testid="briefing-audio-unlock"
            className="rounded-full border border-amber-300/40 px-2.5 py-1 font-mono text-[10px] text-amber-100 hover:bg-amber-400/10"
            onClick={() => void unlockAudio()}
          >
            {audioOn ? "Audio on" : "Enable audio"}
          </button>
        </div>
        <p className="mt-2 font-mono text-[9px] text-slate-500">{audioHint}</p>
        <p className="mt-1 font-mono text-[9px] text-slate-600">← → step beats · Esc close · keys 1–4 stay HUD presets</p>
        <div className="mt-3 border-t border-white/10 pt-3">
          <VectorBriefingExport beat={beat} />
        </div>
      </div>
    </div>
  );
}
