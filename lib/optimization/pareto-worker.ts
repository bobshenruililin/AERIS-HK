/// <reference lib="webworker" />
/**
 * Dedicated NSGA-II worker. 500 generations stay off the rAF / Arrow scrub path.
 * Failover is the caller's responsibility (pareto-client.ts → sync-js with yields).
 */
import { solveParetoFrontier } from "./solver";
import type { ParetoPoint, ParetoSolveInput, ParetoSolveResult } from "./types";

export type ParetoWorkerRequest = {
  type: "run";
  requestId: number;
  payload: ParetoSolveInput;
};

export type ParetoWorkerResponse =
  | { type: "progress"; requestId: number; generation: number; front: ParetoPoint[] }
  | { type: "result"; requestId: number; result: ParetoSolveResult }
  | { type: "error"; requestId: number; message: string };

self.onmessage = (event: MessageEvent<ParetoWorkerRequest>) => {
  const msg = event.data;
  if (!msg || msg.type !== "run") return;
  const reply = (data: ParetoWorkerResponse) => {
    (self as DedicatedWorkerGlobalScope).postMessage(data);
  };
  void (async () => {
    try {
      const result = await solveParetoFrontier(msg.payload, (generation, front) => {
        reply({ type: "progress", requestId: msg.requestId, generation, front });
      });
      reply({
        type: "result",
        requestId: msg.requestId,
        result: { ...result, engine: "worker-nsga2" },
      });
    } catch (error: unknown) {
      reply({
        type: "error",
        requestId: msg.requestId,
        message: error instanceof Error ? error.message : "Pareto worker failed",
      });
    }
  })();
};
