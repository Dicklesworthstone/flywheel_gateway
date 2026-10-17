/**
 * Reservation Negotiation Protocol Service (bd-2befy)
 *
 * Resolves multi-agent file reservation conflicts via configurable negotiation
 * policies and an explicit negotiation state machine:
 * - Resolution strategies: WAIT, REQUEST_HANDOFF, PRIORITY_PREEMPT, FORCE_ACQUIRE, SPLIT_SCOPE
 * - Policy conditions: holderInactiveForSeconds, reservationAgeSeconds, requesterPriority, scopeOverlap
 * - Negotiation lifecycle: pending -> approved | denied | counter_proposed | preempted | auto_released
 */

import { ulid } from "ulid";
import { z } from "zod";

// ============================================================================
// Schemas & Types
// ============================================================================

export const ResolutionStrategySchema = z.enum([
  "WAIT",
  "REQUEST_HANDOFF",
  "PRIORITY_PREEMPT",
  "FORCE_ACQUIRE",
  "SPLIT_SCOPE",
]);

export const NegotiationPolicyActionSchema = z.enum([
  "auto_release",
  "request_handoff",
  "priority_preempt",
  "wait",
]);

export const CreateNegotiationPolicySchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(120),
  priority: z.number().int().min(1).max(10_000).default(100),
  condition: z.object({
    holderInactiveForSeconds: z.number().min(0).optional(),
    reservationAgeSeconds: z.number().min(0).optional(),
    requesterPriority: z.enum(["higher", "same", "any"]).default("any"),
    scopeOverlap: z.enum(["full", "partial", "any"]).default("any"),
  }),
  action: NegotiationPolicyActionSchema,
  timeoutSeconds: z.number().int().min(5).max(3600).default(120),
});

export const InitiateNegotiationSchema = z.object({
  reservationId: z.string().min(1),
  requesterAgentId: z.string().min(1),
  holderAgentId: z.string().min(1),
  requestedPaths: z.array(z.string().min(1)).min(1),
  holderPaths: z.array(z.string().min(1)).min(1),
  requesterTaskPriority: z.number().int().min(0).max(10).default(5),
  holderTaskPriority: z.number().int().min(0).max(10).default(5),
  holderInactiveForSeconds: z.number().min(0).default(0),
  reservationAgeSeconds: z.number().min(0).default(60),
  forceAdminAcquire: z.boolean().default(false),
});

export const RespondNegotiationSchema = z.object({
  decision: z.enum(["approve", "deny", "counter_propose"]),
  counterPaths: z.array(z.string().min(1)).optional(),
  reason: z.string().max(400).optional(),
});

export type ResolutionStrategy = z.infer<typeof ResolutionStrategySchema>;
export type NegotiationPolicy = z.infer<
  typeof CreateNegotiationPolicySchema
> & {
  id: string;
};

export interface ReservationNegotiationRecord {
  id: string;
  reservationId: string;
  requesterAgentId: string;
  holderAgentId: string;
  requestedPaths: string[];
  holderPaths: string[];
  scopeOverlap: "full" | "partial";
  nonOverlappingPaths: string[];
  proposedStrategy: ResolutionStrategy;
  matchedPolicyId: string | null;
  status:
    | "pending_holder_response"
    | "auto_released"
    | "preempted"
    | "force_acquired"
    | "split_scope_proposed"
    | "approved"
    | "denied"
    | "counter_proposed";
  estimatedWaitSeconds?: number;
  counterPaths?: string[];
  auditTrail: Array<{
    step: string;
    detail: string;
    timestamp: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Built-In Policies & Stores
// ============================================================================

const DEFAULT_POLICIES: NegotiationPolicy[] = [
  {
    id: "neg_pol_stale_inactive",
    name: "Auto-Release Stale Inactive Holder",
    priority: 1000,
    condition: {
      holderInactiveForSeconds: 300,
      reservationAgeSeconds: 600,
      requesterPriority: "any",
      scopeOverlap: "any",
    },
    action: "auto_release",
    timeoutSeconds: 60,
  },
  {
    id: "neg_pol_higher_priority_preempt",
    name: "Higher Priority Task Preemption",
    priority: 500,
    condition: {
      holderInactiveForSeconds: 60,
      requesterPriority: "higher",
      scopeOverlap: "any",
    },
    action: "priority_preempt",
    timeoutSeconds: 60,
  },
  {
    id: "neg_pol_default_handoff",
    name: "Standard Handoff Request",
    priority: 100,
    condition: {
      requesterPriority: "any",
      scopeOverlap: "any",
    },
    action: "request_handoff",
    timeoutSeconds: 120,
  },
];

const policiesStore = new Map<string, NegotiationPolicy>();
const negotiationsStore = new Map<string, ReservationNegotiationRecord>();

function ensureDefaultPolicies(): void {
  if (policiesStore.size === 0) {
    for (const p of DEFAULT_POLICIES) {
      policiesStore.set(p.id, structuredClone(p));
    }
  }
}

export function listNegotiationPolicies(): NegotiationPolicy[] {
  ensureDefaultPolicies();
  return Array.from(policiesStore.values()).sort(
    (a, b) => b.priority - a.priority,
  );
}

export function createNegotiationPolicy(
  input: z.input<typeof CreateNegotiationPolicySchema>,
): NegotiationPolicy {
  ensureDefaultPolicies();
  const parsed = CreateNegotiationPolicySchema.parse(input);
  const policy: NegotiationPolicy = {
    ...parsed,
    id: parsed.id ?? `neg_pol_${ulid()}`,
  };
  policiesStore.set(policy.id, policy);
  return policy;
}

// ============================================================================
// Conflict Assessment & Negotiation Execution
// ============================================================================

export function initiateReservationNegotiation(
  input: z.input<typeof InitiateNegotiationSchema>,
): ReservationNegotiationRecord {
  ensureDefaultPolicies();
  const parsed = InitiateNegotiationSchema.parse(input);
  const nowIso = new Date().toISOString();

  const overlapping = parsed.requestedPaths.filter((p) =>
    parsed.holderPaths.includes(p),
  );
  const nonOverlappingPaths = parsed.requestedPaths.filter(
    (p) => !parsed.holderPaths.includes(p),
  );
  const scopeOverlap: "full" | "partial" =
    nonOverlappingPaths.length > 0 && overlapping.length > 0
      ? "partial"
      : "full";

  const isHigherPriority =
    parsed.requesterTaskPriority < parsed.holderTaskPriority; // P0 < P2 (lower number = higher priority) or explicit numeric check
  const priorityRelation: "higher" | "same" =
    parsed.requesterTaskPriority !== parsed.holderTaskPriority &&
    (parsed.requesterTaskPriority < parsed.holderTaskPriority ||
      parsed.requesterTaskPriority > parsed.holderTaskPriority)
      ? parsed.requesterTaskPriority > parsed.holderTaskPriority
        ? "higher"
        : "same"
      : isHigherPriority
        ? "higher"
        : "same";

  const auditTrail: Array<{ step: string; detail: string; timestamp: string }> =
    [
      {
        step: "conflict_assessed",
        detail: `holderInactive=${parsed.holderInactiveForSeconds}s, age=${parsed.reservationAgeSeconds}s, overlap=${scopeOverlap}`,
        timestamp: nowIso,
      },
    ];

  let proposedStrategy: ResolutionStrategy = "REQUEST_HANDOFF";
  let status: ReservationNegotiationRecord["status"] =
    "pending_holder_response";
  let matchedPolicyId: string | null = null;

  if (parsed.forceAdminAcquire) {
    proposedStrategy = "FORCE_ACQUIRE";
    status = "force_acquired";
    auditTrail.push({
      step: "force_acquire",
      detail: "Admin force-acquired reservation with audit notification",
      timestamp: nowIso,
    });
  } else if (scopeOverlap === "partial" && nonOverlappingPaths.length > 0) {
    proposedStrategy = "SPLIT_SCOPE";
    status = "split_scope_proposed";
    auditTrail.push({
      step: "split_scope",
      detail: `Proposed non-overlapping scope: [${nonOverlappingPaths.join(", ")}]`,
      timestamp: nowIso,
    });
  } else {
    // Evaluate policies in descending priority order
    const policies = listNegotiationPolicies();
    for (const pol of policies) {
      if (
        pol.condition.holderInactiveForSeconds !== undefined &&
        parsed.holderInactiveForSeconds < pol.condition.holderInactiveForSeconds
      ) {
        continue;
      }
      if (
        pol.condition.reservationAgeSeconds !== undefined &&
        parsed.reservationAgeSeconds < pol.condition.reservationAgeSeconds
      ) {
        continue;
      }
      if (
        pol.condition.requesterPriority === "higher" &&
        priorityRelation !== "higher"
      ) {
        continue;
      }
      if (
        pol.condition.scopeOverlap !== "any" &&
        pol.condition.scopeOverlap !== scopeOverlap
      ) {
        continue;
      }

      matchedPolicyId = pol.id;
      if (pol.action === "auto_release") {
        proposedStrategy = "PRIORITY_PREEMPT";
        status = "auto_released";
      } else if (pol.action === "priority_preempt") {
        proposedStrategy = "PRIORITY_PREEMPT";
        status = "preempted";
      } else if (pol.action === "wait") {
        proposedStrategy = "WAIT";
        status = "pending_holder_response";
      } else {
        proposedStrategy = "REQUEST_HANDOFF";
        status = "pending_holder_response";
      }
      auditTrail.push({
        step: "policy_matched",
        detail: `Matched policy '${pol.name}' -> action=${pol.action}`,
        timestamp: nowIso,
      });
      break;
    }
  }

  const record: ReservationNegotiationRecord = {
    id: `rneg_${ulid()}`,
    reservationId: parsed.reservationId,
    requesterAgentId: parsed.requesterAgentId,
    holderAgentId: parsed.holderAgentId,
    requestedPaths: parsed.requestedPaths,
    holderPaths: parsed.holderPaths,
    scopeOverlap,
    nonOverlappingPaths,
    proposedStrategy,
    matchedPolicyId,
    status,
    ...(proposedStrategy === "WAIT" && {
      estimatedWaitSeconds: Math.max(30, 300 - parsed.reservationAgeSeconds),
    }),
    auditTrail,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  negotiationsStore.set(record.id, record);
  return record;
}

export function respondToReservationNegotiation(
  negotiationId: string,
  input: z.input<typeof RespondNegotiationSchema>,
): ReservationNegotiationRecord | undefined {
  const rec = negotiationsStore.get(negotiationId);
  if (!rec) return undefined;
  const parsed = RespondNegotiationSchema.parse(input);
  const nowIso = new Date().toISOString();

  if (parsed.decision === "approve") {
    rec.status = "approved";
  } else if (parsed.decision === "deny") {
    rec.status = "denied";
  } else {
    rec.status = "counter_proposed";
    if (parsed.counterPaths) {
      rec.counterPaths = parsed.counterPaths;
    }
  }

  rec.updatedAt = nowIso;
  rec.auditTrail.push({
    step: `holder_${parsed.decision}`,
    detail: parsed.reason ?? `Holder responded with ${parsed.decision}`,
    timestamp: nowIso,
  });

  return rec;
}

export function listReservationNegotiations(): ReservationNegotiationRecord[] {
  return Array.from(negotiationsStore.values());
}

export function clearNegotiationsForTesting(): void {
  policiesStore.clear();
  negotiationsStore.clear();
}
