import { z } from "zod";
import { defineCommand } from "../define";

/** Schema for agent spawn configuration */
const SpawnConfigSchema = z.object({
  /** Working directory for the agent */
  workingDirectory: z.string().min(1),
  /** Optional custom agent ID */
  agentId: z.string().optional(),
  /** Optional system prompt */
  systemPrompt: z.string().optional(),
  /** Environment variables */
  environment: z.record(z.string(), z.string()).optional(),
  /** Timeout in milliseconds (default: 1 hour) */
  timeout: z.number().min(1000).max(86400000).optional(),
  /** Maximum tokens for the agent session */
  maxTokens: z.number().min(1000).max(1000000).optional(),
  /** Agent driver type */
  driver: z.enum(["sdk", "acp", "tmux", "mock"]).optional(),
  /** PTY configuration */
  pty: z
    .object({
      enabled: z.boolean(),
      cols: z.number().min(1).max(500).optional(),
      rows: z.number().min(1).max(500).optional(),
    })
    .optional(),
});

/** Schema for spawned agent response */
const SpawnedAgentSchema = z.object({
  agentId: z.string(),
  state: z.enum(["spawning", "ready"]),
  createdAt: z.string().datetime(),
  driver: z.string(),
  links: z.object({
    self: z.string().url(),
    output: z.string().url(),
    ws: z.string().url(),
  }),
});

/** Schema for agent summary in list */
const AgentSummarySchema = z.object({
  agentId: z.string(),
  state: z.enum([
    "idle",
    "thinking",
    "working",
    "tool_calling",
    "waiting_input",
    "error",
    "stalled",
  ]),
  driver: z.string(),
  createdAt: z.string().datetime(),
  lastActivityAt: z.string().datetime(),
  links: z.object({
    self: z.string().url(),
  }),
});

/** Schema for list agents response */
const ListAgentsResponseSchema = z.object({
  agents: z.array(AgentSummarySchema),
  pagination: z.object({
    cursor: z.string().optional(),
    hasMore: z.boolean(),
    total: z.number().optional(),
  }),
});

/** Schema for agent detail response */
const AgentDetailSchema = z.object({
  agentId: z.string(),
  state: z.enum([
    "idle",
    "thinking",
    "working",
    "tool_calling",
    "waiting_input",
    "error",
    "stalled",
  ]),
  driver: z.string(),
  createdAt: z.string().datetime(),
  lastActivityAt: z.string().datetime(),
  config: z.object({
    workingDirectory: z.string(),
    timeout: z.number(),
    maxTokens: z.number(),
    pty: z.boolean(),
  }),
  stats: z.object({
    messagesReceived: z.number(),
    messagesSent: z.number(),
    tokensUsed: z.number(),
    toolCalls: z.number(),
  }),
  links: z.object({
    self: z.string().url(),
    output: z.string().url(),
    ws: z.string().url(),
    terminate: z.string().url(),
  }),
});

/** Spawn a new agent */
export const spawnAgent = defineCommand({
  name: "agent.spawn",
  description: "Spawn a new agent to execute tasks in a working directory",
  input: SpawnConfigSchema,
  output: SpawnedAgentSchema,
  rest: { method: "POST", path: "/agents" },
  ws: { emitsEvents: ["agent:spawning", "agent:ready", "agent:error"] },
  metadata: {
    permissions: ["agent:write"],
    rateLimit: { requests: 10, window: "1m" },
    audit: true,
  },
  aiHints: {
    whenToUse: "Use when starting a new agent to work on a coding task",
    examples: [
      "Spawn an agent to fix the login bug",
      "Create an agent to implement the new feature",
      "Start an agent to run the test suite",
    ],
    relatedCommands: ["agent.stop", "agent.list", "agent.get"],
    pitfalls: [
      "Ensure workingDirectory exists and is accessible",
      "Consider timeout for long-running tasks",
    ],
  },
});

/** List all agents */
export const listAgents = defineCommand({
  name: "agent.list",
  description: "List all agents with optional filtering",
  input: z.object({
    state: z.array(z.enum(["spawning", "ready", "executing", "paused", "terminating", "terminated"])).optional(),
    driver: z.array(z.string()).optional(),
    createdAfter: z.string().datetime().optional(),
    createdBefore: z.string().datetime().optional(),
    limit: z.number().min(1).max(200).default(50),
    cursor: z.string().optional(),
  }),
  output: ListAgentsResponseSchema,
  rest: { method: "GET", path: "/agents" },
  metadata: {
    permissions: ["agent:read"],
    safe: true,
  },
  aiHints: {
    whenToUse: "Use to see all running or recent agents",
    examples: [
      "List all running agents",
      "Show agents created in the last hour",
      "Get agents filtered by state",
    ],
    relatedCommands: ["agent.get", "agent.spawn"],
  },
});

/** Get agent details */
export const getAgent = defineCommand({
  name: "agent.get",
  description: "Get detailed information about a specific agent",
  input: z.object({
    agentId: z.string(),
  }),
  output: AgentDetailSchema,
  rest: { method: "GET", path: "/agents/:agentId" },
  metadata: {
    permissions: ["agent:read"],
    safe: true,
  },
  aiHints: {
    whenToUse: "Use to check the status and configuration of a specific agent",
    examples: [
      "Get details for agent abc123",
      "Check the status of my agent",
      "See token usage for an agent",
    ],
    relatedCommands: ["agent.list", "agent.stop"],
  },
});

/** Stop an agent */
export const stopAgent = defineCommand({
  name: "agent.stop",
  description: "Terminate a running agent gracefully or forcefully",
  input: z.object({
    agentId: z.string(),
    graceful: z.boolean().default(true),
    timeout: z.number().min(0).max(60000).optional(),
  }),
  output: z.object({
    agentId: z.string(),
    state: z.literal("terminating"),
    terminatedAt: z.string().datetime().optional(),
  }),
  rest: { method: "DELETE", path: "/agents/:agentId" },
  ws: { emitsEvents: ["agent:terminating", "agent:terminated"] },
  metadata: {
    permissions: ["agent:delete"],
    audit: true,
  },
  aiHints: {
    whenToUse: "Use to stop a running agent when it is no longer needed",
    examples: [
      "Stop agent abc123",
      "Terminate the agent gracefully",
      "Force stop a stuck agent",
    ],
    relatedCommands: ["agent.spawn", "agent.list"],
    pitfalls: [
      "Graceful shutdown waits for current operation to complete",
      "Force shutdown may lose in-progress work",
    ],
  },
});

/** Send a message to an agent */
export const sendMessage = defineCommand({
  name: "agent.send",
  description: "Send a message to an agent for processing",
  input: z.object({
    agentId: z.string(),
    type: z.enum(["user", "system"]),
    content: z.string().min(1),
    stream: z.boolean().default(false),
  }),
  output: z.object({
    messageId: z.string(),
    receivedAt: z.string().datetime(),
    state: z.enum(["queued", "processing"]),
  }),
  rest: { method: "POST", path: "/agents/:agentId/send", streaming: true },
  ws: { emitsEvents: ["agent:message:received", "agent:output:chunk"] },
  metadata: {
    permissions: ["agent:write"],
    audit: true,
  },
  aiHints: {
    whenToUse: "Use to send a task or instruction to an agent",
    examples: [
      "Send a coding task to the agent",
      "Ask the agent to run tests",
      "Provide additional context to the agent",
    ],
    relatedCommands: ["agent.get", "agent.output"],
    pitfalls: [
      "Agent must be in ready or executing state",
      "Use stream=true for real-time output",
    ],
  },
});

/** Get agent output */
export const getOutput = defineCommand({
  name: "agent.output",
  description: "Get output chunks from an agent with cursor-based pagination",
  input: z.object({
    agentId: z.string(),
    cursor: z.string().optional(),
    limit: z.number().min(1).max(1000).default(100),
    types: z
      .array(z.enum(["text", "markdown", "thinking", "tool_use", "tool_result", "error", "system"]))
      .optional(),
    wait: z.number().min(0).max(30000).optional(),
  }),
  output: z.object({
    chunks: z.array(
      z.object({
        cursor: z.string(),
        timestamp: z.string().datetime(),
        type: z.enum(["text", "markdown", "thinking", "tool_use", "tool_result", "error", "system"]),
        content: z.union([z.string(), z.record(z.string(), z.unknown())]),
      }),
    ),
    pagination: z.object({
      cursor: z.string(),
      hasMore: z.boolean(),
    }),
  }),
  rest: { method: "GET", path: "/agents/:agentId/output" },
  metadata: {
    permissions: ["agent:read"],
    safe: true,
  },
  aiHints: {
    whenToUse: "Use to retrieve agent output for display or processing",
    examples: [
      "Get the latest output from the agent",
      "Poll for new output since last cursor",
      "Long-poll for real-time updates",
    ],
    relatedCommands: ["agent.send", "agent.get"],
    pitfalls: [
      "Use wait parameter for long-polling",
      "Cursor may expire after ring buffer wraps",
    ],
  },
});

/** Interrupt an agent */
export const interruptAgent = defineCommand({
  name: "agent.interrupt",
  description: "Send an interrupt signal to an agent",
  input: z.object({
    agentId: z.string(),
    signal: z.enum(["SIGINT", "SIGTSTP", "SIGCONT"]).default("SIGINT"),
  }),
  output: z.object({
    agentId: z.string(),
    signal: z.string(),
    sentAt: z.string().datetime(),
    previousState: z.enum([
      "idle",
      "thinking",
      "working",
      "tool_calling",
      "waiting_input",
      "error",
      "stalled",
    ]),
  }),
  rest: { method: "POST", path: "/agents/:agentId/interrupt" },
  ws: { emitsEvents: ["agent:interrupted"] },
  metadata: {
    permissions: ["agent:write"],
    audit: true,
  },
  aiHints: {
    whenToUse: "Use to interrupt a running operation or pause/resume an agent",
    examples: [
      "Send Ctrl+C to stop current operation",
      "Pause the agent with SIGTSTP",
      "Resume a paused agent with SIGCONT",
    ],
    relatedCommands: ["agent.stop", "agent.send"],
    pitfalls: [
      "SIGINT may not stop all operations",
      "SIGTSTP pauses but does not terminate",
    ],
  },
});

/** All agent commands */
export const agentCommands = [
  spawnAgent,
  listAgents,
  getAgent,
  stopAgent,
  sendMessage,
  getOutput,
  interruptAgent,
] as const;
