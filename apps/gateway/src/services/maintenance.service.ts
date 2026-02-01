/**
 * Maintenance / Shutdown Coordinator (in-memory).
 *
 * This is intentionally process-local (single gateway instance semantics).
 * It provides:
 * - current lifecycle mode (running/maintenance/draining)
 * - optional drain deadline for Retry-After hints
 * - lightweight counters for observability (e.g., in-flight HTTP requests)
 */

import { logger } from "./logger";

export type MaintenanceMode = "running" | "maintenance" | "draining";

export interface MaintenanceActor {
  actor?: string;
  userId?: string;
  apiKeyId?: string;
}

export interface MaintenanceState {
  mode: MaintenanceMode;
  startedAt: Date | null;
  deadlineAt: Date | null;
  reason: string | null;
  updatedAt: Date;
  updatedBy: MaintenanceActor | null;
}

export interface MaintenanceSnapshot {
  mode: MaintenanceMode;
  startedAt: string | null;
  deadlineAt: string | null;
  retryAfterSeconds: number | null;
  reason: string | null;
  updatedAt: string;
  updatedBy: MaintenanceActor | null;
  http: {
    inflightRequests: number;
  };
}

const DEFAULT_STATE: MaintenanceState = {
  mode: "running",
  startedAt: null,
  deadlineAt: null,
  reason: null,
  updatedAt: new Date(),
  updatedBy: null,
};

let state: MaintenanceState = { ...DEFAULT_STATE };
let inflightHttpRequests = 0;

function sanitizeReason(reason: string | undefined): string | null {
  if (!reason) return null;
  const trimmed = reason.trim();
  if (trimmed.length === 0) return null;
  // Keep reasons short to avoid accidental log bloat / leakage.
  return trimmed.length > 500 ? `${trimmed.slice(0, 500)}...` : trimmed;
}

export function getMaintenanceState(): MaintenanceState {
  // Return a shallow copy to avoid accidental mutation.
  return { ...state };
}

export function getRetryAfterSeconds(now = Date.now()): number | null {
  if (!state.deadlineAt) return null;
  const msRemaining = state.deadlineAt.getTime() - now;
  if (msRemaining <= 0) return 0;
  return Math.ceil(msRemaining / 1000);
}

export function getMaintenanceSnapshot(now = Date.now()): MaintenanceSnapshot {
  return {
    mode: state.mode,
    startedAt: state.startedAt ? state.startedAt.toISOString() : null,
    deadlineAt: state.deadlineAt ? state.deadlineAt.toISOString() : null,
    retryAfterSeconds: getRetryAfterSeconds(now),
    reason: state.reason,
    updatedAt: state.updatedAt.toISOString(),
    updatedBy: state.updatedBy,
    http: {
      inflightRequests: inflightHttpRequests,
    },
  };
}

export function enterMaintenance(options?: {
  reason?: string;
  actor?: MaintenanceActor;
}): MaintenanceState {
  const now = new Date();
  const next = {
    mode: "maintenance",
    startedAt: now,
    deadlineAt: null,
    reason: sanitizeReason(options?.reason),
    updatedAt: now,
    updatedBy: options?.actor ?? null,
  } satisfies MaintenanceState;
  state = next;

  logger.info(
    {
      mode: next.mode,
      startedAt: next.startedAt.toISOString(),
      deadlineAt: null,
      updatedBy: next.updatedBy,
    },
    "Maintenance mode enabled",
  );

  return getMaintenanceState();
}

export function startDraining(options: {
  deadlineSeconds: number;
  reason?: string;
  actor?: MaintenanceActor;
}): MaintenanceState {
  const now = new Date();
  const deadlineAt = new Date(now.getTime() + options.deadlineSeconds * 1000);

  const next = {
    mode: "draining",
    startedAt: now,
    deadlineAt,
    reason: sanitizeReason(options.reason),
    updatedAt: now,
    updatedBy: options.actor ?? null,
  } satisfies MaintenanceState;
  state = next;

  logger.info(
    {
      mode: next.mode,
      startedAt: next.startedAt.toISOString(),
      deadlineAt: next.deadlineAt.toISOString(),
      updatedBy: next.updatedBy,
    },
    "Drain mode enabled",
  );

  return getMaintenanceState();
}

export function exitMaintenance(options?: { actor?: MaintenanceActor }): void {
  if (state.mode === "running") return;

  const now = new Date();
  state = {
    mode: "running",
    startedAt: null,
    deadlineAt: null,
    reason: null,
    updatedAt: now,
    updatedBy: options?.actor ?? null,
  };

  logger.info(
    { mode: state.mode, updatedBy: state.updatedBy },
    "Maintenance mode disabled",
  );
}

export function isMaintenanceActive(): boolean {
  return state.mode !== "running";
}

export function trackHttpRequestStart(): void {
  inflightHttpRequests++;
}

export function trackHttpRequestEnd(): void {
  inflightHttpRequests--;
  if (inflightHttpRequests >= 0) return;

  logger.warn(
    { inflightHttpRequests },
    "HTTP inflight request counter went negative; clamping to 0",
  );
  inflightHttpRequests = 0;
}

export function _resetMaintenanceStateForTests(): void {
  state = { ...DEFAULT_STATE };
  inflightHttpRequests = 0;
}
