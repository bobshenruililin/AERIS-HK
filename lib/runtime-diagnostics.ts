/**
 * Process-wide frame / worker / DuckDB telemetry for the system health overlay.
 * TwinCanvas records draw stats; engines register workers; analytics records query ms.
 */

export interface FrameDiagnostics {
  fps: number;
  frameMs: number;
  drawCalls: number;
  vramEstimateMb: number;
  duckDbMs: number | null;
  arrowScrubMs: number | null;
  workerCount: number;
  heapMb: number;
  heapDeltaMb: number;
  webgl2: boolean;
  webgpu: boolean;
  contextLost: boolean;
  timestamp: number;
}

export type SmokeCheckId = "duckdb" | "neon" | "shader";

export interface SmokeCheckResult {
  id: SmokeCheckId;
  ok: boolean;
  ms: number;
  detail: string;
}

export interface SmokeTestReport {
  ok: boolean;
  elapsedMs: number;
  checks: SmokeCheckResult[];
}

type DiagListener = (frame: FrameDiagnostics) => void;

const listeners = new Set<DiagListener>();
const workers = new Set<string>();

let lastFrame: FrameDiagnostics = {
  fps: 0,
  frameMs: 0,
  drawCalls: 0,
  vramEstimateMb: 0,
  duckDbMs: null,
  arrowScrubMs: null,
  workerCount: 0,
  heapMb: 0,
  heapDeltaMb: 0,
  webgl2: false,
  webgpu: false,
  contextLost: false,
  timestamp: 0,
};

let heapBaselineMb = 0;
let emaFrameMs = 16.7;
let duckDbMs: number | null = null;
let arrowScrubMs: number | null = null;
let lastDrawCalls = 0;
let lastVramMb = 0;
let webgl2 = false;
let webgpu = false;
let contextLost = false;

function heapUsedMb(): number {
  const perf = typeof performance !== "undefined" ? performance : undefined;
  const memory = perf && "memory" in perf ? (perf as Performance & { memory?: { usedJSHeapSize: number } }).memory : undefined;
  if (!memory || typeof memory.usedJSHeapSize !== "number") return 0;
  return memory.usedJSHeapSize / (1024 * 1024);
}

export function registerAerisWorker(id: string): void {
  workers.add(id);
}

export function unregisterAerisWorker(id: string): void {
  workers.delete(id);
}

export function activeWorkerCount(): number {
  return workers.size;
}

export function recordDuckDbMs(ms: number): void {
  duckDbMs = ms;
}

export function recordArrowScrubMs(ms: number): void {
  arrowScrubMs = ms;
}

export function recordGpuFlags(flags: { webgl2?: boolean; webgpu?: boolean; contextLost?: boolean }): void {
  if (flags.webgl2 != null) webgl2 = flags.webgl2;
  if (flags.webgpu != null) webgpu = flags.webgpu;
  if (flags.contextLost != null) contextLost = flags.contextLost;
}

export function recordFrameSample(sample: {
  frameMs: number;
  drawCalls: number;
  vramEstimateMb: number;
}): FrameDiagnostics {
  const frameMs = Math.max(0.01, sample.frameMs);
  emaFrameMs = emaFrameMs * 0.85 + frameMs * 0.15;
  lastDrawCalls = sample.drawCalls;
  lastVramMb = sample.vramEstimateMb;
  const heapMb = heapUsedMb();
  if (heapBaselineMb <= 0) heapBaselineMb = heapMb;
  lastFrame = {
    fps: 1000 / emaFrameMs,
    frameMs: emaFrameMs,
    drawCalls: lastDrawCalls,
    vramEstimateMb: lastVramMb,
    duckDbMs,
    arrowScrubMs,
    workerCount: workers.size,
    heapMb,
    heapDeltaMb: heapMb - heapBaselineMb,
    webgl2,
    webgpu,
    contextLost,
    timestamp:
      typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now(),
  };
  for (const listener of Array.from(listeners)) listener(lastFrame);
  return lastFrame;
}

export function getFrameDiagnostics(): FrameDiagnostics {
  return lastFrame;
}

export function subscribeDiagnostics(listener: DiagListener): () => void {
  listeners.add(listener);
  listener(lastFrame);
  return () => {
    listeners.delete(listener);
  };
}

export const AERIS_DIAGNOSTICS_EVENT = "aeris-diagnostics-toggle";

export function dispatchDiagnosticsToggle(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(AERIS_DIAGNOSTICS_EVENT));
}
