"use client";

import { MissionShell } from "@/components/system/MissionShell";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="relative">
      <MissionShell label="AERIS-HK · route error contained" />
      <div className="pointer-events-auto absolute inset-x-0 top-16 z-40 mx-auto max-w-md rounded-2xl border border-amber-300/30 bg-slate-950/90 p-4 text-center text-slate-200">
        <div className="font-mono text-[11px] text-amber-200">Error boundary</div>
        <p className="mt-2 text-sm">{error.message}</p>
        <button
          type="button"
          className="mt-3 rounded-full bg-cyan-400 px-3 py-1 text-xs text-slate-950"
          onClick={reset}
        >
          Retry HUD
        </button>
      </div>
    </div>
  );
}
