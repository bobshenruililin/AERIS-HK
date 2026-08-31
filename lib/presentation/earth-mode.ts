/**
 * Earth theater is the Google-Earth analogue of the operator HUD.
 * `/earth`, `?briefing=1`, and `?theater=1` all open the click-to-enter gate
 * and request the GPU Deck.gl twin (software ENU remains the failover).
 */

export function normalizePathname(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, "");
  return trimmed.length > 0 ? trimmed : "/";
}

export function searchParamsOf(search: string): URLSearchParams {
  return new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
}

export function isEarthTheater(pathname: string, search: string): boolean {
  const q = searchParamsOf(search);
  if (q.get("briefing") === "1" || q.get("theater") === "1") return true;
  return normalizePathname(pathname) === "/earth";
}

export function wantsGpuTwin(pathname: string, search: string): boolean {
  if (searchParamsOf(search).get("gpu") === "1") return true;
  return isEarthTheater(pathname, search);
}

export function readEarthModeFromWindow(): { theater: boolean; gpu: boolean } {
  if (typeof window === "undefined") return { theater: false, gpu: false };
  const { pathname, search } = window.location;
  return {
    theater: isEarthTheater(pathname, search),
    gpu: wantsGpuTwin(pathname, search),
  };
}
