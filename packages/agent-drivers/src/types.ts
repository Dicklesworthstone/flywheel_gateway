/**
 * Core types for the Agent Driver Abstraction Layer.
 * These types define the contract between Flywheel Gateway and agent backends.
 */

// ============================================================================
// Driver Types
// ============================================================================

export type AgentDriverType =
  | "sdk"
  | "claude_code_ws"
  | "acp"
  | "tmux"
  | "ntm"
  | "mock";

/**
 * Capabilities that a driver may or may not support.
 * Features should check capabilities before attempting operations.
 */
export interface DriverCapabilities {
  /** Driver supports structured events (tool calls, file ops, etc.) */
  structuredEvents: boolean;
  /** Driver supports intercepting tool calls */
  toolCalls: boolean;
  /** Driver supports file operation events */
  fileOperations: boolean;
  /** Driver supports attaching a visual terminal */
  terminalAttach: boolean;
  /** Driver supports diff rendering for edits */
  diffRendering: boolean;
  /** Driver supports checkpointing and restore */
  checkpoint: boolean;
  /** Driver supports interruption mid-response */
  interrupt: boolean;
  /** Driver supports streaming output */
  streaming: boolean;
}

// ============================================================================
// Agent Configuration
// ============================================================================

export type ModelProvider = "claude" | "codex" | "gemini";

export interface AgentConfig {
  /** Unique identifier for this agent instance */
  id: string;
  /** Human-readable name for the agent */
  name?: string;
  /** AI model provider */
  provider: ModelProvider;
  /** Specific model identifier (e.g., "claude-opus-4", "gpt-5-codex") */
  model: string;
  /** Initial system prompt for the agent */
  systemPrompt?: string;
  /** Working directory for the agent */
  workingDirectory: string;
  /** Maximum tokens for context window */
  maxTokens?: number;
  /** Temperature setting (0.0 - 1.0) */
  temperature?: number;
  /** Additional provider-specific options */
  providerOptions?: Record<string, unknown>;
  /** CAAM account ID for BYOA */
  accountId?: string;
}

// ============================================================================
// Agent State
// ============================================================================

/**
 * Activity states an agent can be in.
 * These are detected/inferred differently by each driver.
 */
export type ActivityState =
  | "idle" // Waiting for input
  | "thinking" // Processing, no output yet
  | "working" // Actively producing output
  | "tool_calling" // Executing a tool
  | "waiting_input" // Waiting for user input
  | "error" // Encountered an error
  | "stalled"; // No activity for threshold period

/**
 * Token usage tracking for an agent.
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost?: number;
}

/**
 * Represents the current state of an agent.
 */
export interface AgentState {
  id: string;
  config: AgentConfig;
  activityState: ActivityState;
  tokenUsage: TokenUsage;
  contextHealth: "healthy" | "warning" | "critical" | "emergency";
  startedAt: Date;
  lastActivityAt: Date;
}

/**
 * Full agent instance including driver reference.
 */
export interface Agent extends AgentState {
  driverId: string;
  driverType: AgentDriverType;
}

// ============================================================================
// Output Types
// ============================================================================

export type OutputType =
  | "text" // Regular text output
  | "markdown" // Markdown-formatted text
  | "thinking" // Internal thinking (if exposed)
  | "tool_use" // Tool invocation
  | "tool_result" // Tool execution result
  | "error" // Error message
  | "system"; // System message

export interface OutputLine {
  timestamp: Date;
  type: OutputType;
  content: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Event Types
// ============================================================================

export type AgentEventType =
  | "state_change"
  | "output"
  | "tool_call_start"
  | "tool_call_end"
  | "file_read"
  | "file_write"
  | "file_edit"
  | "error"
  | "interrupt"
  | "checkpoint_created"
  | "context_warning"
  | "terminated";

export interface AgentEventBase {
  type: AgentEventType;
  agentId: string;
  timestamp: Date;
}

export interface StateChangeEvent extends AgentEventBase {
  type: "state_change";
  previousState: ActivityState;
  newState: ActivityState;
  reason?: string;
}

export interface OutputEvent extends AgentEventBase {
  type: "output";
  output: OutputLine;
}

export interface ToolCallStartEvent extends AgentEventBase {
  type: "tool_call_start";
  toolName: string;
  toolId: string;
  input: Record<string, unknown>;
}

export interface ToolCallEndEvent extends AgentEventBase {
  type: "tool_call_end";
  toolName: string;
  toolId: string;
  output: unknown;
  success: boolean;
  durationMs: number;
}

export interface FileOperationEvent extends AgentEventBase {
  type: "file_read" | "file_write" | "file_edit";
  path: string;
  operation: "read" | "write" | "edit";
  success: boolean;
}

export interface ErrorEvent extends AgentEventBase {
  type: "error";
  error: Error;
  recoverable: boolean;
}

export interface InterruptEvent extends AgentEventBase {
  type: "interrupt";
  reason: "user" | "system" | "timeout" | "context_limit";
}

export interface ContextWarningEvent extends AgentEventBase {
  type: "context_warning";
  level: "warning" | "critical" | "emergency";
  usagePercent: number;
  suggestion: string;
}

export interface TerminatedEvent extends AgentEventBase {
  type: "terminated";
  reason: "normal" | "error" | "user_requested" | "system";
  exitCode: number | undefined;
}

export interface CheckpointCreatedEvent extends AgentEventBase {
  type: "checkpoint_created";
  checkpointId: string;
}

export type AgentEvent =
  | StateChangeEvent
  | OutputEvent
  | ToolCallStartEvent
  | ToolCallEndEvent
  | FileOperationEvent
  | ErrorEvent
  | InterruptEvent
  | ContextWarningEvent
  | TerminatedEvent
  | CheckpointCreatedEvent;

// ============================================================================
// Checkpoint Types
// ============================================================================

export interface CheckpointMetadata {
  id: string;
  agentId: string;
  createdAt: Date;
  tokenUsage: TokenUsage;
  description: string | undefined;
  tags: string[] | undefined;
}

export interface Checkpoint extends CheckpointMetadata {
  conversationHistory: unknown[];
  toolState: Record<string, unknown>;
  contextPack?: unknown;
}

// ============================================================================
// Driver Result Types
// ============================================================================

export interface SpawnResult {
  agent: Agent;
  warnings?: string[];
}

export interface SendResult {
  messageId: string;
  queued: boolean;
}
