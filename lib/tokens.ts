/** Design tokens — the in-repo stand-in for a Figma library until desktop MCP auth exists. */
export const AERIS_TOKENS = {
  color: {
    void: "#05070c",
    cyan: "#22d3ee",
    gold: "#fbbf24",
    emerald: "#34d399",
    crimson: "#f87171",
    glass: "rgba(2, 6, 23, 0.72)",
  },
  type: {
    display: "var(--font-geist-sans)",
    mono: "var(--font-geist-mono)",
    tc: "var(--font-noto-tc)",
  },
  space: {
    hud: "1rem",
    panel: "0.75rem",
  },
} as const;
