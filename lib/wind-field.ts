import type { BuildingFeature, LonLat } from "./types";
import { metersPerDegree } from "./crs";
import { wrapHour, clamp } from "./utils";
import { solarElevationDeg } from "./solar";
import type { PhysicsForcing } from "./physics-forcing";
import { DEFAULT_PHYSICS_FORCING } from "./physics-forcing";

export interface WindParticle {
  id: number;
  lon: number;
  lat: number;
  age: number;
  maxAge: number;
  speed: number;
  venturi: number;
  stalled: boolean;
  trail: LonLat[];
}

export interface WindStreak {
  id: number;
  path: LonLat[];
  venturi: number;
  stalled: boolean;
  speed: number;
  alpha: number;
}

export interface WindVector {
  u: number;
  v: number;
  speed: number;
  venturi: number;
  stalled: boolean;
}

const PARTICLE_COUNT = 920;
const SPAWN_SOUTH = 22.3038;
const SPAWN_NORTH = 22.3338;
const SPAWN_WEST = 114.1588;
const SPAWN_EAST = 114.1762;

function seaBreeze(hour: number, scale: number): { speed: number; dirDeg: number } {
  const h = wrapHour(hour);
  const el = Math.max(0, solarElevationDeg(h));
  const afternoon = 0.5 + 0.5 * Math.cos(((h - 15) * Math.PI) / 12);
  const speed = (1.05 + 2.8 * afternoon * (0.35 + 0.65 * Math.min(1, el / 55))) * scale;
  const dirDeg = 198 + 22 * Math.sin(((h - 13) * Math.PI) / 12);
  return { speed, dirDeg };
}

function centroid(ring: LonLat[]): LonLat {
  let x = 0;
  let y = 0;
  const n = Math.max(1, ring.length - 1);
  for (let i = 0; i < n; i += 1) {
    x += ring[i][0];
    y += ring[i][1];
  }
  return [x / n, y / n];
}

/**
 * Venturi acceleration in narrow tong-lau corridors and stall in dead-end alleys.
 */
function venturiMorphology(
  lon: number,
  lat: number,
  nx: number,
  ny: number,
  buildings: BuildingFeature[],
): { venturi: number; stalled: boolean } {
  const tx = -ny;
  const ty = nx;
  let left = 0;
  let right = 0;
  let ahead = 0;
  let behind = 0;
  let nearestGap = 80;
  for (const b of buildings) {
    const [blon, blat] = centroid(b.geometry.coordinates[0]);
    const dE = (lon - blon) * 102640;
    const dN = (lat - blat) * 110860;
    const dist = Math.hypot(dE, dN);
    if (dist > 70) continue;
    const along = dE * nx + dN * ny;
    const cross = dE * tx + dN * ty;
    const w = Math.exp(-(dist * dist) / (2 * 28 * 28));
    const hw = b.properties.height / Math.sqrt(Math.max(16, b.properties.roofAreaM2));
    if (Math.abs(along) < 36) {
      if (cross > 5 && cross < 48) {
        right += w * (0.7 + 0.4 * Math.min(3, hw));
        nearestGap = Math.min(nearestGap, Math.abs(cross));
      }
      if (cross < -5 && cross > -48) {
        left += w * (0.7 + 0.4 * Math.min(3, hw));
        nearestGap = Math.min(nearestGap, Math.abs(cross));
      }
    }
    if (along > 8 && along < 55 && Math.abs(cross) < 22) ahead += w;
    if (along < -8 && along > -55 && Math.abs(cross) < 22) behind += w;
  }
  const corridor = Math.min(left, right);
  const narrow = clamp((22 - nearestGap) / 18, 0, 1);
  const venturi = 1 + 1.35 * clamp(corridor, 0, 1) * (0.35 + 0.65 * narrow);
  const stalled = ahead > 0.65 && behind < 0.18 && corridor < 0.28;
  return { venturi: stalled ? 0.22 : venturi, stalled };
}

export function windAt(
  lon: number,
  lat: number,
  hour: number,
  buildings: BuildingFeature[],
  forcing: PhysicsForcing = DEFAULT_PHYSICS_FORCING,
): WindVector {
  const breeze = seaBreeze(hour, forcing.seaBreezeScale);
  const rad = (breeze.dirDeg * Math.PI) / 180;
  let u = breeze.speed * Math.sin(rad);
  let v = breeze.speed * Math.cos(rad);

  let blockage = 0;
  let nSChannel = 0;
  for (const b of buildings) {
    const [blon, blat] = centroid(b.geometry.coordinates[0]);
    const dLon = (lon - blon) * 102640;
    const dLat = (lat - blat) * 110860;
    const dist = Math.hypot(dLon, dLat);
    if (dist > 90) continue;
    const w = Math.exp(-(dist * dist) / (2 * 38 * 38));
    blockage += w * b.properties.ventilationBlockage;
    const heading = b.properties.headingDeg % 180;
    const isNS = heading < 35 || heading > 145;
    nSChannel += w * (isNS ? 1 : -0.55);
  }

  const drag = 1 / (1 + 1.85 * blockage);
  u *= drag;
  v *= drag * (1 + 0.35 * nSChannel);
  const harbourBoost = lat < 22.312 ? 1.25 : 1;
  u *= harbourBoost;
  v *= harbourBoost;
  const speed0 = Math.hypot(u, v);
  const nx = speed0 > 1e-4 ? u / speed0 : 0;
  const ny = speed0 > 1e-4 ? v / speed0 : 1;
  const morph = venturiMorphology(lon, lat, nx, ny, buildings);
  u *= morph.venturi;
  v *= morph.venturi;
  if (forcing.seaBreezeScale < 0.08) {
    u *= 0.18;
    v *= 0.18;
  }
  return { u, v, speed: Math.hypot(u, v), venturi: morph.venturi, stalled: morph.stalled };
}

export function createWindParticles(seed = 7): WindParticle[] {
  const particles: WindParticle[] = [];
  let s = seed >>> 0;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < PARTICLE_COUNT; i += 1) {
    const lon = SPAWN_WEST + rnd() * (SPAWN_EAST - SPAWN_WEST);
    const lat = SPAWN_SOUTH + rnd() * (SPAWN_NORTH - SPAWN_SOUTH);
    particles.push({
      id: i,
      lon,
      lat,
      age: rnd() * 12,
      maxAge: 8 + rnd() * 10,
      speed: 1,
      venturi: 1,
      stalled: false,
      trail: [[lon, lat]],
    });
  }
  return particles;
}

export function advectWindParticles(
  particles: WindParticle[],
  dtSec: number,
  hour: number,
  buildings: BuildingFeature[],
  forcing: PhysicsForcing = DEFAULT_PHYSICS_FORCING,
): WindParticle[] {
  const { metersPerDegLat, metersPerDegLng } = metersPerDegree(22.32);
  const next: WindParticle[] = new Array(particles.length);
  for (let i = 0; i < particles.length; i += 1) {
    const p = particles[i];
    const wind = windAt(p.lon, p.lat, hour, buildings, forcing);
    let lon = p.lon + (wind.u * dtSec) / metersPerDegLng;
    let lat = p.lat + (wind.v * dtSec) / metersPerDegLat;
    let age = p.age + dtSec;
    if (
      age > p.maxAge ||
      lon < SPAWN_WEST - 0.004 ||
      lon > SPAWN_EAST + 0.004 ||
      lat < SPAWN_SOUTH - 0.003 ||
      lat > SPAWN_NORTH + 0.004
    ) {
      const t = (p.id * 17 + Math.floor(hour * 40) + i) % 1000;
      const r1 = ((t * 9301 + 49297) % 233280) / 233280;
      const r2 = ((t * 7919 + 104729) % 233280) / 233280;
      lon = SPAWN_WEST + r1 * (SPAWN_EAST - SPAWN_WEST);
      lat = SPAWN_SOUTH + 0.15 * r2 * (SPAWN_NORTH - SPAWN_SOUTH);
      age = 0;
    }
    const trail = p.trail.length > 0 && age === 0 ? [[lon, lat] as LonLat] : [...p.trail, [lon, lat] as LonLat];
    if (trail.length > 6) trail.shift();
    next[i] = {
      id: p.id,
      lon,
      lat,
      age,
      maxAge: p.maxAge,
      speed: wind.speed,
      venturi: wind.venturi,
      stalled: wind.stalled,
      trail,
    };
  }
  return next;
}

export function windStreaksFromParticles(particles: WindParticle[]): WindStreak[] {
  const streaks: WindStreak[] = [];
  for (const p of particles) {
    if (p.trail.length < 2) continue;
    streaks.push({
      id: p.id,
      path: p.trail,
      venturi: p.venturi,
      stalled: p.stalled,
      speed: p.speed,
      alpha: Math.max(0.08, 1 - p.age / p.maxAge),
    });
  }
  return streaks;
}
