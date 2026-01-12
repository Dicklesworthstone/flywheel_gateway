/**
 * Pipeline and Workflow Engine Models
 *
 * Defines types for orchestrating sequences of agent operations including:
 * - Step-by-step workflow definition
 * - Conditional branching
 * - Parallel execution
 * - Checkpoint and resume
 * - Error handling with retry
 */

// ============================================================================
// Pipeline Status Types
// ============================================================================

/**
 * Status of a pipeline execution.
 */
export type PipelineStatus =
  | "idle"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * Status of an individual pipeline step.
 */
export type StepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "cancelled";

/**
 * Types of pipeline steps.
 */
export type StepType =
  | "agent_task"
  | "conditional"
  | "parallel"
  | "approval"
  | "script";

/**
 * Types of pipeline triggers.
 */
export type TriggerType = "manual" | "schedule" | "webhook" | "bead_event";

// ============================================================================
// Step Configuration Types
// ============================================================================

/**
 * Configuration for an agent_task step.
 * Spawns an agent with a given prompt.
 */
export interface AgentTaskConfig {
  /** Prompt to send to the agent */
  prompt: string;
  /** Working directory for the agent */
  workingDirectory?: string;
  /** System prompt override */
  systemPrompt?: string;
  /** Timeout for the task in milliseconds */
  timeout?: number;
  /** Maximum tokens for the agent */
  maxTokens?: number;
  /** Wait for agent to complete (default: true) */
  waitForCompletion?: boolean;
}

/**
 * Configuration for a conditional step.
 * Evaluates a condition and branches accordingly.
 */
export interface ConditionalConfig {
  /** Condition expression (supports ${context.variable} substitution) */
  condition: string;
  /** Step IDs to execute if condition is true */
  thenSteps: string[];
  /** Step IDs to execute if condition is false */
  elseSteps?: string[];
}

/**
 * Configuration for a parallel step.
 * Runs multiple steps concurrently.
 */
export interface ParallelConfig {
  /** Step IDs to run in parallel */
  steps: string[];
  /** Fail fast on first error (default: false) */
  failFast?: boolean;
  /** Maximum concurrent executions (default: unlimited) */
  maxConcurrency?: number;
}

/**
 * Configuration for an approval step.
 * Waits for human approval before continuing.
 */
export interface ApprovalConfig {
  /** Approvers who can approve this step (user IDs) */
  approvers: string[];
  /** Message to display to approvers */
  message: string;
  /** Timeout for approval in milliseconds (optional) */
  timeout?: number;
  /** Action to take on timeout: 'approve', 'reject', or 'fail' */
  onTimeout?: "approve" | "reject" | "fail";
  /** Minimum number of approvals required (default: 1) */
  minApprovals?: number;
}

/**
 * Configuration for a script step.
 * Runs a shell script.
 */
export interface ScriptConfig {
  /** Script content or path */
  script: string;
  /** Whether script is a path (true) or inline content (false) */
  isPath?: boolean;
  /** Working directory for the script */
  workingDirectory?: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Shell to use (default: /bin/bash) */
  shell?: string;
}

/**
 * Union type for all step configurations.
 */
export type StepConfig =
  | { type: "agent_task"; config: AgentTaskConfig }
  | { type: "conditional"; config: ConditionalConfig }
  | { type: "parallel"; config: ParallelConfig }
  | { type: "approval"; config: ApprovalConfig }
  | { type: "script"; config: ScriptConfig };

// ============================================================================
// Trigger Configuration Types
// ============================================================================

/**
 * Configuration for manual triggers.
 */
export interface ManualTriggerConfig {
  /** Optional description shown in UI */
  description?: string;
  /** Parameters that must be provided at trigger time */
  requiredParams?: string[];
}

/**
 * Configuration for scheduled triggers.
 */
export interface ScheduleTriggerConfig {
  /** Cron expression (e.g., "0 0 * * *" for daily at midnight) */
  cron: string;
  /** Timezone (e.g., "America/New_York") */
  timezone?: string;
  /** Start date for the schedule */
  startDate?: string;
  /** End date for the schedule */
  endDate?: string;
}

/**
 * Configuration for webhook triggers.
 */
export interface WebhookTriggerConfig {
  /** Secret for validating webhook requests */
  secret?: string;
  /** Expected headers for validation */
  expectedHeaders?: Record<string, string>;
  /** JSONPath to extract context from webhook payload */
  payloadMapping?: Record<string, string>;
}

/**
 * Configuration for bead event triggers.
 */
export interface BeadEventTriggerConfig {
  /** Bead event types to trigger on */
  events: Array<"created" | "updated" | "closed" | "assigned">;
  /** Filter by bead type */
  beadType?: string[];
  /** Filter by bead priority */
  beadPriority?: number[];
  /** Filter by bead labels */
  beadLabels?: string[];
}

/**
 * Union type for all trigger configurations.
 */
export type TriggerConfig =
  | { type: "manual"; config: ManualTriggerConfig }
  | { type: "schedule"; config: ScheduleTriggerConfig }
  | { type: "webhook"; config: WebhookTriggerConfig }
  | { type: "bead_event"; config: BeadEventTriggerConfig };

// ============================================================================
// Retry Configuration
// ============================================================================

/**
 * Retry policy configuration.
 */
export interface RetryPolicy {
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Initial delay in milliseconds */
  initialDelay: number;
  /** Maximum delay in milliseconds */
  maxDelay: number;
  /** Backoff multiplier (default: 2) */
  multiplier?: number;
  /** Error codes that are retryable */
  retryableErrors?: string[];
}

/**
 * Default retry policy.
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  multiplier: 2,
};

// ============================================================================
// Pipeline Step
// ============================================================================

/**
 * Result of a step execution.
 */
export interface StepResult {
  /** Whether the step succeeded */
  success: boolean;
  /** Output data from the step */
  output?: unknown;
  /** Error information if failed */
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  /** Duration in milliseconds */
  durationMs: number;
  /** Retry count */
  retryCount: number;
}

/**
 * Approval record for approval steps.
 */
export interface ApprovalRecord {
  /** User who provided the approval/rejection */
  userId: string;
  /** Whether they approved or rejected */
  decision: "approved" | "rejected";
  /** Optional comment */
  comment?: string | undefined;
  /** When the decision was made */
  timestamp: Date;
}

/**
 * A single step in a pipeline.
 */
export interface PipelineStep {
  /** Unique step ID within the pipeline */
  id: string;
  /** Human-readable step name */
  name: string;
  /** Optional description */
  description?: string | undefined;
  /** Step type and configuration */
  type: StepType;
  /** Type-specific configuration */
  config: StepConfig;
  /** Current status */
  status: StepStatus;
  /** Step result after execution */
  result?: StepResult | undefined;
  /** Approval records (for approval steps) */
  approvals?: ApprovalRecord[] | undefined;
  /** When the step started */
  startedAt?: Date | undefined;
  /** When the step completed */
  completedAt?: Date | undefined;
  /** Dependencies (step IDs that must complete first) */
  dependsOn?: string[] | undefined;
  /** Retry policy for this step */
  retryPolicy?: RetryPolicy | undefined;
  /** Condition for executing this step */
  condition?: string | undefined;
  /** Continue pipeline on failure (default: false) */
  continueOnFailure?: boolean | undefined;
  /** Step timeout in milliseconds */
  timeout?: number | undefined;
}

// ============================================================================
// Pipeline Trigger
// ============================================================================

/**
 * Pipeline trigger definition.
 */
export interface PipelineTrigger {
  /** Trigger type */
  type: TriggerType;
  /** Type-specific configuration */
  config: TriggerConfig;
  /** Whether the trigger is enabled */
  enabled: boolean;
  /** Last triggered timestamp */
  lastTriggeredAt?: Date;
  /** Next scheduled trigger (for schedule triggers) */
  nextTriggerAt?: Date;
}

// ============================================================================
// Pipeline Run
// ============================================================================

/**
 * A single execution of a pipeline.
 */
export interface PipelineRun {
  /** Unique run ID */
  id: string;
  /** Pipeline ID this run belongs to */
  pipelineId: string;
  /** Current run status */
  status: PipelineStatus;
  /** Index of the current step being executed */
  currentStepIndex: number;
  /** IDs of steps that have been executed (for resume) */
  executedStepIds: string[];
  /** Shared context across steps */
  context: Record<string, unknown>;
  /** Initial trigger parameters */
  triggerParams?: Record<string, unknown> | undefined;
  /** Who/what triggered this run */
  triggeredBy: {
    type: "user" | "schedule" | "webhook" | "bead_event" | "api";
    id?: string | undefined;
  };
  /** When the run started */
  startedAt: Date;
  /** When the run completed */
  completedAt?: Date | undefined;
  /** Error if the run failed */
  error?: {
    code: string;
    message: string;
    stepId?: string | undefined;
  } | undefined;
  /** Duration in milliseconds */
  durationMs?: number | undefined;
}

// ============================================================================
// Pipeline
// ============================================================================

/**
 * A pipeline definition.
 */
export interface Pipeline {
  /** Unique pipeline ID */
  id: string;
  /** Pipeline name */
  name: string;
  /** Pipeline description */
  description?: string | undefined;
  /** Pipeline version (incremented on each update) */
  version: number;
  /** Whether the pipeline is enabled */
  enabled: boolean;
  /** Pipeline trigger configuration */
  trigger: PipelineTrigger;
  /** Pipeline steps */
  steps: PipelineStep[];
  /** Global context defaults */
  contextDefaults?: Record<string, unknown> | undefined;
  /** Global retry policy (can be overridden per step) */
  retryPolicy?: RetryPolicy | undefined;
  /** Tags for categorization */
  tags?: string[] | undefined;
  /** Owner user ID */
  ownerId?: string | undefined;
  /** When the pipeline was created */
  createdAt: Date;
  /** When the pipeline was last updated */
  updatedAt: Date;
  /** When the pipeline was last run */
  lastRunAt?: Date | undefined;
  /** Statistics about the pipeline */
  stats: {
    totalRuns: number;
    successfulRuns: number;
    failedRuns: number;
    averageDurationMs: number;
  };
}

// ============================================================================
// API Types
// ============================================================================

/**
 * Input for creating a new pipeline.
 */
export interface CreatePipelineInput {
  name: string;
  description?: string | undefined;
  trigger: {
    type: TriggerType;
    config: TriggerConfig;
    enabled?: boolean | undefined;
  };
  steps: Array<{
    id: string;
    name: string;
    description?: string | undefined;
    type: StepType;
    config: StepConfig;
    dependsOn?: string[] | undefined;
    retryPolicy?: RetryPolicy | undefined;
    condition?: string | undefined;
    continueOnFailure?: boolean | undefined;
    timeout?: number | undefined;
  }>;
  contextDefaults?: Record<string, unknown> | undefined;
  retryPolicy?: RetryPolicy | undefined;
  tags?: string[] | undefined;
  ownerId?: string | undefined;
}

/**
 * Input for updating a pipeline.
 */
export interface UpdatePipelineInput {
  name?: string | undefined;
  description?: string | undefined;
  enabled?: boolean | undefined;
  trigger?: {
    type?: TriggerType | undefined;
    config?: TriggerConfig | undefined;
    enabled?: boolean | undefined;
  } | undefined;
  steps?: Array<{
    id: string;
    name: string;
    description?: string | undefined;
    type: StepType;
    config: StepConfig;
    dependsOn?: string[] | undefined;
    retryPolicy?: RetryPolicy | undefined;
    condition?: string | undefined;
    continueOnFailure?: boolean | undefined;
    timeout?: number | undefined;
  }> | undefined;
  contextDefaults?: Record<string, unknown> | undefined;
  retryPolicy?: RetryPolicy | undefined;
  tags?: string[] | undefined;
}

/**
 * Filter options for listing pipelines.
 */
export interface PipelineFilter {
  /** Filter by tags */
  tags?: string[] | undefined;
  /** Filter by enabled status */
  enabled?: boolean | undefined;
  /** Filter by owner */
  ownerId?: string | undefined;
  /** Search by name */
  search?: string | undefined;
  /** Pagination limit */
  limit?: number | undefined;
  /** Cursor for pagination */
  cursor?: string | undefined;
}

/**
 * Filter options for listing pipeline runs.
 */
export interface PipelineRunFilter {
  /** Filter by status */
  status?: PipelineStatus[] | undefined;
  /** Filter by triggered after date */
  since?: Date | undefined;
  /** Filter by triggered before date */
  until?: Date | undefined;
  /** Pagination limit */
  limit?: number | undefined;
  /** Cursor for pagination */
  cursor?: string | undefined;
}

// ============================================================================
// Serialization Helpers
// ============================================================================

/**
 * Serialize dates in a pipeline step for API responses.
 */
export function serializeStep(step: PipelineStep): Record<string, unknown> {
  return {
    ...step,
    ...(step.startedAt && { startedAt: step.startedAt.toISOString() }),
    ...(step.completedAt && { completedAt: step.completedAt.toISOString() }),
    ...(step.approvals && {
      approvals: step.approvals.map((a) => ({
        ...a,
        timestamp: a.timestamp.toISOString(),
      })),
    }),
  };
}

/**
 * Serialize dates in a pipeline for API responses.
 */
export function serializePipeline(
  pipeline: Pipeline,
): Record<string, unknown> {
  return {
    ...pipeline,
    createdAt: pipeline.createdAt.toISOString(),
    updatedAt: pipeline.updatedAt.toISOString(),
    ...(pipeline.lastRunAt && { lastRunAt: pipeline.lastRunAt.toISOString() }),
    trigger: {
      ...pipeline.trigger,
      ...(pipeline.trigger.lastTriggeredAt && {
        lastTriggeredAt: pipeline.trigger.lastTriggeredAt.toISOString(),
      }),
      ...(pipeline.trigger.nextTriggerAt && {
        nextTriggerAt: pipeline.trigger.nextTriggerAt.toISOString(),
      }),
    },
    steps: pipeline.steps.map(serializeStep),
  };
}

/**
 * Serialize dates in a pipeline run for API responses.
 */
export function serializeRun(run: PipelineRun): Record<string, unknown> {
  return {
    ...run,
    startedAt: run.startedAt.toISOString(),
    ...(run.completedAt && { completedAt: run.completedAt.toISOString() }),
  };
}
