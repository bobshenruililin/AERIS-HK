/**
 * Scenario-driven biophysical knobs. Defaults are identity (live HKO twin).
 * Never replaces Gagge terms — only scales canyon / AC / breeze inputs.
 */
import { clamp } from "./utils";

export interface PhysicsForcing {
  /** 1 = live sea-breeze; 0 = typhoon-subsidence stall. */
  seaBreezeScale: number;
  /** 0–1 fraction of tenement AC rejected / failed. */
  acGridFailure: number;
  /** Minutes since grid trip; 90 realises indoor wet-bulb > 36°C. */
  blackoutElapsedMin: number;
  /** 0 = clear; 1 = overcast. */
  cloudCover: number;
  /** Night relative-humidity floor (0–1). 0 keeps the live envelope. */
  nightRhFloor: number;
  /** 0–1 ozone / particle penalty folded into CVI. */
  ozoneIndex: number;
  /** Extra AC rejector heat after sunset (midnight canyon trap). */
  midnightAcRejectorBoost: number;
  /** Coastal inundation depth (m) applied to Sham Shui Po lowlands. */
  coastalFloodM: number;
  /** Additive post-cyclone relative-humidity lift (0–1 fraction). */
  postStormRhBoost: number;
  /** Multiplier on the 劏房 concrete thermal-battery term (1 = identity). */
  batteryIntensity: number;
}

export const DEFAULT_PHYSICS_FORCING: PhysicsForcing = {
  seaBreezeScale: 1,
  acGridFailure: 0,
  blackoutElapsedMin: 0,
  cloudCover: 0,
  nightRhFloor: 0,
  ozoneIndex: 0,
  midnightAcRejectorBoost: 0,
  coastalFloodM: 0,
  postStormRhBoost: 0,
  batteryIntensity: 1,
};

export function mergeForcing(patch: Partial<PhysicsForcing> | null | undefined): PhysicsForcing {
  return {
    ...DEFAULT_PHYSICS_FORCING,
    ...(patch ?? {}),
    seaBreezeScale: clamp(patch?.seaBreezeScale ?? 1, 0, 1.4),
    acGridFailure: clamp(patch?.acGridFailure ?? 0, 0, 1),
    blackoutElapsedMin: clamp(patch?.blackoutElapsedMin ?? 0, 0, 240),
    cloudCover: clamp(patch?.cloudCover ?? 0, 0, 1),
    nightRhFloor: clamp(patch?.nightRhFloor ?? 0, 0, 0.99),
    ozoneIndex: clamp(patch?.ozoneIndex ?? 0, 0, 1),
    midnightAcRejectorBoost: clamp(patch?.midnightAcRejectorBoost ?? 0, 0, 3),
    coastalFloodM: clamp(patch?.coastalFloodM ?? 0, 0, 3),
    postStormRhBoost: clamp(patch?.postStormRhBoost ?? 0, 0, 0.2),
    batteryIntensity: clamp(patch?.batteryIntensity ?? 1, 0.5, 2.5),
  };
}
