/**
 * In-memory SWR cache for Neon simulation list/snapshot fetches.
 * Dedupes in-flight requests and serves a TTL window so Cmd+K / share
 * does not repeat identical HTTP round-trips.
 */
import type { CreateSimulationRequest, SimulationRunDto, SimulationSnapshotDto } from "./db/types";

export const SIM_CACHE_TTL_MS = 30_000;

type ListPayload = {
  neon: boolean;
  buildingCount: number;
  runs: SimulationRunDto[];
  neonError: string | null;
};

interface CacheEntry<T> {
  at: number;
  value: T;
}

let listEntry: CacheEntry<ListPayload> | null = null;
let listInflight: Promise<ListPayload> | null = null;
const snapEntries = new Map<string, CacheEntry<SimulationSnapshotDto>>();
const snapInflight = new Map<string, Promise<SimulationSnapshotDto | null>>();

export function invalidateSimulationCache(id?: string): void {
  if (id) {
    snapEntries.delete(id);
    snapInflight.delete(id);
  } else {
    snapEntries.clear();
    snapInflight.clear();
  }
  listEntry = null;
  listInflight = null;
}

function fresh<T>(entry: CacheEntry<T> | undefined | null, now = Date.now()): T | null {
  if (!entry) return null;
  if (now - entry.at > SIM_CACHE_TTL_MS) return null;
  return entry.value;
}

export async function fetchSimulationList(): Promise<ListPayload> {
  const hit = fresh(listEntry);
  if (hit) return hit;
  if (listInflight) return listInflight;
  listInflight = (async () => {
    const res = await fetch("/api/simulations", { cache: "no-store" });
    if (!res.ok) {
      const payload: ListPayload = { neon: false, buildingCount: 0, runs: [], neonError: `HTTP ${res.status}` };
      listEntry = { at: Date.now(), value: payload };
      return payload;
    }
    const payload = (await res.json()) as ListPayload;
    listEntry = { at: Date.now(), value: payload };
    return payload;
  })();
  try {
    return await listInflight;
  } finally {
    listInflight = null;
  }
}

export async function fetchSimulationSnapshot(id: string): Promise<SimulationSnapshotDto | null> {
  const hit = fresh(snapEntries.get(id));
  if (hit) return hit;
  const pending = snapInflight.get(id);
  if (pending) return pending;
  const req = (async () => {
    const res = await fetch(`/api/simulations/${id}`, { cache: "no-store" });
    if (!res.ok) return null;
    const snap = (await res.json()) as SimulationSnapshotDto;
    snapEntries.set(id, { at: Date.now(), value: snap });
    return snap;
  })();
  snapInflight.set(id, req);
  try {
    return await req;
  } finally {
    snapInflight.delete(id);
  }
}

export async function postSimulation(body: CreateSimulationRequest): Promise<{ id: string } | null> {
  const res = await fetch("/api/simulations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  invalidateSimulationCache();
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

export function simulationCacheStats(): { listCached: boolean; snapshotCount: number } {
  return { listCached: fresh(listEntry) != null, snapshotCount: snapEntries.size };
}
