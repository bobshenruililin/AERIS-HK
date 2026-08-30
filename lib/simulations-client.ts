import type { CreateSimulationRequest, SimulationRunDto, SimulationSnapshotDto } from "./db/types";

export async function fetchSimulationList(): Promise<{
  neon: boolean;
  buildingCount: number;
  runs: SimulationRunDto[];
  neonError: string | null;
}> {
  const res = await fetch("/api/simulations", { cache: "no-store" });
  if (!res.ok) {
    return { neon: false, buildingCount: 0, runs: [], neonError: `HTTP ${res.status}` };
  }
  return (await res.json()) as {
    neon: boolean;
    buildingCount: number;
    runs: SimulationRunDto[];
    neonError: string | null;
  };
}

export async function fetchSimulationSnapshot(id: string): Promise<SimulationSnapshotDto | null> {
  const res = await fetch(`/api/simulations/${id}`, { cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json()) as SimulationSnapshotDto;
}

export async function postSimulation(body: CreateSimulationRequest): Promise<{ id: string } | null> {
  const res = await fetch("/api/simulations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  return (await res.json()) as { id: string };
}

export function replaceSimQueryParam(id: string): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("sim", id);
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

export function readSimQueryParam(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("sim");
}
