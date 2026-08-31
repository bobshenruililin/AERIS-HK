"use client";

export function CinematicPlate() {
  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center opacity-[0.14]"
        style={{ backgroundImage: "url(/decade/harbour_approach.png)" }}
        data-testid="cinematic-plate"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-[#05070c]/40 via-transparent to-[#05070c]/80" />
    </div>
  );
}
