# AERIS-HK decade operating picture

In-repo knowledge base (Notion MCP requires Cursor desktop auth in this environment). Import into Notion as a wiki.

## What a decade of this system is

AERIS-HK is not a heat map. It is a first-principles chain:

HKO T/RH → canyon + Oke sky-view → Gagge `S = M − W − E − R − C` → CVI → catchment-weighted Poisson arrivals → M/M/c at CMC / KWH / QEH → exact 0/1 knapsack on m² of cool roof.

The decade observatory asks: **if today's locked roofs had existed every summer 2016–2026, how many Cat 1–3 presentations would not have happened?** Relative risk scales with episode anomaly (Bishai-style, 0.22 / °C).

## Data plane

| Store | CRS / contents |
| --- | --- |
| PostGIS `aeris.buildings` | HK80 EPSG:2326 authority, dual-write 4326 |
| DuckDB-WASM | Arrow IPC footprints + window rank |
| Neon claimable (`NEON_DATABASE_URL`) | `aeris_heat_episodes`, `aeris_policy_audit` — 72h unless claimed |

Claim URL is in `.env.local` as `NEON_CLAIM_URL`. Unclaimed DBs expire in 72 hours.

## Tools that need desktop auth

Figma, Notion, Canva, Neon MCP, Google Drive, and Composio cannot authenticate from this cloud agent. Equivalents in-repo:

- Design tokens: `lib/tokens.ts`
- Knowledge base: this file
- DH briefing: in-app ExportReport + Gmail draft labelled `AERIS-HK/Decade`
- Cinematic stills: `public/decade/*.png` (GenerateImage)
- Production-ish archive: Neon claimable Postgres

## Invariants

- Never pass HK80 eastings to Deck.gl.
- Never persist patient identifiers.
- Exact knapsack is the applied selector; DuckDB windows only rank.
- Gagge identity holds on every footprint.
