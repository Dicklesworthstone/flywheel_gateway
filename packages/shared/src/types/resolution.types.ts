/**
 * Conflict Resolution Types - Shared type definitions for intelligent conflict resolution.
 *
 * These types define the contract between the resolution engine and its consumers.
 * Used by the conflict resolution service, confidence scorer, and rationale generator.
 */

// ============================================================================
// Core Types
// ============================================================================

/**
 * Resolution strategy types.
 * Each strategy represents a different approach to resolving resource conflicts.
 */
export type ResolutionStrategyType =
  | "wait" // Wait for holder to complete
  | "split" // Divide resource into non-overlapping segments
  | "transfer" // Current holder yields to higher-priority agent
  | "coordinate" // Both agents collaborate on shared resource
  | "escalate"; // Route to human decision-maker

/**
 * Urgency levels for resolution requests.
 */
export type ResolutionUrgency = "normal" | "high" | "critical";

/**
 * Identifies a contested resource.
 */
export interface ResourceIdentifier {
  /** Resource type (file, directory, service, etc.) */
  type: "file" | "directory" | "pattern" | "service" | "lock";
  /** Resource path or identifier */
  path: string;
  /** Whether this resource is marked as critical */
  critical?: boolean;
  /** Whether this resource is protected (requires special handling) */
  protected?: boolean;
}

// ============================================================================
// Request/Response Types
// ============================================================================

/**
 * Request for conflict resolution suggestions.
 */
export interface ConflictResolutionRequest {
  /** Unique conflict identifier */
  conflictId: string;
  /** Agent requesting resolution */
  requestingAgentId: string;
  /** BV/task ID for the requesting agent */
  requestingBvId?: string;
  /** Resources being contested */
  contestedResources: ResourceIdentifier[];
  /** Optional urgency override */
  urgencyOverride?: ResolutionUrgency;
  /** Preferred strategies (ordered by preference) */
  preferredStrategies?: ResolutionStrategyType[];
  /** Additional context provided by the agent */
  context?: string;
  /** Project ID for the conflict */
  projectId: string;
  /** Current holder's agent ID */
  holdingAgentId?: string;
  /** Current holder's BV/task ID */
  holdingBvId?: string;
}

/**
 * A complete resolution suggestion returned to the agent.
 */
export interface ResolutionSuggestion {
  /** Unique suggestion identifier */
  suggestionId: string;
  /** Reference to the conflict being resolved */
  conflictId: string;
  /** Primary recommended strategy */
  recommendedStrategy: ResolutionStrategy;
  /** Alternative strategies (ranked by suitability) */
  alternativeStrategies: ResolutionStrategy[];
  /** Overall confidence score (0-100) */
  confidence: number;
  /** Breakdown of confidence factors */
  confidenceBreakdown: ConfidenceFactors;
  /** Human-readable explanation of the recommendation */
  rationale: string;
  /** Whether this conflict qualifies for auto-resolution */
  autoResolutionEligible: boolean;
  /** Estimated time to resolution in milliseconds */
  estimatedResolutionTime: number;
  /** Potential risks with this resolution approach */
  risks: RiskAssessment[];
  /** When this suggestion was created */
  createdAt: Date;
  /** When this suggestion expires (state may have changed) */
  expiresAt: Date;
}

// ============================================================================
// Strategy Types
// ============================================================================

/**
 * A resolution strategy with scoring and parameters.
 */
export interface ResolutionStrategy {
  /** Strategy type */
  type: ResolutionStrategyType;
  /** Suitability score for this strategy (0-100) */
  score: number;
  /** Strategy-specific parameters */
  params: StrategyParams;
  /** Prerequisites that must be met before applying */
  prerequisites: Prerequisite[];
  /** Expected outcome if this strategy is applied */
  expectedOutcome: OutcomeProjection;
}

/**
 * Union type for all strategy parameters.
 */
export type StrategyParams =
  | WaitParams
  | SplitParams
  | TransferParams
  | CoordinateParams
  | EscalateParams;

/**
 * Parameters for the "wait" strategy.
 */
export interface WaitParams {
  type: "wait";
  /** Estimated wait time in milliseconds */
  estimatedWaitMs: number;
  /** How often to check for resolution */
  pollingIntervalMs: number;
  /** Maximum wait time before escalating */
  timeoutMs: number;
  /** Whether to notify on holder's progress */
  notifyOnProgress: boolean;
}

/**
 * Parameters for the "split" strategy.
 */
export interface SplitParams {
  type: "split";
  /** Proposed resource partitions */
  proposedPartitions: ResourcePartition[];
  /** How to merge changes after parallel work */
  mergeStrategy: "auto" | "manual" | "review";
}

/**
 * Parameters for the "transfer" strategy.
 */
export interface TransferParams {
  type: "transfer";
  /** Agent giving up the resource */
  fromAgentId: string;
  /** Agent receiving the resource */
  toAgentId: string;
  /** Whether a checkpoint is required before transfer */
  checkpointRequired: boolean;
  /** Grace period for the transfer in milliseconds */
  gracePeriodMs: number;
}

/**
 * Parameters for the "coordinate" strategy.
 */
export interface CoordinateParams {
  type: "coordinate";
  /** Protocol for coordination */
  coordinationProtocol: "turn-based" | "section-locked" | "merge-on-complete";
  /** Communication channel for coordination */
  communicationChannel: string;
  /** How often to sync progress */
  syncIntervalMs: number;
}

/**
 * Parameters for the "escalate" strategy.
 */
export interface EscalateParams {
  type: "escalate";
  /** Who to escalate to */
  escalationTarget: "project-lead" | "system-admin" | "custom";
  /** Custom target identifier (if escalationTarget is "custom") */
  customTargetId?: string;
  /** Urgency of the escalation */
  urgency: ResolutionUrgency;
  /** Context package for the escalation */
  contextPackage: EscalationContext;
}

/**
 * A partition of resources for the split strategy.
 */
export interface ResourcePartition {
  /** Resources in this partition */
  resources: ResourceIdentifier[];
  /** Agent assigned to this partition */
  assignedAgentId: string;
  /** Description of this partition's scope */
  scope: string;
}

/**
 * Context provided when escalating to a human.
 */
export interface EscalationContext {
  /** Summary of the conflict */
  conflictSummary: string;
  /** Agents involved */
  involvedAgents: Array<{
    agentId: string;
    currentTask: string;
    progress: number;
    priority: string;
  }>;
  /** What the system tried before escalating */
  attemptedResolutions: string[];
  /** Why escalation is needed */
  escalationReason: string;
  /** Recommended action for the human */
  suggestedAction: string;
}

// ============================================================================
// Confidence Scoring Types
// ============================================================================

/**
 * Breakdown of factors contributing to confidence score.
 */
export interface ConfidenceFactors {
  /** Priority differential clarity (0-20 points) */
  priorityDifferential: number;
  /** Progress state certainty (0-15 points) */
  progressCertainty: number;
  /** Historical pattern match (0-25 points) */
  historicalMatch: number;
  /** Resource criticality assessment (0-20 points) */
  resourceCriticality: number;
  /** Time pressure factors (0-20 points) */
  timePressure: number;
  /** Adjustments applied to the base score */
  adjustments: ConfidenceAdjustment[];
}

/**
 * An adjustment to the confidence score.
 */
export interface ConfidenceAdjustment {
  /** Reason for the adjustment */
  reason: string;
  /** Score delta (positive or negative) */
  delta: number;
}

// ============================================================================
// Outcome and Risk Types
// ============================================================================

/**
 * Projected outcome of applying a strategy.
 */
export interface OutcomeProjection {
  /** Probability of successful resolution (0-100) */
  successProbability: number;
  /** Expected time to resolution in milliseconds */
  estimatedTimeMs: number;
  /** Expected impact on involved agents */
  agentImpact: Record<string, "none" | "minimal" | "moderate" | "significant">;
  /** Potential side effects */
  sideEffects: string[];
}

/**
 * Prerequisite that must be met before applying a strategy.
 */
export interface Prerequisite {
  /** Description of the prerequisite */
  description: string;
  /** Whether this prerequisite is currently satisfied */
  satisfied: boolean;
  /** How to satisfy this prerequisite if not satisfied */
  satisfactionHint?: string;
}

/**
 * Assessment of a potential risk.
 */
export interface RiskAssessment {
  /** Risk category */
  category: "data_loss" | "deadlock" | "performance" | "user_impact" | "other";
  /** Risk severity */
  severity: "low" | "medium" | "high" | "critical";
  /** Description of the risk */
  description: string;
  /** Probability of risk materializing (0-100) */
  probability: number;
  /** Possible mitigation */
  mitigation?: string;
}

// ============================================================================
// Auto-Resolution Types
// ============================================================================

/**
 * Criteria for auto-resolution eligibility.
 */
export interface AutoResolutionCriteria {
  /** Minimum confidence score required */
  minConfidence: number;
  /** Maximum wait time for auto-applying wait strategy */
  maxWaitTimeMs: number;
  /** Resource criticality level that disables auto-resolution */
  disabledForCritical: boolean;
  /** Whether both agents must have auto-resolution enabled */
  requireBothAgentsEnabled: boolean;
  /** Maximum prior failed attempts */
  maxPriorFailedAttempts: number;
}

/**
 * Result of checking auto-resolution eligibility.
 */
export interface AutoResolutionCheck {
  /** Whether auto-resolution is eligible */
  eligible: boolean;
  /** Reasons why auto-resolution is/isn't eligible */
  reasons: string[];
  /** Criteria used for the check */
  criteria: AutoResolutionCriteria;
}

// ============================================================================
// Input Source Types
// ============================================================================

/**
 * BV priority information for an agent.
 */
export interface BvPriorityInfo {
  /** BV/task identifier */
  bvId: string;
  /** Priority level (P0-P4) */
  priority: "P0" | "P1" | "P2" | "P3" | "P4";
  /** Urgency rating */
  urgency: number;
  /** Business value score */
  businessValue?: number;
  /** Deadline if any */
  deadline?: Date;
}

/**
 * Checkpoint progress information for an agent.
 */
export interface CheckpointProgressInfo {
  /** Agent identifier */
  agentId: string;
  /** Progress percentage (0-100) */
  progressPercentage: number;
  /** Time invested so far in milliseconds */
  timeInvestedMs: number;
  /** Estimated time remaining in milliseconds */
  estimatedRemainingMs?: number;
  /** Last checkpoint timestamp */
  lastCheckpointAt?: Date;
}

/**
 * Historical resolution data from CASS.
 */
export interface CassHistoryInfo {
  /** Number of similar conflicts found */
  similarConflictCount: number;
  /** Strategy outcomes from history */
  strategyOutcomes: Array<{
    strategy: ResolutionStrategyType;
    successCount: number;
    failureCount: number;
    avgResolutionTimeMs: number;
  }>;
  /** Relevance score of historical data (0-100) */
  relevanceScore: number;
}

/**
 * Agent capabilities for split/coordinate strategies.
 */
export interface AgentCapabilities {
  /** Agent identifier */
  agentId: string;
  /** Whether agent supports split work */
  supportsSplit: boolean;
  /** Whether agent supports coordination */
  supportsCoordination: boolean;
  /** Auto-resolution preference */
  autoResolutionEnabled: boolean;
  /** Skill areas */
  skills: string[];
}

// ============================================================================
// Resolution Result Types
// ============================================================================

/**
 * Result of applying a resolution.
 */
export interface ResolutionResult {
  /** Whether resolution was successful */
  success: boolean;
  /** Strategy that was applied */
  strategy: ResolutionStrategyType;
  /** Time taken to resolve in milliseconds */
  resolutionTimeMs: number;
  /** Any error that occurred */
  error?: string;
  /** Additional details */
  details?: Record<string, unknown>;
}

/**
 * Audit record for a resolution decision.
 */
export interface ResolutionAuditRecord {
  /** Unique audit record ID */
  id: string;
  /** Correlation ID for tracing */
  correlationId: string;
  /** The conflict that was resolved */
  conflictId: string;
  /** The suggestion that was provided */
  suggestionId: string;
  /** Strategy that was recommended */
  recommendedStrategy: ResolutionStrategyType;
  /** Strategy that was actually applied */
  appliedStrategy?: ResolutionStrategyType;
  /** Confidence score */
  confidence: number;
  /** Whether auto-resolution was used */
  autoResolved: boolean;
  /** Input sources availability */
  inputSources: {
    bvPriorityAvailable: boolean;
    checkpointProgressAvailable: boolean;
    cassHistoryRecords: number;
    activeReservations: number;
  };
  /** Processing time in milliseconds */
  processingTimeMs: number;
  /** Timestamp */
  timestamp: Date;
}
