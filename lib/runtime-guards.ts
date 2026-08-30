/**
 * Feature detection for WebGL2, WebAssembly, and Workers.
 * GPU / WASM / Worker callers must fail over — never throw across the
 * client/server or GPU/CPU boundary.
 */

export const AERIS_GPU_FAILED_EVENT = "aeris-gpu-failed";

/** Minimal WASM module (magic + version 1) used to probe `WebAssembly.validate`. */
export const WASM_PROBE_BYTES = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

export function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

export function workerAvailable(): boolean {
  return typeof Worker !== "undefined";
}

export function wasmSupported(): boolean {
  if (typeof WebAssembly === "undefined" || typeof WebAssembly.validate !== "function") {
    return false;
  }
  try {
    return WebAssembly.validate(WASM_PROBE_BYTES);
  } catch {
    return false;
  }
}

/** DuckDB-WASM needs a window, a Worker constructor, and a working WASM runtime. */
export function canUseDuckDbWasm(): boolean {
  return isBrowser() && workerAvailable() && wasmSupported();
}

/** Monte Carlo worker is plain JS — Worker is enough; WASM absence still allows the worker. */
export function canUseMonteCarloWorker(): boolean {
  return isBrowser() && workerAvailable();
}

/** NSGA-II Pareto worker is plain JS — same Worker probe as Monte Carlo. */
export function canUseParetoWorker(): boolean {
  return isBrowser() && workerAvailable();
}

/**
 * True only when a real (non-software) WebGL2 context can clear and read back
 * a pixel. Software rasterizers and missing GL fail closed so Deck.gl / MapLibre
 * never mount over a dead GPU.
 */
export function probeHealthyWebGL2(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const gl = canvas.getContext("webgl2", {
      failIfMajorPerformanceCaveat: true,
      antialias: false,
      preserveDrawingBuffer: true,
    });
    if (!gl || gl.isContextLost() || gl.drawingBufferWidth < 32) return false;
    gl.clearColor(0.05, 0.82, 0.31, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const px = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const ok = px[1] > 160 && px[0] < 80;
    const lose = gl.getExtension("WEBGL_lose_context");
    lose?.loseContext();
    return ok;
  } catch {
    return false;
  }
}

export function notifyGpuFailed(): void {
  if (!isBrowser()) return;
  window.dispatchEvent(new Event(AERIS_GPU_FAILED_EVENT));
}
