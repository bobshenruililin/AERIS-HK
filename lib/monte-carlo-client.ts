"use client";

import type { MonteCarloInput, MonteCarloResult } from "./monte-carlo";
import { runMonteCarlo } from "./monte-carlo";
import { canUseMonteCarloWorker } from "./runtime-guards";

export function runMonteCarloAsync(payload: MonteCarloInput): Promise<MonteCarloResult> {
  if (!canUseMonteCarloWorker()) {
    return Promise.resolve({ ...runMonteCarlo(payload), engine: "sync-js" });
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: MonteCarloResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    try {
      const worker = new Worker(new URL("./monte-carlo-worker.ts", import.meta.url));
      const requestId = Date.now();
      const timer = window.setTimeout(() => {
        worker.terminate();
        finish({ ...runMonteCarlo(payload), engine: "sync-js" });
      }, 12_000);
      worker.onmessage = (event: MessageEvent<{ type?: string; requestId?: number; result?: MonteCarloResult }>) => {
        if (event.data?.type !== "result" || event.data.requestId !== requestId || !event.data.result) return;
        window.clearTimeout(timer);
        worker.terminate();
        finish(event.data.result);
      };
      worker.onerror = () => {
        window.clearTimeout(timer);
        worker.terminate();
        finish({ ...runMonteCarlo(payload), engine: "sync-js" });
      };
      worker.postMessage({ type: "run", requestId, payload });
    } catch {
      finish({ ...runMonteCarlo(payload), engine: "sync-js" });
    }
  });
}
