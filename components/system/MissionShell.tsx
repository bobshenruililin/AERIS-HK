export function MissionShell({ label = "AERIS-HK · hydrating twin" }: { label?: string }) {
  return (
    <div
      className="relative h-screen w-screen overflow-hidden bg-[#05070c] text-slate-100"
      data-testid="hud-ready"
      data-hydrating="1"
    >
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(1200px 600px at 70% -10%, rgba(8, 145, 178, 0.18), transparent 55%), radial-gradient(900px 500px at 10% 110%, rgba(244, 63, 94, 0.08), transparent 50%)",
        }}
      />
      <div className="pointer-events-none absolute inset-x-0 top-3 z-30 flex justify-center px-3">
        <div className="rounded-full border border-cyan-300/20 bg-slate-950/70 px-4 py-2 font-mono text-[10px] tracking-[0.18em] text-slate-500">
          {label}
        </div>
      </div>
    </div>
  );
}
