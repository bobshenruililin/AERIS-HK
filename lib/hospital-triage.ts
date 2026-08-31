/**
 * Kowloon West / Central multi-cluster inpatient rebalancing.
 *
 * When Caritas Medical Centre (CMC) or Kwong Wah Hospital (KWH) exceed 120%
 * staffed acute-bed occupancy, excess inpatients are boarded onto Princess
 * Margaret (PMH) and Queen Elizabeth (QEH) along West Kowloon Corridor and
 * Nathan Road. Ambulance particles are WGS84-only (never HK80 eastings).
 */
import type { HospitalCode, HospitalHourState, LoadBalancePlan, LonLat, TransferArterial, TransferLeg } from "./types";
import { HOSPITALS, hospitalByCode } from "./hospitals";
import { clamp } from "./utils";

export const BED_OVERFLOW_THRESHOLD = 1.2;
export const RECEIVER_TARGET_OCCUPANCY = 1.18;
export const PRE_TRANSFER_OCCUPANCY_CAP = 1.45;
export const POST_TRANSFER_OCCUPANCY_CAP = 1.55;
export const PATIENTS_PER_AMBULANCE = 2;

export const LOAD_BALANCE_SOURCES: readonly HospitalCode[] = ["CMC", "KWH"];
export const LOAD_BALANCE_RECEIVERS: readonly HospitalCode[] = ["PMH", "QEH"];

export const EMPTY_LOAD_BALANCE_PLAN: LoadBalancePlan = {
  triggered: false,
  overflowThreshold: BED_OVERFLOW_THRESHOLD,
  sources: [...LOAD_BALANCE_SOURCES],
  receivers: [...LOAD_BALANCE_RECEIVERS],
  legs: [],
  totalTransferred: 0,
  remainingUnplaced: 0,
};

/**
 * West Kowloon Corridor — western Kowloon waterfront expressway, Lai Chi Kok
 * (PMH) south through Tai Kok Tsui / Olympic / Jordan to QEH. WGS84 lon/lat.
 */
export const WEST_KOWLOON_CORRIDOR: LonLat[] = [
  [114.1348, 22.3409],
  [114.1352, 22.337],
  [114.1405, 22.3285],
  [114.1488, 22.3198],
  [114.1575, 22.3132],
  [114.168, 22.3102],
  [114.17472, 22.30948],
];

/** Nathan Road — Mong Kok / Yau Ma Tei / Jordan spine past KWH to QEH. */
export const NATHAN_ROAD: LonLat[] = [
  [114.1702, 22.3228],
  [114.1714, 22.3184],
  [114.17255, 22.31535],
  [114.1734, 22.3124],
  [114.17472, 22.30948],
];

/** CMC west along Cheung Sha Wan Road onto the northern West Kowloon Corridor at PMH. */
const CMC_TO_PMH: LonLat[] = [
  [114.15255, 22.34075],
  [114.1452, 22.3406],
  [114.1388, 22.3408],
  [114.1348, 22.3409],
];

/** CMC south onto West Kowloon Corridor, then the corridor to QEH. */
const CMC_TO_QEH: LonLat[] = [
  [114.15255, 22.34075],
  [114.1482, 22.3362],
  [114.1405, 22.3285],
  [114.1488, 22.3198],
  [114.1575, 22.3132],
  [114.168, 22.3102],
  [114.17472, 22.30948],
];

/** KWH south on Nathan Road to QEH. */
const KWH_TO_QEH: LonLat[] = [
  [114.17255, 22.31535],
  [114.1734, 22.3124],
  [114.17472, 22.30948],
];

/** KWH north on Nathan Road, then west via the corridor to PMH. */
const KWH_TO_PMH: LonLat[] = [
  [114.17255, 22.31535],
  [114.1714, 22.3184],
  [114.1702, 22.3228],
  [114.1655, 22.3265],
  [114.155, 22.3298],
  [114.145, 22.334],
  [114.137, 22.3385],
  [114.1348, 22.3409],
];

export interface AmbulanceParticle {
  id: string;
  lon: number;
  lat: number;
  progress: number;
  from: HospitalCode;
  to: HospitalCode;
  arterial: TransferArterial;
  path: LonLat[];
}

export interface ArterialStroke {
  id: string;
  arterial: TransferArterial;
  path: LonLat[];
  patients: number;
  from: HospitalCode;
  to: HospitalCode;
}

function assertWgs84(pt: LonLat, label: string): void {
  const [lon, lat] = pt;
  if (lon > 200 || lat > 200) {
    throw new Error(`${label} looks like HK80 projected metres (${lon}, ${lat}); Deck.gl getPosition is WGS84 only`);
  }
  if (lon < 113.8 || lon > 114.5 || lat < 22.15 || lat > 22.55) {
    throw new Error(`${label} is outside Kowloon WGS84 (${lon}, ${lat})`);
  }
}

export function assertArterialWgs84(path: LonLat[], label: string): LonLat[] {
  if (path.length < 2) throw new Error(`${label} needs ≥2 vertices`);
  for (const pt of path) assertWgs84(pt, label);
  return path;
}

assertArterialWgs84(WEST_KOWLOON_CORRIDOR, "West Kowloon Corridor");
assertArterialWgs84(NATHAN_ROAD, "Nathan Road");
assertArterialWgs84(CMC_TO_PMH, "CMC→PMH");
assertArterialWgs84(CMC_TO_QEH, "CMC→QEH");
assertArterialWgs84(KWH_TO_QEH, "KWH→QEH");
assertArterialWgs84(KWH_TO_PMH, "KWH→PMH");

export function pathForTransfer(from: HospitalCode, to: HospitalCode): { arterial: TransferArterial; path: LonLat[] } {
  if (from === "CMC" && to === "PMH") return { arterial: "west-kowloon-corridor", path: CMC_TO_PMH };
  if (from === "CMC" && to === "QEH") return { arterial: "west-kowloon-corridor", path: CMC_TO_QEH };
  if (from === "KWH" && to === "QEH") return { arterial: "nathan-road", path: KWH_TO_QEH };
  if (from === "KWH" && to === "PMH") return { arterial: "nathan-road", path: KWH_TO_PMH };
  throw new Error(`No ambulance arterial from ${from} to ${to}`);
}

function polylineLengthM(path: LonLat[]): number {
  let acc = 0;
  for (let i = 1; i < path.length; i += 1) {
    const [lon0, lat0] = path[i - 1];
    const [lon1, lat1] = path[i];
    const dLat = (lat1 - lat0) * 111_320;
    const dLon = (lon1 - lon0) * 111_320 * Math.cos(((lat0 + lat1) * 0.5 * Math.PI) / 180);
    acc += Math.hypot(dLon, dLat);
  }
  return acc;
}

export function pointAlongPolyline(path: LonLat[], t: number): LonLat {
  const u = ((t % 1) + 1) % 1;
  if (path.length === 0) return [114.17, 22.32];
  if (path.length === 1 || u <= 0) return path[0];
  if (u >= 1) return path[path.length - 1];
  const total = polylineLengthM(path);
  let remain = u * total;
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1];
    const b = path[i];
    const dLat = (b[1] - a[1]) * 111_320;
    const dLon = (b[0] - a[0]) * 111_320 * Math.cos(((a[1] + b[1]) * 0.5 * Math.PI) / 180);
    const seg = Math.hypot(dLon, dLat) || 1e-6;
    if (remain <= seg) {
      const f = remain / seg;
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    }
    remain -= seg;
  }
  return path[path.length - 1];
}

function isSource(code: HospitalCode): boolean {
  return (LOAD_BALANCE_SOURCES as readonly string[]).includes(code);
}

function isReceiver(code: HospitalCode): boolean {
  return (LOAD_BALANCE_RECEIVERS as readonly string[]).includes(code);
}

export function excessInpatients(occupancy: number, staffedAcuteBeds: number): number {
  return Math.max(0, (occupancy - BED_OVERFLOW_THRESHOLD) * staffedAcuteBeds);
}

export function receiverHeadroom(occupancy: number, staffedAcuteBeds: number, code: HospitalCode): number {
  if (code === "QEH" && occupancy >= BED_OVERFLOW_THRESHOLD) return 0;
  return Math.max(0, (RECEIVER_TARGET_OCCUPANCY - occupancy) * staffedAcuteBeds);
}

function bedsOf(code: HospitalCode): number {
  return hospitalByCode(code).staffedAcuteBeds;
}

/**
 * Move excess CMC / KWH inpatients onto PMH and QEH. Occupancy is a fraction of
 * staffed acute beds; transfers conserve patient counts across the four nodes.
 */
export function rebalanceClusterLoad(hospitals: HospitalHourState[]): {
  hospitals: HospitalHourState[];
  plan: LoadBalancePlan;
} {
  const byCode = new Map(hospitals.map((h) => [h.code, { ...h }]));
  Array.from(byCode.values()).forEach((h) => {
    h.occupancyPreTransfer = h.bedOccupancy;
    h.occupancyPostTransfer = h.bedOccupancy;
    h.transferredIn = 0;
    h.transferredOut = 0;
  });

  const excess = new Map<HospitalCode, number>();
  const headroom = new Map<HospitalCode, number>();
  let totalExcess = 0;
  let totalHead = 0;

  for (const code of LOAD_BALANCE_SOURCES) {
    const h = byCode.get(code);
    if (!h) continue;
    const qty = excessInpatients(h.occupancyPreTransfer, bedsOf(code));
    excess.set(code, qty);
    totalExcess += qty;
  }
  for (const code of LOAD_BALANCE_RECEIVERS) {
    const h = byCode.get(code);
    if (!h) continue;
    const qty = receiverHeadroom(h.occupancyPreTransfer, bedsOf(code), code);
    const weighted = code === "PMH" ? qty * 1.15 : qty;
    headroom.set(code, weighted);
    totalHead += weighted;
  }

  if (totalExcess < 0.05) {
    return { hospitals: Array.from(byCode.values()), plan: { ...EMPTY_LOAD_BALANCE_PLAN } };
  }

  const placedScale = totalHead <= 1e-9 ? 0 : Math.min(1, totalHead / totalExcess);
  const legs: TransferLeg[] = [];
  let totalTransferred = 0;

  for (const from of LOAD_BALANCE_SOURCES) {
    const need = (excess.get(from) ?? 0) * placedScale;
    if (need < 0.05 || totalHead <= 1e-9) continue;
    const source = byCode.get(from);
    if (!source) continue;
    for (const to of LOAD_BALANCE_RECEIVERS) {
      const share = (headroom.get(to) ?? 0) / totalHead;
      const patients = need * share;
      if (patients < 0.05) continue;
      const dest = byCode.get(to);
      if (!dest) continue;
      const { arterial, path } = pathForTransfer(from, to);
      legs.push({
        from,
        to,
        patients,
        arterial,
        path: assertArterialWgs84(path, `${from}→${to}`),
      });
      source.transferredOut += patients;
      dest.transferredIn += patients;
      totalTransferred += patients;
    }
  }

  Array.from(byCode.values()).forEach((h) => {
    const beds = bedsOf(h.code);
    const occ =
      (h.occupancyPreTransfer * beds + h.transferredIn - h.transferredOut) / Math.max(1, beds);
    h.occupancyPostTransfer = clamp(occ, 0.4, POST_TRANSFER_OCCUPANCY_CAP);
    h.bedOccupancy = h.occupancyPostTransfer;
    h.bedDeficitPct = Math.max(0, (h.bedOccupancy - 1) * 100);
  });

  const remainingUnplaced = Math.max(0, totalExcess - totalTransferred);
  const plan: LoadBalancePlan = {
    triggered: totalTransferred > 0.05,
    overflowThreshold: BED_OVERFLOW_THRESHOLD,
    sources: [...LOAD_BALANCE_SOURCES],
    receivers: [...LOAD_BALANCE_RECEIVERS],
    legs,
    totalTransferred,
    remainingUnplaced,
  };
  return { hospitals: HOSPITALS.map((spec) => byCode.get(spec.code)).filter((h): h is HospitalHourState => Boolean(h)), plan };
}

export function haBedDeficitBeds(hospitals: HospitalHourState[]): number {
  return hospitals.reduce((sum, h) => sum + Math.max(0, h.bedOccupancy - 1) * bedsOf(h.code), 0);
}

export function planFingerprint(plan: LoadBalancePlan | null | undefined): string {
  if (!plan?.legs.length) return "";
  return plan.legs.map((leg) => `${leg.from}:${leg.to}:${leg.patients.toFixed(2)}`).join("|");
}

export function arterialStrokes(plan: LoadBalancePlan | null | undefined): ArterialStroke[] {
  if (!plan?.triggered) return [];
  return plan.legs.map((leg) => ({
    id: `${leg.from}-${leg.to}`,
    arterial: leg.arterial,
    path: leg.path,
    patients: leg.patients,
    from: leg.from,
    to: leg.to,
  }));
}

export function createAmbulanceParticles(plan: LoadBalancePlan | null | undefined, nowMs = 0): AmbulanceParticle[] {
  if (!plan?.triggered) return [];
  const out: AmbulanceParticle[] = [];
  for (const leg of plan.legs) {
    const n = Math.max(1, Math.round(leg.patients / PATIENTS_PER_AMBULANCE));
    for (let i = 0; i < n; i += 1) {
      const progress = ((i / n) + (nowMs % 12_000) / 12_000) % 1;
      const [lon, lat] = pointAlongPolyline(leg.path, progress);
      out.push({
        id: `${leg.from}-${leg.to}-${i}`,
        lon,
        lat,
        progress,
        from: leg.from,
        to: leg.to,
        arterial: leg.arterial,
        path: leg.path,
      });
    }
  }
  return out;
}

export function advectAmbulanceParticles(particles: AmbulanceParticle[], dt: number): AmbulanceParticle[] {
  const speed = 0.085;
  return particles.map((p) => {
    const progress = (p.progress + dt * speed) % 1;
    const [lon, lat] = pointAlongPolyline(p.path, progress);
    return { ...p, progress, lon, lat };
  });
}

export function isLoadBalanceSource(code: HospitalCode): boolean {
  return isSource(code);
}

export function isLoadBalanceReceiver(code: HospitalCode): boolean {
  return isReceiver(code);
}
