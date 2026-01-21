/**
 * Safety Routes - Safety posture visibility endpoint.
 *
 * Provides comprehensive safety posture information for the readiness UI:
 * - DCG (Destructive Command Guard) installation status
 * - SLB (Simultaneous Launch Button) installation status
 * - UBS (Ultimate Bug Scanner) installation status
 * - ACFS checksum age for tool integrity verification
 */

import { Hono } from "hono";
import { getLogger } from "../middleware/correlation";
import { sendResource, sendValidationError } from "../utils/response";
import * as dcgService from "../services/dcg.service";
import * as slbService from "../services/slb.service";
import { getUBSService } from "../services/ubs.service";
import {
  getChecksumAge,
  listToolsWithChecksums,
} from "../services/update-checker.service";
import { loadToolRegistry } from "../services/tool-registry.service";

const safety = new Hono();

// ============================================================================
// Types
// ============================================================================

interface ToolStatus {
  installed: boolean;
  version: string | null;
  healthy: boolean;
  latencyMs: number;
}

interface ChecksumStatus {
  toolId: string;
  hasChecksums: boolean;
  checksumCount: number;
  registryGeneratedAt: string | null;
  ageMs: number | null;
  stale: boolean;
}

interface SafetyPostureResponse {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  tools: {
    dcg: ToolStatus;
    slb: ToolStatus;
    ubs: ToolStatus;
  };
  checksums: {
    registryGeneratedAt: string | null;
    registryAgeMs: number | null;
    toolsWithChecksums: number;
    staleThresholdMs: number;
    isStale: boolean;
    tools: ChecksumStatus[];
  };
  summary: {
    allToolsInstalled: boolean;
    allToolsHealthy: boolean;
    checksumsAvailable: boolean;
    checksumsStale: boolean;
    overallHealthy: boolean;
    issues: string[];
    recommendations: string[];
  };
}

// ============================================================================
// Constants
// ============================================================================

const STALE_CHECKSUM_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const SAFETY_TOOLS = ["safety.dcg", "safety.slb", "safety.ubs"] as const;

// ============================================================================
// Helpers
// ============================================================================

async function checkDcgStatus(): Promise<ToolStatus> {
  const startTime = performance.now();
  try {
    const available = await dcgService.isDcgAvailable();
    const version = available ? await dcgService.getDcgVersion() : null;
    return {
      installed: available,
      version,
      healthy: available,
      latencyMs: Math.round(performance.now() - startTime),
    };
  } catch {
    return {
      installed: false,
      version: null,
      healthy: false,
      latencyMs: Math.round(performance.now() - startTime),
    };
  }
}

async function checkSlbStatus(): Promise<ToolStatus> {
  const startTime = performance.now();
  try {
    const available = await slbService.isSlbAvailable();
    const versionInfo = available ? await slbService.getSlbVersion() : null;
    return {
      installed: available,
      version: versionInfo?.version ?? null,
      healthy: available,
      latencyMs: Math.round(performance.now() - startTime),
    };
  } catch {
    return {
      installed: false,
      version: null,
      healthy: false,
      latencyMs: Math.round(performance.now() - startTime),
    };
  }
}

async function checkUbsStatus(): Promise<ToolStatus> {
  const startTime = performance.now();
  try {
    const ubsService = getUBSService();
    const health = await ubsService.checkHealth();
    return {
      installed: health.available,
      version: health.version ?? null,
      healthy: health.available,
      latencyMs: Math.round(performance.now() - startTime),
    };
  } catch {
    return {
      installed: false,
      version: null,
      healthy: false,
      latencyMs: Math.round(performance.now() - startTime),
    };
  }
}

async function getChecksumStatuses(): Promise<{
  registryGeneratedAt: string | null;
  registryAgeMs: number | null;
  toolsWithChecksums: number;
  isStale: boolean;
  tools: ChecksumStatus[];
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

    const tools: ChecksumStatus[] = [];

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
          stale:
            toolAgeMs !== null && toolAgeMs > STALE_CHECKSUM_THRESHOLD_MS,
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

// ============================================================================
// Routes
// ============================================================================

/**
 * GET /safety/posture - Get comprehensive safety posture
 *
 * Returns the installation status of DCG, SLB, and UBS safety tools,
 * along with ACFS checksum age for tool integrity verification.
 *
 * Used by the readiness UI to display safety visibility.
 */
safety.get("/posture", async (c) => {
  const log = getLogger();
  log.info("Checking safety posture");

  const startTime = performance.now();

  // Run all checks in parallel
  const [dcg, slb, ubs, checksumStatuses] = await Promise.all([
    checkDcgStatus(),
    checkSlbStatus(),
    checkUbsStatus(),
    getChecksumStatuses(),
  ]);

  const tools = { dcg, slb, ubs };

  // Build summary
  const allToolsInstalled = dcg.installed && slb.installed && ubs.installed;
  const allToolsHealthy = dcg.healthy && slb.healthy && ubs.healthy;
  const checksumsAvailable = checksumStatuses.toolsWithChecksums > 0;
  const checksumsStale = checksumStatuses.isStale;

  const issues: string[] = [];
  const recommendations: string[] = [];

  // Check tool installation
  if (!dcg.installed) {
    issues.push("DCG (Destructive Command Guard) is not installed");
    recommendations.push(
      "Install DCG to prevent dangerous command execution: cargo install dcg",
    );
  }
  if (!slb.installed) {
    issues.push("SLB (Simultaneous Launch Button) is not installed");
    recommendations.push(
      "Install SLB for two-person authorization: go install github.com/Dicklesworthstone/slb@latest",
    );
  }
  if (!ubs.installed) {
    issues.push("UBS (Ultimate Bug Scanner) is not installed");
    recommendations.push(
      "Install UBS for static analysis scanning: cargo install ubs",
    );
  }

  // Check tool health (installed but not healthy)
  if (dcg.installed && !dcg.healthy) {
    issues.push("DCG is installed but not responding correctly");
    recommendations.push("Check DCG configuration and try running: dcg --version");
  }
  if (slb.installed && !slb.healthy) {
    issues.push("SLB is installed but not responding correctly");
    recommendations.push("Check SLB configuration and try running: slb --version");
  }
  if (ubs.installed && !ubs.healthy) {
    issues.push("UBS is installed but not responding correctly");
    recommendations.push("Check UBS configuration and try running: ubs --version");
  }

  // Check checksums
  if (!checksumsAvailable) {
    issues.push("No ACFS checksums available for tool verification");
    recommendations.push(
      "Ensure acfs.manifest.yaml is present and contains checksums",
    );
  }
  if (checksumsStale) {
    issues.push(
      `ACFS checksums are stale (older than ${Math.round(STALE_CHECKSUM_THRESHOLD_MS / (24 * 60 * 60 * 1000))} days)`,
    );
    recommendations.push(
      "Refresh the ACFS manifest to get updated checksums",
    );
  }

  // Determine overall status
  let status: "healthy" | "degraded" | "unhealthy";
  if (allToolsInstalled && allToolsHealthy && !checksumsStale) {
    status = "healthy";
  } else if (allToolsInstalled) {
    status = "degraded";
  } else {
    status = "unhealthy";
  }

  const overallHealthy = status === "healthy";

  const response: SafetyPostureResponse = {
    status,
    timestamp: new Date().toISOString(),
    tools,
    checksums: {
      registryGeneratedAt: checksumStatuses.registryGeneratedAt,
      registryAgeMs: checksumStatuses.registryAgeMs,
      toolsWithChecksums: checksumStatuses.toolsWithChecksums,
      staleThresholdMs: STALE_CHECKSUM_THRESHOLD_MS,
      isStale: checksumStatuses.isStale,
      tools: checksumStatuses.tools,
    },
    summary: {
      allToolsInstalled,
      allToolsHealthy,
      checksumsAvailable,
      checksumsStale,
      overallHealthy,
      issues,
      recommendations,
    },
  };

  const totalLatencyMs = Math.round(performance.now() - startTime);
  log.info(
    {
      status,
      dcgInstalled: dcg.installed,
      slbInstalled: slb.installed,
      ubsInstalled: ubs.installed,
      checksumsStale,
      totalLatencyMs,
    },
    "Safety posture check complete",
  );

  const httpStatus = status === "unhealthy" ? 503 : 200;
  return sendResource(c, "safety_posture", response, httpStatus);
});

/**
 * GET /safety/tools - Get individual tool status
 *
 * Returns detailed status for a specific safety tool.
 */
safety.get("/tools", async (c) => {
  const log = getLogger();
  const tool = c.req.query("tool");
  const validTools = ["dcg", "slb", "ubs"] as const;

  if (tool) {
    // Validate tool name
    if (!validTools.includes(tool as typeof validTools[number])) {
      return sendValidationError(c, [
        {
          path: "query.tool",
          message: `Invalid tool name. Must be one of: ${validTools.join(", ")}`,
        },
      ]);
    }

    // Return specific tool status
    let status: ToolStatus;
    switch (tool) {
      case "dcg":
        status = await checkDcgStatus();
        break;
      case "slb":
        status = await checkSlbStatus();
        break;
      case "ubs":
        status = await checkUbsStatus();
        break;
      default:
        // TypeScript narrowing - should never reach here
        status = await checkDcgStatus();
    }
    log.debug({ tool, installed: status.installed }, "Tool status checked");
    return sendResource(c, "tool_status", { tool, ...status });
  }

  // Return all tool statuses
  const [dcg, slb, ubs] = await Promise.all([
    checkDcgStatus(),
    checkSlbStatus(),
    checkUbsStatus(),
  ]);

  log.debug("All tool statuses checked");
  return sendResource(c, "tool_statuses", {
    dcg,
    slb,
    ubs,
    summary: {
      total: 3,
      installed: [dcg, slb, ubs].filter((t) => t.installed).length,
      healthy: [dcg, slb, ubs].filter((t) => t.healthy).length,
    },
  });
});

/**
 * GET /safety/checksums - Get checksum status
 *
 * Returns ACFS checksum age and status for tool integrity verification.
 */
safety.get("/checksums", async (c) => {
  const log = getLogger();
  const checksumStatuses = await getChecksumStatuses();

  log.debug(
    {
      toolsWithChecksums: checksumStatuses.toolsWithChecksums,
      isStale: checksumStatuses.isStale,
    },
    "Checksum status checked",
  );

  return sendResource(c, "checksum_status", {
    ...checksumStatuses,
    staleThresholdMs: STALE_CHECKSUM_THRESHOLD_MS,
  });
});

export { safety };
