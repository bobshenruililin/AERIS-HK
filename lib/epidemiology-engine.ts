import type {
  BuildingFeature,
  BuildingHourState,
  CviRiskTier,
  HkoHeatStatus,
  HospitalHourState,
  PolicyImpact,
  PolicyState,
  QueueMetrics,
  SystemHourSnapshot,
  TriageMix,
} from "./types";
import { BASELINE_POLICY } from "./types";
import {
  CVI_HIGH_MAX,
  CVI_LOW_MAX,
  CVI_MODERATE_MAX,
  CATCHMENT_POPULATION,
} from "./constants";
import { HOSPITALS, type HospitalSpec } from "./hospitals";
import { solarRadiationIndex } from "./solar";
import { clamp, lerp, wrapHour } from "./utils";
import { getBuildings } from "./spatial-data";
import type { HkoDiurnalEnvelope } from "./hko/types";
import { sampleHkoEnvelope } from "./hko/envelope";
import type { HaNowcast } from "./ha/types";

const STEFAN_LINEAR_HR = 4.7;
const LEWIS_RATIO = 16.5;
const SKIN_WETTED_MAX = 0.85;
const MET_RESTING = 58;

function satVaporKpa(tempC: number): number {
  return 0.6108 * Math.exp((17.27 * tempC) / (tempC + 237.3));
}

function stullWetBulb(ta: number, rhFrac: number): number {
  const rh = clamp(rhFrac * 100, 5, 99);
  return (
    ta * Math.atan(0.151977 * Math.sqrt(rh + 8.313659)) +
    Math.atan(ta + rh) -
    Math.atan(rh - 1.676331) +
    0.00391838 * rh ** 1.5 * Math.atan(0.023101 * rh) -
    4.686035
  );
}

function relativeHumidity(hour: number, envelope: HkoDiurnalEnvelope | null): number {
  if (envelope) {
    return clamp(sampleHkoEnvelope(envelope, hour).rhFrac, 0.25, 0.99);
  }
  const h = wrapHour(hour);
  const nightBoost = 0.5 + 0.5 * Math.cos(((h - 4) * Math.PI) / 12);
  return clamp(0.7 + 0.12 * nightBoost, 0.4, 0.95);
}

/**
 * Local albedo coverage for a footprint: 1 if the optimiser targeted it,
 * otherwise the uniform 0–50% slider when no targeting set is active.
 */
export function localCoolRoofFraction(building: BuildingFeature, policy: PolicyState): number {
  const targets = policy.coolRoofTargetIds;
  if (targets && targets.length > 0) {
    return targets.includes(building.properties.id) ? 1 : 0;
  }
  return clamp(policy.coolRoofPercent / 50, 0, 1);
}

function regionalAirTemp(hour: number, coolRoofPercent: number, envelope: HkoDiurnalEnvelope | null): number {
  const h = wrapHour(hour);
  const roofCool = 1.15 * (coolRoofPercent / 50);
  if (envelope) {
    return sampleHkoEnvelope(envelope, h).airTempC - roofCool * 0.55;
  }
  const cosine = Math.cos((2 * Math.PI * (h - 15.05)) / 24);
  return 29.2 - roofCool * 0.55 + (2.4 - roofCool * 0.45) * cosine;
}

function effectiveAcHeat(building: BuildingFeature, policy: PolicyState): number {
  const deflect = policy.acDeflectionBylaw ? 0.58 : 1;
  const roof = 1 - 0.18 * localCoolRoofFraction(building, policy);
  return building.properties.acAnthropogenicHeat * deflect * roof;
}

export function thermalLagHours(building: BuildingFeature, policy: PolicyState): number {
  return 6 * building.properties.subdividedFlatDensity * (effectiveAcHeat(building, policy) / 180);
}

function canyonAirTemp(
  hour: number,
  building: BuildingFeature,
  policy: PolicyState,
  envelope: HkoDiurnalEnvelope | null,
): number {
  const regional = regionalAirTemp(hour, policy.coolRoofPercent, envelope);
  const ac = effectiveAcHeat(building, policy);
  const canyon =
    1.55 * building.properties.ventilationBlockage +
    0.0145 * ac +
    0.9 * building.properties.subdividedFlatDensity;
  return regional + canyon;
}

function nightShelterRelief(hour: number, policy: PolicyState): number {
  const h = wrapHour(hour);
  const night = h >= 19 || h <= 6 ? 1 : h >= 17 ? (h - 17) / 2 : h <= 8 ? (8 - h) / 2 : 0;
  return (policy.coolingShelters / 30) * 0.46 * clamp(night, 0, 1);
}

export function indoorAirTemp(
  hour: number,
  building: BuildingFeature,
  policy: PolicyState,
  envelope: HkoDiurnalEnvelope | null = null,
): number {
  const lag = thermalLagHours(building, policy);
  const laggedCanyon = canyonAirTemp(hour - lag, building, policy, envelope);
  const liveCanyon = canyonAirTemp(hour, building, policy, envelope);
  const trap =
    2.55 * building.properties.subdividedFlatDensity +
    0.012 * effectiveAcHeat(building, policy) +
    0.85 * building.properties.ventilationBlockage -
    1.8 * localCoolRoofFraction(building, policy);
  const mass = 0.38 + 0.52 * building.properties.subdividedFlatDensity;
  const fabric = mass * (laggedCanyon + trap * 0.42) + (1 - mass) * liveCanyon;
  const shelter = nightShelterRelief(hour, policy);
  const shelteredMix = lerp(fabric, 27.4, shelter * 0.72);
  return shelteredMix;
}

function globeTemp(ta: number, hour: number, blockage: number): number {
  const solar = solarRadiationIndex(hour);
  return ta + 6.4 * solar * (0.35 + 0.65 * blockage) + 1.15 * blockage;
}

function convectiveCoefficient(velocityMs: number): number {
  return 10.45 - velocityMs + 10 * Math.sqrt(Math.max(0.05, velocityMs));
}

export function gaggeTwoNode(
  hour: number,
  building: BuildingFeature,
  policy: PolicyState,
  indoorTa: number,
  outdoorTa: number,
  envelope: HkoDiurnalEnvelope | null = null,
): BuildingHourState["gagge"] {
  const h = wrapHour(hour);
  const elderlyMet = lerp(1.0, 0.86, building.properties.elderlyRatio);
  const nightMet = h >= 22 || h <= 6 ? 0.92 : 1.0;
  const M = MET_RESTING * elderlyMet * nightMet;
  const W = 0;
  const vAir =
    0.12 +
    0.95 * (1 - building.properties.ventilationBlockage) * (0.4 + 0.6 * solarRadiationIndex(h));
  const hc = convectiveCoefficient(vAir);
  const Tsk = 35.7 - 0.027 * M + 0.18 * building.properties.subdividedFlatDensity;
  const Tr = globeTemp(indoorTa, h, building.properties.ventilationBlockage);
  const C = hc * (Tsk - indoorTa);
  const R = STEFAN_LINEAR_HR * (Tsk - Tr);
  const rh = relativeHumidity(h, envelope);
  const Pa = rh * satVaporKpa(indoorTa);
  const Psk = satVaporKpa(Tsk);
  const he = LEWIS_RATIO * hc;
  const eMax = Math.max(4, he * (Psk - Pa));
  const eDiff = 0.06 * eMax;
  const requiredEvap = Math.max(0, M - W - eDiff - R - C);
  const eRsw = Math.min(SKIN_WETTED_MAX * eMax, requiredEvap);
  const E = eDiff + eRsw;
  const S = M - W - E - R - C;
  const Tcr = 36.78 + 0.038 * S + 0.055 * Math.max(0, indoorTa - 28) + 0.012 * Math.max(0, outdoorTa - 32);
  return {
    metabolicRate: M,
    externalWork: W,
    evaporativeLoss: E,
    radiativeLoss: R,
    convectiveLoss: C,
    heatStorage: S,
    skinTempC: Tsk,
    coreTempC: Tcr,
    airVelocityMs: vAir,
  };
}

function wbgtOutdoor(ta: number, tw: number, tg: number): number {
  return 0.7 * tw + 0.2 * tg + 0.1 * ta;
}

function wbgtIndoor(ta: number, tw: number, tg: number): number {
  return 0.7 * tw + 0.3 * tg;
}

export function classifyCvi(cvi: number): CviRiskTier {
  if (cvi < CVI_LOW_MAX) return "low";
  if (cvi < CVI_MODERATE_MAX) return "moderate";
  if (cvi < CVI_HIGH_MAX) return "high";
  return "critical";
}

export function buildingCardiovascularIndex(
  microWbgt: number,
  building: BuildingFeature,
  policy: PolicyState,
): number {
  const dhc = clamp(policy.dhcOutreach / 100, 0, 1);
  const elderly = building.properties.elderlyRatio * (1 - 0.34 * dhc);
  const density = building.properties.subdividedFlatDensity;
  const blockage = building.properties.ventilationBlockage * (policy.acDeflectionBylaw ? 0.9 : 1);
  const raw =
    0.35 * (microWbgt / 35) + 0.28 * density + 0.22 * elderly + 0.15 * blockage;
  return clamp(raw * 100, 0, 100);
}

export function bishaiCardiovascularStrain(
  microWbgt: number,
  coreTempC: number,
  building: BuildingFeature,
  policy: PolicyState,
): number {
  const dhc = clamp(policy.dhcOutreach / 100, 0, 1);
  const beta =
    0.029 *
    (1 + 0.85 * building.properties.elderlyRatio) *
    (1 + 0.4 * building.properties.povertyIndex) *
    (1 - 0.3 * dhc);
  const rr = Math.exp(beta * Math.max(0, microWbgt - 26.4) + 0.22 * Math.max(0, coreTempC - 37.2));
  return clamp(100 * (1 - 1 / rr), 0, 100);
}

export function evaluateBuildingAtHour(
  building: BuildingFeature,
  hour: number,
  policy: PolicyState,
  envelope: HkoDiurnalEnvelope | null = null,
): BuildingHourState {
  const outdoorTa = canyonAirTemp(hour, building, policy, envelope);
  const indoorTa = indoorAirTemp(hour, building, policy, envelope);
  const rh = relativeHumidity(hour, envelope);
  const twOut = stullWetBulb(outdoorTa, rh);
  const twIn = stullWetBulb(indoorTa, Math.min(0.92, rh + 0.04));
  const tgOut = globeTemp(outdoorTa, hour, building.properties.ventilationBlockage);
  const tgIn = globeTemp(indoorTa, hour, 0.85);
  const canyonWbgt = wbgtOutdoor(outdoorTa, twOut, tgOut);
  const indoorWbgt = wbgtIndoor(indoorTa, twIn, tgIn);
  const microWbgt = 0.68 * indoorWbgt + 0.32 * canyonWbgt;
  const gagge = gaggeTwoNode(hour, building, policy, indoorTa, outdoorTa, envelope);
  const cvi = buildingCardiovascularIndex(microWbgt, building, policy);
  return {
    buildingId: building.properties.id,
    hour: wrapHour(hour),
    outdoorTa,
    indoorTa,
    globeTemp: tgIn,
    wetBulbTemp: twIn,
    canyonWbgt,
    indoorWbgt,
    microWbgt,
    cvi,
    cviTier: classifyCvi(cvi),
    gagge,
    thermalLagHours: thermalLagHours(building, policy),
    cardiovascularStrain: bishaiCardiovascularStrain(microWbgt, gagge.coreTempC, building, policy),
  };
}

function interpolateBuildingState(
  a: BuildingHourState,
  b: BuildingHourState,
  t: number,
  hour: number,
): BuildingHourState {
  const mix = (x: number, y: number) => lerp(x, y, t);
  const microWbgt = mix(a.microWbgt, b.microWbgt);
  const cvi = mix(a.cvi, b.cvi);
  return {
    ...a,
    hour,
    outdoorTa: mix(a.outdoorTa, b.outdoorTa),
    indoorTa: mix(a.indoorTa, b.indoorTa),
    globeTemp: mix(a.globeTemp, b.globeTemp),
    wetBulbTemp: mix(a.wetBulbTemp, b.wetBulbTemp),
    canyonWbgt: mix(a.canyonWbgt, b.canyonWbgt),
    indoorWbgt: mix(a.indoorWbgt, b.indoorWbgt),
    microWbgt,
    cvi,
    cviTier: classifyCvi(cvi),
    cardiovascularStrain: mix(a.cardiovascularStrain, b.cardiovascularStrain),
    gagge: {
      metabolicRate: mix(a.gagge.metabolicRate, b.gagge.metabolicRate),
      externalWork: mix(a.gagge.externalWork, b.gagge.externalWork),
      evaporativeLoss: mix(a.gagge.evaporativeLoss, b.gagge.evaporativeLoss),
      radiativeLoss: mix(a.gagge.radiativeLoss, b.gagge.radiativeLoss),
      convectiveLoss: mix(a.gagge.convectiveLoss, b.gagge.convectiveLoss),
      heatStorage: mix(a.gagge.heatStorage, b.gagge.heatStorage),
      skinTempC: mix(a.gagge.skinTempC, b.gagge.skinTempC),
      coreTempC: mix(a.gagge.coreTempC, b.gagge.coreTempC),
      airVelocityMs: mix(a.gagge.airVelocityMs, b.gagge.airVelocityMs),
    },
  };
}

export function evaluateBuildingInterpolated(
  building: BuildingFeature,
  hour: number,
  policy: PolicyState,
  cache?: Map<string, BuildingHourState>,
  envelope: HkoDiurnalEnvelope | null = null,
): BuildingHourState {
  const h = wrapHour(hour);
  const h0 = Math.floor(h);
  const h1 = (h0 + 1) % 24;
  const t = h - h0;
  if (t < 1e-6) {
    return cache?.get(`${building.properties.id}:${h0}`) ?? evaluateBuildingAtHour(building, h0, policy, envelope);
  }
  const a = cache?.get(`${building.properties.id}:${h0}`) ?? evaluateBuildingAtHour(building, h0, policy, envelope);
  const b = cache?.get(`${building.properties.id}:${h1}`) ?? evaluateBuildingAtHour(building, h1, policy, envelope);
  return interpolateBuildingState(a, b, t, h);
}

function factorialTermProduct(lambdaOverMu: number, n: number): number {
  let term = 1;
  for (let i = 1; i <= n; i += 1) {
    term *= lambdaOverMu / i;
  }
  return term;
}

export function mmcQueue(lambda: number, mu: number, servers: number): QueueMetrics {
  const c = Math.max(1, servers);
  if (lambda <= 0.001) {
    return { lambda, mu, servers: c, utilization: 0, probabilityWait: 0, queueLength: 0, waitHours: 0 };
  }
  const rho = lambda / (c * mu);
  if (rho >= 0.995) {
    return {
      lambda,
      mu,
      servers: c,
      utilization: 0.995,
      probabilityWait: 0.99,
      queueLength: 28,
      waitHours: 2.4,
    };
  }
  let sum = 0;
  for (let n = 0; n < c; n += 1) {
    sum += factorialTermProduct(lambda / mu, n);
  }
  const last = factorialTermProduct(lambda / mu, c);
  const p0 = 1 / (sum + last / (1 - rho));
  const probabilityWait = (last / (1 - rho)) * p0;
  const queueLength = probabilityWait * (rho / (1 - rho));
  const waitHours = queueLength / lambda;
  return {
    lambda,
    mu,
    servers: c,
    utilization: rho,
    probabilityWait,
    queueLength,
    waitHours,
  };
}

function diurnalEdFactor(hour: number): number {
  const h = wrapHour(hour);
  const morning = Math.exp(-0.5 * ((h - 10.2) / 1.7) ** 2);
  const evening = Math.exp(-0.5 * ((h - 21.4) / 2.1) ** 2);
  const night = h >= 1 && h <= 5 ? 0.72 : 1;
  return (0.78 + 0.55 * morning + 0.7 * evening) * night;
}

function heatRelativeRisk(state: BuildingHourState, building: BuildingFeature, policy: PolicyState): number {
  const dhc = policy.dhcOutreach / 100;
  const cviTerm = 1 + 1.92 * (state.cvi / 100) ** 1.32;
  const strainTerm = 1 + 0.008 * state.cardiovascularStrain;
  const poverty = 1 + 0.22 * building.properties.povertyIndex;
  return cviTerm * strainTerm * poverty * (1 - 0.22 * dhc);
}

export function hourlyArrivalsForBuilding(
  building: BuildingFeature,
  state: BuildingHourState,
  policy: PolicyState,
): number {
  const baseline = (building.properties.baselineCVDPrevalence / 1000) * building.properties.estimatedResidents;
  const perHour = baseline / 24;
  return perHour * diurnalEdFactor(state.hour) * heatRelativeRisk(state, building, policy);
}

function splitTriage(total: number, cviMean: number): TriageMix {
  const c1 = 0.055 + 0.09 * (cviMean / 100);
  const c2 = 0.24 + 0.12 * (cviMean / 100);
  const c3 = 1 - c1 - c2;
  return {
    category1: total * c1,
    category2: total * c2,
    category3: total * c3,
    total,
  };
}

export function calibrateEdServers(
  lambda: number,
  mu: number,
  targetWaitHours: number,
  hint: number,
): number {
  const lo = Math.max(4, hint - 10);
  const hi = Math.min(40, hint + 16);
  let best = Math.max(1, hint);
  let bestScore = Number.POSITIVE_INFINITY;
  for (let c = lo; c <= hi; c += 1) {
    const q = mmcQueue(lambda, mu, c);
    const waitErr = Math.abs(q.waitHours - Math.max(0, targetWaitHours));
    const satPen = q.utilization >= 0.995 ? 4 : 0;
    const score = waitErr * 12 + satPen;
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

function evaluateHospital(
  spec: HospitalSpec,
  hour: number,
  buildingStates: BuildingHourState[],
  buildings: BuildingFeature[],
  policy: PolicyState,
  nowcast: HaNowcast | null,
): HospitalHourState {
  const byId = new Map(buildings.map((b) => [b.properties.id, b]));
  let lambda = 0;
  let cviAcc = 0;
  let cviW = 0;
  for (const state of buildingStates) {
    const building = byId.get(state.buildingId);
    if (!building) continue;
    const w = spec.catchmentWeight[building.properties.district];
    const arrivals = hourlyArrivalsForBuilding(building, state, policy) * w;
    lambda += arrivals;
    cviAcc += state.cvi * arrivals;
    cviW += arrivals;
  }
  const cviMean = cviW > 0 ? cviAcc / cviW : 50;
  const observed = nowcast?.hospitals.find((h) => h.code === spec.code) ?? null;
  const arrivals = observed
    ? {
        category1: lambda * observed.mix.p1,
        category2: lambda * observed.mix.p2,
        category3: lambda * observed.mix.p3,
        total: lambda,
      }
    : splitTriage(lambda, cviMean);
  const mu = observed?.muPerHour ?? spec.muPerHour;
  const waitHours =
    observed?.waitCat3P50Minutes != null ? observed.waitCat3P50Minutes / 60 : null;
  const servers =
    waitHours != null ? calibrateEdServers(lambda, mu, waitHours, spec.edServers) : spec.edServers;
  const edQueue = mmcQueue(lambda, mu, servers);
  const admittedShare = 0.38 + 0.22 * (cviMean / 100);
  const modelledOcc =
    spec.baselineOccupancy + (admittedShare * lambda * 14) / spec.staffedAcuteBeds;
  const nearNow =
    Boolean(nowcast) && Math.abs(wrapHour(hour) - wrapHour(nowcast?.nowHour ?? hour)) < 0.85;
  const occupancySource = observed && nearNow ? ("delayed-nowcast" as const) : ("model" as const);
  const occupancy = occupancySource === "delayed-nowcast" ? observed!.occupancyFrac : modelledOcc;
  const bedOccupancy = clamp(occupancy, 0.4, 1.35);
  const bedDeficitPct = Math.max(0, (bedOccupancy - 1) * 100);
  const waitPenalty = 0.55 * Math.max(0, edQueue.waitHours);
  const occPenalty = 0.9 * Math.max(0, bedOccupancy - 0.85);
  const cviPenalty = 0.012 * Math.max(0, cviMean - 40);
  const dhcGuard = 1 - 0.18 * (policy.dhcOutreach / 100);
  const relativeMortalityIndex = (1 + waitPenalty + occPenalty + cviPenalty) * dhcGuard;
  return {
    code: spec.code,
    nameEn: spec.nameEn,
    nameZh: spec.nameZh,
    hour: wrapHour(hour),
    arrivals,
    edQueue,
    bedOccupancy,
    bedDeficitPct,
    relativeMortalityIndex,
    calibratedMu: mu,
    calibratedServers: servers,
    occupancySource,
    waitCat3P50Minutes: observed?.waitCat3P50Minutes ?? null,
    nowcastDelayMinutes: observed?.occupancyDelayMinutes ?? null,
  };
}

export function inferHkoHeatStatus(meanWbgt: number, meanOutdoorTa: number): HkoHeatStatus {
  if (meanWbgt >= 33.2 || meanOutdoorTa >= 36) return "SPECIAL_HEAT_STRESS_BLACK";
  if (meanWbgt >= 31.2 || meanOutdoorTa >= 34.2) return "EXTREME_HEAT_AMBER";
  if (meanWbgt >= 28.4 || meanOutdoorTa >= 32.4) return "VERY_HOT_WEATHER_WARNING";
  return "NORMAL";
}

export function resolveHeatStatus(
  meanWbgt: number,
  meanOutdoorTa: number,
  envelope: HkoDiurnalEnvelope | null,
): HkoHeatStatus {
  const analogue = inferHkoHeatStatus(meanWbgt, meanOutdoorTa);
  if (!envelope) return analogue;
  if (envelope.warning.veryHotWeatherWarning) {
    return analogue === "NORMAL" ? "VERY_HOT_WEATHER_WARNING" : analogue;
  }
  if (analogue === "VERY_HOT_WEATHER_WARNING") return "NORMAL";
  return analogue;
}

export function evaluateSystemAtHour(
  hour: number,
  policy: PolicyState,
  buildings: BuildingFeature[] = getBuildings(),
  cache?: Map<string, BuildingHourState>,
  envelope: HkoDiurnalEnvelope | null = null,
  nowcast: HaNowcast | null = null,
): SystemHourSnapshot {
  const buildingStates = buildings.map((b) => evaluateBuildingInterpolated(b, hour, policy, cache, envelope));
  const hospitals = HOSPITALS.map((spec) =>
    evaluateHospital(spec, hour, buildingStates, buildings, policy, nowcast),
  );
  const regionalMeanWbgt =
    buildingStates.reduce((s, b) => s + b.microWbgt, 0) / Math.max(1, buildingStates.length);
  const regionalMeanCvi =
    buildingStates.reduce((s, b) => s + b.cvi, 0) / Math.max(1, buildingStates.length);
  const meanOutdoor =
    buildingStates.reduce((s, b) => s + b.outdoorTa, 0) / Math.max(1, buildingStates.length);
  const clusterBedStress =
    hospitals.reduce((s, h) => s + h.bedOccupancy, 0) / Math.max(1, hospitals.length);
  const totalCat13Arrivals = hospitals.reduce((s, h) => s + h.arrivals.total, 0);
  return {
    hour: wrapHour(hour),
    buildings: buildingStates,
    hospitals,
    regionalMeanWbgt,
    regionalMeanCvi,
    hkoStatus: resolveHeatStatus(regionalMeanWbgt, meanOutdoor, envelope),
    clusterBedStress,
    totalCat13Arrivals,
  };
}

export function precomputeHourlyCache(
  policy: PolicyState,
  buildings: BuildingFeature[] = getBuildings(),
  envelope: HkoDiurnalEnvelope | null = null,
): Map<string, BuildingHourState> {
  const cache = new Map<string, BuildingHourState>();
  for (const building of buildings) {
    for (let hour = 0; hour < 24; hour += 1) {
      cache.set(`${building.properties.id}:${hour}`, evaluateBuildingAtHour(building, hour, policy, envelope));
    }
  }
  return cache;
}

export function computePolicyImpact(
  policy: PolicyState,
  buildings: BuildingFeature[] = getBuildings(),
  envelope: HkoDiurnalEnvelope | null = null,
  nowcast: HaNowcast | null = null,
): PolicyImpact {
  const baselineCache = precomputeHourlyCache(BASELINE_POLICY, buildings, envelope);
  const scenarioCache = precomputeHourlyCache(policy, buildings, envelope);
  let baselineAdmissions24h = 0;
  let scenarioAdmissions24h = 0;
  let baselineMort = 0;
  let scenarioMort = 0;
  let baselineDef = 0;
  let scenarioDef = 0;

  for (let hour = 0; hour < 24; hour += 1) {
    const base = evaluateSystemAtHour(hour, BASELINE_POLICY, buildings, baselineCache, envelope, nowcast);
    const scen = evaluateSystemAtHour(hour, policy, buildings, scenarioCache, envelope, nowcast);
    baselineAdmissions24h += base.totalCat13Arrivals;
    scenarioAdmissions24h += scen.totalCat13Arrivals;
    const baseMort = base.hospitals.reduce((s, h) => s + h.relativeMortalityIndex, 0) / 3;
    const scenMort = scen.hospitals.reduce((s, h) => s + h.relativeMortalityIndex, 0) / 3;
    baselineMort += baseMort;
    scenarioMort += scenMort;
    baselineDef += base.hospitals.reduce((s, h) => s + h.bedDeficitPct, 0) / 3;
    scenarioDef += scen.hospitals.reduce((s, h) => s + h.bedDeficitPct, 0) / 3;
  }

  baselineMort /= 24;
  scenarioMort /= 24;
  baselineDef /= 24;
  scenarioDef /= 24;

  const admissionsAverted = Math.max(0, baselineAdmissions24h - scenarioAdmissions24h);
  const mortDelta = Math.max(0, baselineMort - scenarioMort);
  const preventableMortalityPer100k =
    (mortDelta * (baselineAdmissions24h * 0.046) * (100000 / CATCHMENT_POPULATION));

  return {
    baselineAdmissions24h,
    scenarioAdmissions24h,
    admissionsAverted,
    baselineBedDeficitPct: baselineDef,
    scenarioBedDeficitPct: scenarioDef,
    bedDeficitAvertedPct: Math.max(0, baselineDef - scenarioDef),
    preventableMortalityPer100k,
    baselineMortalityIndex: baselineMort,
    scenarioMortalityIndex: scenarioMort,
  };
}

export function catchmentWeightedArrivals(
  building: BuildingFeature,
  state: BuildingHourState,
  policy: PolicyState,
): number {
  const arrivals = hourlyArrivalsForBuilding(building, state, policy);
  let weighted = 0;
  for (const spec of HOSPITALS) {
    weighted += arrivals * spec.catchmentWeight[building.properties.district];
  }
  return weighted;
}

export function buildingClusterLoad24h(
  building: BuildingFeature,
  envelope: HkoDiurnalEnvelope | null,
  policy: PolicyState,
): number {
  let total = 0;
  for (let hour = 0; hour < 24; hour += 1) {
    const state = evaluateBuildingAtHour(building, hour, policy, envelope);
    total += catchmentWeightedArrivals(building, state, policy);
  }
  return total;
}

export function cviColor(cvi: number): [number, number, number, number] {
  if (cvi < CVI_LOW_MAX) {
    const t = cvi / CVI_LOW_MAX;
    return [
      Math.round(lerp(16, 52, t)),
      Math.round(lerp(185, 211, t)),
      Math.round(lerp(129, 92, t)),
      210,
    ];
  }
  if (cvi < CVI_MODERATE_MAX) {
    const t = (cvi - CVI_LOW_MAX) / (CVI_MODERATE_MAX - CVI_LOW_MAX);
    return [
      Math.round(lerp(245, 249, t)),
      Math.round(lerp(158, 115, t)),
      Math.round(lerp(11, 22, t)),
      225,
    ];
  }
  const t = clamp((cvi - CVI_MODERATE_MAX) / (100 - CVI_MODERATE_MAX), 0, 1);
  return [
    Math.round(lerp(239, 220, t)),
    Math.round(lerp(68, 20, t)),
    Math.round(lerp(68, 60, t)),
    245,
  ];
}

export function hkoStatusLabel(status: HkoHeatStatus): { en: string; zh: string } {
  switch (status) {
    case "NORMAL":
      return { en: "No Heat Warning", zh: "沒有酷熱警告" };
    case "VERY_HOT_WEATHER_WARNING":
      return { en: "Very Hot Weather Warning", zh: "酷熱天氣警告" };
    case "EXTREME_HEAT_AMBER":
      return { en: "Extreme Heat — Amber", zh: "極端酷熱（黃）" };
    case "SPECIAL_HEAT_STRESS_BLACK":
      return { en: "Special Heat Stress — Black", zh: "特別熱壓力（黑）" };
    default:
      return { en: "Unknown", zh: "未知" };
  }
}
