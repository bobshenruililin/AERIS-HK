"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Shield, ThermometerSun, UserRound, Building } from "lucide-react";
import { useSimulation } from "@/components/simulation/SimulationProvider";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { BASELINE_POLICY } from "@/lib/types";

export function PolicyDrawer() {
  const { policy, setPolicy, resetPolicy, impact } = useSimulation();
  const celebrated = useRef(false);

  useEffect(() => {
    if (impact.admissionsAverted >= 18 && !celebrated.current) {
      celebrated.current = true;
      void import("canvas-confetti").then((mod) => {
        void mod.default({
          particleCount: 90,
          spread: 76,
          origin: { y: 0.18, x: 0.82 },
          colors: ["#22d3ee", "#34d399", "#fbbf24", "#f43f5e"],
        });
      });
    }
    if (impact.admissionsAverted < 8) {
      celebrated.current = false;
    }
  }, [impact.admissionsAverted]);

  return (
    <div className="pointer-events-none absolute right-0 top-44 z-20 w-full max-w-sm p-3 md:top-48 md:p-4">
      <GlassPanel>
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-300">Policy stress-tester</div>
            <h2 className="text-sm font-semibold text-white">Kowloon West heat-health interventions</h2>
          </div>
          <button
            type="button"
            onClick={resetPolicy}
            className="text-[10px] text-slate-400 underline-offset-2 hover:text-cyan-200 hover:underline"
          >
            Reset
          </button>
        </div>

        <Slider
          icon={<Building className="h-3.5 w-3.5" />}
          label="Night cooling shelters"
          zh="指定夜間降溫中心"
          value={policy.coolingShelters}
          min={0}
          max={30}
          step={1}
          display={`${policy.coolingShelters} facilities`}
          onChange={(coolingShelters) => setPolicy({ coolingShelters })}
        />
        <Slider
          icon={<UserRound className="h-3.5 w-3.5" />}
          label="DHC community nurse outreach"
          zh="地區康健中心外展"
          value={policy.dhcOutreach}
          min={0}
          max={100}
          step={1}
          display={`${policy.dhcOutreach.toFixed(0)}% coverage`}
          onChange={(dhcOutreach) => setPolicy({ dhcOutreach })}
        />
        <Slider
          icon={<ThermometerSun className="h-3.5 w-3.5" />}
          label="Cool roof / albedo retrofit"
          zh="涼屋頂反照率改造"
          value={policy.coolRoofPercent}
          min={0}
          max={50}
          step={1}
          display={`${policy.coolRoofPercent.toFixed(0)}% surface area`}
          onChange={(coolRoofPercent) => setPolicy({ coolRoofPercent })}
        />

        <label className="mt-2 flex cursor-pointer items-center justify-between rounded-xl bg-white/5 px-3 py-2">
          <span className="flex items-center gap-2 text-xs text-slate-200">
            <Shield className="h-3.5 w-3.5 text-cyan-300" />
            AC heat deflection bylaw
            <span className="block text-[10px] text-slate-400">空調廢熱導引規例</span>
          </span>
          <input
            type="checkbox"
            checked={policy.acDeflectionBylaw}
            onChange={(e) => setPolicy({ acDeflectionBylaw: e.target.checked })}
            className="h-4 w-4 accent-cyan-400"
          />
        </label>

        <div className="mt-3 grid grid-cols-1 gap-2">
          <ImpactCard
            label="24-hr A&E CVD presentations averted"
            value={impact.admissionsAverted.toFixed(1)}
            sub={`Baseline ${impact.baselineAdmissions24h.toFixed(1)} → ${impact.scenarioAdmissions24h.toFixed(1)}`}
          />
          <ImpactCard
            label="HA inpatient bed deficit averted"
            value={`${impact.bedDeficitAvertedPct.toFixed(2)}%`}
            sub={`Scenario occupancy pressure ${impact.scenarioBedDeficitPct.toFixed(2)}%`}
          />
          <ImpactCard
            label="Preventable mortality / 100,000"
            value={impact.preventableMortalityPer100k.toFixed(3)}
            sub={`RMR ${impact.baselineMortalityIndex.toFixed(3)} → ${impact.scenarioMortalityIndex.toFixed(3)}`}
          />
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
          Deltas versus a zero-intervention counterfactual ({BASELINE_POLICY.coolingShelters} shelters, no DHC, no albedo, no bylaw).
          Gagge heat storage and Bishai-style relative risk drive M/M/c arrivals at CMC, KWH and QEH.
        </p>
      </GlassPanel>
    </div>
  );
}

function Slider(props: {
  icon: ReactNode;
  label: string;
  zh: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="mb-2 block">
      <div className="mb-1 flex items-center justify-between gap-2 text-xs text-slate-200">
        <span className="flex items-center gap-1.5">
          <span className="text-cyan-300">{props.icon}</span>
          {props.label}
        </span>
        <span className="font-mono text-cyan-100">{props.display}</span>
      </div>
      <div className="text-[10px] text-slate-500">{props.zh}</div>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className="mt-1 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-700 accent-cyan-400"
      />
    </label>
  );
}

function ImpactCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-cyan-300/15 bg-gradient-to-br from-cyan-400/10 to-transparent px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-400">{label}</div>
      <div className="font-mono text-lg text-emerald-300">{value}</div>
      <div className="text-[10px] text-slate-500">{sub}</div>
    </div>
  );
}
