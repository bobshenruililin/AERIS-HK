import { clamp } from "./utils";

/** Characteristic canyon aspect H/W from building height and roof plan area. */
export function canyonAspectRatio(heightM: number, roofAreaM2: number): number {
  const width = Math.sqrt(Math.max(4, roofAreaM2));
  return Math.max(0.15, heightM / width);
}

/**
 * Sky-view factor for an infinite street canyon (Oke-style).
 * SVF → 1 in open terrain, → 0 in deep tong-lau slots.
 */
export function skyViewFactor(hw: number): number {
  const x = Math.max(0, hw);
  return clamp(1 / Math.sqrt(1 + x * x), 0.05, 0.98);
}

export function canyonMetrics(heightM: number, roofAreaM2: number): { hw: number; svf: number } {
  const hw = canyonAspectRatio(heightM, roofAreaM2);
  return { hw, svf: skyViewFactor(hw) };
}
