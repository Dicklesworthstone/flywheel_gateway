import { z } from "zod";
import { defineCommand } from "../define";
import { agentCommands } from "./agent";

export * from "./agent";

export const listCheckpointsCmd = defineCommand({
  name: "checkpoint.list",
  description: "List checkpoints across agents",
  input: z.object({
    agentId: z.string().optional(),
    limit: z.number().min(1).max(200).optional(),
  }),
  output: z.object({
    checkpoints: z.array(z.record(z.string(), z.unknown())),
  }),
  rest: { method: "GET", path: "/sessions/checkpoints" },
  metadata: { permissions: ["checkpoint:read"], safe: true },
  aiHints: {
    whenToUse: "Use to inspect saved agent state checkpoints",
    examples: ["List checkpoints for an agent"],
    relatedCommands: ["checkpoint.compact"],
  },
});

export const compactCheckpointsCmd = defineCommand({
  name: "checkpoint.compact",
  description: "Execute retention compaction for an agent's checkpoints",
  input: z.object({
    agentId: z.string(),
    dryRun: z.boolean().optional(),
  }),
  output: z.object({
    agentId: z.string(),
    deletedCount: z.number(),
    retainedCount: z.number(),
  }),
  rest: { method: "POST", path: "/sessions/:agentId/checkpoints/compact" },
  metadata: { permissions: ["checkpoint:write"], audit: true },
  aiHints: {
    whenToUse: "Use to prune old checkpoints for an agent",
    examples: ["Compact checkpoints for agent-1"],
    relatedCommands: ["checkpoint.list"],
  },
});

export const contextRotationStatusCmd = defineCommand({
  name: "context.status",
  description: "Get context rotation status and token headroom for a session",
  input: z.object({
    sessionId: z.string(),
    maxTokens: z.number().optional(),
  }),
  output: z.object({
    sessionId: z.string(),
    shouldRotate: z.boolean(),
    utilizationPercent: z.number().optional(),
  }),
  rest: { method: "GET", path: "/sessions/:sessionId/context/rotation" },
  metadata: { permissions: ["context:read"], safe: true },
  aiHints: {
    whenToUse: "Use to check if an agent session needs context rotation",
    examples: ["Check context rotation status for session-1"],
    relatedCommands: ["context.rotate"],
  },
});

export const rotateContextCmd = defineCommand({
  name: "context.rotate",
  description: "Rotate context and generate handoff summary for a session",
  input: z.object({
    sessionId: z.string(),
    reason: z.string().optional(),
  }),
  output: z.object({
    sessionId: z.string(),
    rotated: z.boolean(),
  }),
  rest: { method: "POST", path: "/sessions/:sessionId/context/rotate" },
  metadata: { permissions: ["context:write"], audit: true },
  aiHints: {
    whenToUse: "Use when context token utilization is high and needs rotation",
    examples: ["Rotate context for session-1"],
    relatedCommands: ["context.status"],
  },
});

export const listApprovalsCmd = defineCommand({
  name: "approval.list",
  description: "List safety approval requests",
  input: z.object({
    status: z
      .enum(["pending", "approved", "denied", "expired", "cancelled"])
      .optional(),
    agentId: z.string().optional(),
  }),
  output: z.object({
    approvals: z.array(z.record(z.string(), z.unknown())),
  }),
  rest: { method: "GET", path: "/safety/approvals" },
  metadata: { permissions: ["safety:read"], safe: true },
  aiHints: {
    whenToUse: "Use to inspect pending or historical safety approval requests",
    examples: ["List pending safety approvals"],
    relatedCommands: ["approval.create", "approval.decide"],
  },
});

export const createApprovalCmd = defineCommand({
  name: "approval.create",
  description: "Create a safety approval request",
  input: z.object({
    agentId: z.string(),
    sessionId: z.string(),
    workspaceId: z.string(),
    operation: z.string(),
    description: z.string(),
  }),
  output: z.object({
    id: z.string(),
    status: z.string(),
  }),
  rest: { method: "POST", path: "/safety/approvals" },
  metadata: { permissions: ["safety:write"], audit: true },
  aiHints: {
    whenToUse: "Use to request human approval for a sensitive operation",
    examples: ["Request approval for git push"],
    relatedCommands: ["approval.list", "approval.decide"],
  },
});

export const decideApprovalCmd = defineCommand({
  name: "approval.decide",
  description: "Approve or deny a pending safety approval request",
  input: z.object({
    requestId: z.string(),
    decision: z.enum(["approved", "denied"]),
    decidedBy: z.string(),
    reason: z.string().optional(),
  }),
  output: z.object({
    id: z.string(),
    status: z.string(),
  }),
  rest: { method: "POST", path: "/safety/approvals/:requestId/decide" },
  metadata: { permissions: ["safety:write"], audit: true },
  aiHints: {
    whenToUse: "Use to approve or deny a pending safety request",
    examples: ["Approve request appr_123"],
    relatedCommands: ["approval.list", "approval.create"],
  },
});

export const gitCoordStatusCmd = defineCommand({
  name: "conflict.gitstatus",
  description: "Get multi-agent git coordination and sync statistics",
  input: z.object({
    repositoryId: z.string().optional(),
  }),
  output: z.object({
    stats: z.record(z.string(), z.unknown()),
  }),
  rest: { method: "GET", path: "/conflicts/git/sync-stats" },
  metadata: { permissions: ["conflict:read"], safe: true },
  aiHints: {
    whenToUse: "Use to inspect multi-agent git sync statistics",
    examples: ["Get git coordination status"],
    relatedCommands: ["conflict.gitactive"],
  },
});

export const gitActiveConflictsCmd = defineCommand({
  name: "conflict.gitactive",
  description: "List active git branch assignments for a repository",
  input: z.object({
    repositoryId: z.string(),
  }),
  output: z.object({
    assignments: z.array(z.record(z.string(), z.unknown())),
  }),
  rest: { method: "GET", path: "/conflicts/git/branches/:repositoryId" },
  metadata: { permissions: ["conflict:read"], safe: true },
  aiHints: {
    whenToUse: "Use to check active git branch assignments across agents",
    examples: ["List git branches for repo-1"],
    relatedCommands: ["conflict.gitstatus"],
  },
});

export const ruSyncStatusCmd = defineCommand({
  name: "rusync.status",
  description: "Get Repo Updater (RU) fleet synchronization statistics",
  input: z.object({}),
  output: z.object({
    stats: z.record(z.string(), z.unknown()),
  }),
  rest: { method: "GET", path: "/ru/sync/stats" },
  metadata: { permissions: ["ru:read"], safe: true },
  aiHints: {
    whenToUse: "Use to inspect RU sync statistics",
    examples: ["Check RU sync stats"],
    relatedCommands: ["rusync.history"],
  },
});

export const ruSyncHistoryCmd = defineCommand({
  name: "rusync.history",
  description: "List recent Repo Updater (RU) synchronization operations",
  input: z.object({
    limit: z.number().min(1).max(200).optional(),
  }),
  output: z.object({
    operations: z.array(z.record(z.string(), z.unknown())),
  }),
  rest: { method: "GET", path: "/ru/sync/history" },
  metadata: { permissions: ["ru:read"], safe: true },
  aiHints: {
    whenToUse: "Use to view historical RU sync operations",
    examples: ["Get RU sync history"],
    relatedCommands: ["rusync.status"],
  },
});

export const setupInstallPlanCmd = defineCommand({
  name: "setup.installplan",
  description: "Generate a deterministic tool installation plan",
  input: z.object({
    platform: z.enum(["linux", "darwin", "win32"]).optional(),
  }),
  output: z.object({
    steps: z.array(z.record(z.string(), z.unknown())),
    totalTools: z.number(),
  }),
  rest: { method: "GET", path: "/setup/install-plan" },
  metadata: { permissions: ["setup:read"], safe: true },
  aiHints: {
    whenToUse: "Use to compute the ordered installation plan for toolchain",
    examples: ["Get setup install plan"],
    relatedCommands: ["setup.compatibility"],
  },
});

export const setupCompatibilityCmd = defineCommand({
  name: "setup.compatibility",
  description: "Validate tool registry schema version and compatibility",
  input: z.object({
    version: z.string().optional(),
  }),
  output: z.object({
    currentSchemaVersion: z.string(),
    requestedVersion: z.string(),
  }),
  rest: { method: "GET", path: "/setup/compatibility" },
  metadata: { permissions: ["setup:read"], safe: true },
  aiHints: {
    whenToUse: "Use to verify tool registry schema compatibility",
    examples: ["Check setup registry compatibility"],
    relatedCommands: ["setup.installplan"],
  },
});

export const listFeatureFlagsCmd = defineCommand({
  name: "featureflag.list",
  description: "List all feature flags and rollout rules",
  input: z.object({}),
  output: z.object({
    flags: z.array(z.record(z.string(), z.unknown())),
  }),
  rest: { method: "GET", path: "/feature-flags" },
  metadata: { permissions: ["config:read"], safe: true },
  aiHints: {
    whenToUse: "Use to inspect active feature flags and kill-switch states",
    examples: ["List feature flags"],
    relatedCommands: ["featureflag.evaluate"],
  },
});

export const evaluateFeatureFlagCmd = defineCommand({
  name: "featureflag.evaluate",
  description: "Evaluate a feature flag for a workspace or actor",
  input: z.object({
    key: z.string(),
    workspaceId: z.string().optional(),
    actorId: z.string().optional(),
  }),
  output: z.object({
    key: z.string(),
    enabled: z.boolean(),
    reason: z.string(),
  }),
  rest: { method: "POST", path: "/feature-flags/:key/evaluate" },
  metadata: { permissions: ["config:read"], audit: true },
  aiHints: {
    whenToUse: "Use to evaluate whether a feature flag is enabled for context",
    examples: ["Evaluate feature flag fast-ws-compression"],
    relatedCommands: ["featureflag.list"],
  },
});

export const listCostCapsCmd = defineCommand({
  name: "costcap.list",
  description: "List workspace cost cap policies",
  input: z.object({}),
  output: z.object({
    policies: z.array(z.record(z.string(), z.unknown())),
  }),
  rest: { method: "GET", path: "/cost-caps" },
  metadata: { permissions: ["cost:read"], safe: true },
  aiHints: {
    whenToUse: "Use to view workspace soft and hard cost cap policies",
    examples: ["List workspace cost caps"],
    relatedCommands: ["costcap.evaluate"],
  },
});

export const evaluateCostCapCmd = defineCommand({
  name: "costcap.evaluate",
  description: "Evaluate workspace cost cap policy and auto-throttle state",
  input: z.object({
    workspaceId: z.string(),
    requestedModel: z.string(),
    isEssentialSafetyOrMaintenance: z.boolean().optional(),
  }),
  output: z.object({
    workspaceId: z.string(),
    allowed: z.boolean(),
    action: z.string(),
    effectiveModel: z.string(),
  }),
  rest: { method: "POST", path: "/cost-caps/evaluate" },
  metadata: { permissions: ["cost:write"], audit: true },
  aiHints: {
    whenToUse: "Use to check if a workspace is within cost caps or throttled",
    examples: ["Evaluate cost cap for workspace ws-1"],
    relatedCommands: ["costcap.list"],
  },
});

export const evaluateRoutingCmd = defineCommand({
  name: "routing.evaluate",
  description: "Evaluate model routing policy and failover chain",
  input: z.object({
    agentId: z.string().optional(),
    workspaceId: z.string().optional(),
    taskType: z.string().optional(),
    contextHeadroomPercent: z.number().optional(),
  }),
  output: z.object({
    id: z.string(),
    provider: z.string(),
    model: z.string(),
    failoverCount: z.number(),
  }),
  rest: { method: "POST", path: "/routing/evaluate" },
  metadata: { permissions: ["routing:write"], audit: true },
  aiHints: {
    whenToUse: "Use to select the optimal model and provider for a task",
    examples: ["Evaluate model routing for coding task"],
    relatedCommands: ["routing.policies"],
  },
});

export const listRoutingPoliciesCmd = defineCommand({
  name: "routing.policies",
  description: "List configured model routing policies",
  input: z.object({}),
  output: z.object({
    policies: z.array(z.record(z.string(), z.unknown())),
  }),
  rest: { method: "GET", path: "/routing/policies" },
  metadata: { permissions: ["routing:read"], safe: true },
  aiHints: {
    whenToUse: "Use to inspect model routing policies and failover chains",
    examples: ["List model routing policies"],
    relatedCommands: ["routing.evaluate"],
  },
});

export const listSlosCmd = defineCommand({
  name: "slo.list",
  description: "Get service-level objective (SLO) error budgets and burn rates",
  input: z.object({}),
  output: z.object({
    slos: z.array(z.record(z.string(), z.unknown())),
  }),
  rest: { method: "GET", path: "/slo/status" },
  metadata: { permissions: ["ops:read"], safe: true },
  aiHints: {
    whenToUse: "Use to monitor Gateway SLO targets and error budget burn rates",
    examples: ["List Gateway SLO statuses"],
    relatedCommands: ["runbook.list"],
  },
});

export const listRunbooksCmd = defineCommand({
  name: "runbook.list",
  description: "List operational incident runbooks",
  input: z.object({
    category: z.string().optional(),
  }),
  output: z.object({
    runbooks: z.array(z.record(z.string(), z.unknown())),
  }),
  rest: { method: "GET", path: "/runbooks" },
  metadata: { permissions: ["ops:read"], safe: true },
  aiHints: {
    whenToUse: "Use to retrieve automated remediation steps for incidents",
    examples: ["List operational runbooks"],
    relatedCommands: ["slo.list"],
  },
});

export const getMaintenanceStatusCmd = defineCommand({
  name: "maintenance.status",
  description: "Get Gateway maintenance and drain mode status",
  input: z.object({}),
  output: z.object({
    mode: z.enum(["normal", "draining", "maintenance"]),
    reason: z.string().optional(),
  }),
  rest: { method: "GET", path: "/system/maintenance" },
  metadata: { permissions: ["ops:read"], safe: true },
  aiHints: {
    whenToUse: "Use to check if the Gateway is in maintenance or drain mode",
    examples: ["Get maintenance status"],
    relatedCommands: ["maintenance.update"],
  },
});

export const updateMaintenanceModeCmd = defineCommand({
  name: "maintenance.update",
  description: "Transition Gateway maintenance or drain mode",
  input: z.object({
    enabled: z.boolean(),
    deadlineSeconds: z.number().optional(),
    reason: z.string().optional(),
    actor: z.string().optional(),
  }),
  output: z.object({
    mode: z.enum(["normal", "draining", "maintenance"]),
  }),
  rest: { method: "POST", path: "/system/maintenance" },
  metadata: { permissions: ["ops:write"], audit: true },
  aiHints: {
    whenToUse: "Use to enter or exit Gateway drain or maintenance mode",
    examples: ["Set maintenance mode to draining"],
    relatedCommands: ["maintenance.status"],
  },
});

export const getAuditRedactionCmd = defineCommand({
  name: "audit.redaction",
  description: "Get audit log PII redaction policy and statistics",
  input: z.object({}),
  output: z.object({
    policy: z.record(z.string(), z.unknown()),
  }),
  rest: { method: "GET", path: "/audit/redaction" },
  metadata: { permissions: ["audit:read"], safe: true },
  aiHints: {
    whenToUse: "Use to inspect audit PII redaction rules",
    examples: ["Check audit redaction policy"],
    relatedCommands: ["circuit.list"],
  },
});

export const listCircuitsCmd = defineCommand({
  name: "circuit.list",
  description: "List adaptive circuit breaker states for dependencies",
  input: z.object({}),
  output: z.object({
    breakers: z.array(z.record(z.string(), z.unknown())),
  }),
  rest: { method: "GET", path: "/circuits" },
  metadata: { permissions: ["ops:read"], safe: true },
  aiHints: {
    whenToUse: "Use to inspect circuit breaker states and quarantine status",
    examples: ["List circuit breakers"],
    relatedCommands: ["audit.redaction"],
  },
});

export const getWsReplayStatsCmd = defineCommand({
  name: "wsreplay.stats",
  description: "Get WebSocket event replay buffer statistics",
  input: z.object({}),
  output: z.object({
    bufferedEvents: z.number(),
    channels: z.number(),
  }),
  rest: { method: "GET", path: "/ws-replay/stats" },
  metadata: { permissions: ["ws:read"], safe: true },
  aiHints: {
    whenToUse: "Use to check WebSocket reconnection replay buffer statistics",
    examples: ["Get ws-replay stats"],
    relatedCommands: ["collaboration.bridgestatus"],
  },
});

export const getCollaborationBridgeStatusCmd = defineCommand({
  name: "collaboration.bridgestatus",
  description:
    "Get Graph Bridge real-time conflict/BV/Mail event bridge status",
  input: z.object({}),
  output: z.object({
    active: z.boolean(),
  }),
  rest: { method: "GET", path: "/collaboration/bridge/status" },
  metadata: { permissions: ["collaboration:read"], safe: true },
  aiHints: {
    whenToUse: "Use to inspect the real-time collaboration graph event bridge",
    examples: ["Get collaboration graph bridge status"],
    relatedCommands: ["wsreplay.stats"],
  },
});

export const domainCommands = [
  listCheckpointsCmd,
  compactCheckpointsCmd,
  contextRotationStatusCmd,
  rotateContextCmd,
  listApprovalsCmd,
  createApprovalCmd,
  decideApprovalCmd,
  gitCoordStatusCmd,
  gitActiveConflictsCmd,
  ruSyncStatusCmd,
  ruSyncHistoryCmd,
  setupInstallPlanCmd,
  setupCompatibilityCmd,
  listFeatureFlagsCmd,
  evaluateFeatureFlagCmd,
  listCostCapsCmd,
  evaluateCostCapCmd,
  evaluateRoutingCmd,
  listRoutingPoliciesCmd,
  listSlosCmd,
  listRunbooksCmd,
  getMaintenanceStatusCmd,
  updateMaintenanceModeCmd,
  getAuditRedactionCmd,
  listCircuitsCmd,
  getWsReplayStatsCmd,
  getCollaborationBridgeStatusCmd,
] as const;

export const allCommands = [...agentCommands, ...domainCommands] as const;
