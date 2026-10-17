/**
 * HATEOAS Link Generation Utilities.
 *
 * Provides reusable utilities for generating consistent HATEOAS links
 * across all resource types. This centralizes link generation to ensure
 * consistency and reduce duplication in route handlers.
 */

import type { Context } from "hono";

// ============================================================================
// Core Types
// ============================================================================

/**
 * A set of HATEOAS links for a resource.
 * Always includes 'self', may include action links.
 */
export interface LinkSet {
  self: string;
  [key: string]: string;
}

/**
 * Context for link generation, providing the base URL.
 */
export interface LinkGeneratorContext {
  /** Base URL without trailing slash (e.g., "https://api.example.com") */
  baseUrl: string;
}

/**
 * A function that generates links for a specific resource type.
 * @template T The resource type containing required ID fields
 */
export type LinkGenerator<T> = (
  resource: T,
  context: LinkGeneratorContext,
) => LinkSet;

// ============================================================================
// URL Utilities
// ============================================================================

/**
 * Convert HTTP URL to WebSocket URL.
 * Handles both http→ws and https→wss correctly.
 */
export function toWebSocketUrl(httpUrl: string): string {
  const url = new URL(httpUrl);
  const protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${url.host}`;
}

/**
 * Extract link generator context from Hono context.
 *
 * @param c - Hono context
 * @returns Link generator context with base URL
 *
 * @example
 * ```typescript
 * app.get("/agents/:id", (c) => {
 *   const ctx = getLinkContext(c);
 *   const links = agentLinks({ agentId: "agent_123" }, ctx);
 *   return sendResource(c, "agent", data, 200, { links });
 * });
 * ```
 */
export function getLinkContext(c: Context): LinkGeneratorContext {
  const url = new URL(c.req.url);
  return {
    baseUrl: `${url.protocol}//${url.host}`,
  };
}

// ============================================================================
// Agent Links
// ============================================================================

/**
 * Generate HATEOAS links for an agent resource.
 *
 * @example
 * ```typescript
 * const links = agentLinks({ agentId: "agent_123" }, ctx);
 * // {
 * //   self: "https://api.example.com/agents/agent_123",
 * //   output: "https://api.example.com/agents/agent_123/output",
 * //   status: "https://api.example.com/agents/agent_123/status",
 * //   terminate: "https://api.example.com/agents/agent_123",
 * //   send: "https://api.example.com/agents/agent_123/send",
 * //   interrupt: "https://api.example.com/agents/agent_123/interrupt",
 * //   ws: "wss://api.example.com/ws"
 * // }
 * ```
 */
export const agentLinks: LinkGenerator<{ agentId: string }> = (agent, ctx) => ({
  self: `${ctx.baseUrl}/agents/${agent.agentId}`,
  output: `${ctx.baseUrl}/agents/${agent.agentId}/output`,
  status: `${ctx.baseUrl}/agents/${agent.agentId}/status`,
  terminate: `${ctx.baseUrl}/agents/${agent.agentId}`,
  send: `${ctx.baseUrl}/agents/${agent.agentId}/send`,
  interrupt: `${ctx.baseUrl}/agents/${agent.agentId}/interrupt`,
  ws: `${toWebSocketUrl(ctx.baseUrl)}/ws`,
});

/**
 * Generate minimal self-only link for agent in list context.
 */
export const agentListLinks: LinkGenerator<{ agentId: string }> = (
  agent,
  ctx,
) => ({
  self: `${ctx.baseUrl}/agents/${agent.agentId}`,
});

// ============================================================================
// Reservation Links
// ============================================================================

/**
 * Generate HATEOAS links for a reservation resource.
 */
export const reservationLinks: LinkGenerator<{ id: string }> = (res, ctx) => ({
  self: `${ctx.baseUrl}/reservations/${res.id}`,
  release: `${ctx.baseUrl}/reservations/${res.id}`,
  renew: `${ctx.baseUrl}/reservations/${res.id}/renew`,
});

// ============================================================================
// Checkpoint Links
// ============================================================================

/**
 * Generate HATEOAS links for a checkpoint resource.
 */
export const checkpointLinks: LinkGenerator<{
  id: string;
  sessionId: string;
}> = (chk, ctx) => ({
  self: `${ctx.baseUrl}/sessions/${chk.sessionId}/checkpoints/${chk.id}`,
  restore: `${ctx.baseUrl}/sessions/${chk.sessionId}/checkpoints/${chk.id}/restore`,
  export: `${ctx.baseUrl}/sessions/${chk.sessionId}/checkpoints/${chk.id}/export`,
  delete: `${ctx.baseUrl}/sessions/${chk.sessionId}/checkpoints/${chk.id}`,
});

/**
 * Generate minimal self-only link for checkpoint in list context.
 */
export const checkpointListLinks: LinkGenerator<{
  id: string;
  sessionId: string;
}> = (chk, ctx) => ({
  self: `${ctx.baseUrl}/sessions/${chk.sessionId}/checkpoints/${chk.id}`,
});

// ============================================================================
// Conflict Links
// ============================================================================

/**
 * Generate HATEOAS links for a conflict resource.
 */
export const conflictLinks: LinkGenerator<{ id: string }> = (
  conflict,
  ctx,
) => ({
  self: `${ctx.baseUrl}/conflicts/${conflict.id}`,
  resolve: `${ctx.baseUrl}/conflicts/${conflict.id}/resolve`,
});

// ============================================================================
// Bead Links
// ============================================================================

/**
 * Generate HATEOAS links for a bead (issue) resource.
 *
 * Includes links for:
 * - Standard CRUD operations (self, update, close, claim)
 * - Mail thread coordination (mail_thread) - for viewing/creating Agent Mail
 *   threads associated with this bead ID
 *
 * @example
 * ```typescript
 * const links = beadLinks({ id: "bd-123" }, ctx);
 * // {
 * //   self: "https://api.example.com/beads/bd-123",
 * //   update: "https://api.example.com/beads/bd-123",
 * //   close: "https://api.example.com/beads/bd-123/close",
 * //   claim: "https://api.example.com/beads/bd-123/claim",
 * //   mail_thread: "https://api.example.com/mail/threads/bd-123"
 * // }
 * ```
 */
export const beadLinks: LinkGenerator<{ id: string }> = (bead, ctx) => ({
  self: `${ctx.baseUrl}/beads/${bead.id}`,
  update: `${ctx.baseUrl}/beads/${bead.id}`,
  close: `${ctx.baseUrl}/beads/${bead.id}/close`,
  claim: `${ctx.baseUrl}/beads/${bead.id}/claim`,
  mail_thread: `${ctx.baseUrl}/mail/threads/${bead.id}`,
});

/**
 * Generate threading hints for a bead.
 *
 * Returns an object with hints for using the bead ID as a thread_id
 * in Agent Mail communications. This standardizes the practice of
 * using bead IDs (e.g., "bd-123") as thread identifiers for
 * coordinating multi-agent work on the same issue.
 *
 * @example
 * ```typescript
 * const hints = beadThreadingHints({ id: "bd-123" });
 * // {
 * //   thread_id: "bd-123",
 * //   subject_prefix: "[bd-123]",
 * //   usage: "Use thread_id when sending Agent Mail about this bead"
 * // }
 * ```
 */
export function beadThreadingHints(bead: { id: string }): {
  thread_id: string;
  subject_prefix: string;
  usage: string;
} {
  return {
    thread_id: bead.id,
    subject_prefix: `[${bead.id}]`,
    usage: "Use thread_id when sending Agent Mail about this bead",
  };
}

// ============================================================================
// Message Links
// ============================================================================

/**
 * Generate HATEOAS links for a mail message resource.
 */
export const messageLinks: LinkGenerator<{ id: string }> = (msg, ctx) => ({
  self: `${ctx.baseUrl}/mail/messages/${msg.id}`,
  reply: `${ctx.baseUrl}/mail/messages/${msg.id}/reply`,
});

/**
 * Generate HATEOAS links for a mail thread resource.
 */
export const threadLinks: LinkGenerator<{ threadId: string }> = (
  thread,
  ctx,
) => ({
  self: `${ctx.baseUrl}/mail/threads/${thread.threadId}`,
  messages: `${ctx.baseUrl}/mail/threads/${thread.threadId}/messages`,
});

// ============================================================================
// DCG Links
// ============================================================================

/**
 * Generate HATEOAS links for an allowlist entry resource.
 */
export const allowlistLinks: LinkGenerator<{ ruleId: string }> = (
  entry,
  ctx,
) => ({
  self: `${ctx.baseUrl}/dcg/allowlist/${entry.ruleId}`,
  delete: `${ctx.baseUrl}/dcg/allowlist/${entry.ruleId}`,
});

/**
 * Generate HATEOAS links for a pending exception resource.
 */
export const pendingExceptionLinks: LinkGenerator<{ shortCode: string }> = (
  exception,
  ctx,
) => ({
  self: `${ctx.baseUrl}/dcg/pending/${exception.shortCode}`,
  approve: `${ctx.baseUrl}/dcg/pending/${exception.shortCode}/approve`,
  deny: `${ctx.baseUrl}/dcg/pending/${exception.shortCode}/deny`,
});

// ============================================================================
// Supervisor Links
// ============================================================================

/**
 * Generate HATEOAS links for a daemon resource.
 */
export const daemonLinks: LinkGenerator<{ name: string }> = (daemon, ctx) => ({
  self: `${ctx.baseUrl}/supervisor/${daemon.name}/status`,
  start: `${ctx.baseUrl}/supervisor/${daemon.name}/start`,
  stop: `${ctx.baseUrl}/supervisor/${daemon.name}/stop`,
  restart: `${ctx.baseUrl}/supervisor/${daemon.name}/restart`,
  logs: `${ctx.baseUrl}/supervisor/${daemon.name}/logs`,
});

// ============================================================================
// Job Links
// ============================================================================

/**
 * Generate HATEOAS links for a job resource.
 */
export const jobLinks: LinkGenerator<{ id: string }> = (job, ctx) => ({
  self: `${ctx.baseUrl}/jobs/${job.id}`,
  cancel: `${ctx.baseUrl}/jobs/${job.id}/cancel`,
  retry: `${ctx.baseUrl}/jobs/${job.id}/retry`,
  pause: `${ctx.baseUrl}/jobs/${job.id}/pause`,
  resume: `${ctx.baseUrl}/jobs/${job.id}/resume`,
  output: `${ctx.baseUrl}/jobs/${job.id}/output`,
  logs: `${ctx.baseUrl}/jobs/${job.id}/logs`,
});

/**
 * Generate minimal self-only link for job in list context.
 */
export const jobListLinks: LinkGenerator<{ id: string }> = (job, ctx) => ({
  self: `${ctx.baseUrl}/jobs/${job.id}`,
});
