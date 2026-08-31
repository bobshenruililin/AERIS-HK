/**
 * LIVE MONITORING vs PREDICTIVE TWIN.
 * Default is a compile-time literal so SSR HTML and the first client paint match.
 * Never seed this from the system clock, persisted storage, or the DOM.
 */
export type OpsMode = "live" | "predictive";

export const DEFAULT_OPS_MODE: OpsMode = "live";

export const LIVE_MONITORING_LABEL = "LIVE MONITORING";
export const PREDICTIVE_TWIN_LABEL = "PREDICTIVE TWIN";
