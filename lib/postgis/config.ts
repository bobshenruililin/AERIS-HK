export const DEFAULT_DATABASE_URL = "postgres://aeris:aeris@127.0.0.1:5432/aeris";

export function getDatabaseUrl(): string {
  return process.env.DATABASE_URL?.trim() || process.env.POSTGRES_URL?.trim() || DEFAULT_DATABASE_URL;
}
