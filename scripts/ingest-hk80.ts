import { ingestHk80FromTwin } from "../lib/postgis/ingest";
import { pingPostgis } from "../lib/postgis/pool";
import { getDatabaseUrl } from "../lib/postgis/config";

async function main(): Promise<void> {
  const url = getDatabaseUrl();
  process.stdout.write(`AERIS-HK PostGIS ingest → ${url.replace(/:[^:@/]+@/, ":***@")}\n`);
  const ping = await pingPostgis();
  if (!ping.ok) {
    throw new Error(`PostGIS unreachable: ${ping.error}`);
  }
  process.stdout.write(`PostGIS ${ping.version}; EPSG:2326 ${ping.srid2326 ? "present" : "MISSING"}\n`);
  const result = await ingestHk80FromTwin();
  process.stdout.write(
    `Ingested ${result.buildingCount} footprints · dual-write SRID ${result.sridHk80}→${result.sridWgs84} · ok=${result.dualWriteOk}\n`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
