"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="zh-HK" suppressHydrationWarning>
      <body className="bg-[#05070c] text-slate-100" suppressHydrationWarning>
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-amber-200">
            AERIS-HK global error boundary
          </div>
          <p className="max-w-md text-sm text-slate-300">{error.message}</p>
          <button
            type="button"
            className="rounded-full bg-cyan-400 px-4 py-1.5 text-xs text-slate-950"
            onClick={reset}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
