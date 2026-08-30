"use client";

import { useState } from "react";
import { FileDown } from "lucide-react";
import { useSimulation } from "@/components/simulation/SimulationProvider";
import {
  buildA4Pdf,
  downloadBytes,
  jpegFromDataUrl,
  modelFromTwin,
  rasterizeA4Png,
} from "@/lib/presentation/a4-brief";
import type { BriefingBeat } from "@/lib/presentation/beats";
import { runMonteCarlo } from "@/lib/monte-carlo";
import { scenarioById } from "@/lib/scenarios";
import { formatHourLabel } from "@/lib/utils";

function captureTwinJpeg(): string | null {
  const canvas = document.querySelector<HTMLCanvasElement>("[data-testid=twin-canvas]");
  if (!canvas) return null;
  try {
    return canvas.toDataURL("image/jpeg", 0.86);
  } catch {
    return null;
  }
}

export function VectorBriefingExport({ beat }: { beat: BriefingBeat }) {
  const sim = useSimulation();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("A4 PDF + PNG · map · Monte Carlo 95% CI · HA breakdown");

  const exportSheet = () => {
    setBusy(true);
    try {
      const canvas = document.querySelector<HTMLCanvasElement>("[data-testid=twin-canvas]");
      const mapDataUrl = canvas ? captureTwinJpeg() : null;
      const mapJpeg = mapDataUrl ? jpegFromDataUrl(mapDataUrl) : null;
      const mc =
        sim.monteCarlo ??
        runMonteCarlo({
          scenarioAdmissions24h: sim.impact.scenarioAdmissions24h,
          scenarioBedDeficitPct: sim.impact.scenarioBedDeficitPct,
          acFailProbability: Math.max(0.08, sim.forcing.acGridFailure),
          ozoneIndex: sim.forcing.ozoneIndex,
          iterations: 1000,
          seed: 20220719,
        });
      const outdoor =
        sim.snapshot.buildings.reduce((s, b) => s + b.outdoorTa, 0) /
        Math.max(1, sim.snapshot.buildings.length);
      const model = modelFromTwin({
        beatTitle: beat.titleEn,
        hourLabel: formatHourLabel(sim.hour),
        scenarioName: scenarioById(sim.scenarioId)?.nameEn ?? "Live HKO twin",
        generatedAt: new Date().toISOString().slice(0, 16),
        kowloonAirTempC: outdoor,
        regionalWbgt: sim.snapshot.regionalMeanWbgt,
        cviMean: sim.snapshot.regionalMeanCvi,
        admissionsAverted: sim.impact.admissionsAverted,
        mapJpeg,
        monteCarlo: mc,
        hospitals: sim.snapshot.hospitals,
      });
      const pdf = buildA4Pdf(model);
      const png = rasterizeA4Png(model, canvas);
      downloadBytes(pdf, "application/pdf", `aeris-hk-briefing-beat-${beat.index + 1}.pdf`);
      downloadBytes(png, "image/png", `aeris-hk-briefing-beat-${beat.index + 1}.png`);
      setStatus(`Exported A4 PDF + PNG (${pdf.byteLength} B · ${png.byteLength} B)`);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        data-testid="briefing-export"
        disabled={busy}
        onClick={exportSheet}
        className="inline-flex items-center gap-1.5 rounded-full border border-cyan-300/35 bg-cyan-400/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-cyan-100 hover:bg-cyan-400/20 disabled:opacity-50"
      >
        <FileDown className="h-3.5 w-3.5" />
        {busy ? "Composing A4…" : "Export A4 PDF + PNG"}
      </button>
      <p className="mt-1.5 font-mono text-[9px] text-slate-500" data-testid="briefing-export-status">
        {status}
      </p>
    </div>
  );
}
