import { mulberry32, clamp } from "../utils";
import { specForCode } from "./parse";
import type { DelayedOccupancySample } from "./types";
import type { HospitalCode } from "../types";

/** Ward census typically lags the public A&E wait board by one 15-minute CMS cycle. */
export const OCCUPANCY_LAG_MS = 15 * 60 * 1000;

export function delayedCmsOccupancy(args: {
  code: HospitalCode;
  waitCat3Minutes: number | null;
  waitCat45Minutes: number | null;
  nowMs: number;
  waitBoardMs: number;
}): DelayedOccupancySample {
  const asOfMs = args.waitBoardMs - OCCUPANCY_LAG_MS;
  const bin = Math.floor(asOfMs / OCCUPANCY_LAG_MS);
  const rng = mulberry32(hashCode(args.code) ^ (bin * 2654435761));
  const spec = specForCode(args.code);
  const t3h = (args.waitCat3Minutes ?? 25) / 60;
  const t45h = (args.waitCat45Minutes ?? 90) / 60;
  const waitPressure = clamp(t3h * 0.12 + t45h * 0.018, 0, 0.22);
  const hourHkt = ((asOfMs + 8 * 3600 * 1000) / 3600_000) % 24;
  const evening = Math.exp(-0.5 * ((hourHkt - 21.2) / 2.4) ** 2);
  const occupancyFrac = clamp(
    spec.baselineOccupancy + waitPressure + 0.035 * evening + (rng() - 0.5) * 0.03,
    0.62,
    1.28,
  );
  const throughput = spec.edServers * spec.muPerHour;
  const cat1PerHour = round1(throughput * 0.03 * (0.85 + 0.3 * rng()));
  const cat2PerHour = round1(throughput * 0.14 * (0.85 + 0.3 * rng()));
  const cat3PerHour = round1(throughput * 0.55 * (0.85 + 0.3 * rng()));
  return {
    code: args.code,
    occupancyFrac: round3(occupancyFrac),
    cat1PerHour,
    cat2PerHour,
    cat3PerHour,
    asOf: new Date(asOfMs).toISOString(),
  };
}

function hashCode(code: HospitalCode): number {
  return code.split("").reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) | 0, 0);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
