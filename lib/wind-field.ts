import type { BuildingFeature, LonLat } from "./types";
import { metersPerDegree } from "./crs";
import { wrapHour } from "./utils";
import { solarElevationDeg } from "./solar";

export interface WindParticle {
  id: number;
  lon: number;
  lat: number;
  age: number;
  maxAge: number;
  speed: number;
}

export interface WindVector {
  u: number;
  v: number;
  speed: number;
}

const PARTICLE_COUNT = 920;
const SPAWN_SOUTH = 22.3038;
const SPAWN_NORTH = 22.3338;
const SPAWN_WEST = 114.1588;
const SPAWN_EAST = 114.1762;

function seaBreeze(hour: number): { speed: number; dirDeg: number } {
  const h = wrapHour(hour);
  const el = Math.max(0, solarElevationDeg(h));
  const afternoon = 0.5 + 0.5 * Math.cos(((h - 15) * Math.PI) / 12);
  const speed = 1.05 + 2.8 * afternoon * (0.35 + 0.65 * Math.min(1, el / 55));
  const dirDeg = 198 + 22 * Math.sin(((h - 13) * Math.PI) / 12);
  return { speed, dirDeg };
}

export function windAt(
  lon: number,
  lat: number,
  hour: number,
  buildings: BuildingFeature[],
): WindVector {
  const breeze = seaBreeze(hour);
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
  return { u, v, speed: Math.hypot(u, v) };
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

export function createWindParticles(seed = 7): WindParticle[] {
  const particles: WindParticle[] = [];
  let s = seed >>> 0;
  const rnd = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 0; i < PARTICLE_COUNT; i += 1) {
    particles.push({
      id: i,
      lon: SPAWN_WEST + rnd() * (SPAWN_EAST - SPAWN_WEST),
      lat: SPAWN_SOUTH + rnd() * (SPAWN_NORTH - SPAWN_SOUTH),
      age: rnd() * 12,
      maxAge: 8 + rnd() * 10,
      speed: 1,
    });
  }
  return particles;
}

export function advectWindParticles(
  particles: WindParticle[],
  dtSec: number,
  hour: number,
  buildings: BuildingFeature[],
): WindParticle[] {
  const { metersPerDegLat, metersPerDegLng } = metersPerDegree(22.32);
  const next: WindParticle[] = new Array(particles.length);
  for (let i = 0; i < particles.length; i += 1) {
    const p = particles[i];
    const wind = windAt(p.lon, p.lat, hour, buildings);
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
    next[i] = {
      id: p.id,
      lon,
      lat,
      age,
      maxAge: p.maxAge,
      speed: wind.speed,
    };
  }
  return next;
}
