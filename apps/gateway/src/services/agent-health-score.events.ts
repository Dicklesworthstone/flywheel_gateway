/**
 * Agent Health Score - Error Event Store
 *
 * Shared in-memory store for operational error signals used by bd-1x215.
 *
 * This is intentionally tiny and dependency-free so it can be imported from
 * both the agent runtime (to record events) and the health score service
 * (to compute error rate) without circular imports.
 */

interface ErrorEvent {
  ts: number;
  kind: string;
}

const errorEventsByAgent = new Map<string, ErrorEvent[]>();

function pruneOldEvents(events: ErrorEvent[], nowMs: number, windowMs: number) {
  const cutoff = nowMs - windowMs;
  // Avoid non-null assertions while keeping this hot-path allocation-free.
  while (events.length > 0) {
    const first = events[0];
    if (!first || first.ts >= cutoff) break;
    events.shift();
  }
}

function getMaxTrackedWindowMs(): number {
  // We currently track minute-scale windows; keep 10 minutes for safety.
  return 10 * 60_000;
}

export function recordAgentErrorEvent(agentId: string, kind: string): void {
  const now = Date.now();
  const events = errorEventsByAgent.get(agentId) ?? [];
  events.push({ ts: now, kind });

  if (events.length > 500) {
    events.splice(0, events.length - 500);
  }

  pruneOldEvents(events, now, getMaxTrackedWindowMs());
  errorEventsByAgent.set(agentId, events);
}

export function getAgentErrorRatePerMinute(
  agentId: string,
  windowMs = 60_000,
): number {
  const now = Date.now();
  const events = errorEventsByAgent.get(agentId) ?? [];
  pruneOldEvents(events, now, getMaxTrackedWindowMs());

  const cutoff = now - windowMs;
  let count = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.ts < cutoff) break;
    count++;
  }

  const minutes = windowMs / 60_000;
  return minutes > 0 ? count / minutes : 0;
}

export function clearAgentErrorEvents(agentId?: string): void {
  if (agentId) {
    errorEventsByAgent.delete(agentId);
    return;
  }
  errorEventsByAgent.clear();
}
