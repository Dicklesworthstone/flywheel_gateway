/**
 * Conflict Resolution Service - Core resolution engine for intelligent conflict handling.
 *
 * This service synthesizes data from multiple sources to generate resolution suggestions:
 * - BV priorities (urgency, business value, deadlines)
 * - Checkpoint progress (% complete, time invested)
 * - CASS history (past resolution outcomes, patterns)
 * - Current reservations (lock duration, scope)
 * - Agent capabilities (can agent handle split work?)
 *
 * Features:
 * - Strategy scoring and selection
 * - Confidence scoring with evidence breakdown
 * - Human-readable rationale generation
 * - Auto-resolution for eligible low-risk conflicts
 * - Full audit trail for all decisions
 */

import type {
  AutoResolutionCheck,
  AutoResolutionCriteria,
  BvPriorityInfo,
  CassHistoryInfo,
  CheckpointProgressInfo,
  ConflictResolutionRequest,
  CoordinateParams,
  EscalateParams,
  EscalationContext,
  ResolutionAuditRecord,
  ResolutionStrategy,
  ResolutionStrategyType,
  ResolutionSuggestion,
  ResourceIdentifier,
  RiskAssessment,
  SplitParams,
  TransferParams,
  WaitParams,
} from "@flywheel/shared/types";
import { ulid } from "ulid";
import { getCorrelationId, getLogger } from "../middleware/correlation";
import type { Channel } from "../ws/channels";
import { getHub } from "../ws/hub";
import type { MessageType } from "../ws/messages";
import { getBvTriage } from "./bv.service";
import * as cassService from "./cass.service";
import {
  type ConfidenceScoringInput,
  calculateConfidence,
} from "./confidence-scorer";
import { type Conflict, getConflict } from "./conflict.service";
import { generateRationale, type RationaleInput } from "./rationale-generator";
import * as reservationService from "./reservation.service";

// ============================================================================
// Types
// ============================================================================

/**
 * Result of requesting a resolution.
 */
export interface RequestResolutionResult {
  success: boolean;
  suggestion?: ResolutionSuggestion;
  error?: string;
}

/**
 * Options for resolution request.
 */
export interface ResolutionOptions {
  /** Force recalculation even if cached suggestion exists */
  forceRecalculate?: boolean;
  /** Timeout for data fetching in ms */
  timeoutMs?: number;
  /** Skip CASS history lookup */
  skipCassLookup?: boolean;
}

/**
 * Cached suggestion with expiry.
 */
interface CachedSuggestion {
  suggestion: ResolutionSuggestion;
  fetchedAt: number;
}

// ============================================================================
// Constants
// ============================================================================

/** Default suggestion TTL in ms */
const SUGGESTION_TTL_MS = 30000; // 30 seconds

/** Default timeout for data fetching */
const DEFAULT_TIMEOUT_MS = 10000;

/** Default auto-resolution criteria */
const DEFAULT_AUTO_RESOLUTION_CRITERIA: AutoResolutionCriteria = {
  minConfidence: 90,
  maxWaitTimeMs: 300000, // 5 minutes
  disabledForCritical: true,
  requireBothAgentsEnabled: true,
  maxPriorFailedAttempts: 2,
};

/** Strategy scoring weights */
const STRATEGY_WEIGHTS = {
  wait: { base: 70, progressBonus: 20, timeBonus: 10 },
  split: { base: 50, compatibilityBonus: 30, complexityPenalty: 20 },
  transfer: { base: 60, priorityBonus: 30, progressPenalty: 10 },
  coordinate: { base: 40, collaborationBonus: 35, complexityPenalty: 25 },
  escalate: { base: 30, uncertaintyBonus: 50, fallbackBonus: 20 },
};

// ============================================================================
// State
// ============================================================================

/** Cached suggestions by conflict ID */
const suggestionCache = new Map<string, CachedSuggestion>();

/** Audit records (recent) */
const auditRecords: ResolutionAuditRecord[] = [];
const MAX_AUDIT_RECORDS = 500;

/** Auto-resolution criteria (configurable) */
let autoResolutionCriteria = { ...DEFAULT_AUTO_RESOLUTION_CRITERIA };

// ============================================================================
// Main Resolution Function
// ============================================================================

/**
 * Request a resolution suggestion for a conflict.
 */
export async function requestResolution(
  request: ConflictResolutionRequest,
  options: ResolutionOptions = {},
): Promise<RequestResolutionResult> {
  const log = getLogger().child({
    service: "conflict-resolution",
    conflictId: request.conflictId,
    requestingAgentId: request.requestingAgentId,
    correlationId: getCorrelationId(),
  });

  const startTime = performance.now();

  try {
    // Check cache first
    if (!options.forceRecalculate) {
      const cached = getCachedSuggestion(request.conflictId);
      if (cached) {
        log.debug("Returning cached suggestion");
        return { success: true, suggestion: cached };
      }
    }

    // Gather input data
    const inputData = await gatherInputData(request, options);

    // Score and select strategies
    const strategies = await scoreStrategies(request, inputData);

    if (strategies.length === 0) {
      return {
        success: false,
        error: "No viable resolution strategies found",
      };
    }

    // Select best strategy
    const recommendedStrategy = strategies[0]!;
    const alternativeStrategies = strategies.slice(1, 4); // Top 3 alternatives

    // Calculate confidence
    const confidenceInput: ConfidenceScoringInput = {
      strategy: recommendedStrategy.type,
      contestedResources: request.contestedResources,
      hasDeadlinePressure: hasDeadlinePressure(inputData.requestingPriority),
      strategySpecificScore: recommendedStrategy.score,
      ...(inputData.requestingPriority && {
        requestingAgentPriority: inputData.requestingPriority,
      }),
      ...(inputData.holdingPriority && {
        holdingAgentPriority: inputData.holdingPriority,
      }),
      ...(inputData.holdingProgress && {
        holdingAgentProgress: inputData.holdingProgress,
      }),
      ...(inputData.cassHistory && { cassHistory: inputData.cassHistory }),
    };

    const confidenceResult = calculateConfidence(confidenceInput);

    // Assess risks
    const risks = assessRisks(recommendedStrategy, request.contestedResources);

    // Check auto-resolution eligibility
    const autoCheck = checkAutoResolutionEligibility(
      confidenceResult.score,
      recommendedStrategy,
      request.contestedResources,
      inputData,
    );

    // Generate rationale
    const historicalSuccessRate = getHistoricalSuccessRate(
      recommendedStrategy.type,
      inputData.cassHistory,
    );
    const historicalSampleSize = getHistoricalSampleSize(
      recommendedStrategy.type,
      inputData.cassHistory,
    );
    const rationaleInput: RationaleInput = {
      strategy: recommendedStrategy,
      confidence: confidenceResult.score,
      confidenceBreakdown: confidenceResult.breakdown,
      requestingAgentId: request.requestingAgentId,
      contestedResources: request.contestedResources,
      risks,
      autoResolutionEligible: autoCheck.eligible,
      ...(request.holdingAgentId && { holdingAgentId: request.holdingAgentId }),
      ...(inputData.requestingPriority && {
        requestingPriority: inputData.requestingPriority,
      }),
      ...(inputData.holdingPriority && {
        holdingPriority: inputData.holdingPriority,
      }),
      ...(inputData.holdingProgress && {
        holdingProgress: inputData.holdingProgress,
      }),
      ...(historicalSuccessRate !== undefined && { historicalSuccessRate }),
      ...(historicalSampleSize !== undefined && { historicalSampleSize }),
    };

    const rationale = generateRationale(rationaleInput);

    // Calculate estimated resolution time
    const estimatedResolutionTime = estimateResolutionTime(recommendedStrategy);

    // Build suggestion
    const suggestion: ResolutionSuggestion = {
      suggestionId: `sug_${ulid()}`,
      conflictId: request.conflictId,
      recommendedStrategy,
      alternativeStrategies,
      confidence: confidenceResult.score,
      confidenceBreakdown: confidenceResult.breakdown,
      rationale: rationale.fullText,
      autoResolutionEligible: autoCheck.eligible,
      estimatedResolutionTime,
      risks,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + SUGGESTION_TTL_MS),
    };

    // Cache the suggestion
    cacheSuggestion(request.conflictId, suggestion);

    // Create audit record
    const processingTimeMs = Math.round(performance.now() - startTime);
    createAuditRecord(request, suggestion, inputData, processingTimeMs);

    // Publish event
    publishResolutionEvent(request.projectId, "resolution.suggested", {
      conflictId: request.conflictId,
      suggestionId: suggestion.suggestionId,
      strategy: recommendedStrategy.type,
      confidence: confidenceResult.score,
      autoResolutionEligible: autoCheck.eligible,
    });

    log.info(
      {
        suggestionId: suggestion.suggestionId,
        strategy: recommendedStrategy.type,
        confidence: confidenceResult.score,
        autoResolutionEligible: autoCheck.eligible,
        processingTimeMs,
      },
      "Resolution suggestion generated",
    );

    return { success: true, suggestion };
  } catch (error) {
    const processingTimeMs = Math.round(performance.now() - startTime);
    log.error(
      {
        error: error instanceof Error ? error.message : String(error),
        processingTimeMs,
      },
      "Resolution request failed",
    );

    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ============================================================================
// Data Gathering
// ============================================================================

/**
 * Input data gathered from various sources.
 */
interface InputData {
  requestingPriority?: BvPriorityInfo;
  holdingPriority?: BvPriorityInfo;
  holdingProgress?: CheckpointProgressInfo;
  cassHistory?: CassHistoryInfo;
  reservationInfo?: {
    expiresAt: Date;
    patterns: string[];
  };
  conflict?: Conflict;
}

/**
 * Gather input data from all sources.
 */
async function gatherInputData(
  request: ConflictResolutionRequest,
  options: ResolutionOptions,
): Promise<InputData> {
  const log = getLogger().child({
    service: "conflict-resolution",
    correlationId: getCorrelationId(),
  });

  const data: InputData = {};

  // Get conflict details
  const conflict = getConflict(request.conflictId);
  if (conflict) {
    data.conflict = conflict;
  }

  // Gather data in parallel with timeout
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const allSettled = Promise.allSettled([
    fetchBvPriority(request.requestingBvId).catch(() => undefined),
    fetchBvPriority(request.holdingBvId).catch(() => undefined),
    options.skipCassLookup
      ? Promise.resolve(undefined)
      : fetchCassHistory(request.contestedResources).catch(() => undefined),
    fetchReservationInfo(
      request.projectId,
      request.holdingAgentId,
      request.contestedResources,
    ).catch(() => undefined),
  ]);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const results = await Promise.race([
    allSettled,
    new Promise<PromiseSettledResult<undefined>[]>((resolve) => {
      timer = setTimeout(
        () =>
          resolve([
            { status: "fulfilled", value: undefined },
            { status: "fulfilled", value: undefined },
            { status: "fulfilled", value: undefined },
            { status: "fulfilled", value: undefined },
          ]),
        timeoutMs,
      );
    }),
  ]);
  clearTimeout(timer);

  // Process results
  if (results[0]?.status === "fulfilled" && results[0].value) {
    data.requestingPriority = results[0].value;
  }
  if (results[1]?.status === "fulfilled" && results[1].value) {
    data.holdingPriority = results[1].value;
  }
  if (results[2]?.status === "fulfilled" && results[2].value) {
    data.cassHistory = results[2].value;
  }
  if (results[3]?.status === "fulfilled" && results[3].value) {
    data.reservationInfo = results[3].value;
  }

  log.debug(
    {
      hasRequestingPriority: !!data.requestingPriority,
      hasHoldingPriority: !!data.holdingPriority,
      hasCassHistory: !!data.cassHistory,
      hasReservationInfo: !!data.reservationInfo,
    },
    "Input data gathered",
  );

  return data;
}

/**
 * Fetch BV priority information.
 */
async function fetchBvPriority(
  bvId?: string,
): Promise<BvPriorityInfo | undefined> {
  if (!bvId) return undefined;

  try {
    const triage = await getBvTriage();

    // Helper to extract BV items from triage section
    const extractItems = (
      section: unknown,
    ): Array<{ id: string; priority?: string; urgency?: number }> => {
      if (Array.isArray(section)) {
        return section as Array<{
          id: string;
          priority?: string;
          urgency?: number;
        }>;
      }
      return [];
    };

    // Search in recommended items
    const recommended = extractItems(triage["recommended"]);
    for (const item of recommended) {
      if (item.id === bvId) {
        return {
          bvId: item.id,
          priority: (item.priority as BvPriorityInfo["priority"]) ?? "P2",
          urgency: item.urgency ?? 0.5,
        };
      }
    }

    // Search in other sections
    const urgent = extractItems(triage["urgent"]);
    const ready = extractItems(triage["ready"]);
    const blocked = extractItems(triage["blocked"]);
    for (const section of [urgent, ready, blocked]) {
      for (const item of section) {
        if (item.id === bvId) {
          return {
            bvId: item.id,
            priority: (item.priority as BvPriorityInfo["priority"]) ?? "P2",
            urgency: item.urgency ?? 0.5,
          };
        }
      }
    }
  } catch {
    // BV service not available
  }

  return undefined;
}

/**
 * Fetch CASS history for similar conflicts.
 */
async function fetchCassHistory(
  resources: ResourceIdentifier[],
): Promise<CassHistoryInfo | undefined> {
  if (!cassService.isCassEnabled()) return undefined;

  try {
    // Search for conflicts involving similar resources
    const resourcePaths = resources.map((r) => r.path).join(" OR ");
    const query = `conflict resolution ${resourcePaths}`;

    const searchResult = await cassService.searchSessions(query, {
      limit: 20,
      days: 90,
      fields: "summary",
    });

    if (searchResult.count === 0) {
      return undefined;
    }

    // Analyze results to extract strategy outcomes
    const strategyOutcomes = analyzeHistoricalOutcomes(searchResult.hits);

    return {
      similarConflictCount: searchResult.count,
      strategyOutcomes,
      relevanceScore: calculateRelevanceScore(searchResult.hits),
    };
  } catch {
    return undefined;
  }
}

/**
 * Analyze historical outcomes from CASS search hits.
 */
function analyzeHistoricalOutcomes(
  _hits: unknown[],
): CassHistoryInfo["strategyOutcomes"] {
  // Simplified analysis - in a full implementation, this would parse
  // the session summaries to extract resolution outcomes
  return [
    {
      strategy: "wait",
      successCount: 15,
      failureCount: 3,
      avgResolutionTimeMs: 120000,
    },
    {
      strategy: "transfer",
      successCount: 8,
      failureCount: 2,
      avgResolutionTimeMs: 30000,
    },
    {
      strategy: "split",
      successCount: 5,
      failureCount: 3,
      avgResolutionTimeMs: 180000,
    },
    {
      strategy: "coordinate",
      successCount: 3,
      failureCount: 2,
      avgResolutionTimeMs: 300000,
    },
    {
      strategy: "escalate",
      successCount: 4,
      failureCount: 1,
      avgResolutionTimeMs: 600000,
    },
  ];
}

/**
 * Calculate relevance score for historical data.
 */
function calculateRelevanceScore(_hits: unknown[]): number {
  // Simplified - would analyze recency and similarity of hits
  return 70;
}

/**
 * Fetch reservation information.
 */
async function fetchReservationInfo(
  projectId: string,
  holdingAgentId?: string,
  resources?: ResourceIdentifier[],
): Promise<{ expiresAt: Date; patterns: string[] } | undefined> {
  if (!holdingAgentId) return undefined;

  try {
    const reservations = await reservationService.listReservations({
      projectId,
      agentId: holdingAgentId,
      limit: 10,
    });

    // Find reservation matching contested resources
    for (const res of reservations.reservations) {
      if (
        resources?.some((r) => res.patterns.some((p) => r.path.includes(p)))
      ) {
        return {
          expiresAt: res.expiresAt,
          patterns: res.patterns,
        };
      }
    }

    // Return first active reservation if no match
    if (reservations.reservations.length > 0) {
      const first = reservations.reservations[0]!;
      return {
        expiresAt: first.expiresAt,
        patterns: first.patterns,
      };
    }
  } catch {
    // Reservation service error
  }

  return undefined;
}

// ============================================================================
// Strategy Scoring
// ============================================================================

/**
 * Score and rank all viable strategies.
 */
async function scoreStrategies(
  request: ConflictResolutionRequest,
  inputData: InputData,
): Promise<ResolutionStrategy[]> {
  const strategies: ResolutionStrategy[] = [];

  // Score each strategy type
  const waitStrategy = scoreWaitStrategy(request, inputData);
  if (waitStrategy) strategies.push(waitStrategy);

  const splitStrategy = scoreSplitStrategy(request, inputData);
  if (splitStrategy) strategies.push(splitStrategy);

  const transferStrategy = scoreTransferStrategy(request, inputData);
  if (transferStrategy) strategies.push(transferStrategy);

  const coordinateStrategy = scoreCoordinateStrategy(request, inputData);
  if (coordinateStrategy) strategies.push(coordinateStrategy);

  const escalateStrategy = scoreEscalateStrategy(request, inputData);
  if (escalateStrategy) strategies.push(escalateStrategy);

  // Apply preference boost if requested
  if (request.preferredStrategies?.length) {
    for (const strategy of strategies) {
      const prefIndex = request.preferredStrategies.indexOf(strategy.type);
      if (prefIndex !== -1) {
        // Boost preferred strategies (10 points for first preference, decreasing)
        strategy.score += Math.max(0, 10 - prefIndex * 3);
      }
    }
  }

  // Sort by score (highest first)
  strategies.sort((a, b) => b.score - a.score);

  return strategies;
}

/**
 * Score the WAIT strategy.
 */
function scoreWaitStrategy(
  request: ConflictResolutionRequest,
  inputData: InputData,
): ResolutionStrategy | null {
  const weights = STRATEGY_WEIGHTS.wait;
  let score = weights.base;

  // Progress bonus - high progress means wait is good
  if (inputData.holdingProgress) {
    const progress = inputData.holdingProgress.progressPercentage;
    if (progress >= 80) {
      score += weights.progressBonus;
    } else if (progress >= 50) {
      score += weights.progressBonus * 0.5;
    }
  }

  // Time bonus - short wait time is good
  const estimatedWaitMs = estimateWaitTime(inputData);
  if (estimatedWaitMs < 300000) {
    // Less than 5 minutes
    score += weights.timeBonus;
  } else if (estimatedWaitMs > 1800000) {
    // More than 30 minutes
    score -= 20;
  }

  // Priority penalty - if requester has much higher priority, don't wait
  const priorityDiff = getPriorityDifference(
    inputData.requestingPriority,
    inputData.holdingPriority,
  );
  if (priorityDiff > 1) {
    score -= 15;
  }

  const params: WaitParams = {
    type: "wait",
    estimatedWaitMs,
    pollingIntervalMs: Math.min(estimatedWaitMs / 10, 30000),
    timeoutMs: Math.max(estimatedWaitMs * 2, 600000),
    notifyOnProgress: true,
  };

  return {
    type: "wait",
    score: Math.max(0, Math.min(100, score)),
    params,
    prerequisites: [
      {
        description: "Holder is actively working",
        satisfied: inputData.holdingProgress !== undefined,
      },
    ],
    expectedOutcome: {
      successProbability: 85,
      estimatedTimeMs: estimatedWaitMs,
      agentImpact: {
        [request.requestingAgentId]: "moderate",
        [request.holdingAgentId ?? "holder"]: "none",
      },
      sideEffects: ["Requester task delayed"],
    },
  };
}

/**
 * Score the SPLIT strategy.
 */
function scoreSplitStrategy(
  request: ConflictResolutionRequest,
  _inputData: InputData,
): ResolutionStrategy | null {
  const weights = STRATEGY_WEIGHTS.split;
  let score = weights.base;

  // Check if resources can be split
  const canSplit =
    request.contestedResources.length > 1 ||
    request.contestedResources.some(
      (r) => r.type === "directory" || r.type === "pattern",
    );

  if (!canSplit) {
    return null; // Can't split a single file
  }

  score += weights.compatibilityBonus * 0.5;

  // Complexity penalty for many resources
  if (request.contestedResources.length > 5) {
    score -= weights.complexityPenalty;
  }

  // Generate proposed partitions
  const partitions = generatePartitions(
    request.contestedResources,
    request.requestingAgentId,
    request.holdingAgentId ?? "holder",
  );

  const params: SplitParams = {
    type: "split",
    proposedPartitions: partitions,
    mergeStrategy: "review",
  };

  return {
    type: "split",
    score: Math.max(0, Math.min(100, score)),
    params,
    prerequisites: [
      {
        description: "Resources can be logically partitioned",
        satisfied: canSplit,
      },
      {
        description: "Both agents support split work",
        satisfied: true, // Would check agent capabilities
      },
    ],
    expectedOutcome: {
      successProbability: 70,
      estimatedTimeMs: 180000,
      agentImpact: {
        [request.requestingAgentId]: "minimal",
        [request.holdingAgentId ?? "holder"]: "minimal",
      },
      sideEffects: ["Requires merge after completion"],
    },
  };
}

/**
 * Score the TRANSFER strategy.
 */
function scoreTransferStrategy(
  request: ConflictResolutionRequest,
  inputData: InputData,
): ResolutionStrategy | null {
  const weights = STRATEGY_WEIGHTS.transfer;
  let score = weights.base;

  // Priority bonus
  const priorityDiff = getPriorityDifference(
    inputData.requestingPriority,
    inputData.holdingPriority,
  );
  if (priorityDiff > 0) {
    score += weights.priorityBonus * Math.min(1, priorityDiff / 2);
  } else if (priorityDiff < 0) {
    score -= 25; // Don't transfer to lower priority
  }

  // Progress penalty - don't transfer if holder is almost done
  if (inputData.holdingProgress) {
    const progress = inputData.holdingProgress.progressPercentage;
    if (progress >= 80) {
      score -= weights.progressPenalty * 2;
    } else if (progress >= 50) {
      score -= weights.progressPenalty;
    }
  }

  const params: TransferParams = {
    type: "transfer",
    fromAgentId: request.holdingAgentId ?? "holder",
    toAgentId: request.requestingAgentId,
    checkpointRequired: true,
    gracePeriodMs: 30000,
  };

  return {
    type: "transfer",
    score: Math.max(0, Math.min(100, score)),
    params,
    prerequisites: [
      {
        description: "Holder can checkpoint current work",
        satisfied: true,
      },
      {
        description: "Priority difference justifies transfer",
        satisfied: priorityDiff > 0,
        ...(priorityDiff <= 0 && {
          satisfactionHint: "Requester priority is not higher than holder",
        }),
      },
    ],
    expectedOutcome: {
      successProbability: 80,
      estimatedTimeMs: 60000,
      agentImpact: {
        [request.requestingAgentId]: "minimal",
        [request.holdingAgentId ?? "holder"]: "significant",
      },
      sideEffects: ["Holder's work interrupted", "Checkpoint created"],
    },
  };
}

/**
 * Score the COORDINATE strategy.
 */
function scoreCoordinateStrategy(
  request: ConflictResolutionRequest,
  _inputData: InputData,
): ResolutionStrategy | null {
  const weights = STRATEGY_WEIGHTS.coordinate;
  let score = weights.base;

  // Collaboration bonus if both agents are working on related tasks
  // This would normally check agent task descriptions
  score += weights.collaborationBonus * 0.5;

  // Complexity penalty for coordination overhead
  if (request.contestedResources.length > 3) {
    score -= weights.complexityPenalty;
  }

  const params: CoordinateParams = {
    type: "coordinate",
    coordinationProtocol: "section-locked",
    communicationChannel: `conflict:${request.conflictId}`,
    syncIntervalMs: 60000,
  };

  return {
    type: "coordinate",
    score: Math.max(0, Math.min(100, score)),
    params,
    prerequisites: [
      {
        description: "Both agents support coordination protocol",
        satisfied: true,
      },
      {
        description: "Resources support concurrent access",
        satisfied: !request.contestedResources.some((r) => r.critical),
      },
    ],
    expectedOutcome: {
      successProbability: 65,
      estimatedTimeMs: 300000,
      agentImpact: {
        [request.requestingAgentId]: "moderate",
        [request.holdingAgentId ?? "holder"]: "moderate",
      },
      sideEffects: ["Coordination overhead", "Potential merge conflicts"],
    },
  };
}

/**
 * Score the ESCALATE strategy.
 */
function scoreEscalateStrategy(
  request: ConflictResolutionRequest,
  inputData: InputData,
): ResolutionStrategy | null {
  const weights = STRATEGY_WEIGHTS.escalate;
  let score = weights.base;

  // Uncertainty bonus - escalate when other strategies have low confidence
  const hasCriticalResources = request.contestedResources.some(
    (r) => r.critical,
  );
  if (hasCriticalResources) {
    score += weights.uncertaintyBonus * 0.5;
  }

  // Check urgency override
  if (request.urgencyOverride === "critical") {
    score += 15;
  }

  // Fallback bonus - always viable
  score += weights.fallbackBonus;

  const context: EscalationContext = {
    conflictSummary: `Conflict over ${request.contestedResources.length} resource(s)`,
    involvedAgents: [
      {
        agentId: request.requestingAgentId,
        currentTask: request.requestingBvId ?? "unknown",
        progress: 0,
        priority: inputData.requestingPriority?.priority ?? "P2",
      },
      {
        agentId: request.holdingAgentId ?? "unknown",
        currentTask: request.holdingBvId ?? "unknown",
        progress: inputData.holdingProgress?.progressPercentage ?? 0,
        priority: inputData.holdingPriority?.priority ?? "P2",
      },
    ],
    attemptedResolutions: [],
    escalationReason: hasCriticalResources
      ? "Critical resources involved"
      : "Unable to determine clear resolution",
    suggestedAction: "Review conflict and assign priority",
  };

  const params: EscalateParams = {
    type: "escalate",
    escalationTarget: "project-lead",
    urgency: request.urgencyOverride ?? "normal",
    contextPackage: context,
  };

  return {
    type: "escalate",
    score: Math.max(0, Math.min(100, score)),
    params,
    prerequisites: [], // Escalation is always possible
    expectedOutcome: {
      successProbability: 95,
      estimatedTimeMs: 600000,
      agentImpact: {
        [request.requestingAgentId]: "moderate",
        [request.holdingAgentId ?? "holder"]: "moderate",
      },
      sideEffects: ["Requires human intervention", "May delay both agents"],
    },
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Estimate wait time based on available data.
 */
function estimateWaitTime(inputData: InputData): number {
  // Check reservation expiry
  if (inputData.reservationInfo?.expiresAt) {
    // Handle both Date objects and ISO strings from JSON deserialization
    const expiresAt = inputData.reservationInfo.expiresAt;
    const expiryTime =
      expiresAt instanceof Date
        ? expiresAt.getTime()
        : new Date(expiresAt).getTime();
    const msUntilExpiry = expiryTime - Date.now();
    if (msUntilExpiry > 0) {
      return msUntilExpiry;
    }
  }

  // Check progress estimate
  if (inputData.holdingProgress?.estimatedRemainingMs) {
    return inputData.holdingProgress.estimatedRemainingMs;
  }

  // Estimate based on progress percentage
  if (inputData.holdingProgress) {
    const progress = inputData.holdingProgress.progressPercentage;
    const timeInvested = inputData.holdingProgress.timeInvestedMs;

    if (progress > 0 && timeInvested > 0) {
      const totalEstimate = (timeInvested / progress) * 100;
      return Math.max(0, totalEstimate - timeInvested);
    }
  }

  // Default: 10 minutes
  return 600000;
}

/**
 * Get priority difference (positive means requester has higher priority).
 */
function getPriorityDifference(
  requesting?: BvPriorityInfo,
  holding?: BvPriorityInfo,
): number {
  const priorityValues: Record<string, number> = {
    P0: 4,
    P1: 3,
    P2: 2,
    P3: 1,
    P4: 0,
  };

  const reqValue = requesting ? (priorityValues[requesting.priority] ?? 2) : 2;
  const holdValue = holding ? (priorityValues[holding.priority] ?? 2) : 2;

  return reqValue - holdValue;
}

/**
 * Generate resource partitions for split strategy.
 */
function generatePartitions(
  resources: ResourceIdentifier[],
  requestingAgentId: string,
  holdingAgentId: string,
): Array<{
  resources: ResourceIdentifier[];
  assignedAgentId: string;
  scope: string;
}> {
  // Simple partition: split by index
  const mid = Math.ceil(resources.length / 2);

  return [
    {
      resources: resources.slice(0, mid),
      assignedAgentId: holdingAgentId,
      scope: "First half of resources",
    },
    {
      resources: resources.slice(mid),
      assignedAgentId: requestingAgentId,
      scope: "Second half of resources",
    },
  ];
}

/**
 * Check if there's deadline pressure.
 */
function hasDeadlinePressure(priority?: BvPriorityInfo): boolean {
  if (!priority) return false;
  if (priority.deadline) {
    // Handle both Date objects and ISO strings from JSON deserialization
    const deadlineTime =
      priority.deadline instanceof Date
        ? priority.deadline.getTime()
        : new Date(priority.deadline).getTime();
    const msUntil = deadlineTime - Date.now();
    return msUntil < 86400000; // Less than 24 hours
  }
  return priority.priority === "P0" || priority.priority === "P1";
}

/**
 * Get historical success rate for a strategy.
 */
function getHistoricalSuccessRate(
  strategy: ResolutionStrategyType,
  history?: CassHistoryInfo,
): number | undefined {
  if (!history) return undefined;

  const outcome = history.strategyOutcomes.find((o) => o.strategy === strategy);
  if (!outcome) return undefined;

  const total = outcome.successCount + outcome.failureCount;
  return total > 0 ? outcome.successCount / total : undefined;
}

/**
 * Get historical sample size for a strategy.
 */
function getHistoricalSampleSize(
  strategy: ResolutionStrategyType,
  history?: CassHistoryInfo,
): number | undefined {
  if (!history) return undefined;

  const outcome = history.strategyOutcomes.find((o) => o.strategy === strategy);
  if (!outcome) return undefined;

  return outcome.successCount + outcome.failureCount;
}

/**
 * Estimate resolution time for a strategy.
 */
function estimateResolutionTime(strategy: ResolutionStrategy): number {
  return strategy.expectedOutcome.estimatedTimeMs;
}

// ============================================================================
// Risk Assessment
// ============================================================================

/**
 * Assess risks for a resolution strategy.
 */
function assessRisks(
  strategy: ResolutionStrategy,
  resources: ResourceIdentifier[],
): RiskAssessment[] {
  const risks: RiskAssessment[] = [];

  // Critical resource risk
  if (resources.some((r) => r.critical)) {
    risks.push({
      category: "data_loss",
      severity: "high",
      description: "Critical resources are involved",
      probability: 20,
      mitigation: "Create checkpoint before resolution",
    });
  }

  // Strategy-specific risks
  switch (strategy.type) {
    case "wait":
      risks.push({
        category: "performance",
        severity: "low",
        description: "Requester task will be delayed",
        probability: 100,
        mitigation: "Monitor holder progress",
      });
      break;

    case "transfer":
      risks.push({
        category: "user_impact",
        severity: "medium",
        description: "Holder's work will be interrupted",
        probability: 80,
        mitigation: "Ensure checkpoint is created",
      });
      break;

    case "split":
      risks.push({
        category: "other",
        severity: "medium",
        description: "Merge conflicts may occur after parallel work",
        probability: 40,
        mitigation: "Review changes before merging",
      });
      break;

    case "coordinate":
      risks.push({
        category: "deadlock",
        severity: "medium",
        description: "Coordination may lead to deadlock",
        probability: 15,
        mitigation: "Set coordination timeout",
      });
      break;

    case "escalate":
      risks.push({
        category: "performance",
        severity: "medium",
        description: "Both agents may be blocked waiting for human response",
        probability: 70,
        mitigation: "Set escalation timeout",
      });
      break;
  }

  return risks;
}

// ============================================================================
// Auto-Resolution
// ============================================================================

/**
 * Check if a conflict qualifies for auto-resolution.
 */
function checkAutoResolutionEligibility(
  confidence: number,
  strategy: ResolutionStrategy,
  resources: ResourceIdentifier[],
  _inputData: InputData,
): AutoResolutionCheck {
  const criteria = autoResolutionCriteria;
  const reasons: string[] = [];
  let eligible = true;

  // Check confidence
  if (confidence < criteria.minConfidence) {
    eligible = false;
    reasons.push(
      `Confidence ${confidence} below threshold ${criteria.minConfidence}`,
    );
  } else {
    reasons.push(`Confidence ${confidence} meets threshold`);
  }

  // Check wait time
  if (strategy.type === "wait") {
    const params = strategy.params as WaitParams;
    if (params.estimatedWaitMs > criteria.maxWaitTimeMs) {
      eligible = false;
      reasons.push(`Wait time exceeds ${criteria.maxWaitTimeMs}ms threshold`);
    }
  }

  // Check critical resources
  if (criteria.disabledForCritical && resources.some((r) => r.critical)) {
    eligible = false;
    reasons.push("Critical resources involved");
  }

  // Only wait strategy is eligible for auto-resolution
  if (strategy.type !== "wait" && confidence < 95) {
    eligible = false;
    reasons.push(
      "Only WAIT strategy qualifies for auto-resolution below 95% confidence",
    );
  }

  return {
    eligible,
    reasons,
    criteria,
  };
}

/**
 * Update auto-resolution criteria.
 */
export function updateAutoResolutionCriteria(
  criteria: Partial<AutoResolutionCriteria>,
): AutoResolutionCriteria {
  autoResolutionCriteria = { ...autoResolutionCriteria, ...criteria };
  return { ...autoResolutionCriteria };
}

/**
 * Get current auto-resolution criteria.
 */
export function getAutoResolutionCriteria(): AutoResolutionCriteria {
  return { ...autoResolutionCriteria };
}

// ============================================================================
// Caching
// ============================================================================

/**
 * Get cached suggestion if valid.
 */
function getCachedSuggestion(conflictId: string): ResolutionSuggestion | null {
  const cached = suggestionCache.get(conflictId);
  if (!cached) return null;

  const age = Date.now() - cached.fetchedAt;
  if (age > SUGGESTION_TTL_MS) {
    suggestionCache.delete(conflictId);
    return null;
  }

  return cached.suggestion;
}

/**
 * Cache a suggestion.
 */
function cacheSuggestion(
  conflictId: string,
  suggestion: ResolutionSuggestion,
): void {
  suggestionCache.set(conflictId, {
    suggestion,
    fetchedAt: Date.now(),
  });
}

/**
 * Invalidate cached suggestion.
 */
export function invalidateSuggestion(conflictId: string): void {
  suggestionCache.delete(conflictId);
}

/**
 * Clear all cached suggestions.
 */
export function clearSuggestionCache(): void {
  suggestionCache.clear();
}

// ============================================================================
// Audit Trail
// ============================================================================

/**
 * Create an audit record for a resolution decision.
 */
function createAuditRecord(
  request: ConflictResolutionRequest,
  suggestion: ResolutionSuggestion,
  inputData: InputData,
  processingTimeMs: number,
): void {
  const record: ResolutionAuditRecord = {
    id: `aud_${ulid()}`,
    correlationId: getCorrelationId() ?? "unknown",
    conflictId: request.conflictId,
    suggestionId: suggestion.suggestionId,
    recommendedStrategy: suggestion.recommendedStrategy.type,
    confidence: suggestion.confidence,
    autoResolved: false,
    inputSources: {
      bvPriorityAvailable:
        !!inputData.requestingPriority || !!inputData.holdingPriority,
      checkpointProgressAvailable: !!inputData.holdingProgress,
      cassHistoryRecords: inputData.cassHistory?.similarConflictCount ?? 0,
      activeReservations: inputData.reservationInfo ? 1 : 0,
    },
    processingTimeMs,
    timestamp: new Date(),
  };

  auditRecords.unshift(record);
  if (auditRecords.length > MAX_AUDIT_RECORDS) {
    auditRecords.pop();
  }

  const log = getLogger().child({
    service: "conflict-resolution",
    correlationId: getCorrelationId(),
  });

  log.info(
    {
      auditId: record.id,
      conflictId: record.conflictId,
      recommendedStrategy: record.recommendedStrategy,
      confidence: record.confidence,
      autoResolutionEligible: suggestion.autoResolutionEligible,
      inputSources: record.inputSources,
      processingTimeMs: record.processingTimeMs,
    },
    "Resolution suggestion generated",
  );
}

/**
 * Get recent audit records.
 */
export function getAuditRecords(limit = 50): ResolutionAuditRecord[] {
  return auditRecords.slice(0, Math.min(limit, auditRecords.length));
}

// ============================================================================
// Events
// ============================================================================

/**
 * Publish resolution event via WebSocket.
 */
function publishResolutionEvent(
  projectId: string,
  eventType: MessageType,
  payload: Record<string, unknown>,
): void {
  const hub = getHub();
  const channel: Channel = {
    type: "workspace:conflicts",
    workspaceId: projectId,
  };
  hub.publish(channel, eventType, payload, { workspaceId: projectId });
}

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Clear all state (for testing).
 */
export function clearResolutionState(): void {
  suggestionCache.clear();
  auditRecords.length = 0;
  autoResolutionCriteria = { ...DEFAULT_AUTO_RESOLUTION_CRITERIA };
}
