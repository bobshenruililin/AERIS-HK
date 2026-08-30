"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Building2, Command, Layers, ThermometerSun, Wind, Zap } from "lucide-react";
import { useSimulation } from "@/components/simulation/SimulationProvider";
import { POLICY_PRESETS, STRESS_SCENARIOS, type StressScenarioId } from "@/lib/scenarios";
import { isTypingTarget } from "@/lib/hud";

type PaletteItem = {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: "building" | "policy" | "layer" | "scenario";
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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen(!commandPaletteOpen);
        return;
      }
      if (event.key === "Escape" && commandPaletteOpen) {
        event.preventDefault();
        setCommandPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commandPaletteOpen, setCommandPaletteOpen]);

  const items = useMemo<PaletteItem[]>(() => {
    const aliases: Record<string, string[]> = {
      "pei ho st tong lau": ["Pei Ho St Tong Lau Block A", "北河街唐樓 A座"],
      "temple street night market": ["Temple St Night Market", "廟街夜市"],
    };
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
    ];
    const scenarioItems: PaletteItem[] = STRESS_SCENARIOS.map((s) => ({
      id: `s-${s.id}`,
      group: "Scenarios",
      label: s.nameEn,
      hint: s.nameZh,
      icon: "scenario",
      run: () => applyScenario(s.id as StressScenarioId),
    }));
    const all = [...buildingItems, ...policyItems, ...layerItems, ...scenarioItems];
    const q = query.trim().toLowerCase();
    if (!q) return all.slice(0, 18);
    return all
      .filter((item) => {
        const blob = `${item.label} ${item.hint ?? ""} ${item.group}`.toLowerCase();
        if (blob.includes(q)) return true;
        return Object.entries(aliases).some(
          ([key, extra]) => extra.some((a) => a.toLowerCase().includes(q) || q.includes(a.toLowerCase())) && blob.includes(key),
        );
      })
      .slice(0, 24);
  }, [buildings, query, focusBuilding, setPolicy, hudLayers, setHudLayer, applyScenario]);

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
                    className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-slate-200 hover:bg-cyan-400/10"
                  >
                    {item.icon === "building" ? (
                      <Building2 className="h-3.5 w-3.5 text-cyan-300" />
                    ) : item.icon === "policy" ? (
                      <ThermometerSun className="h-3.5 w-3.5 text-amber-300" />
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
  const {
    setHudPreset,
    playing,
    setPlaying,
    commandPaletteOpen,
    setCommandPaletteOpen,
  } = useSimulation();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || commandPaletteOpen) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "1") setHudPreset(1);
      else if (event.key === "2") setHudPreset(2);
      else if (event.key === "3") setHudPreset(3);
      else if (event.key === "4") setHudPreset(4);
      else if (event.key === " " || event.code === "Space") {
        event.preventDefault();
        setPlaying(!playing);
      } else if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        window.dispatchEvent(new Event("aeris-twin-flyin"));
      } else if (event.key.toLowerCase() === "k" && !event.metaKey) {
        // palette is Cmd+K; ignore bare k
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setHudPreset, playing, setPlaying, commandPaletteOpen, setCommandPaletteOpen]);

  return null;
}
