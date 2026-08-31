/**
 * Pre-allocated typed arrays for Deck.gl binary attributes.
 * Wind / ambulance advect mutates these in place — no [lon, lat] per vertex.
 */
import type { AmbulanceParticle } from "../hospital-triage";
import type { WindParticle } from "../wind-field";

export interface ParticleGpuBuffers {
  capacity: number;
  count: number;
  positions: Float32Array;
  radii: Float32Array;
  colors: Uint8Array;
}

export function createParticleGpuBuffers(capacity: number): ParticleGpuBuffers {
  return {
    capacity,
    count: 0,
    positions: new Float32Array(capacity * 2),
    radii: new Float32Array(capacity),
    colors: new Uint8Array(capacity * 4),
  };
}

function ensureCapacity(buf: ParticleGpuBuffers, n: number): void {
  if (n <= buf.capacity) return;
  const next = Math.max(n, buf.capacity * 2);
  const positions = new Float32Array(next * 2);
  positions.set(buf.positions);
  const radii = new Float32Array(next);
  radii.set(buf.radii);
  const colors = new Uint8Array(next * 4);
  colors.set(buf.colors);
  buf.capacity = next;
  buf.positions = positions;
  buf.radii = radii;
  buf.colors = colors;
}

export function packWindParticles(particles: WindParticle[], out: ParticleGpuBuffers): ParticleGpuBuffers {
  ensureCapacity(out, particles.length);
  out.count = particles.length;
  const pos = out.positions;
  const rad = out.radii;
  const col = out.colors;
  for (let i = 0; i < particles.length; i += 1) {
    const p = particles[i];
    pos[i * 2] = p.lon;
    pos[i * 2 + 1] = p.lat;
    rad[i] = 1.4 + p.speed * 0.35;
    const fade = Math.max(50, 230 * (1 - p.age / p.maxAge));
    const o = i * 4;
    if (p.stalled) {
      col[o] = 148;
      col[o + 1] = 163;
      col[o + 2] = 184;
      col[o + 3] = fade * 0.55;
    } else if (p.venturi > 1.25) {
      col[o] = 251;
      col[o + 1] = 191;
      col[o + 2] = 36;
      col[o + 3] = fade;
    } else {
      col[o] = 34;
      col[o + 1] = 211;
      col[o + 2] = 238;
      col[o + 3] = fade;
    }
  }
  return out;
}

export function packAmbulanceParticles(
  particles: AmbulanceParticle[],
  out: ParticleGpuBuffers,
): ParticleGpuBuffers {
  ensureCapacity(out, particles.length);
  out.count = particles.length;
  const pos = out.positions;
  const rad = out.radii;
  const col = out.colors;
  for (let i = 0; i < particles.length; i += 1) {
    const p = particles[i];
    pos[i * 2] = p.lon;
    pos[i * 2 + 1] = p.lat;
    rad[i] = 9;
    const o = i * 4;
    if (p.arterial === "nathan-road") {
      col[o] = 254;
      col[o + 1] = 215;
      col[o + 2] = 170;
      col[o + 3] = 240;
    } else {
      col[o] = 254;
      col[o + 1] = 202;
      col[o + 2] = 202;
      col[o + 3] = 240;
    }
  }
  return out;
}

export function deckBinaryPoints(buf: ParticleGpuBuffers): {
  length: number;
  attributes: {
    getPosition: { value: Float32Array; size: 2 };
    getRadius: { value: Float32Array; size: 1 };
    getFillColor: { value: Uint8Array; size: 4; normalized: false };
  };
} {
  return {
    length: buf.count,
    attributes: {
      getPosition: { value: buf.positions.subarray(0, buf.count * 2), size: 2 },
      getRadius: { value: buf.radii.subarray(0, buf.count), size: 1 },
      getFillColor: { value: buf.colors.subarray(0, buf.count * 4), size: 4, normalized: false },
    },
  };
}
