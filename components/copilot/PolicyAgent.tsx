"use client";

import { useCallback, useRef, useState } from "react";
import { Bot, Send, Sparkles, X } from "lucide-react";
import { useSimulation } from "@/components/simulation/SimulationProvider";
import { useAerisEscape } from "@/components/system/useAerisEscape";
import { GlassPanel } from "@/components/ui/GlassPanel";
import {
  AgentPlanSchema,
  EMPTY_COPILOT,
  enrichNarrative,
  flyTo,
  planToPatch,
  type AgentPlan,
  type CitationSpec,
} from "@/lib/agent";
import { cn } from "@/lib/utils";
import { CitedText } from "./CitedText";

const SUGGESTIONS = [
  "Compare July 2022 vs district blackout",
  "CMC capacity at 15:00",
  "Focus CVI ≥ 70 critical hotspots",
  "What if Sham Shui Po cool-roof 40% and AC −20%",
];

interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  tools?: string[];
  runtime?: string;
}

export function PolicyAgent() {
  const sim = useSimulation();
  const {
    copilotPanelOpen,
    setCopilotPanelOpen,
    setCopilot,
    setCopilotAmbientDeltaC,
    setPolicy,
    setHour,
    setPlaying,
    applyScenario,
    setFocusedHospital,
    setSelectedId,
    buildings,
    snapshot,
    cache,
    policy,
    envelope,
    totalRoofM2,
    hour,
    scenarioId,
    simId,
    spatial,
    spatialIndex,
    copilot,
  } = sim;
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useAerisEscape(copilotPanelOpen, () => setCopilotPanelOpen(false));

  const onCite = useCallback(
    (spec: CitationSpec) => {
      setCopilot({
        ...copilot,
        citationId: spec.id,
        citationHighlight: spec.highlight,
      });
    },
    [setCopilot, copilot],
  );

  const runQuery = useCallback(
    async (raw: string) => {
      const query = raw.trim();
      if (!query || busy) return;
      setBusy(true);
      setError(null);
      setTurns((prev) => [...prev, { role: "user", text: query }]);
      setDraft("");
      try {
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            query,
            context: {
              hour,
              scenarioId,
              simId,
              footprintCount: spatial.buildingCount || buildings.length,
              vectorCount: spatialIndex.vectorCount || 24_000,
              districtHint: null,
              hospitalHint: sim.focusedHospital,
            },
          }),
        });
        const payload = (await res.json()) as (AgentPlan & { runtime?: string }) | { error?: string };
        if (!res.ok || "error" in payload) {
          throw new Error(("error" in payload && payload.error) || `HTTP ${res.status}`);
        }
        const plan = AgentPlanSchema.parse(payload);
        const footprints = spatial.buildingCount || buildings.length;
        const vectors = spatialIndex.vectorCount || 24_000;
        const narrative = enrichNarrative(plan.narrative, { simId, footprints, vectors });
        const patch = planToPatch(plan, {
          buildings,
          snapshot,
          cache,
          policy,
          envelope,
          totalRoofM2,
          query,
        });
        if (patch.applyScenario && patch.scenarioId) {
          applyScenario(patch.scenarioId);
        }
        if (Object.keys(patch.policyPatch).length > 0) {
          setPolicy(patch.policyPatch);
        }
        setCopilotAmbientDeltaC(patch.ambientDeltaC);
        setHour(patch.hour);
        setPlaying(false);
        setFocusedHospital(patch.focusedHospital);
        if (patch.selectedBuildingId) setSelectedId(patch.selectedBuildingId);
        setCopilot(patch.copilot);
        flyTo(patch.lookAt.lon, patch.lookAt.lat);
        setTurns((prev) => [
          ...prev,
          {
            role: "assistant",
            text: narrative,
            tools: plan.tools.map((t) => t.name),
            runtime: "runtime" in payload ? String(payload.runtime) : "intent-parser",
          },
        ]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "copilot failed");
      } finally {
        setBusy(false);
        window.setTimeout(() => inputRef.current?.focus(), 20);
      }
    },
    [
      applyScenario,
      buildings,
      busy,
      cache,
      envelope,
      hour,
      policy,
      scenarioId,
      setCopilot,
      setCopilotAmbientDeltaC,
      setFocusedHospital,
      setHour,
      setPlaying,
      setPolicy,
      setSelectedId,
      sim.focusedHospital,
      simId,
      snapshot,
      spatial.buildingCount,
      spatialIndex.vectorCount,
      totalRoofM2,
    ],
  );

  const clearSpatial = useCallback(() => {
    setCopilot(EMPTY_COPILOT);
    setCopilotAmbientDeltaC(0);
    setFocusedHospital(null);
  }, [setCopilot, setCopilotAmbientDeltaC, setFocusedHospital]);

  if (!copilotPanelOpen) {
    return (
      <button
        type="button"
        data-testid="policy-copilot"
        aria-expanded={false}
        onClick={() => {
          setCopilotPanelOpen(true);
          window.setTimeout(() => inputRef.current?.focus(), 40);
        }}
        className="pointer-events-auto absolute bottom-36 right-3 z-40 flex items-center gap-2 rounded-full border border-cyan-300/35 bg-slate-950/80 px-3 py-1.5 text-[11px] text-cyan-50 shadow-[0_0_28px_rgba(8,145,178,0.28)] backdrop-blur-xl hover:bg-slate-900/90 md:bottom-40"
      >
        <Sparkles className="h-3.5 w-3.5 text-amber-200" />
        Ask copilot
      </button>
    );
  }

  return (
    <div
      className="pointer-events-none absolute bottom-36 right-3 z-40 w-[min(24rem,calc(100vw-1.5rem))] md:bottom-40"
      data-testid="policy-copilot"
    >
      <GlassPanel className="max-h-[min(70vh,36rem)] overflow-hidden">
        <div className="mb-2 flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-cyan-300">
              <Bot className="h-3.5 w-3.5" />
              Spatial Policy Copilot
            </div>
            <h2 className="text-sm font-semibold text-white">Natural language → Deck.gl + Gagge</h2>
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              className="text-[10px] text-slate-400 hover:text-cyan-100"
              onClick={clearSpatial}
            >
              clear map
            </button>
            <button
              type="button"
              aria-label="Close copilot"
              className="text-slate-400 hover:text-white"
              onClick={() => setCopilotPanelOpen(false)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {copilot.diff ? (
          <div
            className="mb-2 rounded-lg bg-white/5 px-2 py-1 font-mono text-[10px] text-slate-300"
            data-testid="copilot-diff-legend"
          >
            <span className="text-emerald-300">Green</span> = scenario B cooler ·{" "}
            <span className="text-red-300">Red</span> = B hotter (ΔCVI)
            {copilot.compare ? ` · ${copilot.compare.a} → ${copilot.compare.b}` : ""}
          </div>
        ) : null}

        <div className="mb-2 max-h-56 space-y-2 overflow-y-auto pr-1" data-testid="copilot-transcript">
          {turns.length === 0 ? (
            <p className="text-[11px] text-slate-400">
              Ask for a counterfactual, hotspot filter, hospital occupancy, or scenario comparison. Every claim cites
              the live physics engine — click a bracket to highlight the HUD.
            </p>
          ) : null}
          {turns.map((turn, i) => (
            <div
              key={`${turn.role}-${i}`}
              data-testid="copilot-message"
              className={cn(
                "rounded-lg px-2 py-1.5 text-[11px] leading-relaxed",
                turn.role === "user" ? "bg-cyan-400/10 text-cyan-50" : "bg-white/5 text-slate-200",
              )}
            >
              {turn.role === "assistant" ? (
                <CitedText text={turn.text} onCite={onCite} />
              ) : (
                turn.text
              )}
              {turn.tools?.length ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {turn.tools.map((name) => (
                    <span
                      key={name}
                      className="rounded-full bg-amber-400/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-amber-100"
                    >
                      {name}
                    </span>
                  ))}
                  {turn.runtime ? (
                    <span className="rounded-full bg-white/10 px-1.5 py-0.5 font-mono text-[9px] text-slate-400">
                      {turn.runtime}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>

        <div className="mb-2 flex flex-wrap gap-1">
          {SUGGESTIONS.map((q) => (
            <button
              key={q}
              type="button"
              disabled={busy}
              data-testid={`copilot-suggest-${q.slice(0, 12).replace(/\s+/g, "-")}`}
              onClick={() => void runQuery(q)}
              className="rounded-full bg-white/5 px-2 py-0.5 text-[9px] text-slate-300 hover:bg-cyan-400/15 hover:text-cyan-50 disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>

        {error ? <div className="mb-2 text-[10px] text-red-300">{error}</div> : null}

        <form
          className="flex items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            void runQuery(draft);
          }}
        >
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask the twin…"
            data-testid="copilot-input"
            className="min-w-0 flex-1 rounded-full border border-white/10 bg-black/40 px-3 py-1.5 text-xs text-cyan-50 outline-none placeholder:text-slate-500 focus:border-cyan-300/40"
            disabled={busy}
          />
          <button
            type="submit"
            data-testid="copilot-send"
            disabled={busy || !draft.trim()}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-cyan-400 text-slate-950 disabled:opacity-40"
            aria-label="Send"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </form>
      </GlassPanel>
    </div>
  );
}
