"use client";

import { HUD_SVG_MARK } from "./ConceptPrompts";

export function HudOverlays() {
  return (
    <div className="pointer-events-none absolute left-3 top-1/2 z-10 hidden -translate-y-1/2 opacity-70 md:block">
      <div
        className="h-12 w-80 text-cyan-300"
        dangerouslySetInnerHTML={{ __html: HUD_SVG_MARK }}
      />
    </div>
  );
}
