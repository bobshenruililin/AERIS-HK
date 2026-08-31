"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Radio } from "lucide-react";
import { useSimulation } from "@/components/simulation/SimulationProvider";
import { TWIN_FLYIN_EVENT } from "@/lib/twin-camera";
import { useAerisEscape } from "@/components/system/useAerisEscape";

const STEPS = [
  { id: "harbour", label: "Harbour approach", zh: "維港進入", ms: 0 },
  { id: "peak", label: "Peak heat 15:00", zh: "熱力峰值", ms: 4300 },
  { id: "gagge", label: "Interrogate Gagge node", zh: "熱平衡審問", ms: 7800 },
  { id: "knapsack", label: "Lock exact knapsack roofs", zh: "鎖定屋頂", ms: 11200 },
  { id: "catchment", label: "KWH catchment arcs", zh: "廣華服務範圍", ms: 14800 },
] as const;

export function BriefingButton() {
  const sim = useSimulation();
  const simRef = useRef(sim);
  simRef.current = sim;
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState<(typeof STEPS)[number]["id"] | null>(null);
  const timers = useRef<number[]>([]);

  const cancel = useCallback(() => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
    setRunning(false);
    setStep(null);
  }, []);
  useAerisEscape(running, cancel);

  useEffect(() => {
    return () => {
      for (const id of timers.current) window.clearTimeout(id);
    };
  }, []);

  const run = () => {
    const {
      setHour,
      setSelectedId,
      setFocusedHospital,
      setPlaying,
    } = simRef.current;
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
    setRunning(true);
    setPlaying(false);
    setFocusedHospital(null);
    window.dispatchEvent(new Event(TWIN_FLYIN_EVENT));
    setHour(10.2);
    setSelectedId(null);
    setStep("harbour");

    const schedule = (ms: number, fn: () => void) => {
      timers.current.push(window.setTimeout(fn, ms));
    };

    schedule(STEPS[1].ms, () => {
      setStep("peak");
      simRef.current.setHour(15);
    });
    schedule(STEPS[2].ms, () => {
      setStep("gagge");
      const hottest = [...simRef.current.snapshot.buildings].sort((a, b) => b.cvi - a.cvi)[0];
      if (hottest) simRef.current.setSelectedId(hottest.buildingId);
    });
    schedule(STEPS[3].ms, () => {
      setStep("knapsack");
      const { policy, coolRoofCandidates } = simRef.current;
      const locked = policy.coolRoofTargetIds[0] ?? coolRoofCandidates[0]?.buildingId ?? null;
      if (locked) simRef.current.setSelectedId(locked);
    });
    schedule(STEPS[4].ms, () => {
      setStep("catchment");
      simRef.current.setFocusedHospital("KWH");
    });
    schedule(19000, () => {
      setRunning(false);
      setStep(null);
    });
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        data-testid="run-briefing"
        onClick={run}
        className="inline-flex items-center gap-1.5 rounded-full border border-cyan-300/30 bg-cyan-400/10 px-3 py-1 text-[11px] text-cyan-100 hover:bg-cyan-400/20"
      >
        <Radio className="h-3.5 w-3.5" />
        {running ? "Briefing…" : "Run briefing"}
      </button>
      {step ? (
        <span className="font-mono text-[10px] text-amber-200" data-testid="briefing-step">
          {STEPS.find((s) => s.id === step)?.label} · {STEPS.find((s) => s.id === step)?.zh}
        </span>
      ) : null}
    </div>
  );
}
