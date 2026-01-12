/**
 * Context Health Types
 *
 * Types for auto-healing context window management including health
 * monitoring, graduated interventions, and agent rotation.
 */

// ============================================================================
// Enums
// ============================================================================

export enum ContextHealthStatus {
  HEALTHY = "healthy", // < 75%
  WARNING = "warning", // 75-84%
  CRITICAL = "critical", // 85-94%
  EMERGENCY = "emergency", // >= 95%
}

export type HealthAction =
  | "none"
  | "log"
  | "event"
  | "prepare_summary"
  | "summarize"
  | "compact"
  | "checkpoint"
  | "rotate"
  | "transfer";

export type SummarizationMethod = "summarize" | "prune" | "both";

// ============================================================================
// Threshold Configuration
// ============================================================================

export interface ThresholdConfig {
  percentage: number;
  actions: HealthAction[];
}

export interface ContextHealthThresholds {
  warning: ThresholdConfig;
  critical: ThresholdConfig;
  emergency: ThresholdConfig;
}

export const DEFAULT_THRESHOLDS: ContextHealthThresholds = {
  warning: {
    percentage: 75,
    actions: ["log", "event", "prepare_summary"],
  },
  critical: {
    percentage: 85,
    actions: ["summarize", "compact", "event"],
  },
  emergency: {
    percentage: 95,
    actions: ["checkpoint", "rotate", "transfer", "event"],
  },
};

// ============================================================================
// Health Monitoring Types
// ============================================================================

export interface TokenHistoryEntry {
  timestamp: Date;
  tokens: number;
  delta: number;
  event: string; // 'message', 'compaction', 'rotation', etc.
}

export interface HealthRecommendation {
  action: "summarize" | "compact" | "rotate" | "none";
  urgency: "low" | "medium" | "high" | "critical";
  reason: string;
  estimatedTokenSavings: number;
}

export interface ContextHealth {
  sessionId: string;
  status: ContextHealthStatus;
  currentTokens: number;
  maxTokens: number;
  percentUsed: number;

  // Projections
  projectedOverflowInMessages: number | null;
  estimatedTimeToWarning: number | null; // milliseconds

  // History
  tokenHistory: TokenHistoryEntry[];
  lastCompaction: Date | null;
  lastRotation: Date | null;

  // Recommendations
  recommendations: HealthRecommendation[];

  // Timestamps
  checkedAt: Date;
}

// ============================================================================
// Summarization Types
// ============================================================================

export interface SummarizationConfig {
  // Target reduction
  targetReduction: number; // Target token reduction (e.g., 0.3 = 30%)

  // What to summarize
  summarizable: {
    conversationHistory: boolean;
    searchResults: boolean;
    beadContent: boolean;
  };

  // Preservation rules
  preserve: {
    lastNMessages: number; // Always keep last N messages verbatim
    recentMinutes: number; // Keep messages from last N minutes
    keyDecisions: boolean; // Preserve decision points
    errorContext: boolean; // Preserve error-related context
  };
}

export const DEFAULT_SUMMARIZATION_CONFIG: SummarizationConfig = {
  targetReduction: 0.3,
  summarizable: {
    conversationHistory: true,
    searchResults: true,
    beadContent: false,
  },
  preserve: {
    lastNMessages: 5,
    recentMinutes: 10,
    keyDecisions: true,
    errorContext: true,
  },
};

export interface SummarizationResult {
  beforeTokens: number;
  afterTokens: number;
  reduction: number;
  reductionPercent: number;
  summarizedSections: string[];
  preservedSections: string[];
  summaries: SummaryContent[];
  appliedAt: Date;
}

export interface SummaryContent {
  section: string;
  originalTokens: number;
  summaryTokens: number;
  summary: string;
  keyPoints: string[];
}

// ============================================================================
// Rotation Types
// ============================================================================

export interface RotationConfig {
  // When to rotate
  triggers: {
    contextPercentage: number; // Rotate at this % (default: 95)
    messageCount?: number; // Rotate after N messages
    timeMinutes?: number; // Rotate after N minutes
  };

  // How to transfer
  transfer: {
    includeFullSummary: boolean;
    includeRecentMessages: number;
    includeActiveBeads: boolean;
    includeMemoryRules: boolean;
  };

  // New agent setup
  newAgent: {
    model?: string;
    warmupPrompt?: string;
  };

  // Cooldown to prevent thrashing
  cooldownMs: number;
}

export const DEFAULT_ROTATION_CONFIG: RotationConfig = {
  triggers: {
    contextPercentage: 95,
  },
  transfer: {
    includeFullSummary: true,
    includeRecentMessages: 10,
    includeActiveBeads: true,
    includeMemoryRules: true,
  },
  newAgent: {},
  cooldownMs: 60000, // 1 minute minimum between rotations
};

export interface ContextTransfer {
  sourceSessionId: string;
  targetSessionId: string;
  checkpointId: string;

  // Transferred content
  summary: string;
  recentMessages: TransferredMessage[];
  activeBeads: string[];
  memoryRules: string[];

  // Metadata
  sourceTokens: number;
  transferTokens: number;
  compressionRatio: number;
  transferredAt: Date;
}

export interface TransferredMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
}

export interface RotationResult {
  newSessionId: string;
  checkpointId: string;
  transfer: ContextTransfer;
  reason: "context_overflow" | "manual" | "scheduled";
  rotatedAt: Date;
}

// ============================================================================
// Service Configuration
// ============================================================================

export interface ContextHealthConfig {
  // Thresholds
  thresholds: ContextHealthThresholds;

  // Monitoring
  monitoring: {
    checkIntervalMs: number; // How often to check health
    historyRetentionHours: number;
    historyMaxEntries: number;
  };

  // Auto-healing
  autoHealing: {
    enabled: boolean;
    summarizationEnabled: boolean;
    rotationEnabled: boolean;
  };

  // Summarization
  summarization: SummarizationConfig;

  // Rotation
  rotation: RotationConfig;

  // Model limits
  modelLimits: Record<string, number>;
  defaultMaxTokens: number;
}

export const DEFAULT_CONTEXT_HEALTH_CONFIG: ContextHealthConfig = {
  thresholds: DEFAULT_THRESHOLDS,
  monitoring: {
    checkIntervalMs: 10000, // 10 seconds
    historyRetentionHours: 24,
    historyMaxEntries: 1000,
  },
  autoHealing: {
    enabled: true,
    summarizationEnabled: true,
    rotationEnabled: true,
  },
  summarization: DEFAULT_SUMMARIZATION_CONFIG,
  rotation: DEFAULT_ROTATION_CONFIG,
  modelLimits: {
    "claude-3-opus": 200000,
    "claude-3-sonnet": 200000,
    "claude-3-haiku": 200000,
    "claude-3.5-sonnet": 200000,
    "claude-opus-4": 200000,
    "claude-sonnet-4": 200000,
  },
  defaultMaxTokens: 200000,
};

// ============================================================================
// WebSocket Event Types
// ============================================================================

export interface ContextWarningEvent {
  event: "context.warning";
  data: {
    sessionId: string;
    percentUsed: number;
    currentTokens: number;
    maxTokens: number;
    recommendations: HealthRecommendation[];
  };
}

export interface ContextCompactedEvent {
  event: "context.compacted";
  data: {
    sessionId: string;
    beforeTokens: number;
    afterTokens: number;
    reduction: number;
    reductionPercent: number;
    method: SummarizationMethod;
  };
}

export interface ContextRotatedEvent {
  event: "context.emergency_rotated";
  data: {
    sourceSessionId: string;
    targetSessionId: string;
    checkpointId: string;
    reason: "context_overflow" | "manual" | "scheduled";
    transfer: {
      sourceTokens: number;
      transferTokens: number;
      compressionRatio: number;
    };
  };
}

export type ContextHealthEvent =
  | ContextWarningEvent
  | ContextCompactedEvent
  | ContextRotatedEvent;

// ============================================================================
// API Types
// ============================================================================

export interface GetHealthRequest {
  sessionId: string;
}

export interface CompactRequest {
  sessionId: string;
  strategy?: SummarizationMethod;
  targetReduction?: number;
}

export interface RotateRequest {
  sessionId: string;
  config?: Partial<RotationConfig>;
  reason?: string;
}

export interface HealthHistoryQuery {
  sessionId: string;
  since?: Date;
  limit?: number;
}
