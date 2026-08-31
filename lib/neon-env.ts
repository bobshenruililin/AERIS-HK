export function getNeonDatabaseUrl(): string | null {
  const url = process.env.NEON_DATABASE_URL?.trim();
  return url && url.length > 0 ? url : null;
}

export function getNeonClaimUrl(): string | null {
  const url = process.env.NEON_CLAIM_URL?.trim();
  return url && url.length > 0 ? url : null;
}
