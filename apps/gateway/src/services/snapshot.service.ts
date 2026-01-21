/**
 * System Snapshot Service
 *
 * Aggregates state from NTM, beads (br/bv), and tool health into a unified
 * system snapshot. Designed for graceful degradation - returns partial data
 * when some sources are unavailable.
 *
 * Key features:
 * - Parallel data collection with configurable timeouts
 * - Caching with TTL to reduce load on underlying services
 * - Partial failure handling - snapshot returned even if some sources fail
 * - Detailed logging for observability
 */

import type {
  NtmClient,
  NtmStatusOutput,
  NtmSnapshotOutput,
  BvTriageResult,
} from "@flywheel/flywheel-clients";
import {
  createNtmClient,
  createBunNtmCommandRunner,
} from "@flywheel/flywheel-clients";
import type {
  SystemSnapshot,
  SystemSnapshotMeta,
  SystemHealthSummary,
  SystemHealthStatus,
  NtmSnapshot,
  NtmSessionSnapshot,
  NtmAgentSnapshot,
  NtmStatusSummary,
  BeadsSnapshot,
  BeadsStatusCounts,
  BeadsTypeCounts,
  BeadsPriorityCounts,
  BeadsTriageRecommendation,
  BeadsSyncStatus,
  ToolHealthSnapshot,
  ToolHealthStatus,
  ToolChecksumStatus,
  AgentMailSnapshot,
  AgentMailAgentSnapshot,
  AgentMailMessageSummary,
} from "@flywheel/shared";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getLogger } from "../middleware/correlation";
import { getBvTriage, getBvClient } from "./bv.service";
import { getBrList, getBrSyncStatus, getBrClient } from "./br.service";
import * as dcgService from "./dcg.service";
import * as slbService from "./slb.service";
import { getUBSService } from "./ubs.service";
import {
  getChecksumAge,
  listToolsWithChecksums,
} from "./update-checker.service";
import { loadToolRegistry } from "./tool-registry.service";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CACHE_TTL_MS = 10000; // 10 seconds
const DEFAULT_COLLECTION_TIMEOUT_MS = 5000; // 5 seconds per source
const STALE_CHECKSUM_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const SAFETY_TOOLS = ["safety.dcg", "safety.slb", "safety.ubs"] as const;

// ============================================================================
// Types
// ============================================================================

export interface SnapshotServiceConfig {
  /** Cache TTL in milliseconds (default: 10000) */
  cacheTtlMs?: number;
  /** Timeout for each data collection source (default: 5000) */
  collectionTimeoutMs?: number;
  /** Working directory for CLI commands */
  cwd?: string;
}

interface CachedSnapshot {
  snapshot: SystemSnapshot;
  fetchedAt: number;
}

interface CollectionResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  latencyMs: number;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Execute a function with a timeout.
 */
async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  errorMessage: string,
): Promise<CollectionResult<T>> {
  const start = performance.now();

  try {
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), timeoutMs),
      ),
    ]);

    return {
      success: true,
      data: result,
      latencyMs: Math.round(performance.now() - start),
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? `${errorMessage}: ${error.message}`
          : errorMessage,
      latencyMs: Math.round(performance.now() - start),
    };
  }
}

/**
 * Determine health status from availability.
 */
function deriveHealthStatus(available: boolean): SystemHealthStatus {
  return available ? "healthy" : "unhealthy";
}

// ============================================================================
// Data Collection Functions
// ============================================================================

/**
 * Collect NTM snapshot data.
 */
async function collectNtmSnapshot(
  client: NtmClient,
  timeoutMs: number,
): Promise<CollectionResult<NtmSnapshot>> {
  const log = getLogger();

  return withTimeout(
    async () => {
      // Check availability first
      const available = await client.isAvailable();
      if (!available) {
        return createEmptyNtmSnapshot(false);
      }

      // Get status for session/agent info
      const status = await client.status();

      // Get snapshot for alerts (includes session data too, but we prefer status for session info)
      let alerts: string[] = [];
      try {
        const ntmSnapshot = await client.snapshot();
        // Check if it's a full snapshot (not delta)
        if ("alerts" in ntmSnapshot && Array.isArray(ntmSnapshot.alerts)) {
          // Map alert objects to descriptive strings
          alerts = ntmSnapshot.alerts.map((alert) => {
            const severity = alert.severity.toUpperCase();
            const location = alert.session
              ? alert.pane
                ? `${alert.session}:${alert.pane}`
                : alert.session
              : "system";
            return `[${severity}] ${alert.type}: ${alert.message} (${location})`;
          });
        }
      } catch (error) {
        // Log but don't fail - alerts are optional
        log.debug({ error }, "Failed to fetch NTM alerts, continuing without them");
      }

      // Map to our snapshot format
      const sessions: NtmSessionSnapshot[] = status.sessions.map((session) => {
        const base: NtmSessionSnapshot = {
          name: session.name,
          attached: session.attached ?? false,
          agents: (session.agents ?? []).map((agent) => {
            const agentBase: NtmAgentSnapshot = {
              pane: agent.pane,
              type: agent.type,
              state: agent.is_active ? "active" : "idle",
            };
            if (agent.variant !== undefined) agentBase.variant = agent.variant;
            if (agent.is_active !== undefined) agentBase.isActive = agent.is_active;
            if (agent.window !== undefined) agentBase.window = agent.window;
            if (agent.pane_idx !== undefined) agentBase.paneIdx = agent.pane_idx;
            return agentBase;
          }),
        };
        if (session.windows !== undefined) base.windows = session.windows;
        if (session.panes !== undefined) base.panes = session.panes;
        if (session.created_at !== undefined) base.createdAt = session.created_at;
        return base;
      });

      const summary: NtmStatusSummary = {
        totalSessions: status.summary.total_sessions,
        totalAgents: status.summary.total_agents,
        attachedCount: status.summary.attached_count,
        byAgentType: {
          claude: status.summary.claude_count,
          codex: status.summary.codex_count,
          gemini: status.summary.gemini_count,
          cursor: status.summary.cursor_count,
          windsurf: status.summary.windsurf_count,
          aider: status.summary.aider_count,
        },
      };

      return {
        capturedAt: new Date().toISOString(),
        available: true,
        version: status.system.version,
        sessions,
        summary,
        alerts,
      };
    },
    timeoutMs,
    "Failed to collect NTM data",
  );
}

/**
 * Create an empty NTM snapshot for when service is unavailable.
 */
function createEmptyNtmSnapshot(available: boolean): NtmSnapshot {
  return {
    capturedAt: new Date().toISOString(),
    available,
    sessions: [],
    summary: {
      totalSessions: 0,
      totalAgents: 0,
      attachedCount: 0,
      byAgentType: {
        claude: 0,
        codex: 0,
        gemini: 0,
        cursor: 0,
        windsurf: 0,
        aider: 0,
      },
    },
    alerts: [],
  };
}

/**
 * Collect beads (br/bv) snapshot data.
 */
async function collectBeadsSnapshot(
  timeoutMs: number,
): Promise<CollectionResult<BeadsSnapshot>> {
  const log = getLogger();

  return withTimeout(
    async () => {
      // Attempt to get triage data (includes counts)
      let triageData: BvTriageResult | null = null;
      let brAvailable = false;
      let bvAvailable = false;

      try {
        triageData = await getBvTriage();
        bvAvailable = true;
        brAvailable = true; // bv implies br is working
      } catch {
        // bv failed, try br directly
        try {
          await getBrList({ limit: 1 });
          brAvailable = true;
        } catch {
          // br also unavailable
        }
      }

      // Get sync status if br is available
      let syncStatus: BeadsSyncStatus | undefined;
      if (brAvailable) {
        try {
          const brStatus = await getBrSyncStatus();
          const syncBase: BeadsSyncStatus = {
            dirtyCount: brStatus.dirty_count ?? 0,
            jsonlExists: brStatus.jsonl_exists ?? false,
            jsonlNewer: brStatus.jsonl_newer ?? false,
            dbNewer: brStatus.db_newer ?? false,
          };
          if (brStatus.last_export_time !== undefined) {
            syncBase.lastExportTime = brStatus.last_export_time;
          }
          if (brStatus.last_import_time !== undefined) {
            syncBase.lastImportTime = brStatus.last_import_time;
          }
          syncStatus = syncBase;
        } catch {
          // Sync status unavailable
        }
      }

      // Extract counts from triage data
      // Use bracket notation to access index signature properties
      const triageObj = triageData?.triage as Record<string, unknown> | undefined;
      const health = triageObj?.["project_health"] as
        | {
            counts?: {
              total?: number;
              open?: number;
              closed?: number;
              blocked?: number;
              actionable?: number;
              by_status?: Record<string, number>;
              by_type?: Record<string, number>;
              by_priority?: Record<string, number>;
            };
          }
        | undefined;

      const counts = health?.counts;
      const byStatus = counts?.by_status;
      const byType = counts?.by_type;

      const statusCounts: BeadsStatusCounts = {
        open: byStatus?.["open"] ?? 0,
        inProgress: byStatus?.["in_progress"] ?? 0,
        blocked: counts?.blocked ?? 0,
        closed: counts?.closed ?? 0,
        total: counts?.total ?? 0,
      };

      const typeCounts: BeadsTypeCounts = {
        bug: byType?.["bug"] ?? 0,
        feature: byType?.["feature"] ?? 0,
        task: byType?.["task"] ?? 0,
        epic: byType?.["epic"] ?? 0,
        chore: byType?.["chore"] ?? 0,
      };

      const priorityCounts: BeadsPriorityCounts = {
        p0: counts?.by_priority?.["0"] ?? 0,
        p1: counts?.by_priority?.["1"] ?? 0,
        p2: counts?.by_priority?.["2"] ?? 0,
        p3: counts?.by_priority?.["3"] ?? 0,
        p4: counts?.by_priority?.["4"] ?? 0,
      };

      // Extract recommendations
      const recommendations: BeadsTriageRecommendation[] = (
        triageData?.triage?.recommendations ?? []
      )
        .slice(0, 5)
        .map((rec) => {
          const base: BeadsTriageRecommendation = {
            id: rec.id,
            title: rec.title,
            score: rec.score,
          };
          if (rec.reasons !== undefined) base.reasons = rec.reasons;
          return base;
        });

      const quickWins: BeadsTriageRecommendation[] = (
        triageData?.triage?.quick_wins ?? []
      )
        .slice(0, 3)
        .map((rec) => ({
          id: rec.id,
          title: rec.title,
          score: rec.score,
        }));

      const blockersToClean: BeadsTriageRecommendation[] = (
        triageData?.triage?.blockers_to_clear ?? []
      )
        .slice(0, 3)
        .map((rec) => ({
          id: rec.id,
          title: rec.title,
          score: rec.score,
        }));

      const beadsSnapshot: BeadsSnapshot = {
        capturedAt: new Date().toISOString(),
        brAvailable,
        bvAvailable,
        statusCounts,
        typeCounts,
        priorityCounts,
        actionableCount: counts?.actionable ?? 0,
        topRecommendations: recommendations,
        quickWins,
        blockersToClean,
      };
      if (syncStatus !== undefined) {
        beadsSnapshot.syncStatus = syncStatus;
      }
      return beadsSnapshot;
    },
    timeoutMs,
    "Failed to collect beads data",
  );
}

/**
 * Create an empty beads snapshot for when services are unavailable.
 */
function createEmptyBeadsSnapshot(): BeadsSnapshot {
  return {
    capturedAt: new Date().toISOString(),
    brAvailable: false,
    bvAvailable: false,
    statusCounts: {
      open: 0,
      inProgress: 0,
      blocked: 0,
      closed: 0,
      total: 0,
    },
    typeCounts: {
      bug: 0,
      feature: 0,
      task: 0,
      epic: 0,
      chore: 0,
    },
    priorityCounts: {
      p0: 0,
      p1: 0,
      p2: 0,
      p3: 0,
      p4: 0,
    },
    actionableCount: 0,
    topRecommendations: [],
    quickWins: [],
    blockersToClean: [],
  };
}

/**
 * Collect tool health snapshot data.
 */
async function collectToolHealthSnapshot(
  timeoutMs: number,
): Promise<CollectionResult<ToolHealthSnapshot>> {
  return withTimeout(
    async () => {
      // Collect tool statuses in parallel
      const [dcgResult, slbResult, ubsResult] = await Promise.all([
        collectDcgStatus(),
        collectSlbStatus(),
        collectUbsStatus(),
      ]);

      // Collect checksum information
      const checksumInfo = await collectChecksumInfo();

      // Determine overall status
      const allInstalled =
        dcgResult.installed && slbResult.installed && ubsResult.installed;
      const allHealthy =
        dcgResult.healthy && slbResult.healthy && ubsResult.healthy;

      let status: "healthy" | "degraded" | "unhealthy";
      if (allInstalled && allHealthy && !checksumInfo.isStale) {
        status = "healthy";
      } else if (allInstalled) {
        status = "degraded";
      } else {
        status = "unhealthy";
      }

      // Build issues and recommendations
      const issues: string[] = [];
      const recommendations: string[] = [];

      if (!dcgResult.installed) {
        issues.push("DCG (Destructive Command Guard) is not installed");
        recommendations.push("Install DCG: cargo install dcg");
      }
      if (!slbResult.installed) {
        issues.push("SLB (Simultaneous Launch Button) is not installed");
        recommendations.push(
          "Install SLB: go install github.com/Dicklesworthstone/slb@latest",
        );
      }
      if (!ubsResult.installed) {
        issues.push("UBS (Ultimate Bug Scanner) is not installed");
        recommendations.push("Install UBS: cargo install ubs");
      }
      if (checksumInfo.isStale) {
        issues.push("ACFS checksums are stale (older than 7 days)");
        recommendations.push("Refresh the ACFS manifest");
      }

      return {
        capturedAt: new Date().toISOString(),
        dcg: dcgResult,
        slb: slbResult,
        ubs: ubsResult,
        status,
        registryGeneratedAt: checksumInfo.registryGeneratedAt,
        registryAgeMs: checksumInfo.registryAgeMs,
        toolsWithChecksums: checksumInfo.toolsWithChecksums,
        checksumsStale: checksumInfo.isStale,
        checksumStatuses: checksumInfo.tools,
        issues,
        recommendations,
      };
    },
    timeoutMs,
    "Failed to collect tool health data",
  );
}

/**
 * Collect DCG status.
 */
async function collectDcgStatus(): Promise<ToolHealthStatus> {
  const start = performance.now();
  try {
    const available = await dcgService.isDcgAvailable();
    const version = available ? await dcgService.getDcgVersion() : null;
    return {
      installed: available,
      version,
      healthy: available,
      latencyMs: Math.round(performance.now() - start),
    };
  } catch {
    return {
      installed: false,
      version: null,
      healthy: false,
      latencyMs: Math.round(performance.now() - start),
    };
  }
}

/**
 * Collect SLB status.
 */
async function collectSlbStatus(): Promise<ToolHealthStatus> {
  const start = performance.now();
  try {
    const available = await slbService.isSlbAvailable();
    const versionInfo = available ? await slbService.getSlbVersion() : null;
    return {
      installed: available,
      version: versionInfo?.version ?? null,
      healthy: available,
      latencyMs: Math.round(performance.now() - start),
    };
  } catch {
    return {
      installed: false,
      version: null,
      healthy: false,
      latencyMs: Math.round(performance.now() - start),
    };
  }
}

/**
 * Collect UBS status.
 */
async function collectUbsStatus(): Promise<ToolHealthStatus> {
  const start = performance.now();
  try {
    const ubsService = getUBSService();
    const health = await ubsService.checkHealth();
    return {
      installed: health.available,
      version: health.version ?? null,
      healthy: health.available,
      latencyMs: Math.round(performance.now() - start),
    };
  } catch {
    return {
      installed: false,
      version: null,
      healthy: false,
      latencyMs: Math.round(performance.now() - start),
    };
  }
}

/**
 * Collect checksum information.
 */
async function collectChecksumInfo(): Promise<{
  registryGeneratedAt: string | null;
  registryAgeMs: number | null;
  toolsWithChecksums: number;
  isStale: boolean;
  tools: ToolChecksumStatus[];
}> {
  try {
    const registry = await loadToolRegistry();
    const toolsWithChecksums = await listToolsWithChecksums();

    const now = Date.now();
    const registryGeneratedAt = registry.generatedAt ?? null;
    const registryAgeMs = registryGeneratedAt
      ? now - new Date(registryGeneratedAt).getTime()
      : null;
    const isStale =
      registryAgeMs !== null && registryAgeMs > STALE_CHECKSUM_THRESHOLD_MS;

    const tools: ToolChecksumStatus[] = [];
    for (const toolId of SAFETY_TOOLS) {
      const checksumInfo = await getChecksumAge(toolId);
      if (checksumInfo) {
        const toolGenAt = checksumInfo.registryGeneratedAt ?? null;
        const toolAgeMs = toolGenAt
          ? now - new Date(toolGenAt).getTime()
          : null;
        tools.push({
          toolId,
          hasChecksums: checksumInfo.hasChecksums,
          checksumCount: checksumInfo.checksumCount,
          registryGeneratedAt: toolGenAt,
          ageMs: toolAgeMs,
          stale: toolAgeMs !== null && toolAgeMs > STALE_CHECKSUM_THRESHOLD_MS,
        });
      } else {
        tools.push({
          toolId,
          hasChecksums: false,
          checksumCount: 0,
          registryGeneratedAt: null,
          ageMs: null,
          stale: false,
        });
      }
    }

    return {
      registryGeneratedAt,
      registryAgeMs,
      toolsWithChecksums: toolsWithChecksums.length,
      isStale,
      tools,
    };
  } catch {
    return {
      registryGeneratedAt: null,
      registryAgeMs: null,
      toolsWithChecksums: 0,
      isStale: false,
      tools: SAFETY_TOOLS.map((toolId) => ({
        toolId,
        hasChecksums: false,
        checksumCount: 0,
        registryGeneratedAt: null,
        ageMs: null,
        stale: false,
      })),
    };
  }
}

/**
 * Create an empty tool health snapshot.
 */
function createEmptyToolHealthSnapshot(): ToolHealthSnapshot {
  const emptyToolStatus: ToolHealthStatus = {
    installed: false,
    version: null,
    healthy: false,
  };
  return {
    capturedAt: new Date().toISOString(),
    dcg: emptyToolStatus,
    slb: emptyToolStatus,
    ubs: emptyToolStatus,
    status: "unhealthy",
    registryGeneratedAt: null,
    registryAgeMs: null,
    toolsWithChecksums: 0,
    checksumsStale: false,
    checksumStatuses: [],
    issues: ["Tool health check failed"],
    recommendations: ["Verify tool installations and retry"],
  };
}

// ============================================================================
// Agent Mail Collection
// ============================================================================

interface AgentMailFileAgent {
  id: string;
  name?: string;
  capabilities?: string[];
  metadata?: Record<string, unknown>;
  registeredAt?: string;
}

interface AgentMailFileMessage {
  id: string;
  from: string;
  to: string;
  subject: string;
  body?: unknown;
  priority?: "low" | "normal" | "high" | "urgent";
  timestamp: string;
  read?: boolean;
}

/**
 * Collect Agent Mail snapshot from local .agentmail directory.
 */
async function collectAgentMailSnapshot(
  cwd: string,
  timeoutMs: number,
): Promise<CollectionResult<AgentMailSnapshot>> {
  const log = getLogger();

  return withTimeout(
    async () => {
      const agentMailDir = path.join(cwd, ".agentmail");

      // Check if .agentmail directory exists
      try {
        await fs.access(agentMailDir);
      } catch {
        return createEmptyAgentMailSnapshot(false);
      }

      // Read agents.jsonl
      const agents: AgentMailAgentSnapshot[] = [];
      try {
        const agentsPath = path.join(agentMailDir, "agents.jsonl");
        const agentsContent = await fs.readFile(agentsPath, "utf-8");
        const agentLines = agentsContent.trim().split("\n").filter(Boolean);

        for (const line of agentLines) {
          try {
            const agent = JSON.parse(line) as AgentMailFileAgent;
            const agentSnapshot: AgentMailAgentSnapshot = {
              agentId: agent.id,
              capabilities: agent.capabilities ?? [],
            };
            if (agent.metadata !== undefined) agentSnapshot.metadata = agent.metadata;
            if (agent.registeredAt !== undefined) agentSnapshot.registeredAt = agent.registeredAt;
            agents.push(agentSnapshot);
          } catch {
            // Skip malformed lines
          }
        }
      } catch {
        // agents.jsonl doesn't exist or can't be read
      }

      // Read messages.jsonl and compute summary
      const messages: AgentMailMessageSummary = {
        total: 0,
        unread: 0,
        byPriority: { low: 0, normal: 0, high: 0, urgent: 0 },
      };

      try {
        const messagesPath = path.join(agentMailDir, "messages.jsonl");
        const messagesContent = await fs.readFile(messagesPath, "utf-8");
        const messageLines = messagesContent.trim().split("\n").filter(Boolean);

        for (const line of messageLines) {
          try {
            const msg = JSON.parse(line) as AgentMailFileMessage;
            messages.total++;

            if (!msg.read) {
              messages.unread++;
            }

            const priority = msg.priority ?? "normal";
            messages.byPriority[priority]++;
          } catch {
            // Skip malformed lines
          }
        }
      } catch {
        // messages.jsonl doesn't exist or can't be read
      }

      return {
        capturedAt: new Date().toISOString(),
        available: true,
        status: agents.length > 0 ? "healthy" : "degraded",
        agents,
        reservations: [], // Reservations are managed by MCP, not local files
        messages,
      };
    },
    timeoutMs,
    "Failed to collect Agent Mail data",
  );
}

/**
 * Create an empty Agent Mail snapshot.
 */
function createEmptyAgentMailSnapshot(available: boolean): AgentMailSnapshot {
  return {
    capturedAt: new Date().toISOString(),
    available,
    agents: [],
    reservations: [],
    messages: {
      total: 0,
      unread: 0,
      byPriority: { low: 0, normal: 0, high: 0, urgent: 0 },
    },
  };
}

// ============================================================================
// Service Implementation
// ============================================================================

/**
 * Snapshot Service - aggregates system state from multiple sources.
 */
export class SnapshotService {
  private config: Required<SnapshotServiceConfig>;
  private ntmClient: NtmClient;
  private cache: CachedSnapshot | null = null;

  constructor(config: SnapshotServiceConfig = {}) {
    this.config = {
      cacheTtlMs: config.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
      collectionTimeoutMs:
        config.collectionTimeoutMs ?? DEFAULT_COLLECTION_TIMEOUT_MS,
      cwd: config.cwd ?? process.cwd(),
    };

    const runner = createBunNtmCommandRunner();
    this.ntmClient = createNtmClient({
      runner,
      cwd: this.config.cwd,
      timeout: this.config.collectionTimeoutMs,
    });
  }

  /**
   * Get the current system snapshot.
   *
   * Uses caching to reduce load on underlying services.
   * Returns partial data when some sources fail.
   */
  async getSnapshot(options?: { bypassCache?: boolean }): Promise<SystemSnapshot> {
    const log = getLogger();

    // Check cache
    if (
      !options?.bypassCache &&
      this.cache &&
      Date.now() - this.cache.fetchedAt < this.config.cacheTtlMs
    ) {
      log.debug({ cacheTtlMs: this.config.cacheTtlMs }, "Snapshot cache hit");
      return this.cache.snapshot;
    }

    const startTime = performance.now();
    log.info("Collecting system snapshot");

    // Collect all data sources in parallel
    const [ntmResult, beadsResult, toolsResult, agentMailResult] = await Promise.all([
      collectNtmSnapshot(this.ntmClient, this.config.collectionTimeoutMs),
      collectBeadsSnapshot(this.config.collectionTimeoutMs),
      collectToolHealthSnapshot(this.config.collectionTimeoutMs),
      collectAgentMailSnapshot(this.config.cwd, this.config.collectionTimeoutMs),
    ]);

    // Log collection results
    log.debug(
      {
        ntm: { success: ntmResult.success, latencyMs: ntmResult.latencyMs },
        beads: { success: beadsResult.success, latencyMs: beadsResult.latencyMs },
        tools: { success: toolsResult.success, latencyMs: toolsResult.latencyMs },
        agentMail: { success: agentMailResult.success, latencyMs: agentMailResult.latencyMs },
      },
      "Data collection completed",
    );

    // Use collected data or fallbacks
    const ntm = ntmResult.success && ntmResult.data
      ? ntmResult.data
      : createEmptyNtmSnapshot(false);

    const beads = beadsResult.success && beadsResult.data
      ? beadsResult.data
      : createEmptyBeadsSnapshot();

    const tools = toolsResult.success && toolsResult.data
      ? toolsResult.data
      : createEmptyToolHealthSnapshot();

    const agentMail = agentMailResult.success && agentMailResult.data
      ? agentMailResult.data
      : createEmptyAgentMailSnapshot(false);

    // Build summary
    const summary = this.buildHealthSummary(
      ntm,
      beads,
      tools,
      agentMail,
      ntmResult,
      beadsResult,
      toolsResult,
      agentMailResult,
    );

    const generationDurationMs = Math.round(performance.now() - startTime);

    // Build metadata
    const meta: SystemSnapshotMeta = {
      schemaVersion: "1.0.0",
      generatedAt: new Date().toISOString(),
      generationDurationMs,
    };

    const snapshot: SystemSnapshot = {
      meta,
      summary,
      ntm,
      agentMail,
      beads,
      tools,
    };

    // Update cache
    this.cache = { snapshot, fetchedAt: Date.now() };

    log.info(
      {
        status: summary.status,
        healthyCount: summary.healthyCount,
        unhealthyCount: summary.unhealthyCount,
        generationDurationMs,
      },
      "System snapshot generated",
    );

    return snapshot;
  }

  /**
   * Build the health summary from collected data.
   */
  private buildHealthSummary(
    ntm: NtmSnapshot,
    beads: BeadsSnapshot,
    tools: ToolHealthSnapshot,
    agentMail: AgentMailSnapshot,
    ntmResult: CollectionResult<NtmSnapshot>,
    beadsResult: CollectionResult<BeadsSnapshot>,
    toolsResult: CollectionResult<ToolHealthSnapshot>,
    agentMailResult: CollectionResult<AgentMailSnapshot>,
  ): SystemHealthSummary {
    // Determine individual component health
    const ntmHealth: SystemHealthStatus = ntmResult.success
      ? deriveHealthStatus(ntm.available)
      : "unknown";

    const agentMailHealth: SystemHealthStatus = agentMailResult.success
      ? agentMail.available
        ? agentMail.status ?? "healthy"
        : "unhealthy"
      : "unknown";

    const beadsHealth: SystemHealthStatus = beadsResult.success
      ? beads.brAvailable || beads.bvAvailable
        ? "healthy"
        : "unhealthy"
      : "unknown";

    const toolsHealth: SystemHealthStatus = toolsResult.success
      ? tools.status
      : "unknown";

    // Count by status
    const statuses = [ntmHealth, agentMailHealth, beadsHealth, toolsHealth];
    const healthyCount = statuses.filter((s) => s === "healthy").length;
    const degradedCount = statuses.filter((s) => s === "degraded").length;
    const unhealthyCount = statuses.filter((s) => s === "unhealthy").length;
    const unknownCount = statuses.filter((s) => s === "unknown").length;

    // Determine overall status
    let status: SystemHealthStatus;
    if (unhealthyCount > 0) {
      status = "unhealthy";
    } else if (degradedCount > 0 || unknownCount > 0) {
      status = "degraded";
    } else {
      status = "healthy";
    }

    // Build issues list
    const issues: string[] = [];

    if (!ntmResult.success) {
      issues.push(`NTM collection failed: ${ntmResult.error}`);
    } else if (!ntm.available) {
      issues.push("NTM is not available");
    }

    if (!agentMailResult.success) {
      issues.push(`Agent Mail collection failed: ${agentMailResult.error}`);
    } else if (!agentMail.available) {
      issues.push("Agent Mail is not available");
    }

    if (!beadsResult.success) {
      issues.push(`Beads collection failed: ${beadsResult.error}`);
    } else if (!beads.brAvailable && !beads.bvAvailable) {
      issues.push("Beads tools (br/bv) are not available");
    }

    if (!toolsResult.success) {
      issues.push(`Tool health collection failed: ${toolsResult.error}`);
    } else if (tools.status === "unhealthy") {
      issues.push(...tools.issues);
    }

    return {
      status,
      ntm: ntmHealth,
      agentMail: agentMailHealth,
      beads: beadsHealth,
      tools: toolsHealth,
      healthyCount,
      degradedCount,
      unhealthyCount,
      unknownCount,
      issues,
    };
  }

  /**
   * Clear the cache to force a fresh snapshot on next request.
   */
  clearCache(): void {
    this.cache = null;
    const log = getLogger();
    log.debug("Snapshot cache cleared");
  }

  /**
   * Get cache statistics.
   */
  getCacheStats(): {
    cached: boolean;
    age: number | null;
    ttl: number;
  } {
    return {
      cached: this.cache !== null,
      age: this.cache ? Date.now() - this.cache.fetchedAt : null,
      ttl: this.config.cacheTtlMs,
    };
  }
}

// ============================================================================
// Singleton Access
// ============================================================================

let serviceInstance: SnapshotService | null = null;

/**
 * Get the singleton snapshot service instance.
 */
export function getSnapshotService(): SnapshotService {
  if (!serviceInstance) {
    serviceInstance = new SnapshotService();
  }
  return serviceInstance;
}

/**
 * Create a new snapshot service with custom configuration.
 * Useful for testing or specialized use cases.
 */
export function createSnapshotService(
  config?: SnapshotServiceConfig,
): SnapshotService {
  return new SnapshotService(config);
}

/**
 * Clear the singleton instance (for testing).
 */
export function clearSnapshotServiceInstance(): void {
  serviceInstance = null;
}
