/**
 * Collaboration Graph Bridge Service.
 *
 * Bridges graph events from control_plane to the WebSocket hub.
 * Connects to control_plane's SSE stream and republishes events.
 */

import type { GraphEventsService } from "./graph-events";
import { logger } from "./logger";

/**
 * Control plane event structure (from /collaboration/events)
 */
interface ControlPlaneEvent {
  type:
    | "node_added"
    | "node_removed"
    | "node_updated"
    | "edge_added"
    | "edge_removed"
    | "edge_updated"
    | "full_refresh";
  node?: {
    id: string;
    type: "agent" | "file" | "bead";
    data: Record<string, unknown>;
    status: "active" | "idle" | "conflict" | "paused";
  };
  edge?: {
    id: string;
    source: string;
    target: string;
    type: "reservation" | "handoff" | "message" | "dependency" | "conflict";
    animated?: boolean;
    label?: string;
    metadata?: Record<string, unknown>;
  };
  stats?: {
    totalNodes: number;
    nodesByType: Record<string, number>;
    totalEdges: number;
    edgesByType: Record<string, number>;
    activeAgents: number;
    conflictCount: number;
    pendingHandoffs: number;
    activeMessages: number;
  };
  timestamp: string;
  version: number;
}

/**
 * Configuration for the graph bridge service
 */
export interface GraphBridgeConfig {
  /** Control plane base URL */
  controlPlaneUrl: string;
  /** API key for control plane authentication */
  apiKey: string;
  /** Default workspace ID to publish events to */
  defaultWorkspaceId: string;
  /** Polling interval in ms (fallback if SSE fails) */
  pollIntervalMs?: number;
  /** Whether to use SSE or polling */
  useSSE?: boolean;
}

/**
 * Graph bridge service for connecting control_plane to WebSocket hub.
 */
export class GraphBridgeService {
  private config: GraphBridgeConfig;
  private graphEvents: GraphEventsService | null = null;
  private abortController: AbortController | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private lastVersion = 0;
  private isRunning = false;

  constructor(config: GraphBridgeConfig) {
    this.config = {
      pollIntervalMs: 1000,
      useSSE: true,
      ...config,
    };
  }

  /**
   * Start the bridge service.
   * Connects to control_plane and starts forwarding events.
   */
  async start(graphEvents: GraphEventsService): Promise<void> {
    if (this.isRunning) {
      logger.warn("[GRAPH-BRIDGE] Already running");
      return;
    }

    this.graphEvents = graphEvents;
    this.isRunning = true;

    logger.info(
      {
        controlPlaneUrl: this.config.controlPlaneUrl,
        useSSE: this.config.useSSE,
      },
      "[GRAPH-BRIDGE] Starting bridge service",
    );

    if (this.config.useSSE) {
      await this.startSSE();
    } else {
      this.startPolling();
    }
  }

  /**
   * Stop the bridge service.
   */
  stop(): void {
    this.isRunning = false;

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    logger.info("[GRAPH-BRIDGE] Stopped");
  }

  /**
   * Start SSE connection to control_plane.
   */
  private async startSSE(): Promise<void> {
    const url = `${this.config.controlPlaneUrl}/collaboration/events/stream`;

    while (this.isRunning) {
      try {
        this.abortController = new AbortController();

        logger.debug({ url }, "[GRAPH-BRIDGE] Connecting to SSE stream");

        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            Accept: "text/event-stream",
          },
          signal: this.abortController.signal,
        });

        if (!response.ok) {
          throw new Error(`SSE connection failed: ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("No response body");
        }

        const decoder = new TextDecoder();
        let buffer = "";

        while (this.isRunning) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Parse SSE events from buffer
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              try {
                const event = JSON.parse(data) as ControlPlaneEvent;
                this.handleEvent(event);
              } catch (e) {
                logger.warn(
                  { data, error: e },
                  "[GRAPH-BRIDGE] Failed to parse SSE event",
                );
              }
            }
          }
        }
      } catch (error) {
        if (!this.isRunning) return;

        logger.error(
          { error },
          "[GRAPH-BRIDGE] SSE connection error, falling back to polling",
        );

        // Fall back to polling
        this.startPolling();
        return;
      }
    }
  }

  /**
   * Start polling control_plane for events.
   */
  private startPolling(): void {
    if (this.pollInterval) return;

    logger.info(
      { interval: this.config.pollIntervalMs },
      "[GRAPH-BRIDGE] Starting polling mode",
    );

    this.pollInterval = setInterval(async () => {
      if (!this.isRunning) return;
      await this.pollEvents();
    }, this.config.pollIntervalMs);
    // Ensure interval doesn't prevent process exit
    if (this.pollInterval.unref) {
      this.pollInterval.unref();
    }

    // Initial poll
    this.pollEvents();
  }

  /**
   * Poll control_plane for events since last version.
   */
  private async pollEvents(): Promise<void> {
    try {
      const url = `${this.config.controlPlaneUrl}/collaboration/events?sinceVersion=${this.lastVersion}`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Poll failed: ${response.status}`);
      }

      const json = (await response.json()) as {
        data: {
          data: ControlPlaneEvent[];
          currentVersion: number;
        };
      };

      for (const event of json.data.data) {
        this.handleEvent(event);
      }

      this.lastVersion = json.data.currentVersion;
    } catch (error) {
      logger.warn({ error }, "[GRAPH-BRIDGE] Poll failed");
    }
  }

  /**
   * Handle an event from control_plane.
   */
  private handleEvent(event: ControlPlaneEvent): void {
    if (!this.graphEvents) return;

    const workspaceId = this.config.defaultWorkspaceId;

    logger.debug(
      { type: event.type, version: event.version },
      "[GRAPH-BRIDGE] Received event",
    );

    // Update our version tracker
    if (event.version > this.lastVersion) {
      this.lastVersion = event.version;
    }

    // Transform and forward event
    switch (event.type) {
      case "node_added":
        if (event.node) {
          this.graphEvents.publishNodeAdded(workspaceId, {
            id: event.node.id,
            type: event.node.type,
            label: (event.node.data?.["label"] as string) ?? event.node.id,
            status: event.node.status,
            data: event.node.data,
          });
        }
        break;

      case "node_removed":
        if (event.node) {
          this.graphEvents.publishNodeRemoved(
            workspaceId,
            event.node.id,
            event.node.type,
          );
        }
        break;

      case "node_updated":
        if (event.node) {
          this.graphEvents.publishNodeUpdated(workspaceId, {
            id: event.node.id,
            type: event.node.type,
            label: (event.node.data?.["label"] as string) ?? event.node.id,
            status: event.node.status,
            data: event.node.data,
          });
        }
        break;

      case "edge_added":
        if (event.edge) {
          const edgeAddedPayload: {
            id: string;
            source: string;
            target: string;
            type:
              | "reservation"
              | "handoff"
              | "message"
              | "dependency"
              | "conflict";
            animated?: boolean;
            label?: string;
            metadata?: Record<string, unknown>;
          } = {
            id: event.edge.id,
            source: event.edge.source,
            target: event.edge.target,
            type: event.edge.type,
          };
          if (event.edge.animated !== undefined)
            edgeAddedPayload.animated = event.edge.animated;
          if (event.edge.label) edgeAddedPayload.label = event.edge.label;
          if (event.edge.metadata)
            edgeAddedPayload.metadata = event.edge.metadata;
          this.graphEvents.publishEdgeAdded(workspaceId, edgeAddedPayload);
        }
        break;

      case "edge_removed":
        if (event.edge) {
          this.graphEvents.publishEdgeRemoved(
            workspaceId,
            event.edge.id,
            event.edge.type,
          );
        }
        break;

      case "edge_updated":
        if (event.edge) {
          const edgeUpdatedPayload: {
            id: string;
            source: string;
            target: string;
            type:
              | "reservation"
              | "handoff"
              | "message"
              | "dependency"
              | "conflict";
            animated?: boolean;
            label?: string;
            metadata?: Record<string, unknown>;
          } = {
            id: event.edge.id,
            source: event.edge.source,
            target: event.edge.target,
            type: event.edge.type,
          };
          if (event.edge.animated !== undefined)
            edgeUpdatedPayload.animated = event.edge.animated;
          if (event.edge.label) edgeUpdatedPayload.label = event.edge.label;
          if (event.edge.metadata)
            edgeUpdatedPayload.metadata = event.edge.metadata;
          this.graphEvents.publishEdgeUpdated(workspaceId, edgeUpdatedPayload);
        }
        break;

      case "full_refresh":
        this.graphEvents.publishFullRefresh(
          workspaceId,
          event.stats
            ? {
                totalNodes: event.stats.totalNodes,
                nodesByType: event.stats.nodesByType as Record<
                  "agent" | "file" | "bead",
                  number
                >,
                totalEdges: event.stats.totalEdges,
                edgesByType: event.stats.edgesByType as Record<
                  | "reservation"
                  | "handoff"
                  | "message"
                  | "dependency"
                  | "conflict",
                  number
                >,
                activeAgents: event.stats.activeAgents,
                conflictCount: event.stats.conflictCount,
                pendingHandoffs: event.stats.pendingHandoffs,
                activeMessages: event.stats.activeMessages,
              }
            : undefined,
        );
        break;

      default:
        logger.warn({ type: event.type }, "[GRAPH-BRIDGE] Unknown event type");
    }
  }
}

// Singleton instance
let serviceInstance: GraphBridgeService | undefined;

/**
 * Get or create the graph bridge service singleton.
 */
export function getGraphBridgeService(
  config?: GraphBridgeConfig,
): GraphBridgeService {
  if (!serviceInstance) {
    if (!config) {
      throw new Error("GraphBridgeService requires config on first init");
    }
    serviceInstance = new GraphBridgeService(config);
  }
  return serviceInstance;
}

/**
 * Reset the graph bridge service (for testing).
 */
export function resetGraphBridgeService(): void {
  if (serviceInstance) {
    serviceInstance.stop();
  }
  serviceInstance = undefined;
}
