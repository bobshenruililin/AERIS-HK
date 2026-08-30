"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Building2, Command, Database, Layers, MapPin, ThermometerSun, Wind, Zap } from "lucide-react";
import { useSimulation } from "@/components/simulation/SimulationProvider";
import { POLICY_PRESETS, STRESS_SCENARIOS, type StressScenarioId } from "@/lib/scenarios";
import { isTypingTarget } from "@/lib/hud";
import { TWIN_DISTRICTS } from "@/lib/districts";
import { TWIN_FLYIN_EVENT, TWIN_LOOKAT_EVENT, TWIN_ORBIT_EVENT } from "@/lib/twin-camera";
import { AERIS_ESCAPE_EVENT, interpretHudKey } from "@/lib/hotkeys";
import { BRIEFING_BEATS, dispatchBriefingBeat, dispatchBriefingStep } from "@/lib/presentation/beats";

type PaletteItem = {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: "building" | "policy" | "layer" | "scenario" | "street" | "snapshot" | "district";
  run: () => void;
};

export function CommandPalette() {
  const sim = useSimulation();
  const {
    commandPaletteOpen,
    setCommandPaletteOpen,
    buildings,
    focusBuilding,
    setPolicy,
    hudLayers,
    setHudLayer,
    applyScenario,
    savedRuns,
    loadSimulation,
    setCopilotPanelOpen,
    runParetoSolver,
    enterLiveMonitoring,
    enterPredictiveTwin,
  } = sim;
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (commandPaletteOpen) {
      setQuery("");
      const t = window.setTimeout(() => inputRef.current?.focus(), 20);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [commandPaletteOpen]);

  const items = useMemo<PaletteItem[]>(() => {
    const aliases: Record<string, string[]> = {
      "pei ho st tong lau": ["Pei Ho St Tong Lau Block A", "北河街唐樓 A座"],
      "temple street night market": ["Temple St Night Market", "廟街夜市"],
    };
    const districtItems: PaletteItem[] = TWIN_DISTRICTS.map((d) => ({
      id: `district-${d.id}`,
      group: "Districts",
      label: `${d.nameEn} · ${d.nameZh}`,
      hint: "cinematic look-at",
      icon: "district" as const,
      run: () => {
        window.dispatchEvent(new CustomEvent(TWIN_LOOKAT_EVENT, { detail: { lon: d.lon, lat: d.lat } }));
      },
    }));
    const STREET_QUERIES = [
      { q: ["pei ho", "北河"], street: "Pei Ho Street" },
      { q: ["fuk wa", "福華"], street: "Fuk Wa Street" },
      { q: ["apliu", "鴨寮"], street: "Apliu Street" },
      { q: ["shanghai", "上海"], street: "Shanghai Street" },
    ];
    const streetItems: PaletteItem[] = STREET_QUERIES.map((row) => {
      const first = buildings.find((b) => b.properties.streetEn === row.street);
      return {
        id: `street-${row.street}`,
        group: "Streets",
        label: row.street,
        hint: first?.properties.nameZh,
        icon: "street" as const,
        run: () => {
          if (first) focusBuilding(first.properties.id);
        },
      };
    });
    const snapshotItems: PaletteItem[] = savedRuns.map((run) => ({
      id: `sim-${run.id}`,
      group: "DB snapshots",
      label: run.scenario_name,
      hint: `${run.id.slice(0, 8)} · ${new Date(run.created_at).toISOString().slice(0, 16)}`,
      icon: "snapshot" as const,
      run: () => {
        void loadSimulation(run.id);
      },
    }));
    const buildingItems: PaletteItem[] = buildings.map((b) => ({
      id: `b-${b.properties.id}`,
      group: "Buildings",
      label: `${b.properties.nameEn} · ${b.properties.nameZh}`,
      hint: b.properties.address,
      icon: "building",
      run: () => focusBuilding(b.properties.id),
    }));
    const policyItems: PaletteItem[] = POLICY_PRESETS.map((p) => ({
      id: `p-${p.id}`,
      group: "Policy presets",
      label: p.nameEn,
      hint: p.nameZh,
      icon: "policy",
      run: () => {
        if ("scenarioId" in p && p.scenarioId) applyScenario(p.scenarioId);
        if (Object.keys(p.patch).length > 0) setPolicy(p.patch);
      },
    }));
    const layerItems: PaletteItem[] = [
      {
        id: "layer-wind",
        group: "Layers",
        label: hudLayers.windVectors ? "Hide wind vectors" : "Show wind vectors",
        icon: "layer",
        run: () => setHudLayer("windVectors", !hudLayers.windVectors),
      },
      {
        id: "layer-thermal",
        group: "Layers",
        label: hudLayers.thermalShimmer ? "Hide thermal shimmer" : "Show thermal shimmer",
        icon: "layer",
        run: () => setHudLayer("thermalShimmer", !hudLayers.thermalShimmer),
      },
      {
        id: "layer-wire",
        group: "Layers",
        label: hudLayers.buildingWireframes ? "Hide building wireframes" : "Show building wireframes",
        icon: "layer",
        run: () => setHudLayer("buildingWireframes", !hudLayers.buildingWireframes),
      },
      {
        id: "layer-h3",
        group: "Layers",
        label: hudLayers.h3Hexes ? "Hide H3 hex gradient" : "Show H3 hex gradient",
        icon: "layer",
        run: () => setHudLayer("h3Hexes", !hudLayers.h3Hexes),
      },
    ];
    const scenarioItems: PaletteItem[] = STRESS_SCENARIOS.map((s) => ({
      id: `s-${s.id}`,
      group: "Scenarios",
      label: s.nameEn,
      hint: s.nameZh,
      icon: "scenario",
      run: () => applyScenario(s.id as StressScenarioId),
    }));
    const briefingItems: PaletteItem[] = [
      {
        id: "play-briefing",
        group: "Briefing",
        label: "Play executive briefing",
        hint: "Cinematic director · 4 beats",
        icon: "scenario",
        run: () => dispatchBriefingBeat(0, "ui"),
      },
      ...BRIEFING_BEATS.map((b) => ({
        id: `briefing-beat-${b.index}`,
        group: "Briefing",
        label: `Beat ${b.index + 1}: ${b.titleEn}`,
        hint: `${String(b.hour).padStart(2, "0")}:00 HKT`,
        icon: "scenario" as const,
        run: () => dispatchBriefingBeat(b.index, "ui"),
      })),
    ];
    const copilotItems: PaletteItem[] = [
      {
        id: "live-monitoring",
        group: "Ops",
        label: "Live monitoring",
        hint: "HKO AWS + IDW field",
        icon: "scenario",
        run: () => enterLiveMonitoring(),
      },
      {
        id: "predictive-twin",
        group: "Ops",
        label: "Predictive twin",
        hint: "July 2022 heatwave plate",
        icon: "scenario",
        run: () => enterPredictiveTwin(),
      },
      {
        id: "ask-copilot",
        group: "Copilot",
        label: "Ask Spatial Policy Copilot",
        hint: "NL → tools, fly camera, citations",
        icon: "policy",
        run: () => setCopilotPanelOpen(true),
      },
      {
        id: "run-pareto",
        group: "Policy presets",
        label: "Run Pareto solver",
        hint: "NSGA-II · 500 gen · four levers",
        icon: "policy",
        run: () => {
          void runParetoSolver();
        },
      },
    ];
    const all = [
      ...briefingItems,
      ...copilotItems,
      ...districtItems,
      ...streetItems,
      ...buildingItems,
      ...policyItems,
      ...layerItems,
      ...scenarioItems,
      ...snapshotItems,
    ];
    const q = query.trim().toLowerCase();
    if (!q) return all.slice(0, 18);
    return all
      .filter((item) => {
        const blob = `${item.label} ${item.hint ?? ""} ${item.group}`.toLowerCase();
        if (blob.includes(q)) return true;
        return Object.entries(aliases).some(
          ([key, extra]) => extra.some((a) => a.toLowerCase().includes(q) || q.includes(a.toLowerCase())) && blob.includes(key),
        ) || STREET_QUERIES.some((row) => row.q.some((alias) => alias.includes(q) || q.includes(alias)) && item.label.toLowerCase().includes(row.street.toLowerCase()));
      })
      .slice(0, 24);
  }, [buildings, query, focusBuilding, setPolicy, hudLayers, setHudLayer, applyScenario, savedRuns, loadSimulation, setCopilotPanelOpen, runParetoSolver, enterLiveMonitoring, enterPredictiveTwin]);

  return (
    <AnimatePresence>
      {commandPaletteOpen ? (
        <motion.div
          className="pointer-events-auto fixed inset-0 z-[60] flex items-start justify-center bg-slate-950/55 p-4 pt-[12vh] backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setCommandPaletteOpen(false)}
          data-testid="command-palette"
        >
          <motion.div
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 8, opacity: 0 }}
            className="w-full max-w-xl overflow-hidden rounded-2xl border border-cyan-300/30 bg-slate-950/95 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
              <Command className="h-4 w-4 text-cyan-300" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Jump to a building, load a scenario, toggle layers…"
                className="w-full bg-transparent text-sm text-cyan-50 outline-none placeholder:text-slate-500"
                data-testid="command-palette-input"
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setCommandPaletteOpen(false);
                    return;
                  }
                  if (event.key === "Enter" && items[0]) {
                    items[0].run();
                    setCommandPaletteOpen(false);
                  }
                }}
              />
            </div>
            <ul className="max-h-[50vh] overflow-y-auto py-1">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => {
                      item.run();
                      setCommandPaletteOpen(false);
                    }}
                    data-testid={`palette-item-${item.id}`}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-slate-200 hover:bg-cyan-400/10"
                  >
                    {item.icon === "building" ? (
                      <Building2 className="h-3.5 w-3.5 text-cyan-300" />
                    ) : item.icon === "district" ? (
                      <MapPin className="h-3.5 w-3.5 text-amber-200" />
                    ) : item.icon === "policy" ? (
                      <ThermometerSun className="h-3.5 w-3.5 text-amber-300" />
                    ) : item.icon === "street" ? (
                      <MapPin className="h-3.5 w-3.5 text-emerald-300" />
                    ) : item.icon === "snapshot" ? (
                      <Database className="h-3.5 w-3.5 text-violet-300" />
                    ) : item.icon === "layer" ? (
                      item.label.toLowerCase().includes("wind") ? (
                        <Wind className="h-3.5 w-3.5 text-sky-300" />
                      ) : (
                        <Layers className="h-3.5 w-3.5 text-slate-400" />
                      )
                    ) : (
                      <Zap className="h-3.5 w-3.5 text-orange-300" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    <span className="text-[10px] uppercase tracking-wider text-slate-500">{item.group}</span>
                  </button>
                </li>
              ))}
            </ul>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export function HudHotkeys() {
  const sim = useSimulation();
  const simRef = useRef(sim);
  simRef.current = sim;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const s = simRef.current;
      const action = interpretHudKey(event, {
        typing: isTypingTarget(event.target),
        paletteOpen: s.commandPaletteOpen,
      });
      if (!action) return;
      if (action.type === "search") {
        event.preventDefault();
        s.setCommandPaletteOpen(!s.commandPaletteOpen);
        return;
      }
      if (action.type === "dismiss") {
        event.preventDefault();
        if (s.commandPaletteOpen) {
          s.setCommandPaletteOpen(false);
          return;
        }
        const ev = new CustomEvent(AERIS_ESCAPE_EVENT, { cancelable: true });
        window.dispatchEvent(ev);
        if (ev.defaultPrevented) return;
        s.setSelectedId(null);
        s.setInspectorAnchor(null);
        s.setFocusedHospital(null);
        return;
      }
      if (action.type === "preset") {
        event.preventDefault();
        s.setHudPreset(action.id);
        return;
      }
      if (action.type === "timeline-toggle") {
        event.preventDefault();
        s.setPlaying(!s.playing);
        return;
      }
      if (action.type === "flyin") {
        event.preventDefault();
        window.dispatchEvent(new Event(TWIN_FLYIN_EVENT));
        return;
      }
      if (action.type === "orbit") {
        event.preventDefault();
        window.dispatchEvent(new Event(TWIN_ORBIT_EVENT));
        return;
      }
      if (action.type === "beat-next") {
        event.preventDefault();
        dispatchBriefingStep("next", "key");
        return;
      }
      if (action.type === "beat-prev") {
        event.preventDefault();
        dispatchBriefingStep("prev", "key");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return null;
}
