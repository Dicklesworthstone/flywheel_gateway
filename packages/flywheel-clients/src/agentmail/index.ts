import type { ValidationFieldError } from "@flywheel/shared/errors";
import {
  createGatewayError,
  createValidationError,
  toGatewayError,
} from "@flywheel/shared/errors";
import { z } from "zod";

export type AgentMailPriority = "low" | "normal" | "high" | "urgent";

export interface AgentMailClientErrorDetails {
  tool?: string;
  issues?: z.ZodIssue[];
  cause?: unknown;
}

export class AgentMailClientError extends Error {
  readonly kind: "input_validation" | "response_validation" | "transport";
  readonly details?: AgentMailClientErrorDetails;

  constructor(
    kind: AgentMailClientError["kind"],
    message: string,
    details?: AgentMailClientErrorDetails,
  ) {
    super(message);
    this.name = "AgentMailClientError";
    this.kind = kind;
    if (details) {
      this.details = details;
    }
  }
}

export interface AgentMailToolCallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  correlationId?: string;
  requestId?: string;
}

export type AgentMailToolCaller = (
  toolName: string,
  input: unknown,
  options?: AgentMailToolCallOptions,
) => Promise<unknown>;

export interface AgentMailClientOptions {
  callTool: AgentMailToolCaller;
  toolPrefix?: string;
  defaultTtlSeconds?: number;
}

const PrioritySchema = z.enum(["low", "normal", "high", "urgent"]);

const MetadataSchema = z.record(z.string(), z.unknown());

const TimestampSchema = z.preprocess(
  (value) => (value instanceof Date ? value.toISOString() : value),
  z.string().datetime(),
);

const AgentIdentitySchema = z.object({
  agentId: z.string().min(1),
});

const MessageSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    from: AgentIdentitySchema,
    to: AgentIdentitySchema,
    subject: z.string(),
    body: z.unknown(),
    replyTo: z.string().optional(),
    priority: PrioritySchema,
    ttl: z.number().int().positive(),
    metadata: MetadataSchema.optional(),
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .passthrough();

const EnsureProjectInputSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
  metadata: MetadataSchema.optional(),
});

const EnsureProjectOutputSchema = z
  .object({
    projectId: z.string(),
    created: z.boolean(),
  })
  .passthrough();

const RegisterAgentInputSchema = z.object({
  projectId: z.string().min(1),
  agentId: z.string().min(1),
  capabilities: z.array(z.string()).default([]),
  metadata: MetadataSchema.optional(),
});

const RegisterAgentOutputSchema = z
  .object({
    registered: z.boolean(),
    mailboxId: z.string(),
  })
  .passthrough();

const SendMessageInputSchema = z.object({
  projectId: z.string().min(1),
  to: z.string().min(1),
  subject: z.string().min(1),
  body: z.unknown(),
  priority: PrioritySchema.optional(),
  ttl: z.number().int().positive().optional(),
});

const SendMessageOutputSchema = z
  .object({
    messageId: z.string(),
    delivered: z.boolean(),
  })
  .passthrough();

const ReplyInputSchema = z.object({
  messageId: z.string().min(1),
  body: z.unknown(),
  priority: PrioritySchema.optional(),
});

const ReplyOutputSchema = z
  .object({
    replyId: z.string(),
    delivered: z.boolean(),
  })
  .passthrough();

const MarkReadInputSchema = z.object({
  project_key: z.string().min(1),
  agent_name: z.string().min(1),
  message_id: z.number().int(),
});

const MarkReadOutputSchema = z
  .object({
    message_id: z.number(),
    read: z.boolean(),
    read_at: z.string().nullable(),
  })
  .passthrough();

const AcknowledgeInputSchema = z.object({
  project_key: z.string().min(1),
  agent_name: z.string().min(1),
  message_id: z.number().int(),
});

const AcknowledgeOutputSchema = z
  .object({
    message_id: z.number(),
    acknowledged: z.boolean(),
    acknowledged_at: z.string().nullable(),
    read_at: z.string().nullable(),
  })
  .passthrough();

const SearchMessagesInputSchema = z.object({
  project_key: z.string().min(1),
  query: z.string().min(1),
  limit: z.number().int().positive().optional(),
});

const SearchMessagesOutputSchema = z.array(
  z
    .object({
      id: z.number(),
      subject: z.string(),
      importance: z.string(),
      ack_required: z.boolean(),
      created_ts: z.string(),
      thread_id: z.string().nullable().optional(),
      from: z.string(),
    })
    .passthrough(),
);

const SummarizeThreadInputSchema = z.object({
  project_key: z.string().min(1),
  thread_id: z.string().min(1),
  include_examples: z.boolean().optional(),
  llm_mode: z.boolean().optional(),
});

const SummarizeThreadOutputSchema = z
  .object({
    thread_id: z.string(),
    summary: z
      .object({
        participants: z.array(z.string()),
        key_points: z.array(z.string()),
        action_items: z.array(z.string()),
      })
      .passthrough(),
  })
  .passthrough();

const ReleaseReservationsInputSchema = z.object({
  project_key: z.string().min(1),
  agent_name: z.string().min(1),
  paths: z.array(z.string()).optional(),
  file_reservation_ids: z.array(z.number()).optional(),
});

const ReleaseReservationsOutputSchema = z
  .object({
    released: z.number(),
    released_at: z.string(),
  })
  .passthrough();

const RenewReservationsInputSchema = z.object({
  project_key: z.string().min(1),
  agent_name: z.string().min(1),
  extend_seconds: z.number().int().min(60).optional(),
  paths: z.array(z.string()).optional(),
  file_reservation_ids: z.array(z.number()).optional(),
});

const RenewReservationsOutputSchema = z
  .object({
    renewed: z.number(),
    file_reservations: z.array(
      z
        .object({
          id: z.number(),
          path_pattern: z.string(),
          old_expires_ts: z.string(),
          new_expires_ts: z.string(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

const WhoisInputSchema = z.object({
  project_key: z.string().min(1),
  agent_name: z.string().min(1),
  include_recent_commits: z.boolean().optional(),
  commit_limit: z.number().int().optional(),
});

const WhoisOutputSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    program: z.string(),
    model: z.string(),
    task_description: z.string().optional(),
  })
  .passthrough();

const HealthInputSchema = z.object({
  probe: z.enum(["liveness", "readiness"]).optional(),
});

const HealthOutputSchema = z
  .object({
    status: z.string(),
    timestamp: z.string().datetime(),
  })
  .passthrough();

const FetchInboxInputSchema = z.object({
  projectId: z.string().min(1),
  agentId: z.string().min(1),
  limit: z.number().int().positive().optional(),
  since: TimestampSchema.optional(),
  priority: PrioritySchema.optional(),
});

const FetchInboxOutputSchema = z
  .object({
    messages: z.array(MessageSchema),
    hasMore: z.boolean(),
  })
  .passthrough();

const RequestFileReservationInputSchema = z.object({
  projectId: z.string().min(1),
  requesterId: z.string().min(1),
  patterns: z.array(z.string().min(1)).min(1),
  exclusive: z.boolean(),
  duration: z.number().int().positive().optional(),
});

const RequestFileReservationOutputSchema = z
  .object({
    reservationId: z.string(),
    granted: z.boolean(),
    conflicts: z.array(z.string()).optional(),
  })
  .passthrough();

export interface AgentMailClient {
  ensureProject: (
    input: EnsureProjectInput,
    options?: AgentMailToolCallOptions,
  ) => Promise<z.infer<typeof EnsureProjectOutputSchema>>;
  registerAgent: (
    input: RegisterAgentInput,
    options?: AgentMailToolCallOptions,
  ) => Promise<z.infer<typeof RegisterAgentOutputSchema>>;
  sendMessage: (
    input: SendMessageInput,
    options?: AgentMailToolCallOptions,
  ) => Promise<z.infer<typeof SendMessageOutputSchema>>;
  reply: (
    input: ReplyInput,
    options?: AgentMailToolCallOptions,
  ) => Promise<z.infer<typeof ReplyOutputSchema>>;
  fetchInbox: (
    input: FetchInboxInput,
    options?: AgentMailToolCallOptions,
  ) => Promise<z.infer<typeof FetchInboxOutputSchema>>;
  requestFileReservation: (
    input: RequestFileReservationInput,
    options?: AgentMailToolCallOptions,
  ) => Promise<z.infer<typeof RequestFileReservationOutputSchema>>;
  reservationCycle: (
    input: ReservationCycleInput,
    options?: AgentMailToolCallOptions,
  ) => Promise<ReservationCycleOutput>;
  healthCheck: (
    input?: HealthCheckInput,
    options?: AgentMailToolCallOptions,
  ) => Promise<HealthCheckOutput>;
  startSession: (
    input: StartSessionInput,
    options?: AgentMailToolCallOptions,
  ) => Promise<StartSessionOutput>;
  markMessageRead: (
    input: MarkReadInput,
    options?: AgentMailToolCallOptions,
  ) => Promise<MarkReadOutput>;
  acknowledgeMessage: (
    input: AcknowledgeInput,
    options?: AgentMailToolCallOptions,
  ) => Promise<AcknowledgeOutput>;
  searchMessages: (
    input: SearchMessagesInput,
    options?: AgentMailToolCallOptions,
  ) => Promise<SearchMessagesOutput>;
  summarizeThread: (
    input: SummarizeThreadInput,
    options?: AgentMailToolCallOptions,
  ) => Promise<SummarizeThreadOutput>;
  releaseFileReservations: (
    input: ReleaseReservationsInput,
    options?: AgentMailToolCallOptions,
  ) => Promise<ReleaseReservationsOutput>;
  renewFileReservations: (
    input: RenewReservationsInput,
    options?: AgentMailToolCallOptions,
  ) => Promise<RenewReservationsOutput>;
  whois: (
    input: WhoisInput,
    options?: AgentMailToolCallOptions,
  ) => Promise<WhoisOutput>;
}

export type EnsureProjectInput = z.infer<typeof EnsureProjectInputSchema>;
export type RegisterAgentInput = z.infer<typeof RegisterAgentInputSchema>;
export type SendMessageInput = z.infer<typeof SendMessageInputSchema>;
export type ReplyInput = z.infer<typeof ReplyInputSchema>;
export type FetchInboxInput = Omit<
  z.infer<typeof FetchInboxInputSchema>,
  "since"
> & { since?: string | Date };
export type RequestFileReservationInput = z.infer<
  typeof RequestFileReservationInputSchema
>;
export type AgentMailMessage = z.infer<typeof MessageSchema>;
export type ReservationCycleInput = RequestFileReservationInput;
export type ReservationCycleOutput = z.infer<
  typeof RequestFileReservationOutputSchema
>;
export type HealthCheckInput = z.infer<typeof HealthInputSchema>;
export type HealthCheckOutput = z.infer<typeof HealthOutputSchema>;
export type StartSessionInput = {
  projectId: string;
  name: string;
  projectMetadata?: Record<string, unknown>;
  agentId: string;
  capabilities?: string[];
  agentMetadata?: Record<string, unknown>;
};
export type StartSessionOutput = {
  project: z.infer<typeof EnsureProjectOutputSchema>;
  registration: z.infer<typeof RegisterAgentOutputSchema>;
};
export type MarkReadInput = z.infer<typeof MarkReadInputSchema>;
export type MarkReadOutput = z.infer<typeof MarkReadOutputSchema>;
export type AcknowledgeInput = z.infer<typeof AcknowledgeInputSchema>;
export type AcknowledgeOutput = z.infer<typeof AcknowledgeOutputSchema>;
export type SearchMessagesInput = z.infer<typeof SearchMessagesInputSchema>;
export type SearchMessagesOutput = z.infer<typeof SearchMessagesOutputSchema>;
export type SummarizeThreadInput = z.infer<typeof SummarizeThreadInputSchema>;
export type SummarizeThreadOutput = z.infer<typeof SummarizeThreadOutputSchema>;
export type ReleaseReservationsInput = z.infer<typeof ReleaseReservationsInputSchema>;
export type ReleaseReservationsOutput = z.infer<typeof ReleaseReservationsOutputSchema>;
export type RenewReservationsInput = z.infer<typeof RenewReservationsInputSchema>;
export type RenewReservationsOutput = z.infer<typeof RenewReservationsOutputSchema>;
export type WhoisInput = z.infer<typeof WhoisInputSchema>;
export type WhoisOutput = z.infer<typeof WhoisOutputSchema>;

function zodIssuesToFields(issues: z.ZodIssue[]): ValidationFieldError[] {
  return issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
    code: issue.code,
  }));
}

export function mapAgentMailError(error: unknown) {
  if (error instanceof AgentMailClientError) {
    const details = error.details?.tool
      ? { tool: error.details.tool }
      : undefined;
    if (error.kind === "input_validation") {
      const fields = error.details?.issues
        ? zodIssuesToFields(error.details.issues)
        : [];
      return createValidationError("INVALID_REQUEST", fields, {
        ...(details && { details }),
      });
    }

    if (error.kind === "transport") {
      return createGatewayError(
        "SYSTEM_UNAVAILABLE",
        "Agent Mail tool call failed",
        {
          ...(details && { details }),
          cause: error.details?.cause ?? error,
        },
      );
    }

    return createGatewayError(
      "SYSTEM_INTERNAL_ERROR",
      "Agent Mail response validation failed",
      {
        ...(details && { details }),
        cause: error,
      },
    );
  }

  return toGatewayError(error, "SYSTEM_INTERNAL_ERROR");
}

function toolName(prefix: string, suffix: string): string {
  return `${prefix}${suffix}`;
}

async function callToolWithSchema<TInput, TOutput>(
  callTool: AgentMailToolCaller,
  tool: string,
  input: TInput,
  inputSchema: z.ZodType<TInput>,
  outputSchema: z.ZodType<TOutput>,
  options?: AgentMailToolCallOptions,
): Promise<TOutput> {
  const parsedInputResult = inputSchema.safeParse(input);
  if (!parsedInputResult.success) {
    throw new AgentMailClientError(
      "input_validation",
      `Invalid input for ${tool}`,
      { tool, issues: parsedInputResult.error.issues },
    );
  }

  let rawResult: unknown;
  try {
    rawResult = await callTool(tool, parsedInputResult.data, options);
  } catch (error) {
    throw new AgentMailClientError("transport", `Tool call failed: ${tool}`, {
      tool,
      cause: error,
    });
  }

  const parsedOutputResult = outputSchema.safeParse(rawResult);
  if (!parsedOutputResult.success) {
    throw new AgentMailClientError(
      "response_validation",
      `Invalid response from ${tool}`,
      { tool, issues: parsedOutputResult.error.issues },
    );
  }

  return parsedOutputResult.data;
}

export function createAgentMailClient(
  options: AgentMailClientOptions,
): AgentMailClient {
  const prefix = options.toolPrefix ?? "agentmail_";
  const defaultTtl = options.defaultTtlSeconds ?? 3600;

  return {
    ensureProject: (input, callOptions) =>
      callToolWithSchema(
        options.callTool,
        toolName(prefix, "ensure_project"),
        input,
        EnsureProjectInputSchema,
        EnsureProjectOutputSchema,
        callOptions,
      ),
    registerAgent: (input, callOptions) =>
      callToolWithSchema(
        options.callTool,
        toolName(prefix, "register_agent"),
        input,
        RegisterAgentInputSchema,
        RegisterAgentOutputSchema,
        callOptions,
      ),
    sendMessage: (input, callOptions) => {
      const payload = {
        ...input,
        priority: input.priority ?? "normal",
        ttl: input.ttl ?? defaultTtl,
      };
      return callToolWithSchema(
        options.callTool,
        toolName(prefix, "send_message"),
        payload,
        SendMessageInputSchema,
        SendMessageOutputSchema,
        callOptions,
      );
    },
    reply: (input, callOptions) =>
      callToolWithSchema(
        options.callTool,
        toolName(prefix, "reply"),
        input,
        ReplyInputSchema,
        ReplyOutputSchema,
        callOptions,
      ),
    fetchInbox: (input, callOptions) =>
      callToolWithSchema(
        options.callTool,
        toolName(prefix, "fetch_inbox"),
        input,
        FetchInboxInputSchema as z.ZodType<FetchInboxInput>,
        FetchInboxOutputSchema,
        callOptions,
      ),
    requestFileReservation: (input, callOptions) => {
      const payload = {
        ...input,
        duration: input.duration ?? defaultTtl,
      };
      return callToolWithSchema(
        options.callTool,
        toolName(prefix, "request_file_reservation"),
        payload,
        RequestFileReservationInputSchema,
        RequestFileReservationOutputSchema,
        callOptions,
      );
    },
    reservationCycle: (input, callOptions) => {
      const payload = {
        ...input,
        duration: input.duration ?? defaultTtl,
      };
      return callToolWithSchema(
        options.callTool,
        toolName(prefix, "request_file_reservation"),
        payload,
        RequestFileReservationInputSchema,
        RequestFileReservationOutputSchema,
        callOptions,
      );
    },
    healthCheck: (input, callOptions) =>
      callToolWithSchema(
        options.callTool,
        toolName(prefix, "health"),
        input ?? {},
        HealthInputSchema,
        HealthOutputSchema,
        callOptions,
      ),
    startSession: async (input, callOptions) => {
      const project = await callToolWithSchema(
        options.callTool,
        toolName(prefix, "ensure_project"),
        {
          projectId: input.projectId,
          name: input.name,
          metadata: input.projectMetadata,
        },
        EnsureProjectInputSchema,
        EnsureProjectOutputSchema,
        callOptions,
      );

      const registration = await callToolWithSchema(
        options.callTool,
        toolName(prefix, "register_agent"),
        {
          projectId: input.projectId,
          agentId: input.agentId,
          capabilities: input.capabilities ?? [],
          metadata: input.agentMetadata,
        },
        RegisterAgentInputSchema,
        RegisterAgentOutputSchema,
        callOptions,
      );

      return { project, registration };
    },
    markMessageRead: (input, callOptions) =>
      callToolWithSchema(
        options.callTool,
        toolName(prefix, "mark_message_read"),
        input,
        MarkReadInputSchema,
        MarkReadOutputSchema,
        callOptions,
      ),
    acknowledgeMessage: (input, callOptions) =>
      callToolWithSchema(
        options.callTool,
        toolName(prefix, "acknowledge_message"),
        input,
        AcknowledgeInputSchema,
        AcknowledgeOutputSchema,
        callOptions,
      ),
    searchMessages: (input, callOptions) =>
      callToolWithSchema(
        options.callTool,
        toolName(prefix, "search_messages"),
        input,
        SearchMessagesInputSchema,
        SearchMessagesOutputSchema,
        callOptions,
      ),
    summarizeThread: (input, callOptions) =>
      callToolWithSchema(
        options.callTool,
        toolName(prefix, "summarize_thread"),
        input,
        SummarizeThreadInputSchema,
        SummarizeThreadOutputSchema,
        callOptions,
      ),
    releaseFileReservations: (input, callOptions) =>
      callToolWithSchema(
        options.callTool,
        toolName(prefix, "release_file_reservations"),
        input,
        ReleaseReservationsInputSchema,
        ReleaseReservationsOutputSchema,
        callOptions,
      ),
    renewFileReservations: (input, callOptions) =>
      callToolWithSchema(
        options.callTool,
        toolName(prefix, "renew_file_reservations"),
        input,
        RenewReservationsInputSchema,
        RenewReservationsOutputSchema,
        callOptions,
      ),
    whois: (input, callOptions) =>
      callToolWithSchema(
        options.callTool,
        toolName(prefix, "whois"),
        input,
        WhoisInputSchema,
        WhoisOutputSchema,
        callOptions,
      ),
  };
}

export const AgentMailSchemas = {
  PrioritySchema,
  MessageSchema,
  EnsureProjectInputSchema,
  EnsureProjectOutputSchema,
  RegisterAgentInputSchema,
  RegisterAgentOutputSchema,
  SendMessageInputSchema,
  SendMessageOutputSchema,
  ReplyInputSchema,
  ReplyOutputSchema,
  HealthInputSchema,
  HealthOutputSchema,
  FetchInboxInputSchema,
  FetchInboxOutputSchema,
  RequestFileReservationInputSchema,
  RequestFileReservationOutputSchema,
  MarkReadInputSchema,
  MarkReadOutputSchema,
  AcknowledgeInputSchema,
  AcknowledgeOutputSchema,
  SearchMessagesInputSchema,
  SearchMessagesOutputSchema,
  SummarizeThreadInputSchema,
  SummarizeThreadOutputSchema,
  ReleaseReservationsInputSchema,
  ReleaseReservationsOutputSchema,
  RenewReservationsInputSchema,
  RenewReservationsOutputSchema,
  WhoisInputSchema,
  WhoisOutputSchema,
};
