/**
 * Opt-in diagnostics. Production HUD never prints DuckDB failover traces.
 * Enable with NEXT_PUBLIC_AERIS_DEBUG=1.
 */

export function aerisDebugEnabled(): boolean {
  return typeof process !== "undefined" && process.env.NEXT_PUBLIC_AERIS_DEBUG === "1";
}

export function aerisDebugWarn(message: string, error?: unknown): void {
  if (!aerisDebugEnabled()) return;
  if (error !== undefined) {
    console.warn(message, error);
    return;
  }
  console.warn(message);
}
