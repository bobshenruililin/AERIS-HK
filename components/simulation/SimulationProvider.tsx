"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  BuildingFeature,
  BuildingHourState,
  DuckDbQueryBundle,
  HkoDiurnalEnvelope,
  PlaybackSpeed,
  PolicyImpact,
  PolicyState,
  SpatialBuildingsPayload,
  SpatialSnapshotMeta,
  SystemHourSnapshot,
} from "@/lib/types";
import type { HaNowcast } from "@/lib/ha/types";
import { DEFAULT_POLICY } from "@/lib/types";
import { getBuildings } from "@/lib/spatial-data";
import { SYNTHETIC_SPATIAL_META } from "@/lib/spatial-source";
import {
  computePolicyImpact,
  evaluateSystemAtHour,
  precomputeHourlyCache,
} from "@/lib/epidemiology-engine";
import { wrapHour } from "@/lib/utils";
import { runAerisAnalytics } from "@/lib/duckdb-engine";

interface SimulationContextValue {
  buildings: BuildingFeature[];
  hour: number;
  setHour: (hour: number) => void;
  playing: boolean;
  setPlaying: (playing: boolean) => void;
  speed: PlaybackSpeed;
  setSpeed: (speed: PlaybackSpeed) => void;
  policy: PolicyState;
  setPolicy: (patch: Partial<PolicyState>) => void;
  resetPolicy: () => void;
  snapshot: SystemHourSnapshot;
  impact: PolicyImpact;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  hoveredId: string | null;
  setHoveredId: (id: string | null) => void;
  analytics: DuckDbQueryBundle | null;
  cache: Map<string, BuildingHourState>;
  envelope: HkoDiurnalEnvelope | null;
  envelopeError: string | null;
  spatial: SpatialSnapshotMeta;
  haNowcast: HaNowcast | null;
  haError: string | null;
}

const SimulationContext = createContext<SimulationContextValue | null>(null);

function seedSpatialMeta(count: number): SpatialSnapshotMeta {
  return { ...SYNTHETIC_SPATIAL_META, buildingCount: count };
}

async function fetchHkoEnvelope(): Promise<HkoDiurnalEnvelope> {
  const res = await fetch("/api/hko/envelope", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`HKO envelope HTTP ${res.status}`);
  }
  return (await res.json()) as HkoDiurnalEnvelope;
}

async function fetchSpatialBuildings(): Promise<SpatialBuildingsPayload> {
  const res = await fetch("/api/spatial/buildings", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Spatial buildings HTTP ${res.status}`);
  }
  return (await res.json()) as SpatialBuildingsPayload;
}

async function fetchHaNowcast(): Promise<HaNowcast> {
  const res = await fetch("/api/ha/nowcast", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`HA nowcast HTTP ${res.status}`);
  }
  return (await res.json()) as HaNowcast;
}

async function fetchFootprintsIpc(): Promise<{ bytes: Uint8Array; meta: Partial<SpatialSnapshotMeta> }> {
  const res = await fetch("/api/spatial/footprints", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Spatial Arrow IPC HTTP ${res.status}`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  return {
    bytes,
    meta: {
      authority: (res.headers.get("X-AERIS-Authority") as SpatialSnapshotMeta["authority"]) ?? undefined,
      dualWrite: res.headers.get("X-AERIS-Dual-Write") === "true",
      buildingCount: Number(res.headers.get("X-AERIS-Building-Count") ?? bytes.byteLength),
      arrowBytes: bytes.byteLength,
    },
  };
}

export function SimulationProvider({ children }: { children: ReactNode }) {
  const seed = useMemo(() => getBuildings(), []);
  const [buildings, setBuildings] = useState<BuildingFeature[]>(seed);
  const [spatial, setSpatial] = useState<SpatialSnapshotMeta>(() => seedSpatialMeta(seed.length));
  const footprintsIpcRef = useRef<Uint8Array | null>(null);
  const [footprintsEpoch, setFootprintsEpoch] = useState(0);
  const [hour, setHourState] = useState(15);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const [policy, setPolicyState] = useState<PolicyState>(DEFAULT_POLICY);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<DuckDbQueryBundle | null>(null);
  const [envelope, setEnvelope] = useState<HkoDiurnalEnvelope | null>(null);
  const [envelopeError, setEnvelopeError] = useState<string | null>(null);
  const [haNowcast, setHaNowcast] = useState<HaNowcast | null>(null);
  const [haError, setHaError] = useState<string | null>(null);
  const userScrubbed = useRef(false);
  const pinnedToNow = useRef(true);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void fetchHkoEnvelope()
        .then((next) => {
          if (cancelled) return;
          setEnvelope(next);
          setEnvelopeError(null);
          if (pinnedToNow.current && !userScrubbed.current) {
            setHourState(wrapHour(next.nowHour));
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setEnvelopeError(error instanceof Error ? error.message : "HKO ingest failed");
          }
        });
    };
    load();
    const id = window.setInterval(load, 120_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void fetchHaNowcast()
        .then((next) => {
          if (cancelled) return;
          setHaNowcast(next);
          setHaError(null);
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setHaError(error instanceof Error ? error.message : "HA nowcast failed");
          }
        });
    };
    load();
    const id = window.setInterval(load, 120_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [payload, arrow] = await Promise.all([fetchSpatialBuildings(), fetchFootprintsIpc()]);
        if (cancelled) return;
        if (payload.collection.features.length >= 50) {
          setBuildings(payload.collection.features);
        }
        footprintsIpcRef.current = arrow.bytes;
        setSpatial({
          authority: payload.authority,
          sourceSrid: 2326,
          displaySrid: 4326,
          dualWrite: payload.dualWrite,
          buildingCount: payload.collection.features.length,
          arrowBytes: arrow.bytes.byteLength,
          postgisVersion: payload.postgisVersion,
        });
        setFootprintsEpoch((n) => n + 1);
      } catch (error: unknown) {
        if (!cancelled) {
          setSpatial((prev) => ({
            ...prev,
            error: error instanceof Error ? error.message : "PostGIS snapshot failed",
          }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const cache = useMemo(
    () => precomputeHourlyCache(policy, buildings, envelope),
    [policy, buildings, envelope],
  );
  const impact = useMemo(
    () => computePolicyImpact(policy, buildings, envelope, haNowcast),
    [policy, buildings, envelope, haNowcast],
  );
  const snapshot = useMemo(
    () => evaluateSystemAtHour(hour, policy, buildings, cache, envelope, haNowcast),
    [hour, policy, buildings, cache, envelope, haNowcast],
  );

  const hourlyFlat = useMemo(() => Array.from(cache.values()), [cache]);
  const queryHour = Math.round(wrapHour(hour)) % 24;

  useEffect(() => {
    let cancelled = false;
    void runAerisAnalytics({
      buildings,
      hourly: hourlyFlat,
      hour: queryHour,
      policy,
      footprintsIpc: footprintsIpcRef.current,
    }).then((bundle) => {
      if (!cancelled) setAnalytics(bundle);
    });
    return () => {
      cancelled = true;
    };
  }, [buildings, hourlyFlat, queryHour, policy, footprintsEpoch]);

  useEffect(() => {
    if (!playing) return undefined;
    pinnedToNow.current = false;
    let frame = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      setHourState((prev) => wrapHour(prev + dt * speed * 0.5));
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed]);

  const setHour = useCallback((next: number) => {
    userScrubbed.current = true;
    pinnedToNow.current = false;
    setPlaying(false);
    setHourState(wrapHour(next));
  }, []);

  const setPolicy = useCallback((patch: Partial<PolicyState>) => {
    setPolicyState((prev) => ({ ...prev, ...patch }));
  }, []);

  const resetPolicy = useCallback(() => {
    setPolicyState(DEFAULT_POLICY);
  }, []);

  const value = useMemo<SimulationContextValue>(
    () => ({
      buildings,
      hour,
      setHour,
      playing,
      setPlaying,
      speed,
      setSpeed,
      policy,
      setPolicy,
      resetPolicy,
      snapshot,
      impact,
      selectedId,
      setSelectedId,
      hoveredId,
      setHoveredId,
      analytics,
      cache,
      envelope,
      envelopeError,
      spatial,
      haNowcast,
      haError,
    }),
    [
      buildings,
      hour,
      setHour,
      playing,
      speed,
      policy,
      setPolicy,
      resetPolicy,
      snapshot,
      impact,
      selectedId,
      hoveredId,
      analytics,
      cache,
      envelope,
      envelopeError,
      spatial,
      haNowcast,
      haError,
    ],
  );

  return <SimulationContext.Provider value={value}>{children}</SimulationContext.Provider>;
}

export function useSimulation(): SimulationContextValue {
  const ctx = useContext(SimulationContext);
  if (!ctx) {
    throw new Error("useSimulation must be used within SimulationProvider");
  }
  return ctx;
}

export function useSelectedBuildingState(): BuildingHourState | null {
  const { snapshot, selectedId, hoveredId } = useSimulation();
  const id = selectedId ?? hoveredId;
  if (!id) return null;
  return snapshot.buildings.find((b) => b.buildingId === id) ?? null;
}

export function usePlaybackClock(): number {
  const ref = useRef(0);
  ref.current += 1;
  return ref.current;
}
