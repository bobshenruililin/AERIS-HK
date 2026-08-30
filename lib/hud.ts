/**
 * Viewport presets for the AERIS-HK command HUD.
 * Panels are never unmounted — this file only describes presentation.
 */
export type HudPresetId = 1 | 2 | 3 | 4;

export type DrawerId = "header" | "hospital" | "policy" | "critical" | "decade" | "inspector";

export type DrawerPresentation = "expanded" | "pill" | "compact";

export type InspectorTab = "biophysics" | "demographics" | "surge";

export interface HudLayers {
  windVectors: boolean;
  thermalShimmer: boolean;
  buildingWireframes: boolean;
}

export const DEFAULT_HUD_LAYERS: HudLayers = {
  windVectors: true,
  thermalShimmer: true,
  buildingWireframes: false,
};

export interface HudPresetSpec {
  id: HudPresetId;
  nameEn: string;
  nameZh: string;
  blurbEn: string;
  drawers: Record<DrawerId, DrawerPresentation>;
  layers: HudLayers;
  briefing: boolean;
  shortcut: string;
}

export const HUD_PRESETS: Record<HudPresetId, HudPresetSpec> = {
  1: {
    id: 1,
    nameEn: "Strategic Command",
    nameZh: "戰略指揮",
    blurbEn: "Macro HA bed surge & cluster triage",
    drawers: {
      header: "expanded",
      hospital: "expanded",
      policy: "pill",
      critical: "expanded",
      decade: "pill",
      inspector: "compact",
    },
    layers: { windVectors: false, thermalShimmer: true, buildingWireframes: false },
    briefing: false,
    shortcut: "1",
  },
  2: {
    id: 2,
    nameEn: "Micro-Canyon Physics",
    nameZh: "微峽谷物理",
    blurbEn: "3D thermal inertia, wind vectors, building inspection",
    drawers: {
      header: "compact",
      hospital: "pill",
      policy: "pill",
      critical: "pill",
      decade: "pill",
      inspector: "expanded",
    },
    layers: { windVectors: true, thermalShimmer: true, buildingWireframes: true },
    briefing: false,
    shortcut: "2",
  },
  3: {
    id: 3,
    nameEn: "Policy Sandbox",
    nameZh: "政策沙盤",
    blurbEn: "Live sliders, counterfactuals & bed-deficit Monte Carlo",
    drawers: {
      header: "compact",
      hospital: "pill",
      policy: "expanded",
      critical: "pill",
      decade: "expanded",
      inspector: "compact",
    },
    layers: { windVectors: false, thermalShimmer: true, buildingWireframes: false },
    briefing: false,
    shortcut: "3",
  },
  4: {
    id: 4,
    nameEn: "Clinical Surveillance Briefing",
    nameZh: "臨床監測簡報",
    blurbEn: "Full-screen print/export executive view",
    drawers: {
      header: "compact",
      hospital: "pill",
      policy: "pill",
      critical: "pill",
      decade: "pill",
      inspector: "compact",
    },
    layers: { windVectors: false, thermalShimmer: false, buildingWireframes: false },
    briefing: true,
    shortcut: "4",
  },
};

export const DEFAULT_HUD_PRESET: HudPresetId = 1;

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
}

export interface ScreenAnchor {
  x: number;
  y: number;
}
