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
import { buildingCentroid, getBuildings } from "@/lib/spatial-data";
import { SYNTHETIC_SPATIAL_META } from "@/lib/spatial-source";
import {
  computePolicyImpact,
  evaluateSystemAtHour,
  precomputeHourlyCache,
} from "@/lib/epidemiology-engine";
import { wrapHour } from "@/lib/utils";
import { optimiseCoolRoofTargets, runAerisAnalytics } from "@/lib/duckdb-engine";
import { packHourColumns, queryHourColumns } from "@/lib/arrow-columns";
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
import {
  NSGA2_GENERATIONS,
  NSGA2_POPULATION,
  type ParetoPoint,
} from "@/lib/optimization";
import { runParetoAsync } from "@/lib/optimization/pareto-client";
import { TWIN_LOOKAT_EVENT } from "@/lib/twin-camera";
import { measureSpatialIndex, spatialGridFromBuildings, type SpatialIndexStats } from "@/lib/spatial-grid";
import type { SimulationRunDto } from "@/lib/db/types";
import { clusterMetricsFromSnapshot } from "@/lib/db/metrics";
import {
  fetchSimulationList,
  fetchSimulationSnapshot,
  postSimulation,
  readSimQueryParam,
  replaceSimQueryParam,
} from "@/lib/simulations-client";
import { sampleHkoEnvelope } from "@/lib/hko/envelope";
import { EMPTY_COPILOT, shiftEnvelopeTemp, type CopilotSpatialState } from "@/lib/agent";
import {
  DEFAULT_OPS_MODE,
  lookupFromStations,
  sampleSensorMesh,
  sensorLod as selectSensorLod,
  syntheticStationsFromAmbient,
  type HkoLiveFeed,
  type HkoStationLive,
  type LoRaWanSensor,
  type OpsMode,
  type SensorMeshSnapshot,
} from "@/lib/telemetry";

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
  /** Arrow column scrub (hour floor) — UI-thread, target < 5 ms. Not DuckDB ingest. */
  scrubQueryMs: number;
  cache: Map<string, BuildingHourState>;
  envelope: HkoDiurnalEnvelope | null;
  envelopeError: string | null;
  spatial: SpatialSnapshotMeta;
  spatialIndex: SpatialIndexStats;
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
  opsMode: OpsMode;
  enterLiveMonitoring: () => void;
  enterPredictiveTwin: () => void;
  liveFeed: HkoLiveFeed | null;
  liveFeedError: string | null;
  awsStations: HkoStationLive[];
  sensorMesh: SensorMeshSnapshot;
  sensorLod: LoRaWanSensor[];
  forcing: PhysicsForcing;
  monteCarlo: MonteCarloResult | null;
  monteCarloRunning: boolean;
  focusBuilding: (id: string) => void;
  simId: string | null;
  savedRuns: SimulationRunDto[];
  saveSimulation: () => Promise<string | null>;
  loadSimulation: (id: string) => Promise<boolean>;
  simulationSaving: boolean;
  copilot: CopilotSpatialState;
  setCopilot: (next: CopilotSpatialState) => void;
  copilotAmbientDeltaC: number;
  setCopilotAmbientDeltaC: (delta: number) => void;
  copilotPanelOpen: boolean;
  setCopilotPanelOpen: (open: boolean) => void;
  paretoFront: ParetoPoint[];
  paretoRunning: boolean;
  paretoGeneration: number;
  selectedParetoId: string | null;
  paretoEngine: string | null;
  runParetoSolver: () => Promise<void>;
  applyParetoPoint: (id: string) => void;
}

const SimulationContext = createContext<SimulationContextValue | null>(null);

export interface ParetoSolverValue {
  paretoFront: ParetoPoint[];
  paretoRunning: boolean;
  paretoGeneration: number;
  selectedParetoId: string | null;
  paretoEngine: string | null;
  runParetoSolver: () => Promise<void>;
  applyParetoPoint: (id: string) => void;
}

const ParetoSolverContext = createContext<ParetoSolverValue | null>(null);

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

async function fetchLiveTelemetry(): Promise<HkoLiveFeed> {
  const res = await fetch("/api/telemetry/live", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`HKO telemetry HTTP ${res.status}`);
  }
  return (await res.json()) as HkoLiveFeed;
}

const EMPTY_SENSOR_MESH: SensorMeshSnapshot = {
  meshId: "ssp-tenement-lorawan",
  count: 0,
  sensors: [],
  meanIndoorC: 0,
  meanAmbientC: 0,
  acOnCount: 0,
};

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
  const [opsMode, setOpsMode] = useState<OpsMode>(DEFAULT_OPS_MODE);
  const [liveFeed, setLiveFeed] = useState<HkoLiveFeed | null>(null);
  const [liveFeedError, setLiveFeedError] = useState<string | null>(null);
  const [monteCarlo, setMonteCarlo] = useState<MonteCarloResult | null>(null);
  const [monteCarloRunning, setMonteCarloRunning] = useState(false);
  const [simId, setSimId] = useState<string | null>(null);
  const [savedRuns, setSavedRuns] = useState<SimulationRunDto[]>([]);
  const [simulationSaving, setSimulationSaving] = useState(false);
  const [copilot, setCopilot] = useState<CopilotSpatialState>(EMPTY_COPILOT);
  const [copilotAmbientDeltaC, setCopilotAmbientDeltaC] = useState(0);
  const [copilotPanelOpen, setCopilotPanelOpen] = useState(false);
  const [paretoFront, setParetoFront] = useState<ParetoPoint[]>([]);
  const [paretoRunning, setParetoRunning] = useState(false);
  const [paretoGeneration, setParetoGeneration] = useState(0);
  const [selectedParetoId, setSelectedParetoId] = useState<string | null>(null);
  const [paretoEngine, setParetoEngine] = useState<string | null>(null);
  const paretoTokenRef = useRef(0);
  const userScrubbed = useRef(false);
  const pinnedToNow = useRef(true);
  const budgetTouched = useRef(false);
  const liveFeedRef = useRef<HkoLiveFeed | null>(null);

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
      void fetchLiveTelemetry()
        .then((next) => {
          if (cancelled) return;
          setLiveFeed(next);
          setLiveFeedError(null);
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            setLiveFeedError(error instanceof Error ? error.message : "HKO telemetry failed");
          }
        });
    };
    load();
    const id = window.setInterval(load, 30_000);
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
  const scenarioEnvelope = useMemo(
    () => applyScenarioEnvelope(episodeEnvelope, scenario),
    [episodeEnvelope, scenario],
  );
  const forcedEnvelope = useMemo(
    () => shiftEnvelopeTemp(scenarioEnvelope, copilotAmbientDeltaC),
    [scenarioEnvelope, copilotAmbientDeltaC],
  );
  const forcing = scenario?.forcing ?? DEFAULT_PHYSICS_FORCING;
  const spatialWx = useMemo(() => {
    if (opsMode !== "live" || !liveFeed) return null;
    return lookupFromStations(liveFeed.stations);
  }, [opsMode, liveFeed]);
  liveFeedRef.current = liveFeed;

  useEffect(() => {
    if (opsMode !== "live" || !liveFeed) return;
    if (pinnedToNow.current && !userScrubbed.current) {
      setHourState(wrapHour(liveFeed.hourHkt));
    }
  }, [opsMode, liveFeed]);
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
    [buildings, forcedEnvelope, policy.coolingShelters, policy.dhcOutreach, policy.acDeflectionBylaw, policy.canopyGreeneryPercent, policy.acEfficiencyGrantPct],
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
    () => precomputeHourlyCache(policy, buildings, forcedEnvelope, forcing, spatialWx),
    [policy, buildings, forcedEnvelope, forcing, spatialWx],
  );
  const impact = useMemo(
    () => computePolicyImpact(policy, buildings, forcedEnvelope, haNowcast, forcing, spatialWx),
    [policy, buildings, forcedEnvelope, haNowcast, forcing, spatialWx],
  );
  const snapshot = useMemo(
    () => evaluateSystemAtHour(hour, policy, buildings, cache, forcedEnvelope, haNowcast, forcing, spatialWx),
    [hour, policy, buildings, cache, forcedEnvelope, haNowcast, forcing, spatialWx],
  );
  const [spatialIndex, setSpatialIndex] = useState<SpatialIndexStats>({
    vectorCount: 0,
    cellCount: 0,
    bboxMs: 0,
    bboxHits: 0,
    knnMs: 0,
    knnK: 0,
  });
  const spatialGridRef = useRef<ReturnType<typeof spatialGridFromBuildings> | null>(null);
  useEffect(() => {
    spatialGridRef.current = spatialGridFromBuildings(buildings);
  }, [buildings]);
  useEffect(() => {
    const grid = spatialGridRef.current;
    if (!grid) return;
    grid.applyHourlyCvi(snapshot.buildings);
    setSpatialIndex(measureSpatialIndex(grid));
  }, [buildings, snapshot]);

  const hourlyFlat = useMemo(() => Array.from(cache.values()), [cache]);
  const queryHour = Math.round(wrapHour(hour)) % 24;
  const queryHourRef = useRef(queryHour);
  queryHourRef.current = queryHour;
  const hourStore = useMemo(() => packHourColumns(buildings, hourlyFlat), [buildings, hourlyFlat]);
  const scrubColumns = useMemo(() => queryHourColumns(hourStore, queryHour), [hourStore, queryHour]);
  const [scrubQueryMs, setScrubQueryMs] = useState(0);
  useEffect(() => {
    setScrubQueryMs(scrubColumns.elapsedMs);
  }, [scrubColumns]);

  const liveAnalytics = useMemo<DuckDbQueryBundle | null>(() => {
    if (hourStore.n === 0 && !analytics) return null;
    const hourRows = analytics?.districtHourly.filter((row) => row.hour === queryHour) ?? [];
    return {
      districtHourly: hourRows.length > 0 ? hourRows : scrubColumns.districtHourly,
      topCritical: scrubColumns.topCritical,
      queryLatencyMs: analytics?.queryLatencyMs ?? scrubColumns.elapsedMs,
      engine: analytics?.engine ?? "arrow-columns",
      footprintsLoaded: analytics?.footprintsLoaded ?? false,
      footprintCount: analytics?.footprintCount ?? 0,
      arrowIpc: analytics?.arrowIpc ?? true,
    };
  }, [analytics, hourStore.n, queryHour, scrubColumns]);

  useEffect(() => {
    let cancelled = false;
    void runAerisAnalytics({
      buildings,
      hourly: hourlyFlat,
      hour: queryHourRef.current,
      policy,
      footprintsIpc: footprintsIpcRef.current,
    }).then((bundle) => {
      if (!cancelled) setAnalytics(bundle);
    });
    return () => {
      cancelled = true;
    };
  }, [buildings, hourlyFlat, policy, footprintsEpoch]);

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
    setCopilot(EMPTY_COPILOT);
    setCopilotAmbientDeltaC(0);
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
    setOpsMode("predictive");
    setScenarioId(id);
    if (Object.keys(next.policyPatch).length > 0) {
      setPolicyState((prev) => ({ ...prev, ...next.policyPatch }));
    }
    if (typeof next.playheadHour === "number") {
      setHourState(wrapHour(next.playheadHour));
    }
    setHudPresetState(3);
    setDrawerOverride({});
    setHudLayers(HUD_PRESETS[3].layers);
  }, []);

  const clearScenario = useCallback(() => {
    setScenarioId(null);
    setOpsMode("live");
    pinnedToNow.current = true;
    userScrubbed.current = false;
  }, []);

  const enterLiveMonitoring = useCallback(() => {
    setOpsMode("live");
    setScenarioId(null);
    pinnedToNow.current = true;
    userScrubbed.current = false;
    setPlaying(false);
    const current = liveFeedRef.current;
    if (current) setHourState(wrapHour(current.hourHkt));
  }, []);

  const enterPredictiveTwin = useCallback(() => {
    applyScenario("july-2022-heatwave");
    userScrubbed.current = true;
    pinnedToNow.current = false;
    setHourState(15.1);
    setPlaying(false);
  }, [applyScenario]);

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

  const saveSimulation = useCallback(async (): Promise<string | null> => {
    setSimulationSaving(true);
    try {
      const hourly = Array.from({ length: 24 }, (_, h) =>
        clusterMetricsFromSnapshot(
          evaluateSystemAtHour(h, policy, buildings, cache, forcedEnvelope, haNowcast, forcing, spatialWx),
        ),
      ).flat();
      const ambient = forcedEnvelope
        ? sampleHkoEnvelope(forcedEnvelope, 15).airTempC
        : snapshot.buildings.reduce((s, b) => s + b.outdoorTa, 0) / Math.max(1, snapshot.buildings.length);
      const rh = forcedEnvelope ? sampleHkoEnvelope(forcedEnvelope, 15).rhFrac : 0.72;
      const wind =
        snapshot.buildings.reduce((s, b) => s + b.gagge.airVelocityMs, 0) / Math.max(1, snapshot.buildings.length);
      const scenarioName =
        (scenarioId ? scenarioById(scenarioId)?.nameEn : null) ??
        episodeById(episodeId)?.nameEn ??
        "Live HKO twin";
      const posted = await postSimulation({
        scenario_name: scenarioName,
        ambient_temp_c: ambient,
        relative_humidity: rh,
        wind_speed_ms: wind,
        ac_failure_rate: forcing.acGridFailure,
        policy_modifiers: {
          policy,
          scenarioId,
          episodeId,
          hour,
          speed,
          hudPreset,
          forcing: { ...forcing },
        },
        total_averted_ed_visits: impact.admissionsAverted,
        hourly,
      });
      if (!posted) return null;
      setSimId(posted.id);
      replaceSimQueryParam(posted.id);
      const listed = await fetchSimulationList();
      setSavedRuns(listed.runs);
      return posted.id;
    } finally {
      setSimulationSaving(false);
    }
  }, [
    policy,
    buildings,
    cache,
    forcedEnvelope,
    haNowcast,
    forcing,
    snapshot.buildings,
    scenarioId,
    episodeId,
    hour,
    speed,
    hudPreset,
    impact.admissionsAverted,
    spatialWx,
  ]);

  const loadSimulation = useCallback(async (id: string): Promise<boolean> => {
    const snap = await fetchSimulationSnapshot(id);
    if (!snap) return false;
    const mods = snap.policy_modifiers;
    if (mods?.policy) {
      setPolicyState({ ...DEFAULT_POLICY, ...mods.policy });
    }
    setScenarioId(mods?.scenarioId ?? null);
    if (mods?.episodeId) setEpisodeId(mods.episodeId);
    if (typeof mods?.hour === "number") {
      userScrubbed.current = true;
      pinnedToNow.current = false;
      setHourState(wrapHour(mods.hour));
    }
    if (mods?.speed) setSpeed(mods.speed);
    if (mods?.hudPreset) {
      setHudPresetState(mods.hudPreset);
      setHudLayers(HUD_PRESETS[mods.hudPreset].layers);
    }
    setSimId(snap.id);
    replaceSimQueryParam(snap.id);
    return true;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchSimulationList().then((payload) => {
      if (!cancelled) setSavedRuns(payload.runs ?? []);
    });
    const fromUrl = readSimQueryParam();
    if (fromUrl) {
      void fetchSimulationSnapshot(fromUrl).then((snap) => {
        if (cancelled || !snap) return;
        const mods = snap.policy_modifiers;
        if (mods?.policy) setPolicyState({ ...DEFAULT_POLICY, ...mods.policy });
        setScenarioId(mods?.scenarioId ?? null);
        if (mods?.episodeId) setEpisodeId(mods.episodeId);
        if (typeof mods?.hour === "number") {
          userScrubbed.current = true;
          pinnedToNow.current = false;
          setHourState(wrapHour(mods.hour));
        }
        setSimId(snap.id);
      });
    }
    return () => {
      cancelled = true;
    };
  }, []);

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
        seed: 20220719 + Math.round(policy.coolingShelters * 17 + policy.dhcOutreach + policy.canopyGreeneryPercent + policy.acEfficiencyGrantPct),
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
    policy.canopyGreeneryPercent,
    policy.acEfficiencyGrantPct,
  ]);

  const runParetoSolver = useCallback(async () => {
    const token = ++paretoTokenRef.current;
    setParetoRunning(true);
    setParetoGeneration(0);
    try {
      const result = await runParetoAsync(
        {
          buildings,
          candidates: coolRoofCandidates,
          totalRoofM2,
          envelope: forcedEnvelope,
          forcing,
          anchorPolicy: policy,
          generations: NSGA2_GENERATIONS,
          populationSize: NSGA2_POPULATION,
          seed: 20220719 + Math.round(policy.dhcOutreach * 13 + (policy.acDeflectionBylaw ? 7 : 0)),
        },
        (generation, front) => {
          if (token !== paretoTokenRef.current) return;
          setParetoGeneration(generation);
          setParetoFront(front);
        },
      );
      if (token !== paretoTokenRef.current) return;
      setParetoFront(result.front);
      setParetoGeneration(result.generations);
      setParetoEngine(result.engine);
    } finally {
      if (token === paretoTokenRef.current) setParetoRunning(false);
    }
  }, [buildings, coolRoofCandidates, totalRoofM2, forcedEnvelope, forcing, policy]);

  const applyParetoPoint = useCallback(
    (id: string) => {
      const point = paretoFront.find((row) => row.id === id);
      if (!point) return;
      setSelectedParetoId(id);
      setPolicy({
        coolingShelters: Math.round(point.levers.coolingShelters),
        canopyGreeneryPercent: point.levers.canopyGreeneryPercent,
        acEfficiencyGrantPct: point.levers.acEfficiencyGrantPct,
        coolRoofBudgetM2: point.coolRoofBudgetM2,
      });
      setHudPresetState(3);
      setDrawerOverride({});
      setHudLayers(HUD_PRESETS[3].layers);
    },
    [paretoFront, setPolicy],
  );

  const awsStations = useMemo(() => {
    if (opsMode === "live" && liveFeed) return liveFeed.stations;
    const sample = forcedEnvelope ? sampleHkoEnvelope(forcedEnvelope, hour) : null;
    return syntheticStationsFromAmbient(sample?.airTempC ?? 29.2, sample?.rhFrac ?? 0.72, liveFeed?.pulledAtMs ?? 0);
  }, [opsMode, liveFeed, forcedEnvelope, hour]);

  const sensorMesh = useMemo(() => {
    const mesh = sampleSensorMesh({
      stations: awsStations,
      buildings,
      policy,
      hour,
      forcing,
      pulledAtMs: liveFeed?.pulledAtMs ?? 0,
    });
    return mesh.count > 0 ? mesh : EMPTY_SENSOR_MESH;
  }, [awsStations, buildings, policy, hour, forcing, liveFeed]);

  const sensorLodPoints = useMemo(() => selectSensorLod(sensorMesh.sensors), [sensorMesh]);

  const paretoValue = useMemo<ParetoSolverValue>(
    () => ({
      paretoFront,
      paretoRunning,
      paretoGeneration,
      selectedParetoId,
      paretoEngine,
      runParetoSolver,
      applyParetoPoint,
    }),
    [
      paretoFront,
      paretoRunning,
      paretoGeneration,
      selectedParetoId,
      paretoEngine,
      runParetoSolver,
      applyParetoPoint,
    ],
  );

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
      analytics: liveAnalytics,
      scrubQueryMs,
      cache,
      envelope: forcedEnvelope,
      envelopeError,
      spatial,
      spatialIndex,
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
      opsMode,
      enterLiveMonitoring,
      enterPredictiveTwin,
      liveFeed,
      liveFeedError,
      awsStations,
      sensorMesh,
      sensorLod: sensorLodPoints,
      forcing,
      monteCarlo,
      monteCarloRunning,
      focusBuilding,
      simId,
      savedRuns,
      saveSimulation,
      loadSimulation,
      simulationSaving,
      copilot,
      setCopilot,
      copilotAmbientDeltaC,
      setCopilotAmbientDeltaC,
      copilotPanelOpen,
      setCopilotPanelOpen,
      paretoFront,
      paretoRunning,
      paretoGeneration,
      selectedParetoId,
      paretoEngine,
      runParetoSolver,
      applyParetoPoint,
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
      liveAnalytics,
      scrubQueryMs,
      cache,
      forcedEnvelope,
      envelopeError,
      spatial,
      spatialIndex,
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
      opsMode,
      enterLiveMonitoring,
      enterPredictiveTwin,
      liveFeed,
      liveFeedError,
      awsStations,
      sensorMesh,
      sensorLodPoints,
      forcing,
      monteCarlo,
      monteCarloRunning,
      focusBuilding,
      simId,
      savedRuns,
      saveSimulation,
      loadSimulation,
      simulationSaving,
      copilot,
      copilotAmbientDeltaC,
      copilotPanelOpen,
      paretoFront,
      paretoRunning,
      paretoGeneration,
      selectedParetoId,
      paretoEngine,
      runParetoSolver,
      applyParetoPoint,
    ],
  );

  return (
    <SimulationContext.Provider value={value}>
      <ParetoSolverContext.Provider value={paretoValue}>{children}</ParetoSolverContext.Provider>
    </SimulationContext.Provider>
  );
}

export function useSimulation(): SimulationContextValue {
  const ctx = useContext(SimulationContext);
  if (!ctx) {
    throw new Error("useSimulation must be used within SimulationProvider");
  }
  return ctx;
}

export function useParetoSolver(): ParetoSolverValue {
  const ctx = useContext(ParetoSolverContext);
  if (!ctx) {
    throw new Error("useParetoSolver must be used within SimulationProvider");
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
