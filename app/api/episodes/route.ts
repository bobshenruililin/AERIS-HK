import { NextResponse } from "next/server";
import { DECADE_EPISODES } from "@/lib/decade";
import { ensureNeonDecadeSchema, getNeonClaimUrl, getNeonPool } from "@/lib/neon-archive";

export const dynamic = "force-dynamic";

export async function GET() {
  const schema = await ensureNeonDecadeSchema();
  const neon = getNeonPool();
  let persisted = 0;
  if (schema.ok && neon) {
    for (const episode of DECADE_EPISODES) {
      await neon.query(
        `INSERT INTO aeris_heat_episodes
          (id, year, name_en, name_zh, anomaly_c, peak_wbgt, hko_status, duration_days, notes_en)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id) DO UPDATE SET
           anomaly_c = EXCLUDED.anomaly_c,
           peak_wbgt = EXCLUDED.peak_wbgt,
           hko_status = EXCLUDED.hko_status`,
        [
          episode.id,
          episode.year,
          episode.nameEn,
          episode.nameZh,
          episode.anomalyC,
          episode.peakWbgt,
          episode.hkoStatus,
          episode.durationDays,
          episode.notesEn,
        ],
      );
    }
    const count = await neon.query<{ n: string }>("SELECT COUNT(*)::text AS n FROM aeris_heat_episodes");
    persisted = Number(count.rows[0]?.n ?? 0);
  }
  return NextResponse.json({
    authority: schema.ok ? "neon-claimable" : "in-memory",
    neon: schema.ok,
    neonError: schema.error ?? null,
    claimUrl: getNeonClaimUrl(),
    persisted,
    episodes: DECADE_EPISODES,
  });
}
