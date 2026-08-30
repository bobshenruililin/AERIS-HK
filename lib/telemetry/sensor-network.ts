/**
 * Synthetic LoRaWAN indoor thermal mesh: 250 sensors in Sham Shui Po 劏房.
 *
 * Indoor lag kinetics (explicit Euler toward a policy-dependent equilibrium):
 *   T_in^{t+Δt} = T_in^t + (Δt / τ) (T_eq − T_in^t)
 *   τ = 4 h · (0.5 + 0.5 ρ_sub)
 *   T_eq = (1 − α) T_idw + α T_AC     α = 0.82 when the split-type AC is on
 *
 * Night 劏房 battery uses the same τ = 4 h identity as
 * `applySubdividedFlatThermalLag` (lib/biophysics.ts). Deterministic
 * mulberry32 placement — no clock reads on the random path — so SSR, the
 * client, and tests agree given the same stations + hour + policy.
 */

import {
  applySubdividedFlatThermalLag,
  BATTERY_CHARGE_HOUR,
  CONCRETE_THERMAL_BATTERY_TAU_H,
} from "../biophysics";
import { metersPerDegree } from "../crs";
import { DEFAULT_PHYSICS_FORCING, type PhysicsForcing } from "../physics-forcing";
import { buildingCentroid } from "../spatial-data";
import type { BuildingFeature, PolicyState } from "../types";
import { clamp, hashString, lerp, mulberry32, wrapHour } from "../utils";
import {
  HKO_AWS_STATIONS,
  idwInterpolate,
  type HkoStationLive,
  type SpatialWxSample,
} from "./hko-feed";

export const SENSOR_COUNT = 250;
export const LORAWAN_MESH_ID = "ssp-tenement-lorawan";
export const AC_SETPOINT_C = 27.4;
export const AC_MIX = 0.82;
export const LAG_HORIZON_H = 8;
export const LAG_DT_H = 0.25;
export const TWIN_SENSOR_LOD = 6;

export interface LoRaWanSensor {
  id: string;
  lon: number;
  lat: number;
  buildingId: string;
  floor: number;
  indoorC: number;
  ambientC: number;
  acOn: boolean;
  rssiDbm: number;
  uplinkAtMs: number;
  tauH: number;
  subdividedFlatDensity: number;
}

export interface SensorMeshSnapshot {
  meshId: typeof LORAWAN_MESH_ID;
  count: number;
  sensors: LoRaWanSensor[];
  meanIndoorC: number;
  meanAmbientC: number;
  acOnCount: number;
}

function hostBuildings(buildings: BuildingFeature[]): BuildingFeature[] {
  const ssp = buildings.filter(
    (b) =>
      b.properties.district === "Sham Shui Po" && b.properties.subdividedFlatDensity >= 0.35,
  );
  const pool = ssp.length > 0 ? ssp : buildings.filter((b) => b.properties.subdividedFlatDensity >= 0.4);
  const ranked = [...(pool.length > 0 ? pool : buildings)].sort(
    (a, b) => b.properties.subdividedFlatDensity - a.properties.subdividedFlatDensity,
  );
  return ranked;
}

function jitterLonLat(lon: number, lat: number, rng: () => number): { lon: number; lat: number } {
  const { metersPerDegLat, metersPerDegLng } = metersPerDegree(lat);
  const east = (rng() - 0.5) * 14;
  const north = (rng() - 0.5) * 14;
  return {
    lon: lon + east / Math.max(1e-6, metersPerDegLng),
    lat: lat + north / Math.max(1e-6, metersPerDegLat),
  };
}

export function concreteTauH(subdividedFlatDensity: number): number {
  return CONCRETE_THERMAL_BATTERY_TAU_H * (0.5 + 0.5 * clamp(subdividedFlatDensity, 0, 1));
}

export function acOccupied(args: {
  index: number;
  rho: number;
  hour: number;
  policy: PolicyState;
  forcing: PhysicsForcing;
  rng: () => number;
}): boolean {
  if (args.forcing.acGridFailure >= 0.72) return false;
  const h = wrapHour(args.hour);
  const daytime = h >= 10 && h <= 23 ? 1 : 0.28;
  const grant = clamp((args.policy.acEfficiencyGrantPct ?? 0) / 100, 0, 1);
  const p =
    (0.22 + 0.38 * args.rho + 0.28 * grant + (args.policy.acDeflectionBylaw ? 0.06 : 0)) * daytime;
  return args.rng() < clamp(p, 0.04, 0.92);
}

/**
 * Explicit Euler of the fabric lag ODE from (hour − 8 h) to `hour`.
 * Closed enough to a streaming kinetic that SSR and the client stay bit-stable.
 */
export function integrateIndoorLag(args: {
  ambientC: number;
  tauH: number;
  acOn: boolean;
  hour: number;
  rho: number;
  batteryIntensity?: number;
}): number {
  const tEq = args.acOn ? lerp(args.ambientC, AC_SETPOINT_C, AC_MIX) : args.ambientC;
  const tau = Math.max(0.35, args.tauH);
  const steps = Math.round(LAG_HORIZON_H / LAG_DT_H);
  let t = args.ambientC;
  for (let i = 0; i < steps; i += 1) {
    t += (LAG_DT_H / tau) * (tEq - t);
  }
  const chargeEq = args.acOn ? lerp(args.ambientC, AC_SETPOINT_C, AC_MIX * 0.55) : args.ambientC + 1.1 * args.rho;
  const lagged = applySubdividedFlatThermalLag(
    args.hour,
    t,
    chargeEq,
    args.rho,
    args.batteryIntensity ?? 1,
  );
  return lagged.indoorC;
}

export function placeLorawanSensors(buildings: BuildingFeature[]): Array<{
  id: string;
  lon: number;
  lat: number;
  buildingId: string;
  floor: number;
  subdividedFlatDensity: number;
}> {
  const hosts = hostBuildings(buildings);
  if (hosts.length === 0) return [];
  const placed: Array<{
    id: string;
    lon: number;
    lat: number;
    buildingId: string;
    floor: number;
    subdividedFlatDensity: number;
  }> = [];
  for (let i = 0; i < SENSOR_COUNT; i += 1) {
    const host = hosts[i % hosts.length];
    const rng = mulberry32(hashString(`lorawan-${i}-${host.properties.id}`));
    const [clon, clat] = buildingCentroid(host);
    const jitter = jitterLonLat(clon, clat, rng);
    const storeys = Math.max(4, Math.round(host.properties.height / 3.1));
    placed.push({
      id: `LRN-${String(i + 1).padStart(4, "0")}`,
      lon: jitter.lon,
      lat: jitter.lat,
      buildingId: host.properties.id,
      floor: 1 + Math.floor(rng() * storeys),
      subdividedFlatDensity: host.properties.subdividedFlatDensity,
    });
  }
  return placed;
}

function ambientAt(
  stations: readonly HkoStationLive[],
  lon: number,
  lat: number,
  rho: number,
): SpatialWxSample & { ambientC: number } {
  const wx = idwInterpolate(stations, lon, lat);
  const canyon = 0.55 * rho;
  const ambientC = (wx.airTempC ?? 29) + canyon;
  return { ...wx, ambientC };
}

export function sampleSensorMesh(args: {
  stations: readonly HkoStationLive[];
  buildings: BuildingFeature[];
  policy: PolicyState;
  hour: number;
  forcing?: PhysicsForcing;
  pulledAtMs: number;
}): SensorMeshSnapshot {
  const forcing = args.forcing ?? DEFAULT_PHYSICS_FORCING;
  const sites = placeLorawanSensors(args.buildings);
  const sensors: LoRaWanSensor[] = sites.map((site, index) => {
    const rng = mulberry32(hashString(`lorawan-state-${site.id}`));
    const tauH = concreteTauH(site.subdividedFlatDensity);
    const wx = ambientAt(args.stations, site.lon, site.lat, site.subdividedFlatDensity);
    const acOn = acOccupied({
      index,
      rho: site.subdividedFlatDensity,
      hour: args.hour,
      policy: args.policy,
      forcing,
      rng,
    });
    const indoorC = integrateIndoorLag({
      ambientC: wx.ambientC,
      tauH,
      acOn,
      hour: args.hour,
      rho: site.subdividedFlatDensity,
      batteryIntensity: forcing.batteryIntensity,
    });
    const rssiDbm = -72 - Math.floor(rng() * 28) - Math.floor(site.floor * 0.35);
    const uplinkAtMs = args.pulledAtMs - Math.floor(rng() * 90_000);
    return {
      id: site.id,
      lon: site.lon,
      lat: site.lat,
      buildingId: site.buildingId,
      floor: site.floor,
      indoorC,
      ambientC: wx.ambientC,
      acOn,
      rssiDbm,
      uplinkAtMs,
      tauH,
      subdividedFlatDensity: site.subdividedFlatDensity,
    };
  });
  const meanIndoorC =
    sensors.reduce((s, n) => s + n.indoorC, 0) / Math.max(1, sensors.length);
  const meanAmbientC =
    sensors.reduce((s, n) => s + n.ambientC, 0) / Math.max(1, sensors.length);
  return {
    meshId: LORAWAN_MESH_ID,
    count: sensors.length,
    sensors,
    meanIndoorC,
    meanAmbientC,
    acOnCount: sensors.filter((s) => s.acOn).length,
  };
}

/** Synthetic three-station field from a uniform ambient (PREDICTIVE TWIN). */
export function syntheticStationsFromAmbient(
  airTempC: number,
  rhFrac: number,
  pulledAtMs: number,
): HkoStationLive[] {
  const offsets: Record<string, number> = { ssp: 0.18, kp: 0.42, kt: -0.22 };
  return HKO_AWS_STATIONS.map((spec) => ({
    id: spec.id,
    nameEn: spec.nameEn,
    nameZh: spec.nameZh,
    lon: spec.lon,
    lat: spec.lat,
    airTempC: airTempC + (offsets[spec.id] ?? 0),
    rhFrac,
    windDirDeg: 90,
    windSpeedMs: 1.4,
    solarWm2: 640,
    observedAtMs: pulledAtMs,
    sources: ["predictive-twin"],
  }));
}

export function sensorLod(sensors: LoRaWanSensor[], stride = TWIN_SENSOR_LOD): LoRaWanSensor[] {
  return sensors.filter((_, i) => i % stride === 0);
}
