/**
 * Four curated cinematic briefing beats for the Kowloon West twin.
 * Camera frames are TwinView (ENU metres) — never HK80 eastings.
 */
import type { BuildingFeature, PolicyState } from "../types";
import { viewLookingAt, type TwinView } from "../twin-camera";
import { wrapHour } from "../utils";

export const BRIEFING_BEAT_COUNT = 4;
export const KEYFRAME_MS = 2600;
export const BRIEFING_BEAT_EVENT = "aeris-briefing-beat";

export type BriefingBeatId =
  | "regional-heatwave"
  | "street-canyon-trap"
  | "hospital-triage-deficit"
  | "optimal-counterfactual";

export interface BriefingBeat {
  index: number;
  id: BriefingBeatId;
  titleEn: string;
  titleZh: string;
  shortLabel: string;
  narrative: string;
  hour: number;
  view: TwinView;
  focusHospital: "CMC" | "KWH" | null;
  streetEn: string | null;
  applyHeatwave: boolean;
  applyOptimalPolicy: boolean;
}

export const OPTIMAL_COUNTERFACTUAL_POLICY: Partial<PolicyState> = {
  coolingShelters: 24,
  dhcOutreach: 72,
  acDeflectionBylaw: true,
  canopyGreeneryPercent: 55,
  acEfficiencyGrantPct: 70,
};

export const BRIEFING_BEATS: readonly BriefingBeat[] = [
  {
    index: 0,
    id: "regional-heatwave",
    titleEn: "The Regional Heatwave Overview",
    titleZh: "區域熱浪總覽",
    shortLabel: "Heatwave",
    narrative: "Kowloon West at 14:00 HKT — district-scale UTCI (ISO 7243 WBGT analogue) under the July 2022 37.4°C plate.",
    hour: 14,
    view: viewLookingAt(114.1685, 22.322, { zoom: 14.12, pitch: 54, bearing: 22, targetUp: 28 }),
    focusHospital: null,
    streetEn: null,
    applyHeatwave: true,
    applyOptimalPolicy: false,
  },
  {
    index: 1,
    id: "street-canyon-trap",
    titleEn: "The Street Canyon Trap",
    titleZh: "福華街峽谷熱阱",
    shortLabel: "Fuk Wa",
    narrative: "Subdivided units on Fuk Wa Street at 23:00 HKT — canyon trap plus 劏房 concrete thermal battery.",
    hour: 23,
    view: viewLookingAt(114.16307, 22.33102, { zoom: 17.08, pitch: 62, bearing: 98, targetUp: 16 }),
    focusHospital: null,
    streetEn: "Fuk Wa Street",
    applyHeatwave: true,
    applyOptimalPolicy: false,
  },
  {
    index: 2,
    id: "hospital-triage-deficit",
    titleEn: "The Hospital Triage Deficit",
    titleZh: "廣華 / 明愛分流赤字",
    shortLabel: "Triage",
    narrative: "Kwong Wah & Caritas surge at 02:00 HKT — M/M/c occupancy, Cat 1–3 mix, and 120% overflow onto PMH/QEH.",
    hour: 2,
    view: viewLookingAt(114.16255, 22.32805, { zoom: 14.55, pitch: 50, bearing: -14, targetUp: 32 }),
    focusHospital: "KWH",
    streetEn: null,
    applyHeatwave: true,
    applyOptimalPolicy: false,
  },
  {
    index: 3,
    id: "optimal-counterfactual",
    titleEn: "The Optimal Intervention Counterfactual",
    titleZh: "最優干預反事實",
    shortLabel: "Counterfactual",
    narrative: "Shelters, DHC outreach, albedo knapsack, canopy, and tenement AC grants applied on the same heatwave plate.",
    hour: 15,
    view: viewLookingAt(114.1632, 22.3264, { zoom: 15.15, pitch: 56, bearing: -18, targetUp: 22 }),
    focusHospital: null,
    streetEn: null,
    applyHeatwave: true,
    applyOptimalPolicy: true,
  },
] as const;

export function briefingBeat(index: number): BriefingBeat {
  const wrapped = ((index % BRIEFING_BEAT_COUNT) + BRIEFING_BEAT_COUNT) % BRIEFING_BEAT_COUNT;
  return BRIEFING_BEATS[wrapped];
}

/** Advance hour along the narrative (wrapping midnight forward, not backwards). */
export function lerpHourForward(from: number, to: number, t: number): number {
  const a = wrapHour(from);
  let b = wrapHour(to);
  if (b + 1e-9 < a) b += 24;
  return wrapHour(a + (b - a) * t);
}

/**
 * Cinematic hour lerp: midnight-forward for story jumps, but take a short
 * backward step when the target is ≤6 h earlier (e.g. 15:00 → 14:00).
 */
export function lerpHourCinematic(from: number, to: number, t: number): number {
  const a = wrapHour(from);
  const b = wrapHour(to);
  let forward = b - a;
  if (forward < 0) forward += 24;
  const back = forward - 24;
  const delta = Math.abs(back) > 0 && Math.abs(back) <= 6 ? back : forward;
  return wrapHour(a + delta * t);
}

export type BriefingBeatEventDetail = {
  source: "key" | "ui" | "auto";
  index?: number;
  direction?: "next" | "prev";
};

export function dispatchBriefingBeat(index: number, source: "key" | "ui" | "auto" = "ui"): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(BRIEFING_BEAT_EVENT, { detail: { index, source } satisfies BriefingBeatEventDetail }));
}

export function dispatchBriefingStep(direction: "next" | "prev", source: "key" | "ui" | "auto" = "key"): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(BRIEFING_BEAT_EVENT, { detail: { direction, source } satisfies BriefingBeatEventDetail }),
  );
}

/** Highest 劏房 density on Fuk Wa Street (fallback: densest footprint in the twin). */
export function pickFukWaTrapBuilding(buildings: BuildingFeature[]): BuildingFeature | null {
  const street = buildings.filter((b) => b.properties.streetEn === "Fuk Wa Street");
  const pool = street.length > 0 ? street : buildings;
  if (pool.length === 0) return null;
  return [...pool].sort((a, b) => b.properties.subdividedFlatDensity - a.properties.subdividedFlatDensity)[0] ?? null;
}
