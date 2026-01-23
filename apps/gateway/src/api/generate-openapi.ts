/**
 * OpenAPI Specification Generator
 *
 * Generates a complete OpenAPI 3.1 specification from the
 * registered Zod schemas and route definitions.
 */

import { OpenApiGeneratorV31 } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import {
  AgentListResponseSchema,
  AgentResponseSchema,
  ApiErrorResponseSchema,
  // Beads (BR/BV)
  BeadListResponseSchema,
  BeadResponseSchema,
  BrSyncResultResponseSchema,
  BrSyncStatusResponseSchema,
  BvGraphResponseSchema,
  BvInsightsResponseSchema,
  BvPlanResponseSchema,
  BvTriageResponseSchema,
  CloseBeadRequestSchema,
  CreateBeadRequestSchema,
  ListBeadsQuerySchema,
  UpdateBeadRequestSchema,
  // Cost Analytics
  BudgetAlertListResponseSchema,
  BudgetListResponseSchema,
  BudgetResponseSchema,
  BudgetStatusResponseSchema,
  CacheClearedResultResponseSchema,
  CheckpointListResponseSchema,
  CheckpointResponseSchema,
  ConflictListResponseSchema,
  CostBreakdownResponseSchema,
  CostRecordInputSchema,
  CostRecordListResponseSchema,
  CostRecordResponseSchema,
  CostSummaryResponseSchema,
  CostTrendPointSchema,
  CreateBudgetRequestSchema,
  CreateCheckpointRequestSchema,
  CreateDashboardRequestSchema,
  CreateNotificationRequestSchema,
  CreatePipelineRequestSchema,
  CreateReservationRequestSchema,
  CreateWidgetRequestSchema,
  DashboardListResponseSchema,
  DashboardResponseSchema,
  DashboardSharingSchema,
  DashboardStatsResponseSchema,
  DashboardVisibilitySchema,
  ForecastOptionsSchema,
  ForecastResponseSchema,
  ForecastScenarioSchema,
  GrantPermissionRequestSchema,
  HealthCheckResponseSchema,
  InterruptAgentRequestSchema,
  NotificationListResponseSchema,
  OptimizationSummaryResponseSchema,
  PaginationQuerySchema,
  PermissionListResponseSchema,
  PermissionResponseSchema,
  PipelineResponseSchema,
  ProviderIdSchema,
  RateCardListResponseSchema,
  RateCardSchema,
  ReadinessStatusResponseSchema,
  RecommendationCategorySchema,
  RecommendationListResponseSchema,
  RecommendationStatusSchema,
  RegistryRefreshResultResponseSchema,
  ReservationResponseSchema,
  RestoreCheckpointRequestSchema,
  registry,
  SendMessageRequestSchema,
  SetupBatchInstallRequestSchema,
  SetupBatchInstallResultResponseSchema,
  SetupInstallRequestSchema,
  SetupInstallResultResponseSchema,
  SpawnAgentRequestSchema,
  ToolInfoListResponseSchema,
  ToolInfoWithStatusResponseSchema,
  TopSpendingAgentSchema,
  UpdateDashboardRequestSchema,
  VerificationResultResponseSchema,
  WidgetDataResponseSchema,
  WidgetSchema,
} from "./schemas";

// ============================================================================
// Security Schemes
// ============================================================================

registry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
  description: "JWT Bearer token authentication",
});

// ============================================================================
// Route Definitions
// ============================================================================

// Health endpoint
registry.registerPath({
  method: "get",
  path: "/health",
  summary: "Health check",
  description: "Returns the current health status of the API server.",
  tags: ["System"],
  responses: {
    200: {
      description: "Server is healthy",
      content: {
        "application/json": {
          schema: HealthCheckResponseSchema,
        },
      },
    },
  },
});

// ============================================================================
// Agent Routes
// ============================================================================

registry.registerPath({
  method: "get",
  path: "/agents",
  summary: "List agents",
  description:
    "Returns a paginated list of all agents accessible to the authenticated user.",
  tags: ["Agents"],
  request: {
    query: PaginationQuerySchema.extend({
      status: z
        .enum(["spawning", "ready", "busy", "terminated", "error"])
        .optional()
        .openapi({
          description: "Filter by agent status",
        }),
    }),
  },
  responses: {
    200: {
      description: "List of agents",
      content: {
        "application/json": {
          schema: AgentListResponseSchema,
        },
      },
    },
    401: {
      description: "Unauthorized",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/agents",
  summary: "Spawn a new agent",
  description: "Creates and starts a new AI agent in the specified directory.",
  tags: ["Agents"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: SpawnAgentRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Agent created successfully",
      content: {
        "application/json": {
          schema: AgentResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request body",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
    409: {
      description: "Agent with this ID already exists",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/agents/{agentId}",
  summary: "Get agent details",
  description: "Returns detailed information about a specific agent.",
  tags: ["Agents"],
  request: {
    params: z.object({
      agentId: z.string().openapi({
        description: "Agent identifier",
        example: "agent_abc123",
      }),
    }),
  },
  responses: {
    200: {
      description: "Agent details",
      content: {
        "application/json": {
          schema: AgentResponseSchema,
        },
      },
    },
    404: {
      description: "Agent not found",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/agents/{agentId}/messages",
  summary: "Send message to agent",
  description:
    "Sends a message to the agent and optionally streams the response.",
  tags: ["Agents"],
  request: {
    params: z.object({
      agentId: z.string().openapi({
        description: "Agent identifier",
      }),
    }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: SendMessageRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Message sent successfully",
      content: {
        "application/json": {
          schema: z.object({
            object: z.literal("message"),
            data: z.object({
              response: z.string(),
            }),
            requestId: z.string(),
            timestamp: z.string(),
          }),
        },
      },
    },
    404: {
      description: "Agent not found",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/agents/{agentId}/interrupt",
  summary: "Interrupt agent",
  description: "Sends an interrupt signal to the agent.",
  tags: ["Agents"],
  request: {
    params: z.object({
      agentId: z.string(),
    }),
    body: {
      required: false,
      content: {
        "application/json": {
          schema: InterruptAgentRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Interrupt signal sent",
      content: {
        "application/json": {
          schema: AgentResponseSchema,
        },
      },
    },
    404: {
      description: "Agent not found",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "delete",
  path: "/agents/{agentId}",
  summary: "Terminate agent",
  description: "Terminates and removes an agent.",
  tags: ["Agents"],
  request: {
    params: z.object({
      agentId: z.string(),
    }),
  },
  responses: {
    200: {
      description: "Agent terminated",
      content: {
        "application/json": {
          schema: AgentResponseSchema,
        },
      },
    },
    404: {
      description: "Agent not found",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
  },
});

// ============================================================================
// Checkpoint Routes
// ============================================================================

registry.registerPath({
  method: "get",
  path: "/agents/{agentId}/checkpoints",
  summary: "List agent checkpoints",
  description: "Returns a list of checkpoints for the specified agent.",
  tags: ["Checkpoints"],
  request: {
    params: z.object({
      agentId: z.string(),
    }),
    query: PaginationQuerySchema,
  },
  responses: {
    200: {
      description: "List of checkpoints",
      content: {
        "application/json": {
          schema: CheckpointListResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/agents/{agentId}/checkpoints",
  summary: "Create checkpoint",
  description: "Creates a new checkpoint capturing the current agent state.",
  tags: ["Checkpoints"],
  request: {
    params: z.object({
      agentId: z.string(),
    }),
    body: {
      required: false,
      content: {
        "application/json": {
          schema: CreateCheckpointRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Checkpoint created",
      content: {
        "application/json": {
          schema: CheckpointResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/agents/{agentId}/checkpoints/restore",
  summary: "Restore checkpoint",
  description: "Restores the agent to a previous checkpoint state.",
  tags: ["Checkpoints"],
  request: {
    params: z.object({
      agentId: z.string(),
    }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: RestoreCheckpointRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Checkpoint restored",
      content: {
        "application/json": {
          schema: AgentResponseSchema,
        },
      },
    },
  },
});

// ============================================================================
// Reservation Routes
// ============================================================================

registry.registerPath({
  method: "post",
  path: "/reservations",
  summary: "Create file reservation",
  description:
    "Creates a reservation to prevent concurrent edits to specified files.",
  tags: ["Reservations"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: CreateReservationRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Reservation created",
      content: {
        "application/json": {
          schema: ReservationResponseSchema,
        },
      },
    },
    409: {
      description: "File conflict - files already reserved",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
  },
});

// ============================================================================
// Conflict Routes
// ============================================================================

registry.registerPath({
  method: "get",
  path: "/conflicts",
  summary: "List conflicts",
  description: "Returns a list of detected conflicts between agents.",
  tags: ["Conflicts"],
  request: {
    query: PaginationQuerySchema.extend({
      status: z
        .enum(["pending", "resolved", "escalated", "auto_resolved"])
        .optional(),
    }),
  },
  responses: {
    200: {
      description: "List of conflicts",
      content: {
        "application/json": {
          schema: ConflictListResponseSchema,
        },
      },
    },
  },
});

// ============================================================================
// Notification Routes
// ============================================================================

registry.registerPath({
  method: "get",
  path: "/notifications",
  summary: "List notifications",
  description: "Returns a paginated list of notifications for the user.",
  tags: ["Notifications"],
  request: {
    query: PaginationQuerySchema.extend({
      unreadOnly: z.coerce.boolean().optional().openapi({
        description: "Only return unread notifications",
      }),
      category: z
        .enum([
          "agents",
          "coordination",
          "tasks",
          "costs",
          "security",
          "system",
        ])
        .optional(),
    }),
  },
  responses: {
    200: {
      description: "List of notifications",
      content: {
        "application/json": {
          schema: NotificationListResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/notifications",
  summary: "Create notification",
  description: "Creates a new notification for a user.",
  tags: ["Notifications"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: CreateNotificationRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Notification created",
      content: {
        "application/json": {
          schema: z.object({
            object: z.literal("notification"),
            data: z.object({
              id: z.string(),
            }),
            requestId: z.string(),
            timestamp: z.string(),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/notifications/{notificationId}/read",
  summary: "Mark notification as read",
  description: "Marks a notification as read.",
  tags: ["Notifications"],
  request: {
    params: z.object({
      notificationId: z.string(),
    }),
  },
  responses: {
    200: {
      description: "Notification marked as read",
      content: {
        "application/json": {
          schema: z.object({
            object: z.literal("notification"),
            data: z.object({
              success: z.boolean(),
            }),
            requestId: z.string(),
            timestamp: z.string(),
          }),
        },
      },
    },
  },
});

// ============================================================================
// Pipeline Routes
// ============================================================================

registry.registerPath({
  method: "post",
  path: "/pipelines",
  summary: "Create pipeline",
  description: "Creates a new multi-step pipeline for agent orchestration.",
  tags: ["Pipelines"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: CreatePipelineRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Pipeline created",
      content: {
        "application/json": {
          schema: PipelineResponseSchema,
        },
      },
    },
  },
});

// ============================================================================
// Dashboard Routes
// ============================================================================

registry.registerPath({
  method: "get",
  path: "/dashboards",
  summary: "List dashboards",
  description: "Returns a paginated list of dashboards accessible to the user.",
  tags: ["Dashboards"],
  request: {
    query: PaginationQuerySchema.extend({
      userId: z.string().optional().openapi({
        description: "Filter by owner user ID",
      }),
      workspaceId: z.string().optional().openapi({
        description: "Filter by workspace ID",
      }),
      visibility: DashboardVisibilitySchema.optional().openapi({
        description: "Filter by visibility level",
      }),
    }),
  },
  responses: {
    200: {
      description: "List of dashboards",
      content: {
        "application/json": {
          schema: DashboardListResponseSchema,
        },
      },
    },
    401: {
      description: "Unauthorized",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/dashboards",
  summary: "Create dashboard",
  description: "Creates a new custom dashboard with optional initial widgets.",
  tags: ["Dashboards"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: CreateDashboardRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Dashboard created",
      content: {
        "application/json": {
          schema: DashboardResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request body",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/dashboards/favorites",
  summary: "List favorite dashboards",
  description: "Returns the user's favorite dashboards.",
  tags: ["Dashboards"],
  request: {
    query: z.object({
      userId: z.string().optional().openapi({
        description: "User ID",
      }),
    }),
  },
  responses: {
    200: {
      description: "List of favorite dashboards",
      content: {
        "application/json": {
          schema: DashboardListResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/dashboards/stats",
  summary: "Get dashboard statistics",
  description: "Returns aggregate statistics about all dashboards.",
  tags: ["Dashboards"],
  responses: {
    200: {
      description: "Dashboard statistics",
      content: {
        "application/json": {
          schema: DashboardStatsResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/dashboards/public/{slug}",
  summary: "Get public dashboard",
  description: "Returns a public dashboard by its URL slug.",
  tags: ["Dashboards"],
  request: {
    params: z.object({
      slug: z.string().openapi({
        description: "Public dashboard URL slug",
        example: "team-metrics",
      }),
    }),
  },
  responses: {
    200: {
      description: "Public dashboard",
      content: {
        "application/json": {
          schema: DashboardResponseSchema,
        },
      },
    },
    403: {
      description: "Dashboard is not public",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
    404: {
      description: "Dashboard not found",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/dashboards/{dashboardId}",
  summary: "Get dashboard",
  description: "Returns a specific dashboard by ID.",
  tags: ["Dashboards"],
  request: {
    params: z.object({
      dashboardId: z.string().openapi({
        description: "Dashboard identifier",
        example: "dash_abc123",
      }),
    }),
  },
  responses: {
    200: {
      description: "Dashboard details",
      content: {
        "application/json": {
          schema: DashboardResponseSchema,
        },
      },
    },
    403: {
      description: "Access denied",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
    404: {
      description: "Dashboard not found",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "put",
  path: "/dashboards/{dashboardId}",
  summary: "Update dashboard",
  description: "Updates an existing dashboard's properties.",
  tags: ["Dashboards"],
  request: {
    params: z.object({
      dashboardId: z.string().openapi({
        description: "Dashboard identifier",
      }),
    }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: UpdateDashboardRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Dashboard updated",
      content: {
        "application/json": {
          schema: DashboardResponseSchema,
        },
      },
    },
    403: {
      description: "No edit access",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
    404: {
      description: "Dashboard not found",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "delete",
  path: "/dashboards/{dashboardId}",
  summary: "Delete dashboard",
  description: "Permanently deletes a dashboard. Only the owner can delete.",
  tags: ["Dashboards"],
  request: {
    params: z.object({
      dashboardId: z.string(),
    }),
  },
  responses: {
    200: {
      description: "Dashboard deleted",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
          }),
        },
      },
    },
    403: {
      description: "Only owner can delete",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
    404: {
      description: "Dashboard not found",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/dashboards/{dashboardId}/duplicate",
  summary: "Duplicate dashboard",
  description: "Creates a copy of an existing dashboard.",
  tags: ["Dashboards"],
  request: {
    params: z.object({
      dashboardId: z.string(),
    }),
    body: {
      required: false,
      content: {
        "application/json": {
          schema: z.object({
            name: z.string().optional().openapi({
              description: "Custom name for the copy",
            }),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: "Dashboard duplicated",
      content: {
        "application/json": {
          schema: DashboardResponseSchema,
        },
      },
    },
    403: {
      description: "No access to original",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
    404: {
      description: "Dashboard not found",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
  },
});

// Widget Operations

registry.registerPath({
  method: "post",
  path: "/dashboards/{dashboardId}/widgets",
  summary: "Add widget",
  description: "Adds a new widget to a dashboard.",
  tags: ["Dashboards"],
  request: {
    params: z.object({
      dashboardId: z.string(),
    }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: CreateWidgetRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Widget added",
      content: {
        "application/json": {
          schema: DashboardResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid widget data",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
    403: {
      description: "No edit access",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
    404: {
      description: "Dashboard not found",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "put",
  path: "/dashboards/{dashboardId}/widgets/{widgetId}",
  summary: "Update widget",
  description: "Updates an existing widget's properties.",
  tags: ["Dashboards"],
  request: {
    params: z.object({
      dashboardId: z.string(),
      widgetId: z.string(),
    }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: WidgetSchema.partial(),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Widget updated",
      content: {
        "application/json": {
          schema: DashboardResponseSchema,
        },
      },
    },
    403: {
      description: "No edit access",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
    404: {
      description: "Widget not found",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "delete",
  path: "/dashboards/{dashboardId}/widgets/{widgetId}",
  summary: "Remove widget",
  description: "Removes a widget from a dashboard.",
  tags: ["Dashboards"],
  request: {
    params: z.object({
      dashboardId: z.string(),
      widgetId: z.string(),
    }),
  },
  responses: {
    200: {
      description: "Widget removed",
      content: {
        "application/json": {
          schema: DashboardResponseSchema,
        },
      },
    },
    403: {
      description: "No edit access",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
    404: {
      description: "Widget not found",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/dashboards/{dashboardId}/widgets/{widgetId}/data",
  summary: "Get widget data",
  description: "Fetches the current data for a widget.",
  tags: ["Dashboards"],
  request: {
    params: z.object({
      dashboardId: z.string(),
      widgetId: z.string(),
    }),
  },
  responses: {
    200: {
      description: "Widget data",
      content: {
        "application/json": {
          schema: WidgetDataResponseSchema,
        },
      },
    },
    403: {
      description: "No access",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
    404: {
      description: "Widget not found",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
  },
});

// Sharing and Permissions

registry.registerPath({
  method: "put",
  path: "/dashboards/{dashboardId}/sharing",
  summary: "Update sharing settings",
  description: "Updates the sharing configuration for a dashboard.",
  tags: ["Dashboards"],
  request: {
    params: z.object({
      dashboardId: z.string(),
    }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: DashboardSharingSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Sharing updated",
      content: {
        "application/json": {
          schema: DashboardResponseSchema,
        },
      },
    },
    403: {
      description: "Only owner can update sharing",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
    404: {
      description: "Dashboard not found",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/dashboards/{dashboardId}/permissions",
  summary: "List permissions",
  description: "Lists all user permissions for a dashboard.",
  tags: ["Dashboards"],
  request: {
    params: z.object({
      dashboardId: z.string(),
    }),
  },
  responses: {
    200: {
      description: "List of permissions",
      content: {
        "application/json": {
          schema: PermissionListResponseSchema,
        },
      },
    },
    403: {
      description: "Only owner can view permissions",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
    404: {
      description: "Dashboard not found",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/dashboards/{dashboardId}/permissions",
  summary: "Grant permission",
  description: "Grants view or edit permission to a user.",
  tags: ["Dashboards"],
  request: {
    params: z.object({
      dashboardId: z.string(),
    }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: GrantPermissionRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Permission granted",
      content: {
        "application/json": {
          schema: PermissionResponseSchema,
        },
      },
    },
    403: {
      description: "Only owner can grant permissions",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
    404: {
      description: "Dashboard not found",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "delete",
  path: "/dashboards/{dashboardId}/permissions/{targetUserId}",
  summary: "Revoke permission",
  description: "Revokes a user's permission from a dashboard.",
  tags: ["Dashboards"],
  request: {
    params: z.object({
      dashboardId: z.string(),
      targetUserId: z.string().openapi({
        description: "User ID to revoke permission from",
      }),
    }),
  },
  responses: {
    200: {
      description: "Permission revoked",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
          }),
        },
      },
    },
    403: {
      description: "Only owner can revoke permissions",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
    404: {
      description: "Permission not found",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
  },
});

// Favorites

registry.registerPath({
  method: "post",
  path: "/dashboards/{dashboardId}/favorite",
  summary: "Add to favorites",
  description: "Adds a dashboard to the user's favorites.",
  tags: ["Dashboards"],
  request: {
    params: z.object({
      dashboardId: z.string(),
    }),
  },
  responses: {
    200: {
      description: "Added to favorites",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
          }),
        },
      },
    },
    403: {
      description: "No access to dashboard",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
    404: {
      description: "Dashboard not found",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "delete",
  path: "/dashboards/{dashboardId}/favorite",
  summary: "Remove from favorites",
  description: "Removes a dashboard from the user's favorites.",
  tags: ["Dashboards"],
  request: {
    params: z.object({
      dashboardId: z.string(),
    }),
  },
  responses: {
    200: {
      description: "Removed from favorites",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
          }),
        },
      },
    },
    404: {
      description: "Favorite not found",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
  },
});

// ============================================================================
// Cost Analytics Routes
// ============================================================================

// Cost Records

registry.registerPath({
  method: "post",
  path: "/cost-analytics/records",
  summary: "Record cost",
  description: "Records a cost event from an LLM API call.",
  tags: ["Cost Analytics"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: CostRecordInputSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Cost recorded",
      content: {
        "application/json": {
          schema: CostRecordResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid input",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/cost-analytics/records",
  summary: "List cost records",
  description: "Returns cost records with optional filtering.",
  tags: ["Cost Analytics"],
  request: {
    query: PaginationQuerySchema.extend({
      organizationId: z.string().optional(),
      projectId: z.string().optional(),
      agentId: z.string().optional(),
      model: z.string().optional(),
      provider: ProviderIdSchema.optional(),
      since: z.string().datetime().optional(),
      until: z.string().datetime().optional(),
    }),
  },
  responses: {
    200: {
      description: "List of cost records",
      content: {
        "application/json": {
          schema: CostRecordListResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/cost-analytics/summary",
  summary: "Get cost summary",
  description: "Returns aggregated cost summary for a period.",
  tags: ["Cost Analytics"],
  request: {
    query: z.object({
      organizationId: z.string().optional(),
      projectId: z.string().optional(),
      agentId: z.string().optional(),
      since: z.string().datetime().optional(),
      until: z.string().datetime().optional(),
    }),
  },
  responses: {
    200: {
      description: "Cost summary",
      content: {
        "application/json": {
          schema: CostSummaryResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/cost-analytics/breakdown/{dimension}",
  summary: "Get cost breakdown",
  description: "Returns cost breakdown by model, agent, project, or provider.",
  tags: ["Cost Analytics"],
  request: {
    params: z.object({
      dimension: z.enum(["model", "agent", "project", "provider"]),
    }),
    query: z.object({
      organizationId: z.string().optional(),
      projectId: z.string().optional(),
      since: z.string().datetime().optional(),
      until: z.string().datetime().optional(),
    }),
  },
  responses: {
    200: {
      description: "Cost breakdown",
      content: {
        "application/json": {
          schema: CostBreakdownResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid dimension",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/cost-analytics/trends/daily",
  summary: "Get daily cost trends",
  description: "Returns daily cost trend data.",
  tags: ["Cost Analytics"],
  request: {
    query: z.object({
      organizationId: z.string().optional(),
      projectId: z.string().optional(),
      since: z.string().datetime().optional(),
      until: z.string().datetime().optional(),
      days: z.coerce.number().int().min(1).max(365).optional(),
    }),
  },
  responses: {
    200: {
      description: "Daily cost trend",
      content: {
        "application/json": {
          schema: z.object({
            object: z.literal("list"),
            data: z.array(CostTrendPointSchema),
            total: z.number(),
          }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/cost-analytics/top-agents",
  summary: "Get top spending agents",
  description: "Returns the top agents by cost.",
  tags: ["Cost Analytics"],
  request: {
    query: z.object({
      organizationId: z.string().optional(),
      projectId: z.string().optional(),
      since: z.string().datetime().optional(),
      until: z.string().datetime().optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }),
  },
  responses: {
    200: {
      description: "Top spending agents",
      content: {
        "application/json": {
          schema: z.object({
            object: z.literal("list"),
            data: z.array(TopSpendingAgentSchema),
            total: z.number(),
          }),
        },
      },
    },
  },
});

// Budgets

registry.registerPath({
  method: "post",
  path: "/cost-analytics/budgets",
  summary: "Create budget",
  description: "Creates a new cost budget with alert thresholds.",
  tags: ["Cost Analytics"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: CreateBudgetRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Budget created",
      content: {
        "application/json": {
          schema: BudgetResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid input",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/cost-analytics/budgets",
  summary: "List budgets",
  description: "Returns all configured budgets.",
  tags: ["Cost Analytics"],
  request: {
    query: z.object({
      organizationId: z.string().optional(),
      projectId: z.string().optional(),
      enabled: z.coerce.boolean().optional(),
    }),
  },
  responses: {
    200: {
      description: "List of budgets",
      content: {
        "application/json": {
          schema: BudgetListResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/cost-analytics/budgets/{budgetId}",
  summary: "Get budget",
  description: "Returns a specific budget by ID.",
  tags: ["Cost Analytics"],
  request: {
    params: z.object({
      budgetId: z.string(),
    }),
  },
  responses: {
    200: {
      description: "Budget details",
      content: {
        "application/json": {
          schema: BudgetResponseSchema,
        },
      },
    },
    404: {
      description: "Budget not found",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/cost-analytics/budgets/{budgetId}/status",
  summary: "Get budget status",
  description: "Returns current usage status for a budget.",
  tags: ["Cost Analytics"],
  request: {
    params: z.object({
      budgetId: z.string(),
    }),
  },
  responses: {
    200: {
      description: "Budget status",
      content: {
        "application/json": {
          schema: BudgetStatusResponseSchema,
        },
      },
    },
    404: {
      description: "Budget not found",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/cost-analytics/budget-alerts",
  summary: "List budget alerts",
  description: "Returns budget threshold alerts.",
  tags: ["Cost Analytics"],
  request: {
    query: z.object({
      budgetId: z.string().optional(),
      acknowledged: z.coerce.boolean().optional(),
      since: z.string().datetime().optional(),
      limit: z.coerce.number().int().optional(),
    }),
  },
  responses: {
    200: {
      description: "List of alerts",
      content: {
        "application/json": {
          schema: BudgetAlertListResponseSchema,
        },
      },
    },
  },
});

// Forecasts

registry.registerPath({
  method: "post",
  path: "/cost-analytics/forecasts",
  summary: "Generate forecast",
  description: "Generates a new cost forecast based on historical data.",
  tags: ["Cost Analytics"],
  request: {
    body: {
      required: false,
      content: {
        "application/json": {
          schema: ForecastOptionsSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Forecast generated",
      content: {
        "application/json": {
          schema: ForecastResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/cost-analytics/forecasts/latest",
  summary: "Get latest forecast",
  description: "Returns the most recent cost forecast.",
  tags: ["Cost Analytics"],
  request: {
    query: z.object({
      organizationId: z.string().optional(),
      projectId: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Latest forecast",
      content: {
        "application/json": {
          schema: ForecastResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/cost-analytics/forecasts/{forecastId}/scenarios",
  summary: "Get forecast scenarios",
  description: "Returns what-if scenarios for a forecast.",
  tags: ["Cost Analytics"],
  request: {
    params: z.object({
      forecastId: z.string(),
    }),
  },
  responses: {
    200: {
      description: "Forecast scenarios",
      content: {
        "application/json": {
          schema: z.object({
            object: z.literal("list"),
            data: z.array(ForecastScenarioSchema),
            total: z.number(),
          }),
        },
      },
    },
    404: {
      description: "Forecast not found",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
  },
});

// Recommendations

registry.registerPath({
  method: "get",
  path: "/cost-analytics/recommendations",
  summary: "List recommendations",
  description: "Returns cost optimization recommendations.",
  tags: ["Cost Analytics"],
  request: {
    query: z.object({
      organizationId: z.string().optional(),
      projectId: z.string().optional(),
      category: RecommendationCategorySchema.optional(),
      status: RecommendationStatusSchema.optional(),
      limit: z.coerce.number().int().optional(),
    }),
  },
  responses: {
    200: {
      description: "List of recommendations",
      content: {
        "application/json": {
          schema: RecommendationListResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/cost-analytics/recommendations/summary",
  summary: "Get optimization summary",
  description: "Returns aggregate optimization summary.",
  tags: ["Cost Analytics"],
  request: {
    query: z.object({
      organizationId: z.string().optional(),
      projectId: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Optimization summary",
      content: {
        "application/json": {
          schema: OptimizationSummaryResponseSchema,
        },
      },
    },
  },
});

// Rate Cards

registry.registerPath({
  method: "get",
  path: "/cost-analytics/rate-cards",
  summary: "List rate cards",
  description: "Returns all configured model rate cards.",
  tags: ["Cost Analytics"],
  responses: {
    200: {
      description: "List of rate cards",
      content: {
        "application/json": {
          schema: RateCardListResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/cost-analytics/rate-cards",
  summary: "Create/update rate card",
  description: "Creates or updates a model rate card.",
  tags: ["Cost Analytics"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: RateCardSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Rate card created/updated",
      content: {
        "application/json": {
          schema: z.object({
            object: z.literal("rateCard"),
            data: RateCardSchema,
          }),
        },
      },
    },
    400: {
      description: "Invalid input",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
  },
});

// ============================================================================
// Setup Routes
// ============================================================================

registry.registerPath({
  method: "get",
  path: "/setup/readiness",
  summary: "Get setup readiness status",
  description:
    "Returns comprehensive readiness status including detected agents, tools, manifest metadata, and recommendations. Results are cached for 60s by default.",
  tags: ["Setup"],
  request: {
    query: z.object({
      bypass_cache: z.coerce.boolean().optional().openapi({
        description: "Set to true to force fresh detection",
      }),
    }),
  },
  responses: {
    200: {
      description:
        "Readiness status with manifest metadata and recommendations",
      content: {
        "application/json": {
          schema: ReadinessStatusResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/setup/tools",
  summary: "List all known tools",
  description:
    "Returns information about all known tools from the ACFS manifest, including manifest-driven fields like tags, optional, enabledByDefault, and phase.",
  tags: ["Setup"],
  responses: {
    200: {
      description: "List of tool information",
      content: {
        "application/json": {
          schema: ToolInfoListResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/setup/tools/{name}",
  summary: "Get tool information",
  description:
    "Returns detailed information about a specific tool including its current detection status.",
  tags: ["Setup"],
  request: {
    params: z.object({
      name: z.string().openapi({
        description: "Tool name",
        example: "dcg",
      }),
    }),
  },
  responses: {
    200: {
      description: "Tool information with detection status",
      content: {
        "application/json": {
          schema: ToolInfoWithStatusResponseSchema,
        },
      },
    },
    404: {
      description: "Tool not found",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/setup/install",
  summary: "Install a tool",
  description:
    "Installs the specified tool with progress events sent via WebSocket. Installation is idempotent - if tool is already installed, returns success.",
  tags: ["Setup"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: SetupInstallRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Installation result",
      content: {
        "application/json": {
          schema: SetupInstallResultResponseSchema,
        },
      },
    },
    400: {
      description: "No automated installation available for this tool",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
    500: {
      description: "Installation failed",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/setup/install/batch",
  summary: "Install multiple tools",
  description:
    "Installs multiple tools sequentially with progress events. Can optionally stop on first error.",
  tags: ["Setup"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: SetupBatchInstallRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Batch installation results",
      content: {
        "application/json": {
          schema: SetupBatchInstallResultResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/setup/verify/{name}",
  summary: "Verify tool installation",
  description:
    "Forces a fresh detection of the specified tool to verify its installation status.",
  tags: ["Setup"],
  request: {
    params: z.object({
      name: z.string().openapi({
        description: "Tool name to verify",
      }),
    }),
  },
  responses: {
    200: {
      description: "Verification result",
      content: {
        "application/json": {
          schema: VerificationResultResponseSchema,
        },
      },
    },
    404: {
      description: "Tool not found",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "delete",
  path: "/setup/cache",
  summary: "Clear detection cache",
  description:
    "Clears the tool detection cache, forcing fresh detection on next readiness check.",
  tags: ["Setup"],
  responses: {
    200: {
      description: "Cache cleared",
      content: {
        "application/json": {
          schema: CacheClearedResultResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "delete",
  path: "/setup/registry/cache",
  summary: "Clear registry cache",
  description: "Clears the tool registry manifest cache.",
  tags: ["Setup"],
  responses: {
    200: {
      description: "Registry cache cleared",
      content: {
        "application/json": {
          schema: CacheClearedResultResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/setup/registry/refresh",
  summary: "Refresh tool registry",
  description:
    "Forces a reload of the ACFS tool registry manifest. Returns manifest metadata and tool count.",
  tags: ["Setup"],
  responses: {
    200: {
      description: "Registry refreshed with manifest metadata",
      content: {
        "application/json": {
          schema: RegistryRefreshResultResponseSchema,
        },
      },
    },
  },
});

// ============================================================================
// Beads (BR/BV) Routes
// ============================================================================

registry.registerPath({
  method: "get",
  path: "/beads",
  summary: "List beads",
  description:
    "Returns a list of beads with optional filtering. Supports status, type, assignee, label, and priority filters.",
  tags: ["Beads"],
  request: {
    query: ListBeadsQuerySchema,
  },
  responses: {
    200: {
      description: "List of beads",
      content: {
        "application/json": {
          schema: BeadListResponseSchema,
        },
      },
    },
    500: {
      description: "Server error",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/beads",
  summary: "Create a bead",
  description: "Creates a new bead (issue) with the specified properties.",
  tags: ["Beads"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: CreateBeadRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: "Bead created successfully",
      content: {
        "application/json": {
          schema: BeadResponseSchema,
        },
      },
    },
    400: {
      description: "Invalid request body",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/beads/{id}",
  summary: "Get bead details",
  description: "Returns detailed information about a specific bead.",
  tags: ["Beads"],
  request: {
    params: z.object({
      id: z.string().openapi({
        description: "Bead identifier",
        example: "bd-1abc",
      }),
    }),
  },
  responses: {
    200: {
      description: "Bead details",
      content: {
        "application/json": {
          schema: BeadResponseSchema,
        },
      },
    },
    404: {
      description: "Bead not found",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "patch",
  path: "/beads/{id}",
  summary: "Update a bead",
  description: "Updates the specified bead with new values.",
  tags: ["Beads"],
  request: {
    params: z.object({
      id: z.string().openapi({
        description: "Bead identifier",
      }),
    }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: UpdateBeadRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Bead updated",
      content: {
        "application/json": {
          schema: BeadResponseSchema,
        },
      },
    },
    404: {
      description: "Bead not found",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "delete",
  path: "/beads/{id}",
  summary: "Close a bead",
  description: "Closes the specified bead. Use query params for reason and force.",
  tags: ["Beads"],
  request: {
    params: z.object({
      id: z.string().openapi({
        description: "Bead identifier",
      }),
    }),
    query: z.object({
      reason: z.string().optional().openapi({
        description: "Reason for closing",
      }),
      force: z.enum(["true", "false"]).optional().openapi({
        description: "Force close even with open dependencies",
      }),
    }),
  },
  responses: {
    200: {
      description: "Bead closed",
      content: {
        "application/json": {
          schema: BeadResponseSchema,
        },
      },
    },
    404: {
      description: "Bead not found",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/beads/{id}/close",
  summary: "Close a bead (alternative)",
  description: "Alternative endpoint to close a bead with a request body.",
  tags: ["Beads"],
  request: {
    params: z.object({
      id: z.string().openapi({
        description: "Bead identifier",
      }),
    }),
    body: {
      required: false,
      content: {
        "application/json": {
          schema: CloseBeadRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Bead closed",
      content: {
        "application/json": {
          schema: BeadResponseSchema,
        },
      },
    },
    404: {
      description: "Bead not found",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/beads/{id}/claim",
  summary: "Claim a bead",
  description: "Claims the bead by setting status to in_progress.",
  tags: ["Beads"],
  request: {
    params: z.object({
      id: z.string().openapi({
        description: "Bead identifier",
      }),
    }),
  },
  responses: {
    200: {
      description: "Bead claimed",
      content: {
        "application/json": {
          schema: BeadResponseSchema,
        },
      },
    },
    404: {
      description: "Bead not found",
      content: {
        "application/json": {
          schema: ApiErrorResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/beads/list/ready",
  summary: "List ready beads",
  description: "Returns beads that are ready to work on (no blocking dependencies).",
  tags: ["Beads"],
  request: {
    query: z.object({
      limit: z.string().optional().openapi({
        description: "Max results",
      }),
      assignee: z.string().optional().openapi({
        description: "Filter by assignee",
      }),
      unassigned: z.enum(["true", "false"]).optional().openapi({
        description: "Only show unassigned",
      }),
      label: z.union([z.string(), z.array(z.string())]).optional().openapi({
        description: "Filter by label (can be repeated)",
      }),
      sort: z.enum(["hybrid", "priority", "oldest"]).optional().openapi({
        description: "Sort mode",
      }),
    }),
  },
  responses: {
    200: {
      description: "List of ready beads",
      content: {
        "application/json": {
          schema: BeadListResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/beads/triage",
  summary: "Get BV triage",
  description: "Returns BV triage recommendations, quick wins, and blockers to clear.",
  tags: ["Beads"],
  request: {
    query: z.object({
      limit: z.string().optional().openapi({
        description: "Limit recommendations",
      }),
      minScore: z.string().optional().openapi({
        description: "Minimum score threshold",
      }),
    }),
  },
  responses: {
    200: {
      description: "Triage results",
      content: {
        "application/json": {
          schema: BvTriageResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/beads/ready",
  summary: "Get BV quick wins",
  description: "Returns quick win beads identified by BV.",
  tags: ["Beads"],
  request: {
    query: z.object({
      limit: z.string().optional().openapi({
        description: "Max results",
      }),
    }),
  },
  responses: {
    200: {
      description: "Quick win beads",
      content: {
        "application/json": {
          schema: BeadListResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/beads/blocked",
  summary: "Get blockers to clear",
  description: "Returns beads that are blocking other work.",
  tags: ["Beads"],
  request: {
    query: z.object({
      limit: z.string().optional().openapi({
        description: "Max results",
      }),
    }),
  },
  responses: {
    200: {
      description: "Blocker beads",
      content: {
        "application/json": {
          schema: BeadListResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/beads/insights",
  summary: "Get BV insights",
  description: "Returns BV graph insights and analysis.",
  tags: ["Beads"],
  responses: {
    200: {
      description: "Insights data",
      content: {
        "application/json": {
          schema: BvInsightsResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/beads/plan",
  summary: "Get BV plan",
  description: "Returns BV execution plan.",
  tags: ["Beads"],
  responses: {
    200: {
      description: "Plan data",
      content: {
        "application/json": {
          schema: BvPlanResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/beads/graph",
  summary: "Get dependency graph",
  description: "Returns the bead dependency graph in various formats.",
  tags: ["Beads"],
  request: {
    query: z.object({
      format: z.enum(["json", "dot", "mermaid"]).optional().openapi({
        description: "Output format",
        default: "json",
      }),
      rootId: z.string().optional().openapi({
        description: "Root issue ID for subgraph",
      }),
      depth: z.string().optional().openapi({
        description: "Max depth (0 = unlimited)",
      }),
    }),
  },
  responses: {
    200: {
      description: "Graph data",
      content: {
        "application/json": {
          schema: BvGraphResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/beads/sync/status",
  summary: "Get sync status",
  description: "Returns the BR sync status (dirty count, timestamps).",
  tags: ["Beads"],
  responses: {
    200: {
      description: "Sync status",
      content: {
        "application/json": {
          schema: BrSyncStatusResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/beads/sync",
  summary: "Sync beads",
  description: "Runs br sync --flush-only to export changes to JSONL.",
  tags: ["Beads"],
  responses: {
    200: {
      description: "Sync completed",
      content: {
        "application/json": {
          schema: BrSyncResultResponseSchema,
        },
      },
    },
  },
});

// ============================================================================
// OpenAPI Document Generator
// ============================================================================

/**
 * Generate the complete OpenAPI 3.1 specification.
 * Returns an OpenAPI 3.1 document object.
 */
export function generateOpenAPISpec(): ReturnType<
  OpenApiGeneratorV31["generateDocument"]
> {
  const generator = new OpenApiGeneratorV31(registry.definitions);

  return generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "Flywheel Gateway API",
      version: "1.0.0",
      description: `
# Flywheel Gateway API

The Flywheel Gateway provides a unified REST API for managing AI agents,
sessions, checkpoints, and real-time coordination.

## Authentication

All endpoints require Bearer token authentication:

\`\`\`
Authorization: Bearer <your-api-key>
\`\`\`

## Rate Limiting

API requests are limited to 1000 requests per minute per API key.
Rate limit headers are included in all responses:

- \`X-RateLimit-Limit\`: Maximum requests per window
- \`X-RateLimit-Remaining\`: Remaining requests in current window
- \`X-RateLimit-Reset\`: Unix timestamp when the window resets

## Pagination

List endpoints use cursor-based pagination:

- \`limit\`: Number of items per page (1-100, default 20)
- \`cursor\`: Pagination cursor from previous response

Responses include \`hasMore\` and \`nextCursor\` for navigation.

## Error Handling

All errors follow a consistent structure with:
- \`code\`: Machine-readable error code
- \`message\`: Human-readable description
- \`hint\`: Suggested action for AI agents
- \`severity\`: Error severity (terminal, recoverable, retry)

## WebSocket API

Real-time updates are available via WebSocket at \`/ws\`.

### Connection

\`\`\`javascript
const ws = new WebSocket('wss://gateway.example.com/ws');
ws.onopen = () => {
  ws.send(JSON.stringify({ type: 'subscribe', channels: ['agent:state:agent_123'] }));
};
\`\`\`

### Channel Patterns

| Channel Pattern | Description |
|-----------------|-------------|
| \`agent:state:{agentId}\` | Lifecycle state changes |
| \`agent:output:{agentId}\` | Streaming output chunks |
| \`agent:tools:{agentId}\` | Tool call events |
| \`ntm:state\` | NTM session/agent state changes |
| \`ntm:health\` | NTM health status changes |
| \`ntm:alerts\` | NTM alert events |
| \`dcg:blocks\` | DCG block events |
| \`dcg:config\` | DCG configuration changes |
| \`beads:updates\` | Bead CRUD events |
| \`setup:install:progress\` | Installation progress |
| \`session:{sessionId}\` | Session-specific events |

### Message Format

\`\`\`json
{
  "channel": "agent:state:agent_123",
  "type": "state_changed",
  "data": { "previousState": "ready", "newState": "executing" },
  "cursor": "cursor_abc123",
  "timestamp": "2026-01-22T10:00:00.123Z"
}
\`\`\`

### Reconnection

On reconnect, send the last received cursor to catch up on missed messages:

\`\`\`json
{ "type": "subscribe", "channels": ["agent:output:agent_123"], "cursor": "cursor_abc123" }
\`\`\`

See \`/docs/robot-mode-api.md\` for complete WebSocket documentation.
      `.trim(),
      contact: {
        name: "Flywheel Gateway Support",
        email: "support@flywheel.dev",
      },
      license: {
        name: "MIT",
        url: "https://opensource.org/licenses/MIT",
      },
    },
    servers: [
      {
        url: "http://localhost:3000",
        description: "Local development",
      },
      {
        url: "https://api.flywheel.dev/v1",
        description: "Production",
      },
    ],
    tags: [
      {
        name: "System",
        description: "System health and status endpoints",
      },
      {
        name: "Setup",
        description:
          "Setup wizard endpoints for tool detection, installation, and registry management. Uses ACFS manifest for tool metadata.",
      },
      {
        name: "Agents",
        description: "Agent lifecycle and communication",
      },
      {
        name: "Beads",
        description:
          "Issue tracking with BR (beads_rust) and BV (bead viewer) integration. Supports CRUD operations, triage, graph analysis, and sync.",
      },
      {
        name: "Checkpoints",
        description: "Agent state checkpoints for rollback",
      },
      {
        name: "Reservations",
        description: "File reservation to prevent edit conflicts",
      },
      {
        name: "Conflicts",
        description: "Conflict detection and resolution",
      },
      {
        name: "Notifications",
        description: "User notification management",
      },
      {
        name: "Pipelines",
        description: "Multi-step agent orchestration pipelines",
      },
      {
        name: "Dashboards",
        description: "Custom dashboard builder with drag-and-drop widgets",
      },
      {
        name: "Cost Analytics",
        description:
          "Cost tracking, budgets, forecasting, and optimization recommendations",
      },
    ],
    security: [
      {
        bearerAuth: [],
      },
    ],
  });
}

/**
 * Get OpenAPI spec as formatted JSON string.
 */
export function getOpenAPISpecJson(): string {
  return JSON.stringify(generateOpenAPISpec(), null, 2);
}
