/**
 * HA / DH executive briefing: population at risk, projected bed deficit, ROI/$ .
 * Costs are Kowloon West operational priors in HKD, not patient-level records.
 */
import type { BuildingFeature, PolicyImpact, PolicyState, SystemHourSnapshot } from "./types";
import { HOSPITALS } from "./hospitals";
import { haBedDeficitBeds } from "./hospital-triage";
import { clamp } from "./utils";

/** Cool-roof retrofit, HKD per m² of roof (HA / EMSD-scale albedo package). */
export const COOL_ROOF_HKD_PER_M2 = 480;
/** Night cooling-shelter staffing + venue, HKD per facility-night. */
export const SHELTER_NIGHT_HKD = 18_000;
/** DHC / CGAT outreach, HKD per percentage-point of nurse dispatch. */
export const DHC_HKD_PER_OUTREACH_PCT = 2_400;
/** Emergency ambulance inter-hospital transfer, HKD per boarded patient. */
export const AMBULANCE_TRANSFER_HKD = 2_150;
/** Mean HA Cat 1–3 ED episode cost, HKD. */
export const HA_ED_EPISODE_HKD = 12_800;
/** Acute medical bed-day, HKD. */
export const HA_BED_DAY_HKD = 5_600;
/** Street-tree / canopy programme, HKD per percentage-point of cover. */
export const CANOPY_HKD_PER_PCT = 92_000;
/** Municipal AC efficiency grant, HKD per subdivided unit at 100% uptake. */
export const AC_GRANT_MUNICIPAL_HKD_PER_UNIT = 3_600;
/** Household copay on an efficiency grant, HKD per subdivided unit at 100% uptake. */
export const AC_GRANT_HOUSEHOLD_HKD_PER_UNIT = 1_200;
/** Occupants per subdivided unit used to turn residents into grant-eligible flats. */
export const SUBDIVIDED_OCCUPANTS_PER_UNIT = 2.8;

export const CVI_AT_RISK = 70;
export const INDOOR_TA_AT_RISK_C = 32;
export const INDOOR_WBGT_AT_RISK_C = 28;

export interface InterventionSpend {
  coolRoofHkd: number;
  sheltersHkd: number;
  dhcHkd: number;
  ambulanceHkd: number;
  canopyHkd: number;
  acGrantMunicipalHkd: number;
  acGrantHouseholdHkd: number;
  municipalHkd: number;
  householdHkd: number;
  totalHkd: number;
}

export interface BenefitBreakdown {
  avertedAdmissionsHkd: number;
  bedDaysSaved: number;
  bedDaysSavedHkd: number;
  totalHkd: number;
}

export interface HospitalTransferRow {
  code: string;
  nameEn: string;
  nameZh: string;
  occupancyPre: number;
  occupancyPost: number;
  transferredIn: number;
  transferredOut: number;
  bedDeficitBeds: number;
}

export interface ExecutiveBriefing {
  generatedAt: string;
  hour: number;
  scenarioName: string;
  populationAtRisk: number;
  populationCatchment: number;
  populationAtRiskPct: number;
  projectedHaBedDeficitBeds: number;
  projectedHaBedDeficit24hMean: number;
  hospitals: HospitalTransferRow[];
  totalTransferred: number;
  remainingUnplaced: number;
  spend: InterventionSpend;
  benefit: BenefitBreakdown;
  roiPerInterventionDollar: number;
  hourlyScenarioArrivals: number[];
  hourlyBaselineArrivals: number[];
  hourlyScenarioBedDeficitBeds: number[];
}

export function populationAtRisk(
  snapshot: SystemHourSnapshot,
  buildings: BuildingFeature[],
): number {
  const byId = new Map(buildings.map((b) => [b.properties.id, b]));
  let residents = 0;
  for (const state of snapshot.buildings) {
    const feature = byId.get(state.buildingId);
    if (!feature) continue;
    if (
      state.cvi >= CVI_AT_RISK ||
      state.indoorTa >= INDOOR_TA_AT_RISK_C ||
      state.indoorWbgt >= INDOOR_WBGT_AT_RISK_C
    ) {
      residents += feature.properties.estimatedResidents;
    }
  }
  return residents;
}

export function estimatedSubdividedUnits(buildings: BuildingFeature[]): number {
  return buildings.reduce((sum, b) => {
    const occupants = b.properties.estimatedResidents * b.properties.subdividedFlatDensity;
    return sum + occupants / SUBDIVIDED_OCCUPANTS_PER_UNIT;
  }, 0);
}

export function interventionSpend(
  policy: PolicyState,
  transferredPatients: number,
  buildings: BuildingFeature[] = [],
): InterventionSpend {
  const coolRoofHkd = Math.max(0, policy.coolRoofBudgetM2) * COOL_ROOF_HKD_PER_M2;
  const sheltersHkd = Math.max(0, policy.coolingShelters) * SHELTER_NIGHT_HKD;
  const dhcHkd = Math.max(0, policy.dhcOutreach) * DHC_HKD_PER_OUTREACH_PCT;
  const ambulanceHkd = Math.max(0, transferredPatients) * AMBULANCE_TRANSFER_HKD;
  const canopyHkd = Math.max(0, policy.canopyGreeneryPercent ?? 0) * CANOPY_HKD_PER_PCT;
  const grantFrac = clamp((policy.acEfficiencyGrantPct ?? 0) / 100, 0, 1);
  const units = estimatedSubdividedUnits(buildings);
  const acGrantMunicipalHkd = AC_GRANT_MUNICIPAL_HKD_PER_UNIT * units * grantFrac;
  const acGrantHouseholdHkd = AC_GRANT_HOUSEHOLD_HKD_PER_UNIT * units * grantFrac;
  const municipalHkd = coolRoofHkd + sheltersHkd + dhcHkd + ambulanceHkd + canopyHkd + acGrantMunicipalHkd;
  const householdHkd = acGrantHouseholdHkd;
  return {
    coolRoofHkd,
    sheltersHkd,
    dhcHkd,
    ambulanceHkd,
    canopyHkd,
    acGrantMunicipalHkd,
    acGrantHouseholdHkd,
    municipalHkd,
    householdHkd,
    totalHkd: municipalHkd + householdHkd,
  };
}

export function benefitFromImpact(impact: PolicyImpact): BenefitBreakdown {
  const baselineMean =
    (impact.hourlyBaselineBedDeficitBeds?.reduce((s, n) => s + n, 0) ?? 0) /
    Math.max(1, impact.hourlyBaselineBedDeficitBeds?.length ?? 1);
  const scenarioMean =
    (impact.hourlyScenarioBedDeficitBeds?.reduce((s, n) => s + n, 0) ?? 0) /
    Math.max(1, impact.hourlyScenarioBedDeficitBeds?.length ?? 1);
  const bedDaysSaved = Math.max(0, baselineMean - scenarioMean);
  const avertedAdmissionsHkd = Math.max(0, impact.admissionsAverted) * HA_ED_EPISODE_HKD;
  const bedDaysSavedHkd = bedDaysSaved * HA_BED_DAY_HKD;
  return {
    avertedAdmissionsHkd,
    bedDaysSaved,
    bedDaysSavedHkd,
    totalHkd: avertedAdmissionsHkd + bedDaysSavedHkd,
  };
}

export function roiPerDollar(benefitHkd: number, spendHkd: number): number {
  if (spendHkd <= 1e-6) return benefitHkd > 0 ? Number.POSITIVE_INFINITY : 0;
  return benefitHkd / spendHkd;
}

export function compileExecutiveBriefing(args: {
  snapshot: SystemHourSnapshot;
  buildings: BuildingFeature[];
  impact: PolicyImpact;
  policy: PolicyState;
  scenarioName?: string;
  generatedAt?: string;
}): ExecutiveBriefing {
  const pop = populationAtRisk(args.snapshot, args.buildings);
  const catchment = args.buildings.reduce((s, b) => s + b.properties.estimatedResidents, 0);
  const spend = interventionSpend(args.policy, args.snapshot.triage?.totalTransferred ?? 0, args.buildings);
  const benefit = benefitFromImpact(args.impact);
  const deficit24 =
    (args.impact.hourlyScenarioBedDeficitBeds?.reduce((s, n) => s + n, 0) ?? 0) /
    Math.max(1, args.impact.hourlyScenarioBedDeficitBeds?.length ?? 1);
  return {
    generatedAt: args.generatedAt ?? new Date().toISOString(),
    hour: args.snapshot.hour,
    scenarioName: args.scenarioName ?? "Live HKO twin",
    populationAtRisk: pop,
    populationCatchment: catchment,
    populationAtRiskPct: catchment > 0 ? (100 * pop) / catchment : 0,
    projectedHaBedDeficitBeds: haBedDeficitBeds(args.snapshot.hospitals),
    projectedHaBedDeficit24hMean: deficit24,
    hospitals: args.snapshot.hospitals.map((h) => {
      const spec = HOSPITALS.find((s) => s.code === h.code);
      return {
        code: h.code,
        nameEn: h.nameEn,
        nameZh: h.nameZh,
        occupancyPre: h.occupancyPreTransfer,
        occupancyPost: h.occupancyPostTransfer,
        transferredIn: h.transferredIn,
        transferredOut: h.transferredOut,
        bedDeficitBeds: Math.max(0, h.bedOccupancy - 1) * (spec?.staffedAcuteBeds ?? 0),
      };
    }),
    totalTransferred: args.snapshot.triage?.totalTransferred ?? 0,
    remainingUnplaced: args.snapshot.triage?.remainingUnplaced ?? 0,
    spend,
    benefit,
    roiPerInterventionDollar: roiPerDollar(benefit.totalHkd, spend.totalHkd),
    hourlyScenarioArrivals: args.impact.hourlyScenarioArrivals ?? [],
    hourlyBaselineArrivals: args.impact.hourlyBaselineArrivals ?? [],
    hourlyScenarioBedDeficitBeds: args.impact.hourlyScenarioBedDeficitBeds ?? [],
  };
}

export function formatHkd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `HK$ ${Math.round(n).toLocaleString("en-HK")}`;
}

export function formatRoi(roi: number): string {
  if (!Number.isFinite(roi)) return "∞";
  return `${roi.toFixed(2)}×`;
}
