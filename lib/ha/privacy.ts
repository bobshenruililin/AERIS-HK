const FORBIDDEN_KEY =
  /\b(hkid|patient[_ ]?id|patientName|fullName|givenName|surname|dateOfBirth|date_of_birth|dob|episode(?:No|_no)?|admission(?:No|_no)?|caseNo|hospitalNumber|bed(?:No|_no|Number)?|passport|identityNo|phone|mobile|addressLine)\b/i;

const HKID_PATTERN = /\b[A-Z]{1,2}\d{6}\(?[0-9A]\)?\b/;

export const AGGREGATE_WEBHOOK_KEYS = new Set([
  "code",
  "occupancyFrac",
  "cat1PerHour",
  "cat2PerHour",
  "cat3PerHour",
  "asOf",
]);

export function assertNoPatientIdentifiers(payload: unknown, label = "HA nowcast"): void {
  const json = JSON.stringify(payload);
  if (FORBIDDEN_KEY.test(json)) {
    throw new Error(`${label} rejected: payload contains a patient-level field name`);
  }
  if (HKID_PATTERN.test(json)) {
    throw new Error(`${label} rejected: payload contains an HKID-shaped token`);
  }
  if (Array.isArray(payload) && payload.some((row) => row && typeof row === "object" && "patients" in row)) {
    throw new Error(`${label} rejected: patient arrays are not permitted`);
  }
}

export function stripUnknownKeys<T extends Record<string, unknown>>(
  row: T,
  allowed: Set<string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (allowed.has(key)) out[key] = value;
  }
  return out;
}
