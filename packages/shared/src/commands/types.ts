import type { z } from "zod";

/**
 * HTTP methods supported for REST bindings.
 */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * AI hints provide structured guidance for AI-assisted API usage.
 */
export interface AIHints {
  /** When this command should be used */
  whenToUse: string;
  /** Example natural language requests that map to this command */
  examples: string[];
  /** Related commands the AI should consider */
  relatedCommands: string[];
  /** Common mistakes to avoid */
  pitfalls?: string[];
  /** Prerequisites that must be met */
  prerequisites?: string[];
}

/**
 * REST binding configuration for a command.
 */
export interface RestBinding {
  /** HTTP method */
  method: HttpMethod;
  /** URL path template (e.g., "/agents/:agentId") */
  path: string;
  /** Whether this is a streaming endpoint */
  streaming?: boolean;
}

/**
 * WebSocket binding configuration for a command.
 */
export interface WebSocketBinding {
  /** Event types this command emits */
  emitsEvents: string[];
  /** Whether this command supports subscription */
  subscribable?: boolean;
}

/**
 * Rate limit configuration for a command.
 */
export interface RateLimitConfig {
  /** Maximum number of requests */
  requests: number;
  /** Time window (e.g., "1m", "1h", "1d") */
  window: string;
}

/**
 * Command metadata including permissions and operational settings.
 */
export interface CommandMetadata {
  /** Required permissions to execute this command */
  permissions: string[];
  /** Rate limiting configuration */
  rateLimit?: RateLimitConfig;
  /** Whether to audit this command */
  audit?: boolean;
  /** Whether this is a safe (idempotent, read-only) operation */
  safe?: boolean;
  /** Whether this is a long-running operation that returns a job ID */
  longRunning?: boolean;
}

/**
 * Complete command definition.
 */
export interface CommandDefinition<
  TInput extends z.ZodType = z.ZodType,
  TOutput extends z.ZodType = z.ZodType,
> {
  /** Unique command name (e.g., "agent.spawn", "checkpoint.create") */
  name: string;
  /** Human-readable description */
  description: string;
  /** Input validation schema */
  inputSchema: TInput;
  /** Output validation schema */
  outputSchema: TOutput;
  /** REST API binding */
  rest: RestBinding;
  /** WebSocket binding (optional) */
  ws?: WebSocketBinding;
  /** Command metadata */
  metadata: CommandMetadata;
  /** AI assistance hints */
  aiHints: AIHints;
}

/**
 * Command definition input (what you pass to defineCommand).
 */
export interface CommandDefinitionInput<
  TInput extends z.ZodType = z.ZodType,
  TOutput extends z.ZodType = z.ZodType,
> {
  name: string;
  description: string;
  input: TInput;
  output: TOutput;
  rest: RestBinding;
  ws?: WebSocketBinding;
  metadata: CommandMetadata;
  aiHints: AIHints;
}

/**
 * Registered command with inferred types.
 */
export type RegisteredCommand<
  TInput extends z.ZodType = z.ZodType,
  TOutput extends z.ZodType = z.ZodType,
> = CommandDefinition<TInput, TOutput> & {
  /** Category derived from command name (e.g., "agent" from "agent.spawn") */
  category: string;
  /** Path parameters extracted from REST path */
  pathParams: string[];
};

/**
 * Command handler function type.
 */
export type CommandHandler<
  TInput extends z.ZodType = z.ZodType,
  TOutput extends z.ZodType = z.ZodType,
> = (
  input: z.infer<TInput>,
  context: CommandContext,
) => Promise<z.infer<TOutput>>;

/**
 * Context passed to command handlers.
 */
export interface CommandContext {
  /** Unique request correlation ID */
  correlationId: string;
  /** Authenticated user/workspace ID */
  workspaceId?: string;
  /** Request timestamp */
  timestamp: Date;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Command registry interface.
 */
export interface CommandRegistry {
  /** Get a command by name */
  get(name: string): RegisteredCommand | undefined;
  /** Check if a command exists */
  has(name: string): boolean;
  /** Get all commands */
  all(): RegisteredCommand[];
  /** Get commands by category */
  byCategory(category: string): RegisteredCommand[];
  /** Get all category names */
  categories(): string[];
  /** Number of registered commands */
  size: number;
}
