/**
 * Spatial data sonification for the Kowloon West twin.
 *
 * Web Audio graphs are created only after an explicit user gesture
 * (`unlock()`). Never construct AudioContext at module load or during SSR.
 *
 * Drone: low sine whose frequency/gain track district-mean ISO 7243 WBGT
 * (operational UTCI analogue — not a Fiala polynomial).
 * Ticks: short triangle pulses when a hovered roof exceeds 40°C sol-air.
 */

import { clamp } from "../utils";

export const SOL_AIR_TICK_C = 40;
export const DRONE_WBGT_FLOOR = 24;
export const DRONE_WBGT_SPAN = 14;

export function droneFrequencyHz(wbgt: number): number {
  const u = clamp((wbgt - DRONE_WBGT_FLOOR) / DRONE_WBGT_SPAN, 0, 1);
  return 46 + u * 28;
}

export function droneGain(wbgt: number): number {
  const u = clamp((wbgt - DRONE_WBGT_FLOOR) / DRONE_WBGT_SPAN, 0, 1);
  return 0.01 + u * 0.042;
}

function audioCtor(): (new (contextOptions?: AudioContextOptions) => AudioContext) | null {
  if (typeof window === "undefined") return null;
  const g = globalThis as typeof globalThis & {
    AudioContext?: new (contextOptions?: AudioContextOptions) => AudioContext;
    webkitAudioContext?: new (contextOptions?: AudioContextOptions) => AudioContext;
  };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

export function canUseWebAudio(): boolean {
  return audioCtor() != null;
}

export class HeatSoundscape {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private osc: OscillatorNode | null = null;
  private lfo: OscillatorNode | null = null;
  private lfoGain: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private muted = false;
  unlocked = false;

  async unlock(): Promise<boolean> {
    const Ctor = audioCtor();
    if (!Ctor) return false;
    if (!this.ctx) {
      this.ctx = new Ctor();
      this.buildGraph();
    }
    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
    }
    this.unlocked = this.ctx.state === "running" || this.ctx.state === "suspended";
    return this.unlocked && this.ctx.state === "running";
  }

  private buildGraph(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.master = ctx.createGain();
    this.master.gain.value = 0.0001;
    this.osc = ctx.createOscillator();
    this.osc.type = "sine";
    this.osc.frequency.value = 52;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 160;
    this.filter.Q.value = 0.7;
    this.lfo = ctx.createOscillator();
    this.lfo.type = "sine";
    this.lfo.frequency.value = 0.07;
    this.lfoGain = ctx.createGain();
    this.lfoGain.gain.value = 3.5;
    this.lfo.connect(this.lfoGain);
    this.lfoGain.connect(this.osc.frequency);
    this.osc.connect(this.filter);
    this.filter.connect(this.master);
    this.master.connect(ctx.destination);
    this.osc.start();
    this.lfo.start();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ctx && this.master) {
      this.master.gain.linearRampToValueAtTime(muted ? 0.0001 : 0.02, this.ctx.currentTime + 0.12);
    }
  }

  setUtciWbgt(wbgt: number): void {
    if (!this.ctx || !this.osc || !this.master || !this.filter) return;
    const now = this.ctx.currentTime;
    this.osc.frequency.linearRampToValueAtTime(droneFrequencyHz(wbgt), now + 0.45);
    const g = this.muted ? 0.0001 : droneGain(wbgt);
    this.master.gain.linearRampToValueAtTime(g, now + 0.45);
    this.filter.frequency.linearRampToValueAtTime(120 + clamp((wbgt - 24) / 14, 0, 1) * 80, now + 0.45);
  }

  tickSolAir(): void {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(920, t);
    osc.frequency.exponentialRampToValueAtTime(420, t + 0.08);
    gain.gain.setValueAtTime(0.048, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(t);
    osc.stop(t + 0.1);
  }

  async close(): Promise<void> {
    const ctx = this.ctx;
    this.unlocked = false;
    this.osc = null;
    this.lfo = null;
    this.lfoGain = null;
    this.filter = null;
    this.master = null;
    this.ctx = null;
    if (!ctx) return;
    try {
      await ctx.close();
    } catch {
      // Already closed.
    }
  }
}

/** Module singleton — the class still does not touch AudioContext until unlock(). */
export const heatSoundscape = new HeatSoundscape();
