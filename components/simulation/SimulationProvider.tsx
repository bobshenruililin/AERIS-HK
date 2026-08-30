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
  CoolRoofCandidate,
  CoolRoofPlan,
  DuckDbQueryBundle,
  HkoDiurnalEnvelope,
  HospitalCode,
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
import { optimiseCoolRoofTargets, runAerisAnalytics } from "@/lib/duckdb-engine";
import {
  defaultCoolRoofBudgetM2,
  rankCoolRoofCandidates,
  sameIdSet,
  totalRoofAreaM2,
} from "@/lib/cool-roof-optimiser";
import { applyEpisodeAnomaly, CURRENT_EPISODE_ID, episodeById } from "@/lib/decade";
import { makeAuditEvent, type PolicyAuditEvent } from "@/lib/audit";
import {
  DEFAULT_HUD_LAYERS,
  DEFAULT_HUD_PRESET,
  HUD_PRESETS,
  type DrawerId,
  type HudLayers,
  type HudPresetId,
  type InspectorTab,
  type ScreenAnchor,
} from "@/lib/hud";
import { DEFAULT_PHYSICS_FORCING, type PhysicsForcing } from "@/lib/physics-forcing";
import {
  applyScenarioEnvelope,
  scenarioById,
  type StressScenarioId,
} from "@/lib/scenarios";
import type { MonteCarloResult } from "@/lib/monte-carlo";
import { runMonteCarloAsync } from "@/lib/monte-carlo-client";
import { TWIN_LOOKAT_EVENT } from "@/lib/twin-camera";
import { buildingCentroid } from "@/lib/spatial-data";

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
  coolRoofPlan: CoolRoofPlan | null;
  coolRoofCandidates: CoolRoofCandidate[];
  totalRoofM2: number;
  focusedHospital: HospitalCode | null;
  setFocusedHospital: (code: HospitalCode | null) => void;
  episodeId: string;
  setEpisodeId: (id: string) => void;
  neonArchive: { neon: boolean; persisted: number; claimUrl: string | null } | null;
  auditLog: PolicyAuditEvent[];
  hudPreset: HudPresetId;
  setHudPreset: (id: HudPresetId) => void;
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  hudLayers: HudLayers;
  setHudLayer: (key: keyof HudLayers, value: boolean) => void;
  inspectorTab: InspectorTab;
  setInspectorTab: (tab: InspectorTab) => void;
  drawerOverride: Partial<Record<DrawerId, boolean>>;
  toggleDrawer: (id: DrawerId) => void;
  isDrawerExpanded: (id: DrawerId) => boolean;
  inspectorAnchor: ScreenAnchor | null;
  setInspectorAnchor: (anchor: ScreenAnchor | null) => void;
  scenarioId: StressScenarioId | null;
  applyScenario: (id: StressScenarioId) => void;
  clearScenario: () => void;
  forcing: PhysicsForcing;
  monteCarlo: MonteCarloResult | null;
  monteCarloRunning: boolean;
  focusBuilding: (id: string) => void;
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
  const [policy, setPolicyState] = useState<PolicyState>(() => ({
    ...DEFAULT_POLICY,
    coolRoofBudgetM2: defaultCoolRoofBudgetM2(seed),
  }));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<DuckDbQueryBundle | null>(null);
  const [envelope, setEnvelope] = useState<HkoDiurnalEnvelope | null>(null);
  const [envelopeError, setEnvelopeError] = useState<string | null>(null);
  const [haNowcast, setHaNowcast] = useState<HaNowcast | null>(null);
  const [haError, setHaError] = useState<string | null>(null);
  const [coolRoofPlan, setCoolRoofPlan] = useState<CoolRoofPlan | null>(null);
  const [focusedHospital, setFocusedHospital] = useState<HospitalCode | null>(null);
  const [episodeId, setEpisodeId] = useState(CURRENT_EPISODE_ID);
  const [neonArchive, setNeonArchive] = useState<{
    neon: boolean;
    persisted: number;
    claimUrl: string | null;
  } | null>(null);
  const [auditLog, setAuditLog] = useState<PolicyAuditEvent[]>([]);
  const [hudPreset, setHudPresetState] = useState<HudPresetId>(DEFAULT_HUD_PRESET);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [hudLayers, setHudLayers] = useState<HudLayers>(DEFAULT_HUD_LAYERS);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("biophysics");
  const [drawerOverride, setDrawerOverride] = useState<Partial<Record<DrawerId, boolean>>>({});
  const [inspectorAnchor, setInspectorAnchor] = useState<ScreenAnchor | null>(null);
  const [scenarioId, setScenarioId] = useState<StressScenarioId | null>(null);
  const [monteCarlo, setMonteCarlo] = useState<MonteCarloResult | null>(null);
  const [monteCarloRunning, setMonteCarloRunning] = useState(false);
  const userScrubbed = useRef(false);
  const pinnedToNow = useRef(true);
  const budgetTouched = useRef(false);

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

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/episodes", { cache: "no-store" })
      .then((res) => res.json())
      .then((payload: { neon?: boolean; persisted?: number; claimUrl?: string | null }) => {
        if (cancelled) return;
        setNeonArchive({
          neon: Boolean(payload.neon),
          persisted: Number(payload.persisted ?? 0),
          claimUrl: payload.claimUrl ?? null,
        });
      })
      .catch(() => {
        if (!cancelled) setNeonArchive({ neon: false, persisted: 0, claimUrl: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const episodeEnvelope = useMemo(
    () => applyEpisodeAnomaly(envelope, episodeById(episodeId)),
    [envelope, episodeId],
  );
  const scenario = scenarioId ? scenarioById(scenarioId) : null;
  const forcedEnvelope = useMemo(
    () => applyScenarioEnvelope(episodeEnvelope, scenario),
    [episodeEnvelope, scenario],
  );
  const forcing = scenario?.forcing ?? DEFAULT_PHYSICS_FORCING;
  const totalRoofM2 = useMemo(() => totalRoofAreaM2(buildings), [buildings]);

  useEffect(() => {
    if (budgetTouched.current) return;
    const next = defaultCoolRoofBudgetM2(buildings);
    setPolicyState((prev) =>
      Math.abs(prev.coolRoofBudgetM2 - next) < 0.5 ? prev : { ...prev, coolRoofBudgetM2: next },
    );
  }, [buildings]);

  const coolRoofCandidates = useMemo(
    () =>
      rankCoolRoofCandidates(buildings, forcedEnvelope, {
        ...policy,
        coolRoofPercent: 0,
        coolRoofTargetIds: [],
      }),
    // Ranking is local-only: ignore budget, targets, and district percent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [buildings, forcedEnvelope, policy.coolingShelters, policy.dhcOutreach, policy.acDeflectionBylaw],
  );

  useEffect(() => {
    let cancelled = false;
    void optimiseCoolRoofTargets({
      candidates: coolRoofCandidates,
      budgetM2: policy.coolRoofBudgetM2,
      totalRoofM2,
    }).then((plan) => {
      if (cancelled) return;
      setCoolRoofPlan(plan);
      setPolicyState((prev) => {
        if (
          sameIdSet(prev.coolRoofTargetIds, plan.selectedIds) &&
          Math.abs(prev.coolRoofPercent - plan.districtCoolRoofPercent) < 1e-6
        ) {
          return prev;
        }
        return {
          ...prev,
          coolRoofTargetIds: plan.selectedIds,
          coolRoofPercent: plan.districtCoolRoofPercent,
        };
      });
    });
    return () => {
      cancelled = true;
    };
  }, [coolRoofCandidates, policy.coolRoofBudgetM2, totalRoofM2]);

  const cache = useMemo(
    () => precomputeHourlyCache(policy, buildings, forcedEnvelope, forcing),
    [policy, buildings, forcedEnvelope, forcing],
  );
  const impact = useMemo(
    () => computePolicyImpact(policy, buildings, forcedEnvelope, haNowcast, forcing),
    [policy, buildings, forcedEnvelope, haNowcast, forcing],
  );
  const snapshot = useMemo(
    () => evaluateSystemAtHour(hour, policy, buildings, cache, forcedEnvelope, haNowcast, forcing),
    [hour, policy, buildings, cache, forcedEnvelope, haNowcast, forcing],
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
    if (patch.coolRoofBudgetM2 != null) budgetTouched.current = true;
    setPolicyState((prev) => ({ ...prev, ...patch }));
    const event = makeAuditEvent(patch as Record<string, unknown>);
    setAuditLog((prev) => [...prev.slice(-39), event]);
    void fetch("/api/audit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
    }).catch(() => undefined);
  }, []);

  const resetPolicy = useCallback(() => {
    budgetTouched.current = false;
    setPolicyState({
      ...DEFAULT_POLICY,
      coolRoofBudgetM2: defaultCoolRoofBudgetM2(buildings),
    });
  }, [buildings]);

  const setHudPreset = useCallback((id: HudPresetId) => {
    setHudPresetState(id);
    setDrawerOverride({});
    setHudLayers(HUD_PRESETS[id].layers);
  }, []);

  const setHudLayer = useCallback((key: keyof HudLayers, value: boolean) => {
    setHudLayers((prev) => ({ ...prev, [key]: value }));
  }, []);

  const toggleDrawer = useCallback((id: DrawerId) => {
    setDrawerOverride((prev) => {
      const spec = HUD_PRESETS[hudPreset].drawers[id];
      const currentlyExpanded = prev[id] ?? spec === "expanded";
      return { ...prev, [id]: !currentlyExpanded };
    });
  }, [hudPreset]);

  const isDrawerExpanded = useCallback(
    (id: DrawerId) => {
      const spec = HUD_PRESETS[hudPreset].drawers[id];
      if (drawerOverride[id] != null) return Boolean(drawerOverride[id]);
      return spec === "expanded";
    },
    [hudPreset, drawerOverride],
  );

  const applyScenario = useCallback((id: StressScenarioId) => {
    const next = scenarioById(id);
    if (!next) return;
    setScenarioId(id);
    if (Object.keys(next.policyPatch).length > 0) {
      setPolicyState((prev) => ({ ...prev, ...next.policyPatch }));
    }
    setHudPresetState(3);
    setDrawerOverride({});
    setHudLayers(HUD_PRESETS[3].layers);
  }, []);

  const clearScenario = useCallback(() => {
    setScenarioId(null);
  }, []);

  const focusBuilding = useCallback(
    (id: string) => {
      const feature = buildings.find((b) => b.properties.id === id);
      setSelectedId(id);
      setInspectorTab("biophysics");
      setHudPresetState(2);
      setDrawerOverride({});
      setHudLayers(HUD_PRESETS[2].layers);
      if (typeof window !== "undefined") {
        setInspectorAnchor({ x: window.innerWidth * 0.62, y: window.innerHeight * 0.4 });
        if (feature) {
          const [lon, lat] = buildingCentroid(feature);
          window.dispatchEvent(new CustomEvent(TWIN_LOOKAT_EVENT, { detail: { lon, lat } }));
        }
      }
    },
    [buildings],
  );

  useEffect(() => {
    let cancelled = false;
    setMonteCarloRunning(true);
    const timer = window.setTimeout(() => {
      void runMonteCarloAsync({
        scenarioAdmissions24h: impact.scenarioAdmissions24h,
        scenarioBedDeficitPct: impact.scenarioBedDeficitPct,
        acFailProbability: Math.max(0.08, forcing.acGridFailure),
        ozoneIndex: forcing.ozoneIndex,
        iterations: 1000,
        seed: 20220719 + Math.round(policy.coolingShelters * 17 + policy.dhcOutreach),
      }).then((result) => {
        if (!cancelled) {
          setMonteCarlo(result);
          setMonteCarloRunning(false);
        }
      });
    }, 320);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    impact.scenarioAdmissions24h,
    impact.scenarioBedDeficitPct,
    forcing.acGridFailure,
    forcing.ozoneIndex,
    policy.coolingShelters,
    policy.dhcOutreach,
    policy.coolRoofBudgetM2,
    policy.acDeflectionBylaw,
  ]);

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
      envelope: forcedEnvelope,
      envelopeError,
      spatial,
      haNowcast,
      haError,
      coolRoofPlan,
      coolRoofCandidates,
      totalRoofM2,
      focusedHospital,
      setFocusedHospital,
      episodeId,
      setEpisodeId,
      neonArchive,
      auditLog,
      hudPreset,
      setHudPreset,
      commandPaletteOpen,
      setCommandPaletteOpen,
      hudLayers,
      setHudLayer,
      inspectorTab,
      setInspectorTab,
      drawerOverride,
      toggleDrawer,
      isDrawerExpanded,
      inspectorAnchor,
      setInspectorAnchor,
      scenarioId,
      applyScenario,
      clearScenario,
      forcing,
      monteCarlo,
      monteCarloRunning,
      focusBuilding,
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
      forcedEnvelope,
      envelopeError,
      spatial,
      haNowcast,
      haError,
      coolRoofPlan,
      coolRoofCandidates,
      totalRoofM2,
      focusedHospital,
      episodeId,
      neonArchive,
      auditLog,
      hudPreset,
      setHudPreset,
      commandPaletteOpen,
      hudLayers,
      setHudLayer,
      inspectorTab,
      drawerOverride,
      toggleDrawer,
      isDrawerExpanded,
      inspectorAnchor,
      scenarioId,
      applyScenario,
      clearScenario,
      forcing,
      monteCarlo,
      monteCarloRunning,
      focusBuilding,
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
