/**
 * HUD keyboard grammar. Cmd/Ctrl+K and Esc are global; presets and Space
 * are ignored while typing or while the command palette is open.
 */

export const AERIS_ESCAPE_EVENT = "aeris-escape";

export type HudKeyAction =
  | { type: "preset"; id: 1 | 2 | 3 | 4 }
  | { type: "timeline-toggle" }
  | { type: "search" }
  | { type: "dismiss" }
  | { type: "flyin" }
  | { type: "orbit" }
  | { type: "beat-next" }
  | { type: "beat-prev" };

export interface HudKeyContext {
  typing: boolean;
  paletteOpen: boolean;
}

export interface HudKeyLike {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

export function interpretHudKey(event: HudKeyLike, ctx: HudKeyContext): HudKeyAction | null {
  const key = event.key;
  const code = event.code ?? "";
  if ((event.metaKey || event.ctrlKey) && key.toLowerCase() === "k") {
    return { type: "search" };
  }
  if (key === "Escape") {
    return { type: "dismiss" };
  }
  if (ctx.typing || ctx.paletteOpen) return null;
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (key === "1" || key === "2" || key === "3" || key === "4") {
    return { type: "preset", id: Number(key) as 1 | 2 | 3 | 4 };
  }
  if (key === " " || code === "Space") {
    return { type: "timeline-toggle" };
  }
  if (key === "f" || key === "F") return { type: "flyin" };
  if (key === "o" || key === "O") return { type: "orbit" };
  if (key === "ArrowRight") return { type: "beat-next" };
  if (key === "ArrowLeft") return { type: "beat-prev" };
  return null;
}
