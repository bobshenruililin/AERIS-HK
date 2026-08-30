"use client";

import { useEffect } from "react";
import { AERIS_ESCAPE_EVENT } from "@/lib/hotkeys";

/** Consume a HUD Esc cascade. Callers should close the topmost overlay. */
export function useAerisEscape(active: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!active) return;
    const handler = (event: Event) => {
      event.preventDefault();
      onEscape();
    };
    window.addEventListener(AERIS_ESCAPE_EVENT, handler);
    return () => window.removeEventListener(AERIS_ESCAPE_EVENT, handler);
  }, [active, onEscape]);
}
