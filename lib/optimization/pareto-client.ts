"use client";

import { solveParetoFrontier } from "./solver";
import { canUseParetoWorker } from "../runtime-guards";
import { registerAerisWorker, unregisterAerisWorker } from "../runtime-diagnostics";
import type { ParetoPoint, ParetoProgressCallback, ParetoSolveInput, ParetoSolveResult } from "./types";

const WORKER_TIMEOUT_MS = 180_000;

export function runParetoSync(
  payload: ParetoSolveInput,
  onProgress?: ParetoProgressCallback,
): Promise<ParetoSolveResult> {
  return solveParetoFrontier(payload, onProgress);
}

/**
 * Worker NSGA-II with sync-js failover. Yields are inside runNsga2's
 * onGeneration only on the main-thread path via setTimeout(0) so a missing
 * Worker never freezes diurnal scrubbing.
 */
export function runParetoAsync(
  payload: ParetoSolveInput,
  onProgress?: ParetoProgressCallback,
): Promise<ParetoSolveResult> {
  if (!canUseParetoWorker()) {
    return runWithYields(payload, onProgress);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: ParetoSolveResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    try {
      const worker = new Worker(new URL("./pareto-worker.ts", import.meta.url));
      registerAerisWorker("nsga2");
      const requestId = Date.now();
      const timer = window.setTimeout(() => {
        worker.terminate();
        unregisterAerisWorker("nsga2");
        void runWithYields(payload, onProgress).then(finish);
      }, WORKER_TIMEOUT_MS);
      worker.onmessage = (
        event: MessageEvent<{
          type?: string;
          requestId?: number;
          generation?: number;
          front?: ParetoPoint[];
          result?: ParetoSolveResult;
        }>,
      ) => {
        if (event.data?.requestId !== requestId) return;
        if (event.data.type === "progress" && event.data.front && onProgress) {
          onProgress(event.data.generation ?? 0, event.data.front);
          return;
        }
        if (event.data.type === "result" && event.data.result) {
          window.clearTimeout(timer);
          worker.terminate();
          unregisterAerisWorker("nsga2");
          finish(event.data.result);
          return;
        }
        if (event.data.type === "error") {
          window.clearTimeout(timer);
          worker.terminate();
          unregisterAerisWorker("nsga2");
          void runWithYields(payload, onProgress).then(finish);
        }
      };
      worker.onerror = () => {
        window.clearTimeout(timer);
        worker.terminate();
        unregisterAerisWorker("nsga2");
        void runWithYields(payload, onProgress).then(finish);
      };
      worker.postMessage({ type: "run", requestId, payload });
    } catch {
      void runWithYields(payload, onProgress).then(finish);
    }
  });
}

async function runWithYields(
  payload: ParetoSolveInput,
  onProgress?: ParetoProgressCallback,
): Promise<ParetoSolveResult> {
  const result = await solveParetoFrontier(payload, async (generation, front) => {
    onProgress?.(generation, front);
    await new Promise<void>((resolve) => {
      if (typeof window !== "undefined") window.setTimeout(resolve, 0);
      else resolve();
    });
  });
  return { ...result, engine: "sync-js" };
}
