/**
 * Click-to-highlight citation catalog. Labels in chat MUST match `bracket`.
 */
export type CitationHighlight =
  | "roofs"
  | "gagge"
  | "wbgt"
  | "pmv"
  | "duckdb"
  | "grid"
  | "neon"
  | "queue"
  | "rr"
  | "knapsack";

export interface CitationSpec {
  id: string;
  bracket: string;
  equation: string;
  module: string;
  highlight: CitationHighlight;
}

export const CITATION_CATALOG: Record<string, CitationSpec> = {
  "sol-air-eq-3": {
    id: "sol-air-eq-3",
    bracket: "Sol-Air Equation: Eq. 3",
    equation: "q_abs = I_peak · sin^{1.15}(γ_s) · (1 − ρ)   ρ_asphalt=0.18  ρ_cool=0.65",
    module: "lib/solar.ts",
    highlight: "roofs",
  },
  gagge: {
    id: "gagge",
    bracket: "Gagge two-node: S = M − W − E − R − C",
    equation: "S = M − W − E − R − C  (W/m²)",
    module: "lib/epidemiology-engine.ts",
    highlight: "gagge",
  },
  "iso-7730-pmv": {
    id: "iso-7730-pmv",
    bracket: "ISO 7730 Fanger PMV",
    equation: "PMV = (0.303 e^{-0.036M} + 0.028)·[(M−W) − ΣH_L]",
    module: "lib/biophysics.ts",
    highlight: "pmv",
  },
  "iso-7243-wbgt": {
    id: "iso-7243-wbgt",
    bracket: "ISO 7243 WBGT",
    equation: "WBGT_out = 0.7 Tw + 0.2 Tg + 0.1 Ta",
    module: "lib/biophysics.ts",
    highlight: "wbgt",
  },
  "duckdb-agg": {
    id: "duckdb-agg",
    bracket: "DuckDB Footprint Aggregation",
    equation: "Arrow IPC window SQL over HK80 footprints (columnar fallback if WASM is absent)",
    module: "lib/duckdb-engine.ts",
    highlight: "duckdb",
  },
  "enu-grid": {
    id: "enu-grid",
    bracket: "ENU SpatialGrid",
    equation: "Uniform 40 m hash · bbox / kNN over packed ENU vectors",
    module: "lib/spatial-grid.ts",
    highlight: "grid",
  },
  "neon-run": {
    id: "neon-run",
    bracket: "Neon Simulation Run",
    equation: "simulation_runs.config hydrates HUD via ?sim=<uuid>",
    module: "lib/db/schema.ts",
    highlight: "neon",
  },
  "mmc-erlang": {
    id: "mmc-erlang",
    bracket: "M/M/c Erlang-C",
    equation: "ρ = λ/(cμ);  P(wait) = Erlang-C;  120% → PMH/QEH",
    module: "lib/epidemiology-engine.ts",
    highlight: "queue",
  },
  "dlnm-rr": {
    id: "dlnm-rr",
    bracket: "Bishai DLNM-style RR 0.22/°C",
    equation: "RR = max(0.55, 1 + 0.22·ΔT);  MC: exp(0.22·ΔT_spike)",
    module: "lib/decade.ts",
    highlight: "rr",
  },
  knapsack: {
    id: "knapsack",
    bracket: "Cool-roof 0/1 knapsack",
    equation: "max Σ averted_i  s.t. Σ roof_m2_i ≤ budget",
    module: "lib/cool-roof-knapsack.ts",
    highlight: "knapsack",
  },
};

export const CITATION_IDS = Object.keys(CITATION_CATALOG);

export function citationByBracket(label: string): CitationSpec | null {
  const trimmed = label.replace(/^\[/, "").replace(/\]$/, "").trim();
  for (const spec of Object.values(CITATION_CATALOG)) {
    if (spec.bracket === trimmed || spec.id === trimmed) return spec;
  }
  const lower = trimmed.toLowerCase();
  if (lower.includes("sol-air") || lower.includes("eq. 3")) return CITATION_CATALOG["sol-air-eq-3"];
  if (lower.includes("gagge")) return CITATION_CATALOG.gagge;
  if (lower.includes("7730") || lower.includes("fanger") || lower.includes("pmv")) {
    return CITATION_CATALOG["iso-7730-pmv"];
  }
  if (lower.includes("7243") || lower.includes("wbgt")) return CITATION_CATALOG["iso-7243-wbgt"];
  if (lower.includes("duckdb") || lower.includes("footprint")) return CITATION_CATALOG["duckdb-agg"];
  if (lower.includes("spatialgrid") || lower.includes("enu")) return CITATION_CATALOG["enu-grid"];
  if (lower.includes("neon")) return CITATION_CATALOG["neon-run"];
  if (lower.includes("erlang") || lower.includes("m/m/c")) return CITATION_CATALOG["mmc-erlang"];
  if (lower.includes("dlnm") || lower.includes("bishai") || lower.includes("0.22")) {
    return CITATION_CATALOG["dlnm-rr"];
  }
  if (lower.includes("knapsack")) return CITATION_CATALOG.knapsack;
  return null;
}

export function formatNeonCitation(simId: string | null): string {
  if (!simId) return "[Neon Simulation Run #pending]";
  return `[Neon Simulation Run #${simId.replace(/-/g, "").slice(0, 4)}]`;
}

export function formatDuckDbCitation(footprints: number, vectors: number): string {
  return `[DuckDB ${footprints.toLocaleString("en-HK")} Footprint Aggregation · ${vectors.toLocaleString("en-HK")} ENU vectors]`;
}

export function enrichNarrative(
  text: string,
  ctx: { simId: string | null; footprints: number; vectors: number },
): string {
  return text
    .replace(/\[DuckDB Footprint Aggregation\]/g, formatDuckDbCitation(ctx.footprints, ctx.vectors))
    .replace(/\[DuckDB \d[\d,]* Footprint Aggregation[^\]]*\]/g, formatDuckDbCitation(ctx.footprints, ctx.vectors))
    .replace(/\[Neon Simulation Run(?: #[^\]]+)?\]/g, formatNeonCitation(ctx.simId));
}

export function splitCitedText(text: string): Array<{ type: "text" | "cite"; value: string; spec: CitationSpec | null }> {
  const out: Array<{ type: "text" | "cite"; value: string; spec: CitationSpec | null }> = [];
  const re = /\[([^\]]+)\]/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const idx = match.index;
    if (idx > last) out.push({ type: "text", value: text.slice(last, idx), spec: null });
    const spec = citationByBracket(match[1]);
    out.push({ type: "cite", value: match[0], spec });
    last = idx + match[0].length;
  }
  if (last < text.length) out.push({ type: "text", value: text.slice(last), spec: null });
  return out;
}
