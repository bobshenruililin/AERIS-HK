"use client";

import { useSimulation } from "@/components/simulation/SimulationProvider";
import { GlassPanel } from "./GlassPanel";
import { DECADE_EPISODES, decadeCumulativeAverted, episodeRelativeRisk } from "@/lib/decade";

export function DecadeObservatory() {
  const { episodeId, setEpisodeId, impact, coolRoofPlan, neonArchive } = useSimulation();
  const live = impact.admissionsAverted;
  const cumulative = decadeCumulativeAverted(live);
  const maxRr = Math.max(...DECADE_EPISODES.map((e) => episodeRelativeRisk(e)));

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-40 z-20 flex justify-center p-3 md:bottom-44 md:p-4">
      <GlassPanel className="w-full max-w-5xl">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-amber-300">Decade observatory</div>
            <div className="text-[10px] text-slate-500">十年酷熱反事實 · 2016–2026 · if these roofs had been locked each summer</div>
          </div>
          <div className="font-mono text-[11px] text-emerald-300" data-testid="decade-cumulative">
            Σ {cumulative.toFixed(0)} averted
          </div>
        </div>
        <div className="flex gap-1 overflow-x-auto" data-testid="decade-years">
          {DECADE_EPISODES.map((episode) => {
            const on = episode.id === episodeId;
            const h = Math.max(16, (episodeRelativeRisk(episode) / maxRr) * 36);
            return (
              <button
                key={episode.id}
                type="button"
                onClick={() => setEpisodeId(episode.id)}
                className={`flex min-w-[3.4rem] flex-col items-center rounded-lg px-1.5 py-1 ${
                  on ? "bg-amber-400/20 ring-1 ring-amber-300/50" : "bg-white/5 hover:bg-white/10"
                }`}
                data-testid={`decade-year-${episode.year}`}
              >
                <div className="flex h-9 items-end">
                  <div className="w-3 rounded-sm bg-gradient-to-t from-orange-700 to-amber-300" style={{ height: h }} />
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-slate-200">{episode.year}</div>
              </button>
            );
          })}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-slate-400 md:grid-cols-4">
          <span data-testid="decade-episode-name">
            {DECADE_EPISODES.find((e) => e.id === episodeId)?.nameEn} ·{" "}
            {DECADE_EPISODES.find((e) => e.id === episodeId)?.nameZh}
          </span>
          <span>
            ΔT {DECADE_EPISODES.find((e) => e.id === episodeId)?.anomalyC.toFixed(2)}°C · RR{" "}
            {episodeRelativeRisk(DECADE_EPISODES.find((e) => e.id === episodeId)!).toFixed(2)}
          </span>
          <span>
            ensemble {coolRoofPlan?.ensembleP10?.toFixed(1) ?? "—"}–{coolRoofPlan?.ensembleP90?.toFixed(1) ?? "—"} local
          </span>
          <span data-testid="decade-neon">
            {neonArchive?.neon ? `Neon archive · ${neonArchive.persisted} rows` : "Neon archive standby"}
          </span>
        </div>
      </GlassPanel>
    </div>
  );
}
