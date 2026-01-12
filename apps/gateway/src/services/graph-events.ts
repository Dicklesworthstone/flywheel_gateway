/**
 * Collaboration Graph Events Service.
 *
 * Publishes real-time collaboration graph updates to WebSocket subscribers.
 * The graph shows agents, files, handoffs, and their relationships.
 */

import type { WebSocketHub } from "../ws/hub";
import type { MessageMetadata } from "../ws/messages";
import { logger } from "./logger";

/**
 * Types of graph update events.
 */
export type GraphUpdateType =
  | "node_added"
  | "node_removed"
  | "node_updated"
  | "edge_added"
  | "edge_removed"
  | "edge_updated"
  | "full_refresh";

/**
 * Graph node types.
 */
export type GraphNodeType = "agent" | "file" | "bead";

/**
 * Graph edge types.
 */
export type GraphEdgeType =
  | "reservation"
  | "handoff"
  | "message"
  | "dependency"
  | "conflict";

/**
 * Graph node payload for WebSocket events.
 */
export interface GraphNodePayload {
  /** Node ID (e.g., "agent:abc123" or "file:/path/to/file") */
  id: string;
  /** Node type */
  type: GraphNodeType;
  /** Node label for display */
  label: string;
  /** Node status */
  status: "active" | "idle" | "conflict" | "paused";
  /** Additional data based on node type */
  data: Record<string, unknown>;
}

/**
 * Graph edge payload for WebSocket events.
 */
export interface GraphEdgePayload {
  /** Edge ID */
  id: string;
  /** Source node ID */
  source: string;
  /** Target node ID */
  target: string;
  /** Edge type */
  type: GraphEdgeType;
  /** Whether to animate the edge */
  animated?: boolean;
  /** Edge label */
  label?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Graph statistics payload.
 */
export interface GraphStatsPayload {
  /** Total number of nodes */
  totalNodes: number;
  /** Nodes by type */
  nodesByType: Record<GraphNodeType, number>;
  /** Total number of edges */
  totalEdges: number;
  /** Edges by type */
  edgesByType: Record<GraphEdgeType, number>;
  /** Number of active agents */
  activeAgents: number;
  /** Number of conflicts */
  conflictCount: number;
  /** Number of pending handoffs */
  pendingHandoffs: number;
  /** Number of active messages (last hour) */
  activeMessages: number;
}

/**
 * Graph update event payload for WebSocket.
 */
export interface GraphUpdatePayload {
  /** Update type */
  updateType: GraphUpdateType;
  /** Affected node (for node events) */
  node?: GraphNodePayload;
  /** Affected edge (for edge events) */
  edge?: GraphEdgePayload;
  /** Updated statistics */
  stats?: GraphStatsPayload;
  /** Graph version for cache invalidation */
  version: number;
  /** Event timestamp */
  timestamp: string;
}

/**
 * Graph events service for publishing collaboration graph WebSocket events.
 */
export class GraphEventsService {
  private version = 1;

  constructor(private hub: WebSocketHub) {}

  /**
   * Get current graph version.
   */
  getVersion(): number {
    return this.version;
  }

  /**
   * Increment graph version (call when graph changes).
   */
  incrementVersion(): number {
    this.version++;
    return this.version;
  }

  /**
   * Publish a node added event.
   */
  publishNodeAdded(
    workspaceId: string,
    node: GraphNodePayload,
    stats?: GraphStatsPayload,
    metadata?: MessageMetadata,
  ): void {
    this.publishGraphUpdate(
      workspaceId,
      {
        updateType: "node_added",
        node,
        stats,
        version: this.incrementVersion(),
        timestamp: new Date().toISOString(),
      },
      metadata,
    );

    logger.debug(
      { workspaceId, nodeId: node.id, nodeType: node.type },
      "[GRAPH] Node added",
    );
  }

  /**
   * Publish a node removed event.
   */
  publishNodeRemoved(
    workspaceId: string,
    nodeId: string,
    nodeType: GraphNodeType,
    stats?: GraphStatsPayload,
    metadata?: MessageMetadata,
  ): void {
    this.publishGraphUpdate(
      workspaceId,
      {
        updateType: "node_removed",
        node: {
          id: nodeId,
          type: nodeType,
          label: "",
          status: "idle",
          data: {},
        },
        stats,
        version: this.incrementVersion(),
        timestamp: new Date().toISOString(),
      },
      metadata,
    );

    logger.debug({ workspaceId, nodeId, nodeType }, "[GRAPH] Node removed");
  }

  /**
   * Publish a node updated event.
   */
  publishNodeUpdated(
    workspaceId: string,
    node: GraphNodePayload,
    stats?: GraphStatsPayload,
    metadata?: MessageMetadata,
  ): void {
    this.publishGraphUpdate(
      workspaceId,
      {
        updateType: "node_updated",
        node,
        stats,
        version: this.incrementVersion(),
        timestamp: new Date().toISOString(),
      },
      metadata,
    );

    logger.debug(
      { workspaceId, nodeId: node.id, nodeType: node.type },
      "[GRAPH] Node updated",
    );
  }

  /**
   * Publish an edge added event.
   */
  publishEdgeAdded(
    workspaceId: string,
    edge: GraphEdgePayload,
    stats?: GraphStatsPayload,
    metadata?: MessageMetadata,
  ): void {
    this.publishGraphUpdate(
      workspaceId,
      {
        updateType: "edge_added",
        edge,
        stats,
        version: this.incrementVersion(),
        timestamp: new Date().toISOString(),
      },
      metadata,
    );

    logger.debug(
      { workspaceId, edgeId: edge.id, edgeType: edge.type },
      "[GRAPH] Edge added",
    );
  }

  /**
   * Publish an edge removed event.
   */
  publishEdgeRemoved(
    workspaceId: string,
    edgeId: string,
    edgeType: GraphEdgeType,
    stats?: GraphStatsPayload,
    metadata?: MessageMetadata,
  ): void {
    this.publishGraphUpdate(
      workspaceId,
      {
        updateType: "edge_removed",
        edge: {
          id: edgeId,
          source: "",
          target: "",
          type: edgeType,
        },
        stats,
        version: this.incrementVersion(),
        timestamp: new Date().toISOString(),
      },
      metadata,
    );

    logger.debug({ workspaceId, edgeId, edgeType }, "[GRAPH] Edge removed");
  }

  /**
   * Publish an edge updated event.
   */
  publishEdgeUpdated(
    workspaceId: string,
    edge: GraphEdgePayload,
    stats?: GraphStatsPayload,
    metadata?: MessageMetadata,
  ): void {
    this.publishGraphUpdate(
      workspaceId,
      {
        updateType: "edge_updated",
        edge,
        stats,
        version: this.incrementVersion(),
        timestamp: new Date().toISOString(),
      },
      metadata,
    );

    logger.debug(
      { workspaceId, edgeId: edge.id, edgeType: edge.type },
      "[GRAPH] Edge updated",
    );
  }

  /**
   * Publish a full graph refresh event.
   * Used when the graph has changed significantly and clients should refetch.
   */
  publishFullRefresh(
    workspaceId: string,
    stats?: GraphStatsPayload,
    metadata?: MessageMetadata,
  ): void {
    this.publishGraphUpdate(
      workspaceId,
      {
        updateType: "full_refresh",
        stats,
        version: this.incrementVersion(),
        timestamp: new Date().toISOString(),
      },
      metadata,
    );

    logger.info({ workspaceId }, "[GRAPH] Full refresh published");
  }

  /**
   * Publish a stats-only update.
   * Useful for periodic stats updates without specific node/edge changes.
   */
  publishStatsUpdate(
    workspaceId: string,
    stats: GraphStatsPayload,
    metadata?: MessageMetadata,
  ): void {
    this.hub.publish(
      { type: "workspace:graph", workspaceId },
      "graph.stats",
      {
        stats,
        version: this.version,
        timestamp: new Date().toISOString(),
      },
      metadata,
    );
  }

  /**
   * Internal method to publish graph update events.
   */
  private publishGraphUpdate(
    workspaceId: string,
    payload: GraphUpdatePayload,
    metadata?: MessageMetadata,
  ): void {
    const messageType = `graph.${payload.updateType}`;

    this.hub.publish(
      { type: "workspace:graph", workspaceId },
      messageType,
      payload,
      metadata,
    );
  }

  // ========== Convenience Methods for Common Events ==========

  /**
   * Publish agent spawned event (adds agent node).
   */
  publishAgentSpawned(
    workspaceId: string,
    agentId: string,
    agentName: string,
    agentType: "claude" | "codex" | "gemini" | "unknown",
  ): void {
    this.publishNodeAdded(workspaceId, {
      id: `agent:${agentId}`,
      type: "agent",
      label: agentName,
      status: "active",
      data: {
        agentId,
        agentType,
        loopCount: 0,
      },
    });
  }

  /**
   * Publish agent terminated event (removes agent node).
   */
  publishAgentTerminated(workspaceId: string, agentId: string): void {
    this.publishNodeRemoved(workspaceId, `agent:${agentId}`, "agent");
  }

  /**
   * Publish file reservation created event (adds edge).
   */
  publishReservationCreated(
    workspaceId: string,
    path: string,
    agentId: string,
    expiresAt?: string,
  ): void {
    // Add file node
    this.publishNodeAdded(workspaceId, {
      id: `file:${path}`,
      type: "file",
      label: path.split("/").pop() ?? path,
      status: "active",
      data: { path, reservedBy: agentId, expiresAt },
    });

    // Add reservation edge
    this.publishEdgeAdded(workspaceId, {
      id: `reservation:${path}`,
      source: `agent:${agentId}`,
      target: `file:${path}`,
      type: "reservation",
      label: "reserved",
      metadata: { expiresAt },
    });
  }

  /**
   * Publish file reservation released event (removes edge and possibly node).
   */
  publishReservationReleased(workspaceId: string, path: string): void {
    this.publishEdgeRemoved(workspaceId, `reservation:${path}`, "reservation");
    this.publishNodeRemoved(workspaceId, `file:${path}`, "file");
  }

  /**
   * Publish handoff initiated event (adds edge).
   */
  publishHandoffInitiated(
    workspaceId: string,
    handoffId: string,
    fromAgentId: string,
    toAgentId: string | "any",
    description: string,
  ): void {
    this.publishEdgeAdded(workspaceId, {
      id: `handoff:${handoffId}`,
      source: `agent:${fromAgentId}`,
      target: toAgentId === "any" ? "pool:any" : `agent:${toAgentId}`,
      type: "handoff",
      animated: true,
      label: description.slice(0, 30),
      metadata: { handoffId, status: "pending" },
    });
  }

  /**
   * Publish handoff completed event (removes edge).
   */
  publishHandoffCompleted(workspaceId: string, handoffId: string): void {
    this.publishEdgeRemoved(workspaceId, `handoff:${handoffId}`, "handoff");
  }

  /**
   * Publish conflict detected event.
   */
  publishConflictDetected(
    workspaceId: string,
    conflictId: string,
    path: string,
    agentIds: string[],
  ): void {
    // Update file node status
    this.publishNodeUpdated(workspaceId, {
      id: `file:${path}`,
      type: "file",
      label: path.split("/").pop() ?? path,
      status: "conflict",
      data: { path, conflicting: true, conflictingAgents: agentIds },
    });

    // Add conflict edges for each agent
    for (const agentId of agentIds) {
      this.publishEdgeAdded(workspaceId, {
        id: `conflict:${conflictId}:${agentId}`,
        source: `agent:${agentId}`,
        target: `file:${path}`,
        type: "conflict",
        animated: true,
      });
    }
  }

  /**
   * Publish conflict resolved event.
   */
  publishConflictResolved(
    workspaceId: string,
    conflictId: string,
    path: string,
    agentIds: string[],
  ): void {
    // Remove conflict edges
    for (const agentId of agentIds) {
      this.publishEdgeRemoved(
        workspaceId,
        `conflict:${conflictId}:${agentId}`,
        "conflict",
      );
    }

    // Update file node status back to active
    this.publishNodeUpdated(workspaceId, {
      id: `file:${path}`,
      type: "file",
      label: path.split("/").pop() ?? path,
      status: "active",
      data: { path, conflicting: false },
    });
  }
}

// Singleton instance
let serviceInstance: GraphEventsService | undefined;

/**
 * Get or create the graph events service singleton.
 */
export function getGraphEventsService(hub?: WebSocketHub): GraphEventsService {
  if (!serviceInstance) {
    if (!hub) {
      throw new Error(
        "GraphEventsService requires a WebSocketHub on first initialization",
      );
    }
    serviceInstance = new GraphEventsService(hub);
  }
  return serviceInstance;
}

/**
 * Reset the graph events service (for testing).
 */
export function resetGraphEventsService(): void {
  serviceInstance = undefined;
}
