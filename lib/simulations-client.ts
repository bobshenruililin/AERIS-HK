/**
 * In-memory SWR cache for Neon simulation list/snapshot fetches.
 * Re-exported as the simulations client so existing imports keep working.
 */
export {
  SIM_CACHE_TTL_MS,
  fetchSimulationList,
  fetchSimulationSnapshot,
  postSimulation,
  invalidateSimulationCache,
  replaceSimQueryParam,
  readSimQueryParam,
  simulationCacheStats,
} from "./sim-cache";
