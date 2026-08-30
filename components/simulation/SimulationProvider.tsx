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
  SystemHourSnapshot,
} from "@/lib/types";
import { DEFAULT_POLICY } from "@/lib/types";
import { getBuildings } from "@/lib/spatial-data";
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
}

const SimulationContext = createContext<SimulationContextValue | null>(null);

async function fetchHkoEnvelope(): Promise<HkoDiurnalEnvelope> {
  const res = await fetch("/api/hko/envelope", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`HKO envelope HTTP ${res.status}`);
  }
  return (await res.json()) as HkoDiurnalEnvelope;
}

export function SimulationProvider({ children }: { children: ReactNode }) {
  const buildings = useMemo(() => getBuildings(), []);
  const [hour, setHourState] = useState(15);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const [policy, setPolicyState] = useState<PolicyState>(DEFAULT_POLICY);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<DuckDbQueryBundle | null>(null);
  const [envelope, setEnvelope] = useState<HkoDiurnalEnvelope | null>(null);
  const [envelopeError, setEnvelopeError] = useState<string | null>(null);
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

  const cache = useMemo(
    () => precomputeHourlyCache(policy, buildings, envelope),
    [policy, buildings, envelope],
  );
  const impact = useMemo(
    () => computePolicyImpact(policy, buildings, envelope),
    [policy, buildings, envelope],
  );
  const snapshot = useMemo(
    () => evaluateSystemAtHour(hour, policy, buildings, cache, envelope),
    [hour, policy, buildings, cache, envelope],
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
    }).then((bundle) => {
      if (!cancelled) setAnalytics(bundle);
    });
    return () => {
      cancelled = true;
    };
  }, [buildings, hourlyFlat, queryHour, policy]);

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
