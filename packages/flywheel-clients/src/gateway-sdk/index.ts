/**
 * Type-Safe Gateway Client SDK (`bd-62hcq` / `bd-3ix6h` / `bd-2bacm` / `bd-ng6he` / `bd-rx9gg`)
 *
 * Provides a typed HTTP + SSE client for Flywheel Gateway with:
 * - Structured error handling (`GatewaySdkError` preserving status, code, correlationId, traceId)
 * - Typed query, mutation, and Server-Sent Events (SSE) streaming helpers
 */

export interface GatewaySdkConfig {
  baseUrl: string;
  token?: string;
  fetch?: typeof fetch;
}

export interface GatewayRequestOptions {
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export interface GatewayHealthResponse {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp?: string;
  version?: string;
}

export interface GatewayRoutingEvaluateInput {
  agentId?: string;
  workspaceId?: string;
  taskType?: string;
  contextHeadroomPercent?: number;
  defaultProvider?: "anthropic" | "openai" | "google" | "local";
  defaultModel?: string;
}

export interface GatewayRoutingDecision {
  id: string;
  policyId: string | null;
  policyName: string | null;
  provider: string;
  model: string;
  failoverCount: number;
  steps: Array<{
    candidate: string;
    outcome: string;
    reason: string;
  }>;
  createdAt: string;
}

export interface GatewayPublishEventInput {
  type: string;
  source?: string;
  payload: Record<string, unknown>;
}

export interface GatewayStreamEvent {
  id: string;
  seq: number;
  version: string;
  type: string;
  source: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface GatewayPublishEventResponse {
  event: GatewayStreamEvent;
  receipts: unknown[];
}

export class GatewaySdkError extends Error {
  readonly status: number;
  readonly code: string;
  readonly correlationId: string | undefined;
  readonly traceId: string | undefined;
  readonly details: unknown;

  constructor(params: {
    message: string;
    status: number;
    code: string;
    correlationId?: string | undefined;
    traceId?: string | undefined;
    details?: unknown;
  }) {
    super(params.message);
    this.name = "GatewaySdkError";
    this.status = params.status;
    this.code = params.code;
    this.correlationId = params.correlationId;
    this.traceId = params.traceId;
    this.details = params.details;
  }
}

export class GatewaySdkClient {
  private readonly baseUrl: string;
  private readonly token: string | undefined;
  private readonly fetchFn: typeof fetch;

  constructor(config: GatewaySdkConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.token = config.token;
    this.fetchFn = config.fetch ?? globalThis.fetch;
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: GatewayRequestOptions,
  ): Promise<T> {
    const headers: Record<string, string> = {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...options?.headers,
    };

    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const response = await this.fetchFn(`${this.baseUrl}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
    });

    const correlationId =
      response.headers.get("x-correlation-id") ??
      response.headers.get("x-request-id") ??
      undefined;
    const traceId = response.headers.get("x-trace-id") ?? undefined;

    if (!response.ok) {
      const errBody = (await response.json().catch(() => null)) as Record<
        string,
        unknown
      > | null;
      const errObj =
        errBody && typeof errBody["error"] === "object" && errBody["error"]
          ? (errBody["error"] as Record<string, unknown>)
          : errBody;
      const code =
        typeof errObj?.["code"] === "string"
          ? errObj["code"]
          : `HTTP_${response.status}`;
      const message =
        typeof errObj?.["message"] === "string"
          ? errObj["message"]
          : `Request failed with status ${response.status}`;

      throw new GatewaySdkError({
        message,
        status: response.status,
        code,
        correlationId,
        traceId,
        details: errObj?.["details"],
      });
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const json = (await response.json()) as Record<string, unknown>;
    if (
      json &&
      typeof json === "object" &&
      "data" in json &&
      ("object" in json || "requestId" in json)
    ) {
      return json["data"] as T;
    }
    return json as T;
  }

  /** GET /health */
  async health(
    options?: GatewayRequestOptions,
  ): Promise<GatewayHealthResponse> {
    return this.request<GatewayHealthResponse>(
      "GET",
      "/health",
      undefined,
      options,
    );
  }

  /** GET /agents */
  async listAgents(
    params?: { status?: string; limit?: number },
    options?: GatewayRequestOptions,
  ): Promise<unknown> {
    const query = params
      ? new URLSearchParams(
          Object.entries(params)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => [k, String(v)]),
        ).toString()
      : "";
    const path = `/agents${query ? `?${query}` : ""}`;
    return this.request("GET", path, undefined, options);
  }

  /** POST /routing/evaluate */
  async evaluateRouting(
    input: GatewayRoutingEvaluateInput,
    options?: GatewayRequestOptions,
  ): Promise<GatewayRoutingDecision> {
    return this.request<GatewayRoutingDecision>(
      "POST",
      "/routing/evaluate",
      input,
      options,
    );
  }

  /** POST /events/publish */
  async publishEvent(
    input: GatewayPublishEventInput,
    options?: GatewayRequestOptions,
  ): Promise<GatewayPublishEventResponse> {
    return this.request<GatewayPublishEventResponse>(
      "POST",
      "/events/publish",
      input,
      options,
    );
  }

  /** GET /events/stream (SSE) */
  async *streamEvents(
    params?: { types?: string; sinceSeq?: number },
    options?: GatewayRequestOptions,
  ): AsyncGenerator<GatewayStreamEvent> {
    const query = params
      ? new URLSearchParams(
          Object.entries(params)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => [k, String(v)]),
        ).toString()
      : "";
    const path = `/events/stream${query ? `?${query}` : ""}`;

    const headers: Record<string, string> = {
      Accept: "text/event-stream",
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      ...options?.headers,
    };

    const response = await this.fetchFn(`${this.baseUrl}${path}`, {
      method: "GET",
      headers,
      ...(options?.signal ? { signal: options.signal } : {}),
    });

    if (!response.ok) {
      throw new GatewaySdkError({
        message: `SSE stream failed with status ${response.status}`,
        status: response.status,
        code: `HTTP_${response.status}`,
      });
    }

    if (!response.body) {
      throw new GatewaySdkError({
        message: "No response body for SSE stream",
        status: 500,
        code: "STREAM_EMPTY",
      });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          yield JSON.parse(line.slice(6)) as GatewayStreamEvent;
        }
      }
    }
    if (buffer.startsWith("data: ")) {
      yield JSON.parse(buffer.slice(6)) as GatewayStreamEvent;
    }
  }

  /** GET /sessions/checkpoints */
  async listCheckpoints(
    params?: { agentId?: string; limit?: number },
    options?: GatewayRequestOptions,
  ): Promise<{ checkpoints: Array<Record<string, unknown>> }> {
    const query = params
      ? new URLSearchParams(
          Object.entries(params)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => [k, String(v)]),
        ).toString()
      : "";
    return this.request(
      "GET",
      `/sessions/checkpoints${query ? `?${query}` : ""}`,
      undefined,
      options,
    );
  }

  /** POST /sessions/:agentId/checkpoints/compact */
  async compactCheckpoints(
    agentId: string,
    body?: { dryRun?: boolean },
    options?: GatewayRequestOptions,
  ): Promise<Record<string, unknown>> {
    return this.request(
      "POST",
      `/sessions/${encodeURIComponent(agentId)}/checkpoints/compact`,
      body ?? {},
      options,
    );
  }

  /** GET /sessions/:sessionId/context/rotation */
  async getContextRotationStatus(
    sessionId: string,
    params?: { maxTokens?: number },
    options?: GatewayRequestOptions,
  ): Promise<Record<string, unknown>> {
    const query = params?.maxTokens ? `?maxTokens=${params.maxTokens}` : "";
    return this.request(
      "GET",
      `/sessions/${encodeURIComponent(sessionId)}/context/rotation${query}`,
      undefined,
      options,
    );
  }

  /** POST /sessions/:sessionId/context/rotate */
  async rotateContext(
    sessionId: string,
    body?: { reason?: string; maxTokens?: number },
    options?: GatewayRequestOptions,
  ): Promise<Record<string, unknown>> {
    return this.request(
      "POST",
      `/sessions/${encodeURIComponent(sessionId)}/context/rotate`,
      body ?? {},
      options,
    );
  }

  /** GET /safety/approvals */
  async listApprovals(
    params?: { status?: string; agentId?: string },
    options?: GatewayRequestOptions,
  ): Promise<Record<string, unknown>> {
    const query = params
      ? new URLSearchParams(
          Object.entries(params)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => [k, String(v)]),
        ).toString()
      : "";
    return this.request(
      "GET",
      `/safety/approvals${query ? `?${query}` : ""}`,
      undefined,
      options,
    );
  }

  /** POST /safety/approvals */
  async createApproval(
    body: {
      agentId: string;
      sessionId: string;
      workspaceId: string;
      operation: string;
      description: string;
      details?: Record<string, unknown>;
    },
    options?: GatewayRequestOptions,
  ): Promise<Record<string, unknown>> {
    return this.request("POST", "/safety/approvals", body, options);
  }

  /** POST /safety/approvals/:requestId/decide */
  async decideApproval(
    requestId: string,
    body: {
      decision: "approved" | "denied";
      decidedBy: string;
      reason?: string;
    },
    options?: GatewayRequestOptions,
  ): Promise<Record<string, unknown>> {
    return this.request(
      "POST",
      `/safety/approvals/${encodeURIComponent(requestId)}/decide`,
      body,
      options,
    );
  }

  /** GET /conflicts/git/sync-stats */
  async getGitCoordStatus(
    params?: { repositoryId?: string },
    options?: GatewayRequestOptions,
  ): Promise<Record<string, unknown>> {
    const query = params?.repositoryId
      ? `?repositoryId=${encodeURIComponent(params.repositoryId)}`
      : "";
    return this.request(
      "GET",
      `/conflicts/git/sync-stats${query}`,
      undefined,
      options,
    );
  }

  /** GET /conflicts/git/branches/:repositoryId */
  async listGitActiveConflicts(
    params: { repositoryId: string },
    options?: GatewayRequestOptions,
  ): Promise<Record<string, unknown>> {
    return this.request(
      "GET",
      `/conflicts/git/branches/${encodeURIComponent(params.repositoryId)}`,
      undefined,
      options,
    );
  }

  /** GET /ru/sync/stats */
  async getRuSyncStatus(
    options?: GatewayRequestOptions,
  ): Promise<Record<string, unknown>> {
    return this.request("GET", "/ru/sync/stats", undefined, options);
  }

  /** GET /ru/sync/history */
  async listRuSyncHistory(
    params?: { limit?: number },
    options?: GatewayRequestOptions,
  ): Promise<Record<string, unknown>> {
    const query = params?.limit ? `?limit=${params.limit}` : "";
    return this.request("GET", `/ru/sync/history${query}`, undefined, options);
  }

  /** GET /setup/install-plan */
  async getSetupInstallPlan(
    params?: { platform?: "linux" | "darwin" | "win32" },
    options?: GatewayRequestOptions,
  ): Promise<Record<string, unknown>> {
    const query = params?.platform ? `?platform=${params.platform}` : "";
    return this.request(
      "GET",
      `/setup/install-plan${query}`,
      undefined,
      options,
    );
  }

  /** GET /setup/compatibility */
  async getSetupCompatibility(
    params?: { version?: string },
    options?: GatewayRequestOptions,
  ): Promise<Record<string, unknown>> {
    const query = params?.version
      ? `?version=${encodeURIComponent(params.version)}`
      : "";
    return this.request(
      "GET",
      `/setup/compatibility${query}`,
      undefined,
      options,
    );
  }

  /** GET /feature-flags */
  async listFeatureFlags(
    options?: GatewayRequestOptions,
  ): Promise<Record<string, unknown>> {
    return this.request("GET", "/feature-flags", undefined, options);
  }

  /** POST /feature-flags/:key/evaluate */
  async evaluateFeatureFlag(
    key: string,
    body: { workspaceId?: string; actorId?: string },
    options?: GatewayRequestOptions,
  ): Promise<Record<string, unknown>> {
    return this.request(
      "POST",
      `/feature-flags/${encodeURIComponent(key)}/evaluate`,
      body,
      options,
    );
  }

  /** GET /cost-caps */
  async listCostCaps(
    options?: GatewayRequestOptions,
  ): Promise<Record<string, unknown>> {
    return this.request("GET", "/cost-caps", undefined, options);
  }

  /** POST /cost-caps/evaluate */
  async evaluateCostCap(
    body: {
      workspaceId: string;
      requestedModel: string;
      isEssentialSafetyOrMaintenance?: boolean;
    },
    options?: GatewayRequestOptions,
  ): Promise<Record<string, unknown>> {
    return this.request("POST", "/cost-caps/evaluate", body, options);
  }

  /** GET /routing/policies */
  async listRoutingPolicies(
    options?: GatewayRequestOptions,
  ): Promise<Record<string, unknown>> {
    return this.request("GET", "/routing/policies", undefined, options);
  }

  /** GET /slo/status */
  async listSlos(options?: GatewayRequestOptions): Promise<unknown> {
    return this.request("GET", "/slo/status", undefined, options);
  }

  /** GET /runbooks */
  async listRunbooks(
    params?: { category?: string },
    options?: GatewayRequestOptions,
  ): Promise<Record<string, unknown>> {
    const query = params?.category
      ? `?category=${encodeURIComponent(params.category)}`
      : "";
    return this.request("GET", `/runbooks${query}`, undefined, options);
  }

  /** GET /system/maintenance */
  async getMaintenanceStatus(
    options?: GatewayRequestOptions,
  ): Promise<Record<string, unknown>> {
    return this.request("GET", "/system/maintenance", undefined, options);
  }

  /** POST /system/maintenance */
  async updateMaintenanceMode(
    body: {
      enabled: boolean;
      deadlineSeconds?: number;
      reason?: string;
      actor?: string;
    },
    options?: GatewayRequestOptions,
  ): Promise<Record<string, unknown>> {
    return this.request("POST", "/system/maintenance", body, options);
  }

  /** GET /audit/redaction */
  async getAuditRedaction(
    options?: GatewayRequestOptions,
  ): Promise<Record<string, unknown>> {
    return this.request("GET", "/audit/redaction", undefined, options);
  }

  /** GET /circuits */
  async listCircuits(
    options?: GatewayRequestOptions,
  ): Promise<Record<string, unknown>> {
    return this.request("GET", "/circuits", undefined, options);
  }

  /** GET /ws-replay/stats */
  async getWsReplayStats(
    options?: GatewayRequestOptions,
  ): Promise<Record<string, unknown>> {
    return this.request("GET", "/ws-replay/stats", undefined, options);
  }

  /** GET /collaboration/bridge/status */
  async getCollaborationBridgeStatus(
    options?: GatewayRequestOptions,
  ): Promise<Record<string, unknown>> {
    return this.request(
      "GET",
      "/collaboration/bridge/status",
      undefined,
      options,
    );
  }
}
