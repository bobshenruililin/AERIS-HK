export interface PolicyAuditEvent {
  at: string;
  actor: string;
  patch: Record<string, unknown>;
}

export function makeAuditEvent(patch: Record<string, unknown>, actor = "mission-control"): PolicyAuditEvent {
  return {
    at: new Date().toISOString(),
    actor,
    patch,
  };
}

export function summariseAudit(events: PolicyAuditEvent[]): string {
  if (events.length === 0) return "No policy mutations this session.";
  const last = events[events.length - 1];
  const keys = Object.keys(last.patch).join(", ");
  return `${events.length} mutations · last ${keys} @ ${last.at.slice(11, 19)}Z`;
}
