/**
 * WebGL context-loss restore and WebGPU device-lost probes.
 * Lost contexts must call preventDefault so the browser can fire
 * webglcontextrestored. Restore never reloads the page — callers remount
 * Deck.gl / MapLibre after a healthy WebGL2 re-probe.
 */
import { isBrowser, notifyGpuFailed, probeHealthyWebGL2 } from "../runtime-guards";

export const AERIS_GPU_RESTORED_EVENT = "aeris-gpu-restored";

export interface WebGpuProbe {
  available: boolean;
  adapter: boolean;
  lost: boolean;
}

export interface ShaderCompileResult {
  ok: boolean;
  ms: number;
  reason: string;
}

export interface GpuLifecycleSnapshot {
  webgl2: boolean;
  webgpu: boolean;
  contextLost: boolean;
  vramEstimateMb: number;
}

let contextLost = false;
let webgpuLost = false;
let lastVramMb = 0;

const VERT_SRC = `#version 300 es
precision highp float;
layout(location=0) in vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAG_SRC = `#version 300 es
precision highp float;
out vec4 outColor;
void main() {
  outColor = vec4(0.05, 0.82, 0.31, 1.0);
}
`;

export function isGpuContextLost(): boolean {
  return contextLost || webgpuLost;
}

export function markGpuContextLost(): void {
  contextLost = true;
}

export function markGpuContextRestored(): void {
  contextLost = false;
}

export function handleWebGlContextLost(event: Event): void {
  if (typeof Event !== "undefined" && "preventDefault" in event) {
    event.preventDefault();
  }
  contextLost = true;
  notifyGpuFailed();
}

export function handleWebGlContextRestored(): void {
  const healthy = probeHealthyWebGL2();
  contextLost = !healthy;
  if (healthy && isBrowser()) {
    window.dispatchEvent(new Event(AERIS_GPU_RESTORED_EVENT));
  }
}

export function canRestoreGpu(): boolean {
  return probeHealthyWebGL2();
}

type GpuAdapterLike = {
  requestDevice: () => Promise<GpuDeviceLike>;
};

type GpuDeviceLike = {
  lost: Promise<{ reason?: string; message?: string }>;
  destroy?: () => void;
};

type NavigatorGpuLike = {
  gpu?: {
    requestAdapter: () => Promise<GpuAdapterLike | null>;
  };
};

export async function probeWebGPU(): Promise<WebGpuProbe> {
  if (typeof navigator === "undefined") {
    return { available: false, adapter: false, lost: webgpuLost };
  }
  const gpu = (navigator as NavigatorGpuLike).gpu;
  if (!gpu) return { available: false, adapter: false, lost: webgpuLost };
  try {
    const adapter = await gpu.requestAdapter();
    if (!adapter) return { available: true, adapter: false, lost: webgpuLost };
    const device = await adapter.requestDevice();
    void device.lost.then(() => {
      webgpuLost = true;
      notifyGpuFailed();
    });
    device.destroy?.();
    return { available: true, adapter: true, lost: webgpuLost };
  } catch {
    return { available: true, adapter: false, lost: webgpuLost };
  }
}

export function webgpuSupportedSync(): boolean {
  if (typeof navigator === "undefined") return false;
  return Boolean((navigator as NavigatorGpuLike).gpu);
}

/**
 * Compile a 4-vertex identity shader on a throwaway WebGL2 canvas.
 * Must not share the Deck.gl context and must not call loseContext on a live canvas.
 */
export function compileProbeShaders(): ShaderCompileResult {
  const started =
    typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
  if (typeof document === "undefined") {
    return { ok: false, ms: 0, reason: "no-document" };
  }
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 4;
    canvas.height = 4;
    const gl = canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: true, antialias: false });
    if (!gl) {
      return {
        ok: false,
        ms: elapsed(started),
        reason: "no-webgl2",
      };
    }
    const vs = gl.createShader(gl.VERTEX_SHADER);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    const prog = gl.createProgram();
    if (!vs || !fs || !prog) {
      return { ok: false, ms: elapsed(started), reason: "alloc" };
    }
    gl.shaderSource(vs, VERT_SRC);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
      return { ok: false, ms: elapsed(started), reason: "vertex" };
    }
    gl.shaderSource(fs, FRAG_SRC);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      return { ok: false, ms: elapsed(started), reason: "fragment" };
    }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    const linked = Boolean(gl.getProgramParameter(prog, gl.LINK_STATUS));
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    gl.deleteProgram(prog);
    const lose = gl.getExtension("WEBGL_lose_context");
    lose?.loseContext();
    return { ok: linked, ms: elapsed(started), reason: linked ? "ok" : "link" };
  } catch {
    return { ok: false, ms: elapsed(started), reason: "throw" };
  }
}

function elapsed(started: number): number {
  const now =
    typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
  return now - started;
}

export function estimateGpuVramMb(opts: {
  canvasWidth: number;
  canvasHeight: number;
  instanceBytes: number;
  particleBytes: number;
}): number {
  const color = opts.canvasWidth * opts.canvasHeight * 4;
  const depth = opts.canvasWidth * opts.canvasHeight * 4;
  const bytes = color + depth + opts.instanceBytes + opts.particleBytes;
  lastVramMb = bytes / (1024 * 1024);
  return lastVramMb;
}

export function lastVramEstimateMb(): number {
  return lastVramMb;
}

export function gpuLifecycleSnapshot(): GpuLifecycleSnapshot {
  return {
    webgl2: probeHealthyWebGL2(),
    webgpu: webgpuSupportedSync(),
    contextLost: isGpuContextLost(),
    vramEstimateMb: lastVramMb,
  };
}
