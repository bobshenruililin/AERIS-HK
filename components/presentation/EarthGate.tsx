"use client";

type EarthGateProps = {
  onEnter: () => void;
};

export function EarthGate({ onEnter }: EarthGateProps) {
  return (
    <button
      type="button"
      data-testid="theater-gate"
      onClick={onEnter}
      className="absolute inset-0 z-[80] cursor-pointer overflow-hidden text-left"
      aria-label="Enter the Kowloon West thermal Earth"
    >
      <div
        className="aeris-earth-ken absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url(/decade/harbour_approach.png)" }}
      />
      <div className="absolute inset-0 bg-[#030712]/55" />
      <div className="absolute inset-0 bg-gradient-to-b from-[#030712]/30 via-transparent to-[#030712]/85" />
      <div className="absolute inset-0 shadow-[inset_0_0_180px_rgba(3,7,18,0.85)]" />

      <div className="aeris-earth-copy relative z-10 flex h-full flex-col items-center justify-center px-6 text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.55em] text-cyan-300/90">AERIS</p>
        <h1 className="mt-4 font-noto text-4xl font-semibold tracking-tight text-cyan-50 md:text-6xl">九龍西</h1>
        <p className="mt-2 text-lg font-medium tracking-[0.28em] text-slate-200 md:text-2xl">KOWLOON WEST</p>
        <p className="mt-6 max-w-xl text-balance text-base text-slate-200/95 md:text-lg">
          Organize the city&apos;s thermal truth.
        </p>
        <p className="mt-2 max-w-xl text-sm text-slate-400 md:text-[15px]">
          把一座城市的熱真實，做成可查詢的地球
        </p>
        <p className="mt-8 max-w-lg font-mono text-[10px] uppercase leading-relaxed tracking-[0.18em] text-slate-500">
          ISO 7243 WBGT · Gagge two-node · M/M/c surge · July 2022 37.4 °C plate
        </p>
        <span className="mt-10 rounded-full border border-cyan-300/45 bg-cyan-400/10 px-7 py-2.5 font-mono text-[11px] uppercase tracking-[0.28em] text-cyan-50 shadow-[0_0_40px_rgba(34,211,238,0.18)]">
          Click to enter Earth
        </span>
        <p className="mt-4 font-mono text-[9px] text-slate-600">
          One click unlocks the heat soundscape · four cinematic beats · Esc to operate
        </p>
      </div>
    </button>
  );
}
