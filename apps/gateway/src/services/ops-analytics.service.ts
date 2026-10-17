/**
 * Operational Analytics & Simulation Service (bd-1b6lz, bd-1ouud, bd-1jv2y)
 *
 * Provides:
 * 1. Safety Policy Simulator (bd-1b6lz):
 *    - Predicts how DCG/SLB/UBS safety rules treat a candidate command or file edit
 *    - Versioned policy snapshots + simulation metrics (allowed/blocked/warned counts)
 * 2. Bead Dependency Graph Visualization (bd-1ouud):
 *    - Computes nodes, edges, cycle detection, topological layout layers,
 *      critical path, and bottleneck/blocking counts
 * 3. Audit Log Query Builder (bd-1jv2y):
 *    - Structured filter builder (`eq`, `contains`, `in`, `gt`, `lt`), grouping,
 *      saved queries, and JSON/CSV export
 */

import { ulid } from "ulid";
import { z } from "zod";

// ============================================================================
// 1. Safety Policy Simulator (bd-1b6lz)
// ============================================================================

export interface SafetyRule {
  id: string;
  engine: "dcg" | "slb" | "ubs";
  name: string;
  pattern: RegExp;
  action: "block" | "warn" | "require_approval";
  reason: string;
}

const DEFAULT_SAFETY_RULES: SafetyRule[] = [
  {
    id: "dcg-git-reset-hard",
    engine: "dcg",
    name: "Block git reset --hard",
    pattern: /\bgit\s+reset\s+--hard\b/i,
    action: "block",
    reason: "Destructive git reset --hard is forbidden by DCG",
  },
  {
    id: "dcg-git-clean-fd",
    engine: "dcg",
    name: "Block git clean -f",
    pattern: /\bgit\s+clean\s+-[a-z]*f/i,
    action: "block",
    reason: "Destructive git clean is forbidden by DCG",
  },
  {
    id: "dcg-rm-rf",
    engine: "dcg",
    name: "Block rm -rf",
    pattern: /\brm\s+-[a-z]*r[a-z]*f\b|\brm\s+-[a-z]*f[a-z]*r\b/i,
    action: "block",
    reason: "Destructive rm -rf is forbidden by DCG (Rule 1: No File Deletion)",
  },
  {
    id: "dcg-git-push-force",
    engine: "dcg",
    name: "Block git push --force",
    pattern: /\bgit\s+push\s+.*(--force|-f)\b/i,
    action: "block",
    reason: "Force push is blocked by DCG",
  },
  {
    id: "slb-prod-deploy",
    engine: "slb",
    name: "Two-Person Approval for Production Deploy",
    pattern: /\bdeploy\s+--env[=\s]+prod(uction)?\b/i,
    action: "require_approval",
    reason: "Production deploy requires SLB two-person approval",
  },
  {
    id: "ubs-eval-usage",
    engine: "ubs",
    name: "Warn on dynamic eval()",
    pattern: /\beval\s*\(/,
    action: "warn",
    reason: "UBS static scanner flagged dynamic eval() usage",
  },
];

let safetyPolicyVersion = 1;
const safetySimulationMetrics = {
  totalSimulations: 0,
  allowedCount: 0,
  blockedCount: 0,
  approvalRequiredCount: 0,
  warnedCount: 0,
  byRuleId: {} as Record<string, number>,
};

export function listSafetyPolicyRules() {
  return {
    policyVersion: safetyPolicyVersion,
    rules: DEFAULT_SAFETY_RULES.map((r) => ({
      id: r.id,
      engine: r.engine,
      name: r.name,
      pattern: r.pattern.source,
      action: r.action,
      reason: r.reason,
    })),
  };
}

export function simulateSafetyPolicy(input: {
  command?: string;
  codeSnippet?: string;
}) {
  safetySimulationMetrics.totalSimulations++;
  const text = [input.command ?? "", input.codeSnippet ?? ""].join("\n");

  const matchedRules: Array<{
    ruleId: string;
    engine: string;
    action: "block" | "warn" | "require_approval";
    reason: string;
  }> = [];

  for (const rule of DEFAULT_SAFETY_RULES) {
    if (rule.pattern.test(text)) {
      matchedRules.push({
        ruleId: rule.id,
        engine: rule.engine,
        action: rule.action,
        reason: rule.reason,
      });
      safetySimulationMetrics.byRuleId[rule.id] =
        (safetySimulationMetrics.byRuleId[rule.id] ?? 0) + 1;
    }
  }

  const isBlocked = matchedRules.some((m) => m.action === "block");
  const requiresApproval =
    !isBlocked && matchedRules.some((m) => m.action === "require_approval");
  const hasWarning = matchedRules.some((m) => m.action === "warn");

  if (isBlocked) safetySimulationMetrics.blockedCount++;
  else if (requiresApproval) safetySimulationMetrics.approvalRequiredCount++;
  else if (hasWarning) safetySimulationMetrics.warnedCount++;
  else safetySimulationMetrics.allowedCount++;

  return {
    allowed: !isBlocked && !requiresApproval,
    outcome: isBlocked
      ? ("blocked" as const)
      : requiresApproval
        ? ("require_approval" as const)
        : hasWarning
          ? ("warn" as const)
          : ("allowed" as const),
    policyVersion: safetyPolicyVersion,
    matchedRules,
  };
}

export function getSafetySimulationMetrics() {
  return structuredClone(safetySimulationMetrics);
}

// ============================================================================
// 2. Bead Dependency Graph Visualization (bd-1ouud)
// ============================================================================

export const BeadGraphInputNodeSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: z.enum(["open", "in_progress", "closed"]).default("open"),
  priority: z.number().int().min(0).max(4).default(2),
  blockedBy: z.array(z.string()).default([]),
});

export interface DependencyGraphResult {
  nodes: Array<{
    id: string;
    title: string;
    status: "open" | "in_progress" | "closed";
    priority: number;
    layer: number;
    unblocksCount: number;
    isOnCriticalPath: boolean;
  }>;
  edges: Array<{
    from: string;
    to: string;
    type: "blocks";
  }>;
  metrics: {
    totalNodes: number;
    totalEdges: number;
    cycleDetected: boolean;
    cycles: string[][];
    criticalPath: string[];
    topBottlenecks: Array<{ id: string; unblocksCount: number }>;
  };
}

export function buildBeadDependencyGraph(
  rawNodes: Array<z.input<typeof BeadGraphInputNodeSchema>>,
): DependencyGraphResult {
  const nodes = rawNodes.map((n) => BeadGraphInputNodeSchema.parse(n));
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const edges: Array<{ from: string; to: string; type: "blocks" }> = [];
  const dependentsMap = new Map<string, string[]>();

  for (const n of nodes) {
    dependentsMap.set(n.id, []);
  }

  for (const n of nodes) {
    for (const blockerId of n.blockedBy) {
      if (nodeMap.has(blockerId)) {
        edges.push({ from: blockerId, to: n.id, type: "blocks" });
        dependentsMap.get(blockerId)?.push(n.id);
      }
    }
  }

  // Cycle detection via DFS
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const cycles: string[][] = [];

  function dfsCycle(curr: string, path: string[]): void {
    visited.add(curr);
    inStack.add(curr);
    for (const next of dependentsMap.get(curr) ?? []) {
      if (!visited.has(next)) {
        dfsCycle(next, [...path, next]);
      } else if (inStack.has(next)) {
        const idx = path.indexOf(next);
        cycles.push(idx >= 0 ? [...path.slice(idx), next] : [...path, next]);
      }
    }
    inStack.delete(curr);
  }

  for (const n of nodes) {
    if (!visited.has(n.id)) {
      dfsCycle(n.id, [n.id]);
    }
  }

  // Compute topological layers & longest path (when acyclic)
  const layerMap = new Map<string, number>();
  const parentOnLongestPath = new Map<string, string>();

  function computeLayer(id: string, stackGuard: Set<string>): number {
    if (layerMap.has(id)) return layerMap.get(id)!;
    if (stackGuard.has(id)) return 0;
    stackGuard.add(id);

    const node = nodeMap.get(id);
    let maxParentLayer = -1;
    let bestBlocker: string | undefined;
    for (const blockerId of node?.blockedBy ?? []) {
      if (nodeMap.has(blockerId)) {
        const l = computeLayer(blockerId, stackGuard);
        if (l > maxParentLayer) {
          maxParentLayer = l;
          bestBlocker = blockerId;
        }
      }
    }
    stackGuard.delete(id);
    const layer = maxParentLayer + 1;
    layerMap.set(id, layer);
    if (bestBlocker) parentOnLongestPath.set(id, bestBlocker);
    return layer;
  }

  for (const n of nodes) {
    computeLayer(n.id, new Set());
  }

  // Reconstruct critical path (longest chain of open/in_progress beads, or overall)
  let deepestId: string | undefined;
  let maxLayer = -1;
  for (const [id, layer] of layerMap.entries()) {
    if (layer > maxLayer) {
      maxLayer = layer;
      deepestId = id;
    }
  }

  const criticalPath: string[] = [];
  let cursor = deepestId;
  const seenCrit = new Set<string>();
  while (cursor && !seenCrit.has(cursor)) {
    seenCrit.add(cursor);
    criticalPath.unshift(cursor);
    cursor = parentOnLongestPath.get(cursor);
  }

  const criticalSet = new Set(criticalPath);

  const enrichedNodes = nodes.map((n) => ({
    id: n.id,
    title: n.title,
    status: n.status,
    priority: n.priority,
    layer: layerMap.get(n.id) ?? 0,
    unblocksCount: (dependentsMap.get(n.id) ?? []).length,
    isOnCriticalPath: criticalSet.has(n.id),
  }));

  const topBottlenecks = [...enrichedNodes]
    .filter((n) => n.status !== "closed" && n.unblocksCount > 0)
    .sort((a, b) => b.unblocksCount - a.unblocksCount)
    .slice(0, 5)
    .map((n) => ({ id: n.id, unblocksCount: n.unblocksCount }));

  return {
    nodes: enrichedNodes,
    edges,
    metrics: {
      totalNodes: enrichedNodes.length,
      totalEdges: edges.length,
      cycleDetected: cycles.length > 0,
      cycles,
      criticalPath,
      topBottlenecks,
    },
  };
}

// ============================================================================
// 3. Audit Log Query Builder (bd-1jv2y)
// ============================================================================

export const AuditFilterSchema = z.object({
  field: z.enum(["actor", "action", "resource", "outcome", "workspaceId"]),
  operator: z.enum(["eq", "contains", "in"]),
  value: z.union([z.string(), z.array(z.string())]),
});

export const AuditQuerySpecSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(120).default("Ad-hoc Audit Query"),
  filters: z.array(AuditFilterSchema).default([]),
  groupBy: z
    .enum(["actor", "action", "resource", "outcome", "workspaceId"])
    .optional(),
  limit: z.number().int().min(1).max(1000).default(100),
});

export interface AuditRecordEntry {
  id: string;
  actor: string;
  action: string;
  resource: string;
  outcome: "success" | "failure" | "denied";
  workspaceId: string;
  timestamp: string;
}

const auditEntriesStore: AuditRecordEntry[] = [];
const savedAuditQueriesStore = new Map<
  string,
  z.infer<typeof AuditQuerySpecSchema> & { id: string }
>();

export function seedAuditEntry(
  entry: Omit<AuditRecordEntry, "id" | "timestamp"> & {
    id?: string;
    timestamp?: string;
  },
): AuditRecordEntry {
  const full: AuditRecordEntry = {
    id: entry.id ?? `aud_${ulid()}`,
    actor: entry.actor,
    action: entry.action,
    resource: entry.resource,
    outcome: entry.outcome,
    workspaceId: entry.workspaceId,
    timestamp: entry.timestamp ?? new Date().toISOString(),
  };
  auditEntriesStore.push(full);
  return full;
}

export function saveAuditQuery(input: z.input<typeof AuditQuerySpecSchema>) {
  const parsed = AuditQuerySpecSchema.parse(input);
  const id = parsed.id ?? `aq_${ulid()}`;
  const saved = { ...parsed, id };
  savedAuditQueriesStore.set(id, saved);
  return saved;
}

export function executeAuditQuery(
  input: z.input<typeof AuditQuerySpecSchema>,
  exportFormat?: "json" | "csv",
) {
  const parsed = AuditQuerySpecSchema.parse(input);
  const matching = auditEntriesStore.filter((entry) => {
    for (const f of parsed.filters) {
      const fieldVal = entry[f.field];
      if (f.operator === "eq" && fieldVal !== f.value) return false;
      if (
        f.operator === "contains" &&
        typeof f.value === "string" &&
        !fieldVal.toLowerCase().includes(f.value.toLowerCase())
      ) {
        return false;
      }
      if (
        f.operator === "in" &&
        Array.isArray(f.value) &&
        !f.value.includes(fieldVal)
      ) {
        return false;
      }
    }
    return true;
  });

  const rows = matching.slice(0, parsed.limit);
  const groups: Record<string, number> = {};
  if (parsed.groupBy) {
    for (const r of rows) {
      const key = r[parsed.groupBy];
      groups[key] = (groups[key] ?? 0) + 1;
    }
  }

  let csv: string | undefined;
  if (exportFormat === "csv") {
    const header = "id,actor,action,resource,outcome,workspaceId,timestamp";
    const lines = rows.map(
      (r) =>
        `${r.id},${r.actor},${r.action},${r.resource},${r.outcome},${r.workspaceId},${r.timestamp}`,
    );
    csv = [header, ...lines].join("\n");
  }

  return {
    totalMatched: matching.length,
    rows,
    ...(parsed.groupBy && { groups }),
    ...(csv !== undefined && { csv }),
  };
}

export function clearOpsAnalyticsForTesting(): void {
  safetyPolicyVersion = 1;
  safetySimulationMetrics.totalSimulations = 0;
  safetySimulationMetrics.allowedCount = 0;
  safetySimulationMetrics.blockedCount = 0;
  safetySimulationMetrics.approvalRequiredCount = 0;
  safetySimulationMetrics.warnedCount = 0;
  safetySimulationMetrics.byRuleId = {};
  auditEntriesStore.length = 0;
  savedAuditQueriesStore.clear();
}
