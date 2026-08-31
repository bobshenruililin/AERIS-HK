import type { HkoDiurnalEnvelope } from "@/lib/types";

/** Additive ambient ΔT on the live / scenario HKO envelope (copilot counterfactual). */
export function shiftEnvelopeTemp(
  envelope: HkoDiurnalEnvelope | null,
  deltaC: number,
): HkoDiurnalEnvelope | null {
  if (!envelope || Math.abs(deltaC) < 1e-9) return envelope;
  return {
    ...envelope,
    kowloonAirTempC: envelope.kowloonAirTempC + deltaC,
    hours: envelope.hours.map((row) => ({ ...row, airTempC: row.airTempC + deltaC })),
    stations: envelope.stations.map((station) => ({
      ...station,
      airTempC: station.airTempC == null ? station.airTempC : station.airTempC + deltaC,
    })),
  };
}
