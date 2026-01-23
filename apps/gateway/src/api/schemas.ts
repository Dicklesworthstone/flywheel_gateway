/**
 * OpenAPI Schema Registry
 *
 * Centralizes Zod schemas with OpenAPI metadata for automatic
 * OpenAPI specification generation.
 */

import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
} from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

// Extend Zod with OpenAPI methods
extendZodWithOpenApi(z);

// Create the global registry
export const registry = new OpenAPIRegistry();

// ============================================================================
// Common Types
// ============================================================================

export const TimestampSchema = z.string().datetime().openapi({
  description: "ISO 8601 timestamp",
  example: "2024-01-15T10:30:00.000Z",
});

export const RequestIdSchema = z.string().openapi({
  description: "Unique request identifier for debugging",
  example: "req_abc123xyz",
});

// ============================================================================
// Response Envelope Schemas
// ============================================================================

export const ApiErrorSchema = z
  .object({
    code: z.string().openapi({
      description: "Error code from the error taxonomy",
      example: "AGENT_NOT_FOUND",
    }),
    message: z.string().openapi({
      description: "Human-readable error message",
      example: "Agent agent_123 not found",
    }),
    severity: z.enum(["terminal", "recoverable", "retry"]).optional().openapi({
      description: "Error severity for AI agents",
    }),
    hint: z.string().optional().openapi({
      description: "Suggested action to resolve the error",
    }),
    alternative: z.string().optional().openapi({
      description: "Alternative approach if current request cannot succeed",
    }),
    example: z.unknown().optional().openapi({
      description: "Example of valid input that would succeed",
    }),
    param: z.string().optional().openapi({
      description: "Specific field that caused the error",
    }),
    details: z.record(z.string(), z.unknown()).optional().openapi({
      description: "Additional error details",
    }),
  })
  .openapi("ApiError");

registry.register("ApiError", ApiErrorSchema);

export const ApiErrorResponseSchema = z
  .object({
    object: z.literal("error").openapi({
      description: "Always 'error' for error responses",
    }),
    error: ApiErrorSchema,
    requestId: RequestIdSchema,
    timestamp: TimestampSchema,
  })
  .openapi("ApiErrorResponse");

registry.register("ApiErrorResponse", ApiErrorResponseSchema);

// ============================================================================
// Agent Schemas
// ============================================================================

export const AgentStateSchema = z
  .enum(["spawning", "ready", "busy", "terminated", "error"])
  .openapi({
    description: "Current state of the agent",
  });

registry.register("AgentState", AgentStateSchema);

export const SpawnAgentRequestSchema = z
  .object({
    workingDirectory: z.string().min(1).openapi({
      description: "Absolute path to the agent working directory",
      example: "/home/user/project",
    }),
    agentId: z.string().min(1).optional().openapi({
      description: "Custom agent ID (auto-generated if not provided)",
    }),
    systemPrompt: z.string().min(1).optional().openapi({
      description: "System prompt for the agent",
    }),
    timeout: z.number().min(1000).max(86400000).optional().openapi({
      description: "Timeout in milliseconds",
      default: 300000,
    }),
    maxTokens: z.number().min(1000).max(1000000).optional().openapi({
      description: "Maximum tokens for agent responses",
    }),
  })
  .openapi("SpawnAgentRequest");

registry.register("SpawnAgentRequest", SpawnAgentRequestSchema);

export const SendMessageRequestSchema = z
  .object({
    type: z.enum(["user", "system"]).openapi({
      description: "Message type",
    }),
    content: z.string().min(1).openapi({
      description: "Message content to send to the agent",
    }),
    stream: z.boolean().optional().openapi({
      description: "Whether to stream the response",
      default: false,
    }),
  })
  .openapi("SendMessageRequest");

registry.register("SendMessageRequest", SendMessageRequestSchema);

export const InterruptAgentRequestSchema = z
  .object({
    signal: z.enum(["SIGINT", "SIGTSTP", "SIGCONT"]).default("SIGINT").openapi({
      description: "Unix signal to send",
    }),
  })
  .openapi("InterruptAgentRequest");

registry.register("InterruptAgentRequest", InterruptAgentRequestSchema);

export const AgentSchema = z
  .object({
    agentId: z.string().openapi({
      description: "Unique agent identifier",
      example: "agent_abc123",
    }),
    state: AgentStateSchema,
    driver: z.string().openapi({
      description: "Agent driver type",
      example: "sdk",
    }),
    workingDirectory: z.string().openapi({
      description: "Agent working directory path",
    }),
    pid: z.number().optional().openapi({
      description: "Process ID of the agent",
    }),
    createdAt: TimestampSchema,
    lastActivityAt: TimestampSchema.optional(),
  })
  .openapi("Agent");

registry.register("Agent", AgentSchema);

// ============================================================================
// Checkpoint Schemas
// ============================================================================

export const CreateCheckpointRequestSchema = z
  .object({
    name: z.string().min(1).max(100).optional().openapi({
      description: "Human-readable name for the checkpoint",
      example: "before-refactoring",
    }),
    description: z.string().max(500).optional().openapi({
      description: "Description of what the checkpoint captures",
    }),
  })
  .openapi("CreateCheckpointRequest");

registry.register("CreateCheckpointRequest", CreateCheckpointRequestSchema);

export const RestoreCheckpointRequestSchema = z
  .object({
    checkpointId: z.string().openapi({
      description: "ID of the checkpoint to restore",
    }),
    resumeSession: z.boolean().optional().openapi({
      description: "Whether to resume the agent session after restore",
      default: false,
    }),
  })
  .openapi("RestoreCheckpointRequest");

registry.register("RestoreCheckpointRequest", RestoreCheckpointRequestSchema);

export const CheckpointSchema = z
  .object({
    id: z.string().openapi({
      description: "Unique checkpoint identifier",
    }),
    agentId: z.string().openapi({
      description: "ID of the agent this checkpoint belongs to",
    }),
    name: z.string().optional().openapi({
      description: "Human-readable checkpoint name",
    }),
    description: z.string().optional().openapi({
      description: "Checkpoint description",
    }),
    createdAt: TimestampSchema,
    sizeBytes: z.number().optional().openapi({
      description: "Size of the checkpoint in bytes",
    }),
  })
  .openapi("Checkpoint");

registry.register("Checkpoint", CheckpointSchema);

// ============================================================================
// Reservation Schemas
// ============================================================================

export const CreateReservationRequestSchema = z
  .object({
    files: z
      .array(z.string())
      .min(1)
      .openapi({
        description: "List of file paths to reserve",
        example: ["/src/index.ts", "/src/utils.ts"],
      }),
    ttlSeconds: z.number().min(60).max(86400).optional().openapi({
      description: "Time-to-live in seconds",
      default: 3600,
    }),
    reason: z.string().max(500).optional().openapi({
      description: "Reason for the reservation",
    }),
  })
  .openapi("CreateReservationRequest");

registry.register("CreateReservationRequest", CreateReservationRequestSchema);

export const ReservationSchema = z
  .object({
    id: z.string().openapi({
      description: "Unique reservation identifier",
    }),
    agentId: z.string().openapi({
      description: "ID of the agent holding the reservation",
    }),
    files: z.array(z.string()).openapi({
      description: "Reserved file paths",
    }),
    reason: z.string().optional().openapi({
      description: "Reason for the reservation",
    }),
    expiresAt: TimestampSchema,
    createdAt: TimestampSchema,
  })
  .openapi("Reservation");

registry.register("Reservation", ReservationSchema);

// ============================================================================
// Conflict Schemas
// ============================================================================

export const ConflictStatusSchema = z
  .enum(["pending", "resolved", "escalated", "auto_resolved"])
  .openapi({
    description: "Current status of the conflict",
  });

registry.register("ConflictStatus", ConflictStatusSchema);

export const ConflictSchema = z
  .object({
    id: z.string().openapi({
      description: "Unique conflict identifier",
    }),
    type: z.string().openapi({
      description: "Type of conflict",
      example: "file_edit",
    }),
    status: ConflictStatusSchema,
    agents: z.array(z.string()).openapi({
      description: "IDs of agents involved in the conflict",
    }),
    files: z.array(z.string()).optional().openapi({
      description: "Files involved in the conflict",
    }),
    detectedAt: TimestampSchema,
    resolvedAt: TimestampSchema.optional(),
    resolution: z.string().optional().openapi({
      description: "How the conflict was resolved",
    }),
  })
  .openapi("Conflict");

registry.register("Conflict", ConflictSchema);

// ============================================================================
// Notification Schemas
// ============================================================================

export const NotificationCategorySchema = z
  .enum(["agents", "coordination", "tasks", "costs", "security", "system"])
  .openapi({
    description: "Notification category",
  });

registry.register("NotificationCategory", NotificationCategorySchema);

export const NotificationPrioritySchema = z
  .enum(["urgent", "high", "normal", "low"])
  .openapi({
    description: "Notification priority level",
  });

registry.register("NotificationPriority", NotificationPrioritySchema);

export const CreateNotificationRequestSchema = z
  .object({
    recipientId: z.string().openapi({
      description: "User ID of the notification recipient",
    }),
    category: NotificationCategorySchema,
    priority: NotificationPrioritySchema.default("normal"),
    title: z.string().min(1).max(200).openapi({
      description: "Notification title",
    }),
    body: z.string().min(1).max(2000).openapi({
      description: "Notification body text",
    }),
    link: z.string().url().optional().openapi({
      description: "Optional link for more details",
    }),
    channels: z
      .array(z.enum(["in_app", "email", "slack", "webhook"]))
      .optional()
      .openapi({
        description: "Delivery channels to use",
        default: ["in_app"],
      }),
  })
  .openapi("CreateNotificationRequest");

registry.register("CreateNotificationRequest", CreateNotificationRequestSchema);

export const NotificationSchema = z
  .object({
    id: z.string().openapi({
      description: "Unique notification identifier",
    }),
    recipientId: z.string(),
    category: NotificationCategorySchema,
    priority: NotificationPrioritySchema,
    title: z.string(),
    body: z.string(),
    link: z.string().optional(),
    status: z.enum(["unread", "read", "actioned", "dismissed"]).openapi({
      description: "Notification status",
    }),
    createdAt: TimestampSchema,
    readAt: TimestampSchema.optional(),
  })
  .openapi("Notification");

registry.register("Notification", NotificationSchema);

// ============================================================================
// Pipeline Schemas
// ============================================================================

export const PipelineStepTypeSchema = z
  .enum([
    "agent_task",
    "conditional",
    "parallel",
    "approval",
    "script",
    "loop",
    "wait",
  ])
  .openapi({
    description: "Type of pipeline step",
  });

registry.register("PipelineStepType", PipelineStepTypeSchema);

export const PipelineStepSchema = z
  .object({
    id: z.string().openapi({
      description: "Unique step identifier",
    }),
    name: z.string().openapi({
      description: "Human-readable step name",
    }),
    type: PipelineStepTypeSchema,
    config: z.record(z.string(), z.unknown()).openapi({
      description: "Step-specific configuration",
    }),
    dependsOn: z.array(z.string()).optional().openapi({
      description: "IDs of steps this step depends on",
    }),
  })
  .openapi("PipelineStep");

registry.register("PipelineStep", PipelineStepSchema);

export const CreatePipelineRequestSchema = z
  .object({
    name: z.string().min(1).max(100).openapi({
      description: "Pipeline name",
    }),
    description: z.string().max(500).optional().openapi({
      description: "Pipeline description",
    }),
    steps: z.array(PipelineStepSchema).min(1).openapi({
      description: "Pipeline steps",
    }),
  })
  .openapi("CreatePipelineRequest");

registry.register("CreatePipelineRequest", CreatePipelineRequestSchema);

export const PipelineSchema = z
  .object({
    id: z.string().openapi({
      description: "Unique pipeline identifier",
    }),
    name: z.string(),
    description: z.string().optional(),
    steps: z.array(PipelineStepSchema),
    status: z.enum(["draft", "active", "paused", "archived"]).openapi({
      description: "Pipeline status",
    }),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .openapi("Pipeline");

registry.register("Pipeline", PipelineSchema);

// ============================================================================
// Pagination Schemas
// ============================================================================

export const PaginationQuerySchema = z
  .object({
    limit: z.coerce.number().min(1).max(100).optional().openapi({
      description: "Maximum number of items to return",
      default: 20,
    }),
    cursor: z.string().optional().openapi({
      description: "Pagination cursor for next page",
    }),
  })
  .openapi("PaginationQuery");

registry.register("PaginationQuery", PaginationQuerySchema);

// ============================================================================
// Health Check Schema
// ============================================================================

export const HealthCheckResponseSchema = z
  .object({
    status: z.enum(["healthy", "degraded", "unhealthy"]).openapi({
      description: "Overall health status",
    }),
    version: z.string().openapi({
      description: "API version",
      example: "1.0.0",
    }),
    uptime: z.number().openapi({
      description: "Server uptime in seconds",
    }),
    timestamp: TimestampSchema,
  })
  .openapi("HealthCheckResponse");

registry.register("HealthCheckResponse", HealthCheckResponseSchema);

// ============================================================================
// Export utility for creating response schemas
// ============================================================================

/**
 * Create a typed API response schema for a resource.
 */
export function createApiResponseSchema<T extends z.ZodTypeAny>(
  name: string,
  dataSchema: T,
  objectType: string,
) {
  const schema = z
    .object({
      object: z.literal(objectType).openapi({
        description: `Always '${objectType}' for this response type`,
      }),
      data: dataSchema,
      requestId: RequestIdSchema,
      timestamp: TimestampSchema,
      links: z.record(z.string(), z.string()).optional().openapi({
        description: "HATEOAS links for resource navigation",
      }),
    })
    .openapi(name);

  registry.register(name, schema);
  return schema;
}

/**
 * Create a typed API list response schema.
 */
export function createApiListResponseSchema<T extends z.ZodTypeAny>(
  name: string,
  itemSchema: T,
) {
  const schema = z
    .object({
      object: z.literal("list").openapi({
        description: "Always 'list' for collection responses",
      }),
      data: z.array(itemSchema),
      hasMore: z.boolean().openapi({
        description: "Whether more items exist beyond this page",
      }),
      nextCursor: z.string().optional().openapi({
        description: "Pagination cursor for next page",
      }),
      total: z.number().optional().openapi({
        description: "Total count across all pages",
      }),
      url: z.string().openapi({
        description: "URL for this list endpoint",
      }),
      requestId: RequestIdSchema,
      timestamp: TimestampSchema,
    })
    .openapi(name);

  registry.register(name, schema);
  return schema;
}

// Register response wrappers for common types
export const AgentResponseSchema = createApiResponseSchema(
  "AgentResponse",
  AgentSchema,
  "agent",
);

export const AgentListResponseSchema = createApiListResponseSchema(
  "AgentListResponse",
  AgentSchema,
);

export const CheckpointResponseSchema = createApiResponseSchema(
  "CheckpointResponse",
  CheckpointSchema,
  "checkpoint",
);

export const CheckpointListResponseSchema = createApiListResponseSchema(
  "CheckpointListResponse",
  CheckpointSchema,
);

export const ReservationResponseSchema = createApiResponseSchema(
  "ReservationResponse",
  ReservationSchema,
  "reservation",
);

export const ConflictListResponseSchema = createApiListResponseSchema(
  "ConflictListResponse",
  ConflictSchema,
);

export const NotificationListResponseSchema = createApiListResponseSchema(
  "NotificationListResponse",
  NotificationSchema,
);

export const PipelineResponseSchema = createApiResponseSchema(
  "PipelineResponse",
  PipelineSchema,
  "pipeline",
);

// ============================================================================
// Dashboard Schemas
// ============================================================================

export const DashboardLayoutSchema = z
  .object({
    columns: z.number().int().min(1).max(24).optional().openapi({
      description: "Number of columns in the grid",
      default: 12,
    }),
    rowHeight: z.number().int().min(20).max(200).optional().openapi({
      description: "Height of each grid row in pixels",
      default: 80,
    }),
    margin: z
      .tuple([z.number().int().min(0), z.number().int().min(0)])
      .optional()
      .openapi({
        description: "Grid margin [x, y] in pixels",
      }),
    containerPadding: z
      .tuple([z.number().int().min(0), z.number().int().min(0)])
      .optional()
      .openapi({
        description: "Container padding [x, y] in pixels",
      }),
  })
  .openapi("DashboardLayout");

registry.register("DashboardLayout", DashboardLayoutSchema);

export const WidgetPositionSchema = z
  .object({
    x: z.number().int().min(0).openapi({ description: "X position in grid" }),
    y: z.number().int().min(0).openapi({ description: "Y position in grid" }),
    w: z.number().int().min(1).openapi({ description: "Width in grid units" }),
    h: z.number().int().min(1).openapi({ description: "Height in grid units" }),
    minW: z
      .number()
      .int()
      .min(1)
      .optional()
      .openapi({ description: "Minimum width" }),
    minH: z
      .number()
      .int()
      .min(1)
      .optional()
      .openapi({ description: "Minimum height" }),
    maxW: z
      .number()
      .int()
      .min(1)
      .optional()
      .openapi({ description: "Maximum width" }),
    maxH: z
      .number()
      .int()
      .min(1)
      .optional()
      .openapi({ description: "Maximum height" }),
  })
  .openapi("WidgetPosition");

registry.register("WidgetPosition", WidgetPositionSchema);

export const WidgetTypeSchema = z
  .enum([
    "metric-card",
    "line-chart",
    "bar-chart",
    "pie-chart",
    "table",
    "agent-list",
    "activity-feed",
    "cost-breakdown",
    "heatmap",
    "gauge",
    "text",
    "iframe",
  ])
  .openapi({
    description: "Type of dashboard widget",
  });

registry.register("WidgetType", WidgetTypeSchema);

export const DataSourceConfigSchema = z
  .object({
    type: z.enum(["api", "query", "static"]).openapi({
      description: "Data source type",
    }),
    endpoint: z.string().optional().openapi({
      description: "API endpoint to fetch data from",
      example: "/api/analytics/summary",
    }),
    query: z.string().optional().openapi({
      description: "Query string for query-based data sources",
    }),
    filters: z.record(z.string(), z.unknown()).optional().openapi({
      description: "Filters to apply to data",
    }),
    timeRange: z
      .object({
        preset: z.enum(["15m", "1h", "6h", "24h", "7d", "30d", "custom"]),
        start: z.string().optional(),
        end: z.string().optional(),
      })
      .optional()
      .openapi({
        description: "Time range for data",
      }),
  })
  .openapi("DataSourceConfig");

registry.register("DataSourceConfig", DataSourceConfigSchema);

export const DisplayConfigSchema = z
  .object({
    colorScheme: z.string().optional().openapi({
      description: "Color scheme name",
    }),
    showLegend: z.boolean().optional().openapi({
      description: "Whether to show legend",
    }),
    showGrid: z.boolean().optional().openapi({
      description: "Whether to show grid lines",
    }),
    showLabels: z.boolean().optional().openapi({
      description: "Whether to show data labels",
    }),
    labelPosition: z
      .enum(["top", "bottom", "left", "right"])
      .optional()
      .openapi({
        description: "Position of labels",
      }),
    animationEnabled: z.boolean().optional().openapi({
      description: "Whether animations are enabled",
    }),
  })
  .openapi("DisplayConfig");

registry.register("DisplayConfig", DisplayConfigSchema);

export const ThresholdConfigSchema = z
  .object({
    warning: z.number().optional().openapi({
      description: "Warning threshold value",
    }),
    critical: z.number().optional().openapi({
      description: "Critical threshold value",
    }),
    warningColor: z.string().optional().openapi({
      description: "Color for warning state",
    }),
    criticalColor: z.string().optional().openapi({
      description: "Color for critical state",
    }),
  })
  .openapi("ThresholdConfig");

registry.register("ThresholdConfig", ThresholdConfigSchema);

export const WidgetConfigSchema = z
  .object({
    dataSource: DataSourceConfigSchema,
    display: DisplayConfigSchema.optional(),
    thresholds: ThresholdConfigSchema.optional(),
    customOptions: z.record(z.string(), z.unknown()).optional().openapi({
      description: "Widget-specific custom options",
    }),
  })
  .openapi("WidgetConfig");

registry.register("WidgetConfig", WidgetConfigSchema);

export const WidgetSchema = z
  .object({
    id: z.string().openapi({
      description: "Unique widget identifier",
    }),
    type: WidgetTypeSchema,
    title: z.string().min(1).max(100).openapi({
      description: "Widget title",
    }),
    description: z.string().max(500).optional().openapi({
      description: "Widget description",
    }),
    position: WidgetPositionSchema,
    config: WidgetConfigSchema,
    refreshInterval: z.number().int().min(0).optional().openapi({
      description: "Auto-refresh interval in seconds (0 = manual)",
    }),
  })
  .openapi("Widget");

registry.register("Widget", WidgetSchema);

export const CreateWidgetRequestSchema = WidgetSchema.omit({ id: true })
  .extend({
    id: z.string().optional().openapi({
      description: "Optional widget ID (auto-generated if not provided)",
    }),
  })
  .openapi("CreateWidgetRequest");

registry.register("CreateWidgetRequest", CreateWidgetRequestSchema);

export const DashboardVisibilitySchema = z
  .enum(["private", "team", "public"])
  .openapi({
    description: "Dashboard visibility level",
  });

registry.register("DashboardVisibility", DashboardVisibilitySchema);

export const DashboardSharingSchema = z
  .object({
    visibility: DashboardVisibilitySchema.optional(),
    teamId: z.string().optional().openapi({
      description: "Team ID for team-visible dashboards",
    }),
    viewers: z.array(z.string()).optional().openapi({
      description: "User IDs with view access",
    }),
    editors: z.array(z.string()).optional().openapi({
      description: "User IDs with edit access",
    }),
    publicSlug: z.string().optional().openapi({
      description: "URL slug for public dashboards",
    }),
    requireAuth: z.boolean().optional().openapi({
      description: "Require authentication for public dashboards",
    }),
    embedEnabled: z.boolean().optional().openapi({
      description: "Allow embedding in iframes",
    }),
  })
  .openapi("DashboardSharing");

registry.register("DashboardSharing", DashboardSharingSchema);

export const CreateDashboardRequestSchema = z
  .object({
    name: z.string().min(1).max(100).openapi({
      description: "Dashboard name",
      example: "My Dashboard",
    }),
    description: z.string().max(500).optional().openapi({
      description: "Dashboard description",
    }),
    workspaceId: z.string().optional().openapi({
      description: "Workspace ID",
    }),
    layout: DashboardLayoutSchema.optional(),
    widgets: z.array(CreateWidgetRequestSchema).optional().openapi({
      description: "Initial widgets",
    }),
    sharing: DashboardSharingSchema.optional(),
    refreshInterval: z.number().int().min(0).optional().openapi({
      description: "Global auto-refresh interval in seconds",
    }),
  })
  .openapi("CreateDashboardRequest");

registry.register("CreateDashboardRequest", CreateDashboardRequestSchema);

export const UpdateDashboardRequestSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).optional(),
    layout: DashboardLayoutSchema.optional(),
    widgets: z.array(WidgetSchema).optional(),
    sharing: DashboardSharingSchema.optional(),
    refreshInterval: z.number().int().min(0).optional(),
  })
  .openapi("UpdateDashboardRequest");

registry.register("UpdateDashboardRequest", UpdateDashboardRequestSchema);

export const DashboardSchema = z
  .object({
    id: z.string().openapi({
      description: "Unique dashboard identifier",
    }),
    name: z.string().openapi({
      description: "Dashboard name",
    }),
    description: z.string().optional().openapi({
      description: "Dashboard description",
    }),
    ownerId: z.string().openapi({
      description: "User ID of the dashboard owner",
    }),
    workspaceId: z.string().optional().openapi({
      description: "Workspace ID",
    }),
    layout: DashboardLayoutSchema,
    widgets: z.array(WidgetSchema),
    sharing: DashboardSharingSchema,
    refreshInterval: z.number().optional(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .openapi("Dashboard");

registry.register("Dashboard", DashboardSchema);

export const DashboardSummarySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    ownerId: z.string(),
    visibility: DashboardVisibilitySchema,
    widgetCount: z.number().int(),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    isFavorite: z.boolean().optional(),
  })
  .openapi("DashboardSummary");

registry.register("DashboardSummary", DashboardSummarySchema);

export const DashboardPermissionTypeSchema = z.enum(["view", "edit"]).openapi({
  description: "Permission level",
});

registry.register("DashboardPermissionType", DashboardPermissionTypeSchema);

export const DashboardPermissionEntrySchema = z
  .object({
    userId: z.string(),
    permission: DashboardPermissionTypeSchema,
    grantedBy: z.string(),
    grantedAt: TimestampSchema,
  })
  .openapi("DashboardPermissionEntry");

registry.register("DashboardPermissionEntry", DashboardPermissionEntrySchema);

export const GrantPermissionRequestSchema = z
  .object({
    targetUserId: z.string().openapi({
      description: "User ID to grant permission to",
    }),
    permission: DashboardPermissionTypeSchema,
  })
  .openapi("GrantPermissionRequest");

registry.register("GrantPermissionRequest", GrantPermissionRequestSchema);

export const WidgetDataSchema = z
  .object({
    widgetId: z.string(),
    data: z.unknown(),
    fetchedAt: TimestampSchema,
    error: z.string().optional(),
  })
  .openapi("WidgetData");

registry.register("WidgetData", WidgetDataSchema);

export const DashboardStatsSchema = z
  .object({
    totalDashboards: z.number().int(),
    publicDashboards: z.number().int(),
    teamDashboards: z.number().int(),
    privateDashboards: z.number().int(),
    totalWidgets: z.number().int(),
    avgWidgetsPerDashboard: z.number(),
  })
  .openapi("DashboardStats");

registry.register("DashboardStats", DashboardStatsSchema);

// Dashboard response wrappers
export const DashboardResponseSchema = createApiResponseSchema(
  "DashboardResponse",
  DashboardSchema,
  "dashboard",
);

export const DashboardListResponseSchema = createApiListResponseSchema(
  "DashboardListResponse",
  DashboardSummarySchema,
);

export const DashboardStatsResponseSchema = createApiResponseSchema(
  "DashboardStatsResponse",
  DashboardStatsSchema,
  "stats",
);

export const WidgetDataResponseSchema = createApiResponseSchema(
  "WidgetDataResponse",
  WidgetDataSchema,
  "widgetData",
);

export const PermissionListResponseSchema = createApiListResponseSchema(
  "PermissionListResponse",
  DashboardPermissionEntrySchema,
);

export const PermissionResponseSchema = createApiResponseSchema(
  "PermissionResponse",
  DashboardPermissionEntrySchema,
  "permission",
);

// ============================================================================
// Cost Analytics Schemas
// ============================================================================

export const ProviderIdSchema = z
  .enum(["anthropic", "openai", "google", "local"])
  .openapi({
    description: "LLM provider identifier",
  });

registry.register("ProviderId", ProviderIdSchema);

export const CostRecordInputSchema = z
  .object({
    organizationId: z.string().optional().openapi({
      description: "Organization ID for cost allocation",
    }),
    projectId: z.string().optional().openapi({
      description: "Project ID for cost allocation",
    }),
    agentId: z.string().optional().openapi({
      description: "Agent that incurred the cost",
    }),
    taskId: z.string().optional().openapi({
      description: "Task that incurred the cost",
    }),
    sessionId: z.string().optional().openapi({
      description: "Session that incurred the cost",
    }),
    model: z.string().openapi({
      description: "Model used for the request",
      example: "claude-3-opus-20240229",
    }),
    provider: ProviderIdSchema,
    promptTokens: z.number().int().min(0).openapi({
      description: "Number of prompt tokens",
    }),
    completionTokens: z.number().int().min(0).openapi({
      description: "Number of completion tokens",
    }),
    cachedTokens: z.number().int().min(0).optional().openapi({
      description: "Number of cached prompt tokens",
    }),
    taskType: z.string().optional().openapi({
      description: "Type of task performed",
    }),
    complexityTier: z
      .enum(["simple", "moderate", "complex"])
      .optional()
      .openapi({
        description: "Complexity tier for tiered pricing",
      }),
    success: z.boolean().openapi({
      description: "Whether the request succeeded",
    }),
    requestDurationMs: z.number().int().min(0).optional().openapi({
      description: "Request duration in milliseconds",
    }),
    correlationId: z.string().optional().openapi({
      description: "Correlation ID for request tracing",
    }),
  })
  .openapi("CostRecordInput");

registry.register("CostRecordInput", CostRecordInputSchema);

export const CostRecordSchema = z
  .object({
    id: z.string().openapi({
      description: "Unique cost record identifier",
    }),
    timestamp: z.string().datetime().openapi({
      description: "When the cost was incurred",
    }),
    model: z.string(),
    provider: ProviderIdSchema,
    promptTokens: z.number().int(),
    completionTokens: z.number().int(),
    totalCostUnits: z.number().int().openapi({
      description: "Total cost in micro-units (1/1,000,000 of a dollar)",
    }),
    formattedCost: z.string().openapi({
      description: "Human-readable cost string",
      example: "$0.0123",
    }),
    success: z.boolean(),
    agentId: z.string().optional(),
    taskType: z.string().optional(),
  })
  .openapi("CostRecord");

registry.register("CostRecord", CostRecordSchema);

export const CostSummarySchema = z
  .object({
    totalCostUnits: z.number().int(),
    formattedTotalCost: z.string(),
    totalRequests: z.number().int(),
    totalPromptTokens: z.number().int(),
    totalCompletionTokens: z.number().int(),
    avgCostPerRequest: z.number().int(),
    formattedAvgCost: z.string(),
    successRate: z.number(),
    period: z.object({
      start: z.string().datetime(),
      end: z.string().datetime(),
    }),
  })
  .openapi("CostSummary");

registry.register("CostSummary", CostSummarySchema);

export const CostBreakdownItemSchema = z
  .object({
    key: z.string().openapi({
      description: "Breakdown dimension key (model name, agent ID, etc.)",
    }),
    totalCostUnits: z.number().int(),
    formattedCost: z.string(),
    requestCount: z.number().int(),
    percentage: z.number(),
  })
  .openapi("CostBreakdownItem");

registry.register("CostBreakdownItem", CostBreakdownItemSchema);

export const CostBreakdownSchema = z
  .object({
    dimension: z.enum(["model", "agent", "project", "provider"]),
    totalCostUnits: z.number().int(),
    formattedTotalCost: z.string(),
    period: z.object({
      start: z.string().datetime(),
      end: z.string().datetime(),
    }),
    items: z.array(CostBreakdownItemSchema),
  })
  .openapi("CostBreakdown");

registry.register("CostBreakdown", CostBreakdownSchema);

export const CostTrendPointSchema = z
  .object({
    date: z.string().datetime().optional(),
    hour: z.string().datetime().optional(),
    costUnits: z.number().int(),
    formattedCost: z.string(),
    requestCount: z.number().int(),
  })
  .openapi("CostTrendPoint");

registry.register("CostTrendPoint", CostTrendPointSchema);

export const BudgetPeriodSchema = z
  .enum(["daily", "weekly", "monthly", "yearly"])
  .openapi({
    description: "Budget period type",
  });

registry.register("BudgetPeriod", BudgetPeriodSchema);

export const BudgetActionSchema = z
  .enum(["alert", "throttle", "block"])
  .openapi({
    description: "Action to take when budget is exceeded",
  });

registry.register("BudgetAction", BudgetActionSchema);

export const CreateBudgetRequestSchema = z
  .object({
    name: z.string().min(1).max(100).openapi({
      description: "Budget name",
      example: "Monthly API Budget",
    }),
    organizationId: z.string().optional(),
    projectId: z.string().optional(),
    period: BudgetPeriodSchema,
    amountUnits: z.number().int().min(1).openapi({
      description: "Budget amount in micro-units",
    }),
    alertThresholds: z.array(z.number().min(0).max(100)).optional().openapi({
      description: "Percentage thresholds for alerts (e.g., [50, 80, 90])",
    }),
    actionOnExceed: BudgetActionSchema.optional(),
    rollover: z.boolean().optional().openapi({
      description: "Whether unused budget rolls over to next period",
    }),
    effectiveDate: z.string().datetime().optional(),
    expiresAt: z.string().datetime().optional(),
    enabled: z.boolean().optional(),
  })
  .openapi("CreateBudgetRequest");

registry.register("CreateBudgetRequest", CreateBudgetRequestSchema);

export const BudgetSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    organizationId: z.string().optional(),
    projectId: z.string().optional(),
    period: BudgetPeriodSchema,
    amountUnits: z.number().int(),
    formattedAmount: z.string(),
    alertThresholds: z.array(z.number()),
    actionOnExceed: BudgetActionSchema,
    rollover: z.boolean(),
    enabled: z.boolean(),
    effectiveDate: z.string().datetime(),
    expiresAt: z.string().datetime().optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi("Budget");

registry.register("Budget", BudgetSchema);

export const BudgetStatusSchema = z
  .object({
    budgetId: z.string(),
    budgetName: z.string(),
    periodStart: z.string().datetime(),
    periodEnd: z.string().datetime(),
    usedUnits: z.number().int(),
    usedPercent: z.number(),
    remainingUnits: z.number().int(),
    formattedUsed: z.string(),
    formattedRemaining: z.string(),
    burnRateUnitsPerDay: z.number(),
    projectedEndOfPeriodUnits: z.number().int(),
    projectedExceed: z.boolean(),
    daysUntilExhausted: z.number().optional(),
    status: z.enum(["ok", "warning", "critical", "exceeded"]),
    currentThreshold: z.number().optional(),
    alertsTriggered: z.number().int(),
    lastUpdatedAt: z.string().datetime(),
  })
  .openapi("BudgetStatus");

registry.register("BudgetStatus", BudgetStatusSchema);

export const BudgetAlertSchema = z
  .object({
    id: z.string(),
    budgetId: z.string(),
    budgetName: z.string(),
    thresholdPercent: z.number(),
    usedPercent: z.number(),
    usedUnits: z.number().int(),
    periodStart: z.string().datetime(),
    periodEnd: z.string().datetime(),
    acknowledged: z.boolean(),
    acknowledgedAt: z.string().datetime().optional(),
    acknowledgedBy: z.string().optional(),
    createdAt: z.string().datetime(),
  })
  .openapi("BudgetAlert");

registry.register("BudgetAlert", BudgetAlertSchema);

export const ForecastMethodologySchema = z
  .enum(["linear", "exponential", "ensemble"])
  .openapi({
    description: "Forecasting methodology",
  });

registry.register("ForecastMethodology", ForecastMethodologySchema);

export const ForecastOptionsSchema = z
  .object({
    organizationId: z.string().optional(),
    projectId: z.string().optional(),
    horizonDays: z.number().int().min(1).max(90).optional().openapi({
      description: "Number of days to forecast",
      default: 30,
    }),
    historicalDays: z.number().int().min(7).max(365).optional().openapi({
      description: "Number of historical days to use",
      default: 30,
    }),
    methodology: ForecastMethodologySchema.optional(),
  })
  .openapi("ForecastOptions");

registry.register("ForecastOptions", ForecastOptionsSchema);

export const DailyForecastSchema = z
  .object({
    date: z.string().datetime(),
    predictedCostUnits: z.number().int(),
    formattedPredicted: z.string(),
    lowerBoundUnits: z.number().int(),
    upperBoundUnits: z.number().int(),
    confidence: z.number(),
  })
  .openapi("DailyForecast");

registry.register("DailyForecast", DailyForecastSchema);

export const ForecastSchema = z
  .object({
    id: z.string(),
    forecastDate: z.string().datetime(),
    horizonDays: z.number().int(),
    totalForecastUnits: z.number().int(),
    formattedForecast: z.string(),
    confidence95: z.object({
      lower: z.number().int(),
      upper: z.number().int(),
    }),
    methodology: ForecastMethodologySchema,
    accuracyMetrics: z
      .object({
        mape: z.number().optional(),
        rmse: z.number().optional(),
      })
      .optional(),
    trendDirection: z.enum(["increasing", "stable", "decreasing"]),
    trendStrength: z.number().optional(),
    seasonalityDetected: z.boolean().optional(),
    historicalDaysUsed: z.number().int(),
    dailyForecasts: z.array(DailyForecastSchema),
    createdAt: z.string().datetime(),
  })
  .openapi("Forecast");

registry.register("Forecast", ForecastSchema);

export const ForecastScenarioSchema = z
  .object({
    name: z.string(),
    description: z.string(),
    adjustmentPercent: z.number(),
    totalForecastUnits: z.number().int(),
    formattedForecast: z.string(),
  })
  .openapi("ForecastScenario");

registry.register("ForecastScenario", ForecastScenarioSchema);

export const RecommendationCategorySchema = z
  .enum([
    "model_optimization",
    "caching",
    "batching",
    "context_optimization",
    "consolidation",
    "scheduling",
    "rate_limiting",
  ])
  .openapi({
    description: "Cost optimization recommendation category",
  });

registry.register("RecommendationCategory", RecommendationCategorySchema);

export const RecommendationStatusSchema = z
  .enum(["pending", "in_progress", "implemented", "rejected", "failed"])
  .openapi({
    description: "Recommendation implementation status",
  });

registry.register("RecommendationStatus", RecommendationStatusSchema);

export const RecommendationSchema = z
  .object({
    id: z.string(),
    category: RecommendationCategorySchema,
    title: z.string(),
    description: z.string(),
    estimatedSavingsUnits: z.number().int(),
    formattedSavings: z.string(),
    savingsPercent: z.number(),
    confidence: z.enum(["low", "medium", "high"]),
    risk: z.enum(["low", "medium", "high"]),
    status: RecommendationStatusSchema,
    priority: z.number().int(),
    implementation: z.object({
      steps: z.array(z.string()),
      effort: z.enum(["low", "medium", "high"]),
      automatable: z.boolean(),
    }),
    createdAt: z.string().datetime(),
    implementedAt: z.string().datetime().optional(),
    actualSavingsUnits: z.number().int().optional(),
  })
  .openapi("Recommendation");

registry.register("Recommendation", RecommendationSchema);

export const OptimizationSummarySchema = z
  .object({
    totalRecommendations: z.number().int(),
    byCategory: z.record(z.string(), z.number().int()),
    totalPotentialSavingsUnits: z.number().int(),
    formattedPotentialSavings: z.string(),
    implementedSavingsUnits: z.number().int(),
    formattedImplementedSavings: z.string(),
    topRecommendations: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        estimatedSavingsUnits: z.number().int(),
        formattedSavings: z.string(),
      }),
    ),
  })
  .openapi("OptimizationSummary");

registry.register("OptimizationSummary", OptimizationSummarySchema);

export const RateCardSchema = z
  .object({
    model: z.string(),
    provider: ProviderIdSchema,
    promptCostPer1kTokens: z.number().int().openapi({
      description: "Cost per 1000 prompt tokens in micro-units",
    }),
    completionCostPer1kTokens: z.number().int().openapi({
      description: "Cost per 1000 completion tokens in micro-units",
    }),
    cachedPromptCostPer1kTokens: z.number().int().optional(),
    effectiveDate: z.string().datetime(),
    expiresAt: z.string().datetime().optional(),
  })
  .openapi("RateCard");

registry.register("RateCard", RateCardSchema);

export const TopSpendingAgentSchema = z
  .object({
    agentId: z.string(),
    totalCostUnits: z.number().int(),
    formattedCost: z.string(),
    requestCount: z.number().int(),
    avgCostPerRequest: z.number().int(),
    formattedAvgCost: z.string(),
  })
  .openapi("TopSpendingAgent");

registry.register("TopSpendingAgent", TopSpendingAgentSchema);

// Cost Analytics response wrappers
export const CostRecordResponseSchema = createApiResponseSchema(
  "CostRecordResponse",
  CostRecordSchema,
  "costRecord",
);

export const CostRecordListResponseSchema = createApiListResponseSchema(
  "CostRecordListResponse",
  CostRecordSchema,
);

export const CostSummaryResponseSchema = createApiResponseSchema(
  "CostSummaryResponse",
  CostSummarySchema,
  "costSummary",
);

export const CostBreakdownResponseSchema = createApiResponseSchema(
  "CostBreakdownResponse",
  CostBreakdownSchema,
  "costBreakdown",
);

export const BudgetResponseSchema = createApiResponseSchema(
  "BudgetResponse",
  BudgetSchema,
  "budget",
);

export const BudgetListResponseSchema = createApiListResponseSchema(
  "BudgetListResponse",
  BudgetSchema,
);

export const BudgetStatusResponseSchema = createApiResponseSchema(
  "BudgetStatusResponse",
  BudgetStatusSchema,
  "budgetStatus",
);

export const BudgetAlertListResponseSchema = createApiListResponseSchema(
  "BudgetAlertListResponse",
  BudgetAlertSchema,
);

export const ForecastResponseSchema = createApiResponseSchema(
  "ForecastResponse",
  ForecastSchema,
  "forecast",
);

export const RecommendationListResponseSchema = createApiListResponseSchema(
  "RecommendationListResponse",
  RecommendationSchema,
);

export const OptimizationSummaryResponseSchema = createApiResponseSchema(
  "OptimizationSummaryResponse",
  OptimizationSummarySchema,
  "optimizationSummary",
);

export const RateCardListResponseSchema = createApiListResponseSchema(
  "RateCardListResponse",
  RateCardSchema,
);

// ============================================================================
// Beads (BR/BV) Schemas
// ============================================================================

export const BeadDependencySchema = z
  .object({
    id: z.string().openapi({
      description: "Dependency bead ID",
      example: "bd-1abc",
    }),
    title: z.string().optional().openapi({
      description: "Dependency bead title",
    }),
    status: z.string().optional().openapi({
      description: "Dependency bead status",
    }),
    priority: z.number().optional().openapi({
      description: "Dependency bead priority (0=critical, 4=backlog)",
    }),
    dep_type: z.string().optional().openapi({
      description: "Dependency type",
    }),
  })
  .openapi("BeadDependency");

registry.register("BeadDependency", BeadDependencySchema);

export const BeadSchema = z
  .object({
    id: z.string().openapi({
      description: "Unique bead identifier",
      example: "bd-1abc",
    }),
    title: z.string().openapi({
      description: "Bead title",
      example: "Fix authentication bug",
    }),
    description: z.string().optional().openapi({
      description: "Detailed description of the bead",
    }),
    status: z.string().optional().openapi({
      description: "Current status (open, in_progress, closed, blocked)",
      example: "open",
    }),
    priority: z.number().optional().openapi({
      description: "Priority level (0=critical, 1=high, 2=medium, 3=low, 4=backlog)",
      example: 1,
    }),
    issue_type: z.string().optional().openapi({
      description: "Type of issue (bug, feature, task, epic, chore)",
      example: "bug",
    }),
    created_at: z.string().optional().openapi({
      description: "Creation timestamp",
    }),
    created_by: z.string().optional().openapi({
      description: "Creator identifier",
    }),
    updated_at: z.string().optional().openapi({
      description: "Last update timestamp",
    }),
    closed_at: z.string().optional().openapi({
      description: "Closure timestamp",
    }),
    due_at: z.string().optional().openapi({
      description: "Due date",
    }),
    defer_until: z.string().optional().openapi({
      description: "Defer until date",
    }),
    assignee: z.string().optional().openapi({
      description: "Assigned user",
    }),
    owner: z.string().optional().openapi({
      description: "Owner user",
    }),
    labels: z.array(z.string()).optional().openapi({
      description: "Labels attached to the bead",
    }),
    dependency_count: z.number().optional().openapi({
      description: "Number of dependencies",
    }),
    dependent_count: z.number().optional().openapi({
      description: "Number of dependents",
    }),
    dependencies: z.array(BeadDependencySchema).optional().openapi({
      description: "List of dependency beads",
    }),
    dependents: z.array(BeadDependencySchema).optional().openapi({
      description: "List of dependent beads",
    }),
    parent: z.string().optional().openapi({
      description: "Parent bead ID",
    }),
    external_ref: z.string().optional().openapi({
      description: "External reference (e.g., GitHub issue URL)",
    }),
  })
  .openapi("Bead");

registry.register("Bead", BeadSchema);

export const CreateBeadRequestSchema = z
  .object({
    title: z.string().optional().openapi({
      description: "Bead title",
    }),
    type: z.string().optional().openapi({
      description: "Issue type (bug, feature, task, epic, chore)",
    }),
    priority: z.union([z.number(), z.string()]).optional().openapi({
      description: "Priority level (0-4 or P0-P4)",
    }),
    description: z.string().optional().openapi({
      description: "Detailed description",
    }),
    assignee: z.string().optional().openapi({
      description: "Assignee identifier",
    }),
    owner: z.string().optional().openapi({
      description: "Owner identifier",
    }),
    labels: z.array(z.string()).optional().openapi({
      description: "Initial labels",
    }),
    parent: z.string().optional().openapi({
      description: "Parent bead ID",
    }),
    deps: z.union([z.array(z.string()), z.string()]).optional().openapi({
      description: "Dependency bead IDs",
    }),
    estimateMinutes: z.number().optional().openapi({
      description: "Time estimate in minutes",
    }),
    due: z.string().optional().openapi({
      description: "Due date",
    }),
    defer: z.string().optional().openapi({
      description: "Defer until date",
    }),
    externalRef: z.string().optional().openapi({
      description: "External reference URL",
    }),
  })
  .openapi("CreateBeadRequest");

registry.register("CreateBeadRequest", CreateBeadRequestSchema);

export const UpdateBeadRequestSchema = z
  .object({
    title: z.string().optional().openapi({
      description: "New title",
    }),
    description: z.string().optional().openapi({
      description: "New description",
    }),
    design: z.string().optional().openapi({
      description: "Design notes",
    }),
    acceptanceCriteria: z.string().optional().openapi({
      description: "Acceptance criteria",
    }),
    notes: z.string().optional().openapi({
      description: "Additional notes",
    }),
    status: z.string().optional().openapi({
      description: "New status",
    }),
    priority: z.union([z.number(), z.string()]).optional().openapi({
      description: "New priority",
    }),
    type: z.string().optional().openapi({
      description: "New type",
    }),
    assignee: z.string().optional().openapi({
      description: "New assignee",
    }),
    owner: z.string().optional().openapi({
      description: "New owner",
    }),
    claim: z.boolean().optional().openapi({
      description: "Claim the bead (set status to in_progress)",
    }),
    due: z.string().optional().openapi({
      description: "New due date",
    }),
    defer: z.string().optional().openapi({
      description: "New defer date",
    }),
    estimateMinutes: z.number().optional().openapi({
      description: "New time estimate",
    }),
    addLabels: z.array(z.string()).optional().openapi({
      description: "Labels to add",
    }),
    removeLabels: z.array(z.string()).optional().openapi({
      description: "Labels to remove",
    }),
    setLabels: z.array(z.string()).optional().openapi({
      description: "Replace all labels",
    }),
    parent: z.string().optional().openapi({
      description: "New parent bead ID",
    }),
    externalRef: z.string().optional().openapi({
      description: "New external reference",
    }),
  })
  .openapi("UpdateBeadRequest");

registry.register("UpdateBeadRequest", UpdateBeadRequestSchema);

export const CloseBeadRequestSchema = z
  .object({
    reason: z.string().optional().openapi({
      description: "Reason for closing",
    }),
    force: z.boolean().optional().openapi({
      description: "Force close even with open dependencies",
    }),
  })
  .openapi("CloseBeadRequest");

registry.register("CloseBeadRequest", CloseBeadRequestSchema);

export const ListBeadsQuerySchema = z
  .object({
    status: z.union([z.string(), z.array(z.string())]).optional().openapi({
      description: "Filter by status (can be repeated)",
    }),
    type: z.union([z.string(), z.array(z.string())]).optional().openapi({
      description: "Filter by type (can be repeated)",
    }),
    assignee: z.string().optional().openapi({
      description: "Filter by assignee",
    }),
    unassigned: z.enum(["true", "false"]).optional().openapi({
      description: "Only show unassigned beads",
    }),
    id: z.union([z.string(), z.array(z.string())]).optional().openapi({
      description: "Filter by specific IDs (can be repeated)",
    }),
    label: z.union([z.string(), z.array(z.string())]).optional().openapi({
      description: "Filter by label with AND logic (can be repeated)",
    }),
    labelAny: z.union([z.string(), z.array(z.string())]).optional().openapi({
      description: "Filter by label with OR logic (can be repeated)",
    }),
    priority: z.union([z.string(), z.array(z.string())]).optional().openapi({
      description: "Filter by exact priority (can be repeated)",
    }),
    priorityMin: z.string().optional().openapi({
      description: "Minimum priority (0=critical, 4=backlog)",
    }),
    priorityMax: z.string().optional().openapi({
      description: "Maximum priority",
    }),
    titleContains: z.string().optional().openapi({
      description: "Title contains substring",
    }),
    descContains: z.string().optional().openapi({
      description: "Description contains substring",
    }),
    notesContains: z.string().optional().openapi({
      description: "Notes contains substring",
    }),
    all: z.enum(["true", "false"]).optional().openapi({
      description: "Include closed beads (default: false)",
    }),
    limit: z.string().optional().openapi({
      description: "Max results (default: 50, 0 = unlimited)",
    }),
    sort: z.enum(["priority", "created_at", "updated_at", "title"]).optional().openapi({
      description: "Sort by field",
    }),
    reverse: z.enum(["true", "false"]).optional().openapi({
      description: "Reverse sort order",
    }),
    deferred: z.enum(["true", "false"]).optional().openapi({
      description: "Filter for deferred beads",
    }),
    overdue: z.enum(["true", "false"]).optional().openapi({
      description: "Filter for overdue beads",
    }),
  })
  .openapi("ListBeadsQuery");

registry.register("ListBeadsQuery", ListBeadsQuerySchema);

// BV Triage Schemas
export const BvRecommendationSchema = z
  .object({
    id: z.string().openapi({
      description: "Bead ID",
    }),
    title: z.string().openapi({
      description: "Bead title",
    }),
    type: z.string().optional().openapi({
      description: "Issue type",
    }),
    score: z.number().openapi({
      description: "Triage score",
    }),
    reasons: z.array(z.string()).optional().openapi({
      description: "Reasons for the score",
    }),
    status: z.string().optional().openapi({
      description: "Current status",
    }),
    description: z.string().optional().openapi({
      description: "Bead description",
    }),
  })
  .openapi("BvRecommendation");

registry.register("BvRecommendation", BvRecommendationSchema);

export const BvTriageSchema = z
  .object({
    recommendations: z.array(BvRecommendationSchema).optional().openapi({
      description: "Prioritized recommendations",
    }),
    quick_wins: z.array(BvRecommendationSchema).optional().openapi({
      description: "Quick win opportunities",
    }),
    blockers_to_clear: z.array(BvRecommendationSchema).optional().openapi({
      description: "Blockers that should be cleared",
    }),
  })
  .openapi("BvTriage");

registry.register("BvTriage", BvTriageSchema);

export const BvTriageResultSchema = z
  .object({
    generated_at: z.string().openapi({
      description: "Generation timestamp",
    }),
    data_hash: z.string().optional().openapi({
      description: "Hash of source data",
    }),
    triage: BvTriageSchema,
  })
  .openapi("BvTriageResult");

registry.register("BvTriageResult", BvTriageResultSchema);

export const BvInsightsResultSchema = z
  .object({
    generated_at: z.string().openapi({
      description: "Generation timestamp",
    }),
    data_hash: z.string().optional().openapi({
      description: "Hash of source data",
    }),
  })
  .passthrough()
  .openapi("BvInsightsResult");

registry.register("BvInsightsResult", BvInsightsResultSchema);

export const BvPlanResultSchema = z
  .object({
    generated_at: z.string().openapi({
      description: "Generation timestamp",
    }),
    data_hash: z.string().optional().openapi({
      description: "Hash of source data",
    }),
  })
  .passthrough()
  .openapi("BvPlanResult");

registry.register("BvPlanResult", BvPlanResultSchema);

export const BvGraphNodeSchema = z
  .object({
    id: z.string().openapi({
      description: "Node bead ID",
    }),
    title: z.string().openapi({
      description: "Node title",
    }),
    status: z.string().openapi({
      description: "Node status",
    }),
    priority: z.number().optional().openapi({
      description: "Node priority",
    }),
    pagerank: z.number().optional().openapi({
      description: "PageRank score",
    }),
    type: z.string().optional().openapi({
      description: "Issue type",
    }),
    labels: z.array(z.string()).optional().openapi({
      description: "Node labels",
    }),
  })
  .openapi("BvGraphNode");

registry.register("BvGraphNode", BvGraphNodeSchema);

export const BvGraphEdgeSchema = z
  .object({
    source: z.string().openapi({
      description: "Source node ID",
    }),
    target: z.string().openapi({
      description: "Target node ID",
    }),
    type: z.string().optional().openapi({
      description: "Edge type",
    }),
  })
  .openapi("BvGraphEdge");

registry.register("BvGraphEdge", BvGraphEdgeSchema);

export const BvGraphResultSchema = z
  .object({
    format: z.string().optional().openapi({
      description: "Output format (json, dot, mermaid)",
    }),
    nodes: z.union([z.number(), z.array(BvGraphNodeSchema)]).openapi({
      description: "Graph nodes (count or array)",
    }),
    edges: z.union([z.number(), z.array(BvGraphEdgeSchema)]).openapi({
      description: "Graph edges (count or array)",
    }),
    data_hash: z.string().optional().openapi({
      description: "Hash of source data",
    }),
  })
  .passthrough()
  .openapi("BvGraphResult");

registry.register("BvGraphResult", BvGraphResultSchema);

export const BrSyncStatusSchema = z
  .object({
    dirty_count: z.number().optional().openapi({
      description: "Number of dirty records",
    }),
    last_export_time: z.string().optional().openapi({
      description: "Last export timestamp",
    }),
    last_import_time: z.string().optional().openapi({
      description: "Last import timestamp",
    }),
    jsonl_content_hash: z.string().optional().openapi({
      description: "JSONL content hash",
    }),
    jsonl_exists: z.boolean().optional().openapi({
      description: "Whether JSONL file exists",
    }),
    jsonl_newer: z.boolean().optional().openapi({
      description: "Whether JSONL is newer than DB",
    }),
    db_newer: z.boolean().optional().openapi({
      description: "Whether DB is newer than JSONL",
    }),
  })
  .openapi("BrSyncStatus");

registry.register("BrSyncStatus", BrSyncStatusSchema);

export const BrSyncResultSchema = z
  .object({
    status: z.string().optional().openapi({
      description: "Sync operation status",
    }),
  })
  .passthrough()
  .openapi("BrSyncResult");

registry.register("BrSyncResult", BrSyncResultSchema);

// Beads response wrappers
export const BeadResponseSchema = createApiResponseSchema(
  "BeadResponse",
  BeadSchema,
  "bead",
);

export const BeadListResponseSchema = createApiListResponseSchema(
  "BeadListResponse",
  BeadSchema,
);

export const BvTriageResponseSchema = createApiResponseSchema(
  "BvTriageResponse",
  BvTriageResultSchema,
  "triage",
);

export const BvInsightsResponseSchema = createApiResponseSchema(
  "BvInsightsResponse",
  BvInsightsResultSchema,
  "insights",
);

export const BvPlanResponseSchema = createApiResponseSchema(
  "BvPlanResponse",
  BvPlanResultSchema,
  "plan",
);

export const BvGraphResponseSchema = createApiResponseSchema(
  "BvGraphResponse",
  BvGraphResultSchema,
  "graph",
);

export const BrSyncStatusResponseSchema = createApiResponseSchema(
  "BrSyncStatusResponse",
  BrSyncStatusSchema,
  "sync_status",
);

export const BrSyncResultResponseSchema = createApiResponseSchema(
  "BrSyncResultResponse",
  BrSyncResultSchema,
  "sync_result",
);

// ============================================================================
// Setup Schemas
// ============================================================================

export const ToolCategorySchema = z.enum(["agent", "tool"]).openapi({
  description: "Tool category: agent CLI or developer tool",
});

registry.register("ToolCategory", ToolCategorySchema);

export const ManifestMetadataSchema = z
  .object({
    schemaVersion: z.string().openapi({
      description: "ACFS manifest schema version",
      example: "1.0.0",
    }),
    source: z.string().optional().openapi({
      description: "Source identifier of the manifest",
    }),
    generatedAt: z.string().optional().openapi({
      description: "When the manifest was generated",
    }),
    manifestPath: z.string().optional().openapi({
      description: "Absolute filesystem path to the loaded manifest",
      example: "/data/projects/flywheel_gateway/acfs.manifest.yaml",
    }),
    manifestHash: z.string().optional().openapi({
      description: "SHA-256 hash of the manifest content for verification",
      example: "a1b2c3d4e5f6...",
    }),
  })
  .openapi("ManifestMetadata");

registry.register("ManifestMetadata", ManifestMetadataSchema);

export const ToolInfoSchema = z
  .object({
    name: z.string().openapi({
      description: "Tool identifier",
      example: "dcg",
    }),
    displayName: z.string().openapi({
      description: "Human-readable tool name",
      example: "Destructive Command Guard",
    }),
    description: z.string().openapi({
      description: "Tool description",
    }),
    category: ToolCategorySchema,
    tags: z
      .array(z.string())
      .optional()
      .openapi({
        description: "Tool tags from manifest (e.g., critical, recommended)",
        example: ["critical", "safety"],
      }),
    optional: z.boolean().optional().openapi({
      description: "Whether tool is optional for setup",
    }),
    enabledByDefault: z.boolean().optional().openapi({
      description: "Whether tool is enabled by default",
    }),
    phase: z.number().int().optional().openapi({
      description: "Setup phase number from manifest",
      example: 1,
    }),
    manifestVersion: z.string().optional().openapi({
      description: "Manifest schema version this tool came from",
    }),
    installCommand: z.string().optional().openapi({
      description: "Command to install the tool",
    }),
    installUrl: z.string().optional().openapi({
      description: "URL for manual installation instructions",
    }),
    docsUrl: z.string().optional().openapi({
      description: "Documentation URL",
    }),
  })
  .openapi("ToolInfo");

registry.register("ToolInfo", ToolInfoSchema);

export const DetectedCLISchema = z
  .object({
    name: z.string().openapi({
      description: "Tool identifier",
    }),
    available: z.boolean().openapi({
      description: "Whether the tool is installed and accessible",
    }),
    version: z.string().optional().openapi({
      description: "Detected version string",
    }),
    path: z.string().optional().openapi({
      description: "Path to the executable",
    }),
    authenticated: z.boolean().optional().openapi({
      description: "Whether the tool is authenticated (for agent CLIs)",
    }),
    authError: z.string().optional().openapi({
      description: "Authentication error message if auth failed",
    }),
    detectedAt: TimestampSchema,
    durationMs: z.number().int().openapi({
      description: "Detection duration in milliseconds",
    }),
  })
  .openapi("DetectedCLI");

registry.register("DetectedCLI", DetectedCLISchema);

export const ReadinessSummarySchema = z
  .object({
    agentsAvailable: z.number().int().openapi({
      description: "Number of available agent CLIs",
    }),
    agentsTotal: z.number().int().openapi({
      description: "Total number of known agent CLIs",
    }),
    toolsAvailable: z.number().int().openapi({
      description: "Number of available developer tools",
    }),
    toolsTotal: z.number().int().openapi({
      description: "Total number of known developer tools",
    }),
    authIssues: z.array(z.string()).openapi({
      description: "Tools with authentication issues",
    }),
    missingRequired: z.array(z.string()).openapi({
      description: "Required tools that are not installed",
    }),
  })
  .openapi("ReadinessSummary");

registry.register("ReadinessSummary", ReadinessSummarySchema);

export const ReadinessStatusSchema = z
  .object({
    ready: z.boolean().openapi({
      description: "Overall readiness status",
    }),
    agents: z.array(DetectedCLISchema).openapi({
      description: "Detection results for agent CLIs",
    }),
    tools: z.array(DetectedCLISchema).openapi({
      description: "Detection results for developer tools",
    }),
    manifest: ManifestMetadataSchema.optional().openapi({
      description: "Tool registry manifest metadata",
    }),
    summary: ReadinessSummarySchema,
    recommendations: z.array(z.string()).openapi({
      description: "Recommendations to improve readiness",
    }),
    detectedAt: TimestampSchema,
    durationMs: z.number().int().openapi({
      description: "Total detection duration in milliseconds",
    }),
  })
  .openapi("ReadinessStatus");

registry.register("ReadinessStatus", ReadinessStatusSchema);

export const ToolInfoWithStatusSchema = ToolInfoSchema.extend({
  status: DetectedCLISchema.openapi({
    description: "Current detection status for this tool",
  }),
}).openapi("ToolInfoWithStatus");

registry.register("ToolInfoWithStatus", ToolInfoWithStatusSchema);

export const SetupInstallModeSchema = z.enum(["interactive", "easy"]).openapi({
  description: "Installation mode: interactive prompts or automated",
});

registry.register("SetupInstallMode", SetupInstallModeSchema);

export const SetupInstallRequestSchema = z
  .object({
    tool: z.string().openapi({
      description: "Tool name to install",
      example: "dcg",
    }),
    mode: SetupInstallModeSchema.default("easy"),
    verify: z.boolean().default(true).openapi({
      description: "Whether to verify installation after completion",
    }),
  })
  .openapi("SetupInstallRequest");

registry.register("SetupInstallRequest", SetupInstallRequestSchema);

export const SetupBatchInstallRequestSchema = z
  .object({
    tools: z.array(z.string()).min(1).openapi({
      description: "Tool names to install",
    }),
    mode: SetupInstallModeSchema.default("easy"),
    verify: z.boolean().default(true).openapi({
      description: "Whether to verify each installation",
    }),
    stopOnError: z.boolean().default(false).openapi({
      description: "Whether to stop on first error",
    }),
  })
  .openapi("SetupBatchInstallRequest");

registry.register("SetupBatchInstallRequest", SetupBatchInstallRequestSchema);

export const SetupInstallResultSchema = z
  .object({
    tool: z.string().openapi({
      description: "Tool that was installed",
    }),
    success: z.boolean().openapi({
      description: "Whether installation succeeded",
    }),
    version: z.string().optional().openapi({
      description: "Installed version",
    }),
    path: z.string().optional().openapi({
      description: "Path to installed executable",
    }),
    error: z.string().optional().openapi({
      description: "Error message if installation failed",
    }),
    durationMs: z.number().int().openapi({
      description: "Installation duration in milliseconds",
    }),
  })
  .openapi("SetupInstallResult");

registry.register("SetupInstallResult", SetupInstallResultSchema);

export const SetupBatchInstallResultSchema = z
  .object({
    success: z.boolean().openapi({
      description: "Whether all installations succeeded",
    }),
    results: z.array(SetupInstallResultSchema).openapi({
      description: "Individual installation results",
    }),
    summary: z.object({
      total: z.number().int(),
      succeeded: z.number().int(),
      failed: z.number().int(),
    }),
  })
  .openapi("SetupBatchInstallResult");

registry.register("SetupBatchInstallResult", SetupBatchInstallResultSchema);

export const VerificationResultSchema = z
  .object({
    tool: z.string(),
    available: z.boolean(),
    version: z.string().optional(),
    path: z.string().optional(),
    authenticated: z.boolean().optional(),
    authError: z.string().optional(),
    detectedAt: TimestampSchema,
    durationMs: z.number().int(),
  })
  .openapi("VerificationResult");

registry.register("VerificationResult", VerificationResultSchema);

export const RegistryRefreshResultSchema = z
  .object({
    manifest: ManifestMetadataSchema,
    toolCount: z.number().int().openapi({
      description: "Number of tools in refreshed registry",
    }),
    refreshedAt: TimestampSchema,
  })
  .openapi("RegistryRefreshResult");

registry.register("RegistryRefreshResult", RegistryRefreshResultSchema);

export const CacheClearedResultSchema = z
  .object({
    message: z.string(),
    timestamp: TimestampSchema,
  })
  .openapi("CacheClearedResult");

registry.register("CacheClearedResult", CacheClearedResultSchema);

// Setup response wrappers
export const ReadinessStatusResponseSchema = createApiResponseSchema(
  "ReadinessStatusResponse",
  ReadinessStatusSchema,
  "readiness_status",
);

export const ToolInfoListResponseSchema = createApiListResponseSchema(
  "ToolInfoListResponse",
  ToolInfoSchema,
);

export const ToolInfoWithStatusResponseSchema = createApiResponseSchema(
  "ToolInfoWithStatusResponse",
  ToolInfoWithStatusSchema,
  "tool_info",
);

export const SetupInstallResultResponseSchema = createApiResponseSchema(
  "SetupInstallResultResponse",
  SetupInstallResultSchema,
  "install_result",
);

export const SetupBatchInstallResultResponseSchema = createApiResponseSchema(
  "SetupBatchInstallResultResponse",
  SetupBatchInstallResultSchema,
  "batch_install_result",
);

export const VerificationResultResponseSchema = createApiResponseSchema(
  "VerificationResultResponse",
  VerificationResultSchema,
  "verification_result",
);

export const RegistryRefreshResultResponseSchema = createApiResponseSchema(
  "RegistryRefreshResultResponse",
  RegistryRefreshResultSchema,
  "registry_refresh",
);

export const CacheClearedResultResponseSchema = createApiResponseSchema(
  "CacheClearedResultResponse",
  CacheClearedResultSchema,
  "cache_cleared",
);
