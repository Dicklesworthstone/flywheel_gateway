/**
 * Collaboration Graph hooks for real-time agent coordination visualization.
 *
 * Provides hooks for fetching graph data including agents, reservations,
 * conflicts, and messages. Supports WebSocket subscriptions for real-time
 * updates and view mode filtering.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUiStore } from "../stores/ui";

// ============================================================================
// Types
// ============================================================================

export type AgentStatus = "active" | "idle" | "waiting" | "blocked";
export type ConflictType = "deadlock" | "contention" | "timeout";
export type ConflictSeverity = "warning" | "critical";
export type ResourceType = "file" | "directory" | "lock";
export type EdgeType =
  | "message"
  | "handoff"
  | "dependency"
  | "reservation"
  | "waiting";
export type ViewMode = "agents" | "files" | "full";

export interface AgentNode {
  id: string;
  agentId: string;
  name: string;
  status: AgentStatus;
  currentTask?: string;
  reservationCount: number;
  messagesSent: number;
  messagesReceived: number;
  lastActiveAt: string;
}

export interface ReservationNode {
  id: string;
  resourcePath: string;
  resourceType: ResourceType;
  holderId: string;
  waiters: string[];
  acquiredAt: string;
  expiresAt: string;
  mode: "exclusive" | "shared";
}

export interface ConflictNode {
  id: string;
  conflictType: ConflictType;
  involvedAgents: string[];
  involvedResources: string[];
  severity: ConflictSeverity;
  detectedAt: string;
  resolution?: string;
}

export interface MessageEvent {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  subject: string;
  timestamp: string;
  threadId?: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  animated?: boolean;
  label?: string;
  data?: Record<string, unknown>;
}

export interface GraphStats {
  totalAgents: number;
  activeAgents: number;
  blockedAgents: number;
  totalReservations: number;
  activeConflicts: number;
  messagesLast5m: number;
}

export interface CollabGraphData {
  agents: AgentNode[];
  reservations: ReservationNode[];
  conflicts: ConflictNode[];
  recentMessages: MessageEvent[];
  edges: GraphEdge[];
  stats: GraphStats;
  lastUpdated: string;
}

// ============================================================================
// Mock Data (used when mockMode is enabled or API unavailable)
// ============================================================================

const mockAgentNodes: AgentNode[] = [
  {
    id: "agent-node-1",
    agentId: "agent-ax7",
    name: "Claude Opus - Architect",
    status: "active",
    currentTask: "Implementing session handoff protocol",
    reservationCount: 3,
    messagesSent: 12,
    messagesReceived: 8,
    lastActiveAt: new Date(Date.now() - 30000).toISOString(),
  },
  {
    id: "agent-node-2",
    agentId: "agent-bp2",
    name: "Claude Sonnet - Coder",
    status: "waiting",
    currentTask: "Waiting for file reservation",
    reservationCount: 1,
    messagesSent: 5,
    messagesReceived: 4,
    lastActiveAt: new Date(Date.now() - 120000).toISOString(),
  },
  {
    id: "agent-node-3",
    agentId: "agent-km9",
    name: "Claude Haiku - Tester",
    status: "active",
    currentTask: "Running integration tests",
    reservationCount: 0,
    messagesSent: 3,
    messagesReceived: 6,
    lastActiveAt: new Date(Date.now() - 15000).toISOString(),
  },
  {
    id: "agent-node-4",
    agentId: "agent-qr3",
    name: "Codex - Reviewer",
    status: "idle",
    reservationCount: 0,
    messagesSent: 1,
    messagesReceived: 2,
    lastActiveAt: new Date(Date.now() - 300000).toISOString(),
  },
  {
    id: "agent-node-5",
    agentId: "agent-zx1",
    name: "Claude Opus - Planner",
    status: "blocked",
    currentTask: "Waiting for conflict resolution",
    reservationCount: 2,
    messagesSent: 7,
    messagesReceived: 9,
    lastActiveAt: new Date(Date.now() - 60000).toISOString(),
  },
];

const mockReservationNodes: ReservationNode[] = [
  {
    id: "res-node-1",
    resourcePath: "src/services/handoff.service.ts",
    resourceType: "file",
    holderId: "agent-ax7",
    waiters: ["agent-bp2"],
    acquiredAt: new Date(Date.now() - 600000).toISOString(),
    expiresAt: new Date(Date.now() + 1800000).toISOString(),
    mode: "exclusive",
  },
  {
    id: "res-node-2",
    resourcePath: "src/services/checkpoint.service.ts",
    resourceType: "file",
    holderId: "agent-ax7",
    waiters: [],
    acquiredAt: new Date(Date.now() - 300000).toISOString(),
    expiresAt: new Date(Date.now() + 2100000).toISOString(),
    mode: "exclusive",
  },
  {
    id: "res-node-3",
    resourcePath: "src/routes/**/*.ts",
    resourceType: "directory",
    holderId: "agent-ax7",
    waiters: ["agent-zx1"],
    acquiredAt: new Date(Date.now() - 900000).toISOString(),
    expiresAt: new Date(Date.now() + 900000).toISOString(),
    mode: "exclusive",
  },
  {
    id: "res-node-4",
    resourcePath: "src/utils/*.ts",
    resourceType: "directory",
    holderId: "agent-bp2",
    waiters: [],
    acquiredAt: new Date(Date.now() - 120000).toISOString(),
    expiresAt: new Date(Date.now() + 2400000).toISOString(),
    mode: "shared",
  },
  {
    id: "res-node-5",
    resourcePath: "tests/**/*.test.ts",
    resourceType: "directory",
    holderId: "agent-zx1",
    waiters: [],
    acquiredAt: new Date(Date.now() - 180000).toISOString(),
    expiresAt: new Date(Date.now() + 2220000).toISOString(),
    mode: "shared",
  },
];

const mockConflictNodes: ConflictNode[] = [
  {
    id: "conflict-1",
    conflictType: "contention",
    involvedAgents: ["agent-ax7", "agent-bp2"],
    involvedResources: ["src/services/handoff.service.ts"],
    severity: "warning",
    detectedAt: new Date(Date.now() - 60000).toISOString(),
  },
  {
    id: "conflict-2",
    conflictType: "deadlock",
    involvedAgents: ["agent-ax7", "agent-zx1"],
    involvedResources: ["src/routes/**/*.ts", "tests/**/*.test.ts"],
    severity: "critical",
    detectedAt: new Date(Date.now() - 30000).toISOString(),
  },
];

const mockRecentMessages: MessageEvent[] = [
  {
    id: "msg-1",
    fromAgentId: "agent-ax7",
    toAgentId: "agent-km9",
    subject: "Ready for testing",
    timestamp: new Date(Date.now() - 30000).toISOString(),
    threadId: "handoff-impl",
  },
  {
    id: "msg-2",
    fromAgentId: "agent-km9",
    toAgentId: "agent-ax7",
    subject: "Tests started",
    timestamp: new Date(Date.now() - 15000).toISOString(),
    threadId: "handoff-impl",
  },
  {
    id: "msg-3",
    fromAgentId: "agent-bp2",
    toAgentId: "agent-ax7",
    subject: "Requesting file access",
    timestamp: new Date(Date.now() - 60000).toISOString(),
    threadId: "file-access",
  },
  {
    id: "msg-4",
    fromAgentId: "agent-zx1",
    toAgentId: "all",
    subject: "Planning session complete",
    timestamp: new Date(Date.now() - 120000).toISOString(),
    threadId: "planning",
  },
];

function buildMockEdges(): GraphEdge[] {
  const edges: GraphEdge[] = [];

  // Message edges between agents
  for (const msg of mockRecentMessages) {
    if (msg.toAgentId !== "all") {
      const fromIdx = mockAgentNodes.findIndex(
        (a) => a.agentId === msg.fromAgentId,
      );
      const toIdx = mockAgentNodes.findIndex(
        (a) => a.agentId === msg.toAgentId,
      );
      // Skip edges with invalid agent references
      if (fromIdx < 0 || toIdx < 0) continue;
      edges.push({
        id: `edge-msg-${msg.id}`,
        source: `agent-node-${fromIdx + 1}`,
        target: `agent-node-${toIdx + 1}`,
        type: "message",
        animated: true,
        label: msg.subject,
      });
    }
  }

  // Reservation edges (agent owns resource)
  for (const res of mockReservationNodes) {
    const holderIdx = mockAgentNodes.findIndex(
      (a) => a.agentId === res.holderId,
    );
    if (holderIdx >= 0) {
      edges.push({
        id: `edge-res-${res.id}`,
        source: `agent-node-${holderIdx + 1}`,
        target: res.id,
        type: "reservation",
        animated: false,
      });
    }

    // Waiting edges
    for (const waiter of res.waiters) {
      const waiterIdx = mockAgentNodes.findIndex((a) => a.agentId === waiter);
      if (waiterIdx >= 0) {
        edges.push({
          id: `edge-wait-${res.id}-${waiter}`,
          source: `agent-node-${waiterIdx + 1}`,
          target: res.id,
          type: "waiting",
          animated: true,
        });
      }
    }
  }

  // Conflict dependency edges
  for (const conflict of mockConflictNodes) {
    for (let i = 1; i < conflict.involvedAgents.length; i++) {
      const srcIdx = mockAgentNodes.findIndex(
        (a) => a.agentId === conflict.involvedAgents[0],
      );
      const tgtIdx = mockAgentNodes.findIndex(
        (a) => a.agentId === conflict.involvedAgents[i],
      );
      if (srcIdx >= 0 && tgtIdx >= 0) {
        edges.push({
          id: `edge-dep-${conflict.id}-${i}`,
          source: `agent-node-${srcIdx + 1}`,
          target: `agent-node-${tgtIdx + 1}`,
          type: "dependency",
          animated: true,
          data: { conflictId: conflict.id, severity: conflict.severity },
        });
      }
    }
  }

  return edges;
}

const mockGraphData: CollabGraphData = {
  agents: mockAgentNodes,
  reservations: mockReservationNodes,
  conflicts: mockConflictNodes,
  recentMessages: mockRecentMessages,
  edges: buildMockEdges(),
  stats: {
    totalAgents: 5,
    activeAgents: 2,
    blockedAgents: 1,
    totalReservations: 5,
    activeConflicts: 2,
    messagesLast5m: 4,
  },
  lastUpdated: new Date().toISOString(),
};

// ============================================================================
// API Client
// ============================================================================

const API_BASE = "/api/collaboration";

async function fetchAPI<T>(
  endpoint: string,
  options?: RequestInit,
): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ message: "Request failed" }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  const json = await response.json();
  return json.data ?? json;
}

// ============================================================================
// Query Hooks
// ============================================================================

interface UseQueryResult<T> {
  data: T | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

function useQuery<T>(
  endpoint: string,
  mockData: T,
  deps: unknown[] = [],
): UseQueryResult<T> {
  const mockMode = useUiStore((state) => state.mockMode);
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const mockDataRef = useRef(mockData);
  useEffect(() => {
    mockDataRef.current = mockData;
  }, [mockData]);

  const fetch = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    if (mockMode) {
      // Simulate network delay
      await new Promise((r) => setTimeout(r, 300));
      setData(mockDataRef.current);
      setIsLoading(false);
      return;
    }

    try {
      const result = await fetchAPI<T>(endpoint);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e : new Error("Unknown error"));
      // Fall back to mock data on error
      setData(mockDataRef.current);
    }
    setIsLoading(false);
  }, [endpoint, mockMode]);

  useEffect(() => {
    fetch();
  }, [fetch, ...deps]);

  return { data, isLoading, error, refetch: fetch };
}

/**
 * Hook to fetch full collaboration graph data.
 */
export function useCollabGraphData(): UseQueryResult<CollabGraphData> {
  return useQuery("/graph", mockGraphData);
}

/**
 * Hook to fetch graph statistics only (lighter weight).
 */
export function useCollabGraphStats(): UseQueryResult<GraphStats> {
  return useQuery("/graph/stats", mockGraphData.stats);
}

/**
 * Hook to fetch active agents.
 */
export function useCollabAgents(): UseQueryResult<AgentNode[]> {
  return useQuery("/agents", mockAgentNodes);
}

/**
 * Hook to fetch active reservations.
 */
export function useCollabReservations(): UseQueryResult<ReservationNode[]> {
  return useQuery("/reservations", mockReservationNodes);
}

/**
 * Hook to fetch active conflicts.
 */
export function useCollabConflicts(): UseQueryResult<ConflictNode[]> {
  return useQuery("/conflicts", mockConflictNodes);
}

/**
 * Hook to fetch recent messages for message flow visualization.
 */
export function useCollabMessages(
  limit: number = 20,
): UseQueryResult<MessageEvent[]> {
  return useQuery(
    `/messages?limit=${limit}`,
    mockRecentMessages.slice(0, limit),
    [limit],
  );
}

// ============================================================================
// WebSocket Subscription Hook
// ============================================================================

interface GraphEvent {
  type:
    | "agent.status"
    | "reservation.acquired"
    | "reservation.released"
    | "message.sent"
    | "conflict.detected"
    | "conflict.resolved";
  payload: unknown;
  timestamp: string;
}

interface UseGraphSubscriptionOptions {
  /**
   * Workspace ID to subscribe to for collaboration events.
   * Defaults to "default".
   */
  workspaceId?: string;
  onAgentStatus?: (agent: AgentNode) => void;
  onReservationAcquired?: (reservation: ReservationNode) => void;
  onReservationReleased?: (reservationId: string) => void;
  onMessageSent?: (message: MessageEvent) => void;
  onConflictDetected?: (conflict: ConflictNode) => void;
  onConflictResolved?: (conflictId: string) => void;
}

interface UseGraphSubscriptionResult {
  connected: boolean;
  lastEvent: GraphEvent | null;
  eventCount: number;
  reconnect: () => void;
}

/**
 * Hook to subscribe to real-time graph updates via WebSocket.
 * Updates are batched at 100ms intervals to prevent UI thrashing.
 */
export function useGraphSubscription(
  options: UseGraphSubscriptionOptions = {},
): UseGraphSubscriptionResult {
  const mockMode = useUiStore((state) => state.mockMode);
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<GraphEvent | null>(null);
  const [eventCount, setEventCount] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const batchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const shouldReconnectRef = useRef(true);
  const eventQueueRef = useRef<GraphEvent[]>([]);
  const connectRef = useRef<() => void>(() => {});

  const clearReconnectTimeout = useCallback(() => {
    if (!reconnectTimeoutRef.current) return;
    clearTimeout(reconnectTimeoutRef.current);
    reconnectTimeoutRef.current = null;
  }, []);

  // Store options in a ref to avoid recreating callbacks on every render.
  // This prevents cascading recreation of queueEvent → connect → reconnect
  // which could cause unnecessary WebSocket reconnections.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const processEvents = useCallback(() => {
    const events = eventQueueRef.current;
    eventQueueRef.current = [];

    for (const event of events) {
      switch (event.type) {
        case "agent.status":
          optionsRef.current.onAgentStatus?.(event.payload as AgentNode);
          break;
        case "reservation.acquired":
          optionsRef.current.onReservationAcquired?.(
            event.payload as ReservationNode,
          );
          break;
        case "reservation.released":
          optionsRef.current.onReservationReleased?.(event.payload as string);
          break;
        case "message.sent":
          optionsRef.current.onMessageSent?.(event.payload as MessageEvent);
          break;
        case "conflict.detected":
          optionsRef.current.onConflictDetected?.(
            event.payload as ConflictNode,
          );
          break;
        case "conflict.resolved":
          optionsRef.current.onConflictResolved?.(event.payload as string);
          break;
      }
      setLastEvent(event);
      setEventCount((c) => c + 1);
    }
  }, []);

  const queueEvent = useCallback(
    (event: GraphEvent) => {
      eventQueueRef.current.push(event);

      // Batch processing at 100ms intervals
      if (!batchTimeoutRef.current) {
        batchTimeoutRef.current = setTimeout(() => {
          batchTimeoutRef.current = null;
          processEvents();
        }, 100);
      }
    },
    [processEvents],
  );

  const connect = useCallback(() => {
    clearReconnectTimeout();

    if (mockMode) {
      // In mock mode, simulate connection and periodic events
      setConnected(true);
      return;
    }

    shouldReconnectRef.current = true;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onopen = () => {
      if (wsRef.current !== ws) return;

      const workspaceId = options.workspaceId ?? "default";

      // Consider "connected" only once we have at least one successful subscription.
      setConnected(false);

      // Subscribe to workspace channels that affect collaboration graph state.
      ws.send(
        JSON.stringify({
          type: "subscribe",
          channel: `workspace:reservations:${workspaceId}`,
        }),
      );
      ws.send(
        JSON.stringify({
          type: "subscribe",
          channel: `workspace:conflicts:${workspaceId}`,
        }),
      );
    };

    ws.onmessage = (event) => {
      if (wsRef.current !== ws) return;

      try {
        const message = JSON.parse(event.data) as {
          type?: unknown;
          channel?: unknown;
          message?: { id?: unknown; type?: unknown; payload?: unknown };
          ackRequired?: unknown;
          code?: unknown;
        };

        if (message.type === "subscribed") {
          setConnected(true);
          return;
        }

        if (message.type === "error") {
          // Subscription errors (e.g. auth) mean real-time updates are not active.
          if (
            message.code === "WS_SUBSCRIPTION_DENIED" ||
            message.code === "INVALID_CHANNEL"
          ) {
            setConnected(false);
          }
          return;
        }

        if (message.type !== "message" || !message.message) return;

        const hubType = message.message.type;
        const hubPayload = message.message.payload;

        if (hubType === "reservation.acquired") {
          const p = hubPayload as {
            reservationId?: string;
            requesterId?: string;
            patterns?: string[];
            exclusive?: boolean;
            acquiredAt?: string;
            expiresAt?: string;
          };
          queueEvent({
            type: "reservation.acquired",
            payload: {
              id: p.reservationId ?? "unknown",
              resourcePath: p.patterns?.[0] ?? "unknown",
              resourceType: "file",
              holderId: p.requesterId ?? "unknown",
              waiters: [],
              acquiredAt: p.acquiredAt ?? new Date().toISOString(),
              expiresAt: p.expiresAt ?? new Date().toISOString(),
              mode: p.exclusive ? "exclusive" : "shared",
            } satisfies ReservationNode,
            timestamp: new Date().toISOString(),
          });
        } else if (hubType === "reservation.released") {
          const p = hubPayload as { reservationId?: string };
          queueEvent({
            type: "reservation.released",
            payload: p.reservationId ?? "unknown",
            timestamp: new Date().toISOString(),
          });
        } else if (hubType === "conflict.detected") {
          const p = hubPayload as {
            conflictId?: string;
            pattern?: string;
            existingReservation?: { requesterId?: string };
            requestingAgent?: string;
            detectedAt?: string;
          };
          queueEvent({
            type: "conflict.detected",
            payload: {
              id: p.conflictId ?? "unknown",
              conflictType: "contention",
              involvedAgents: [
                p.existingReservation?.requesterId ?? "unknown",
                p.requestingAgent ?? "unknown",
              ],
              involvedResources: p.pattern ? [p.pattern] : [],
              severity: "warning",
              detectedAt: p.detectedAt ?? new Date().toISOString(),
            } satisfies ConflictNode,
            timestamp: new Date().toISOString(),
          });
        } else if (hubType === "conflict.resolved") {
          const p = hubPayload as { conflictId?: string };
          queueEvent({
            type: "conflict.resolved",
            payload: p.conflictId ?? "unknown",
            timestamp: new Date().toISOString(),
          });
        }

        if (
          message.ackRequired === true &&
          typeof message.message.id === "string"
        ) {
          ws.send(
            JSON.stringify({
              type: "ack",
              messageIds: [message.message.id],
            }),
          );
        }
      } catch {
        // Ignore invalid messages
      }
    };

    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      wsRef.current = null;

      setConnected(false);

      if (!shouldReconnectRef.current) return;

      // Attempt reconnection after 3 seconds (but only if this wasn't a manual close)
      clearReconnectTimeout();
      reconnectTimeoutRef.current = setTimeout(
        () => connectRef.current(),
        3000,
      );
    };

    ws.onerror = () => {
      if (wsRef.current !== ws) return;
      setConnected(false);
    };

    wsRef.current = ws;
  }, [clearReconnectTimeout, mockMode, options.workspaceId, queueEvent]);

  // Keep connectRef in sync with connect for self-referencing
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  const reconnect = useCallback(() => {
    shouldReconnectRef.current = false;
    clearReconnectTimeout();
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    connect();
  }, [clearReconnectTimeout, connect]);

  useEffect(() => {
    connect();

    return () => {
      shouldReconnectRef.current = false;
      clearReconnectTimeout();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (batchTimeoutRef.current) {
        clearTimeout(batchTimeoutRef.current);
      }
    };
  }, [clearReconnectTimeout, connect]);

  // Mock mode: simulate periodic events
  useEffect(() => {
    if (!mockMode) return;

    const interval = setInterval(() => {
      // Randomly generate mock events
      const eventTypes: GraphEvent["type"][] = [
        "agent.status",
        "message.sent",
        "reservation.acquired",
      ];
      const type = eventTypes[Math.floor(Math.random() * eventTypes.length)]!;

      let payload: unknown;
      switch (type) {
        case "agent.status":
          payload = {
            ...mockAgentNodes[
              Math.floor(Math.random() * mockAgentNodes.length)
            ]!,
            lastActiveAt: new Date().toISOString(),
          };
          break;
        case "message.sent":
          payload = {
            id: `mock-msg-${Date.now()}`,
            fromAgentId:
              mockAgentNodes[Math.floor(Math.random() * mockAgentNodes.length)]
                ?.agentId,
            toAgentId:
              mockAgentNodes[Math.floor(Math.random() * mockAgentNodes.length)]
                ?.agentId,
            subject: "Mock message",
            timestamp: new Date().toISOString(),
          };
          break;
        case "reservation.acquired":
          payload = {
            ...mockReservationNodes[
              Math.floor(Math.random() * mockReservationNodes.length)
            ]!,
            acquiredAt: new Date().toISOString(),
          };
          break;
      }

      queueEvent({
        type,
        payload,
        timestamp: new Date().toISOString(),
      });
    }, 5000);

    return () => clearInterval(interval);
  }, [mockMode, queueEvent]);

  return { connected, lastEvent, eventCount, reconnect };
}

// ============================================================================
// View Mode and Filtering
// ============================================================================

interface FilteredGraphData {
  nodes: Array<AgentNode | ReservationNode | ConflictNode>;
  edges: GraphEdge[];
}

/**
 * Hook to filter graph data based on view mode.
 */
export function useFilteredGraph(
  data: CollabGraphData | null,
  viewMode: ViewMode,
): FilteredGraphData {
  return useMemo(() => {
    if (!data) {
      return { nodes: [], edges: [] };
    }

    switch (viewMode) {
      case "agents":
        // Only show agent nodes and message/handoff edges
        return {
          nodes: data.agents,
          edges: data.edges.filter(
            (e) =>
              e.type === "message" ||
              e.type === "handoff" ||
              e.type === "dependency",
          ),
        };

      case "files":
        // Show agent nodes, reservation nodes, and ownership edges
        return {
          nodes: [...data.agents, ...data.reservations],
          edges: data.edges.filter(
            (e) => e.type === "reservation" || e.type === "waiting",
          ),
        };

      default:
        // Show everything (full mode)
        return {
          nodes: [...data.agents, ...data.reservations, ...data.conflicts],
          edges: data.edges,
        };
    }
  }, [data, viewMode]);
}

// ============================================================================
// Selection State
// ============================================================================

interface UseGraphSelectionResult {
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  selectNode: (nodeId: string | null) => void;
  selectEdge: (edgeId: string | null) => void;
  clearSelection: () => void;
}

/**
 * Hook to manage graph selection state.
 */
export function useGraphSelection(): UseGraphSelectionResult {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  const selectNode = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId);
    setSelectedEdgeId(null);
  }, []);

  const selectEdge = useCallback((edgeId: string | null) => {
    setSelectedEdgeId(edgeId);
    setSelectedNodeId(null);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }, []);

  return {
    selectedNodeId,
    selectedEdgeId,
    selectNode,
    selectEdge,
    clearSelection,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get status color for an agent node.
 */
export function getAgentStatusColor(status: AgentStatus): string {
  switch (status) {
    case "active":
      return "var(--positive)";
    case "idle":
      return "var(--text-muted)";
    case "waiting":
      return "var(--warning)";
    case "blocked":
      return "var(--danger)";
    default:
      return "var(--text-muted)";
  }
}

/**
 * Get edge style based on type.
 */
export function getEdgeStyle(type: EdgeType): {
  stroke: string;
  strokeDasharray?: string;
  animated: boolean;
} {
  switch (type) {
    case "message":
      return {
        stroke: "var(--text-muted)",
        strokeDasharray: "5,5",
        animated: true,
      };
    case "handoff":
      return { stroke: "var(--primary)", animated: true };
    case "dependency":
      return {
        stroke: "var(--danger)",
        strokeDasharray: "3,3",
        animated: true,
      };
    case "reservation":
      return { stroke: "var(--positive)", animated: false };
    case "waiting":
      return {
        stroke: "var(--warning)",
        strokeDasharray: "5,5",
        animated: true,
      };
    default:
      return { stroke: "var(--border)", animated: false };
  }
}

/**
 * Get conflict severity color.
 */
export function getConflictSeverityColor(severity: ConflictSeverity): string {
  switch (severity) {
    case "critical":
      return "var(--danger)";
    case "warning":
      return "var(--warning)";
    default:
      return "var(--text-muted)";
  }
}

/**
 * Format time relative to now.
 */
export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);

  if (diffSecs < 60) return `${diffSecs}s ago`;
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffMs / 86400000)}d ago`;
}

/**
 * Calculate time remaining until expiry.
 */
export function formatTimeRemaining(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();

  if (diffMs <= 0) return "expired";

  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);

  if (diffMins < 60) return `${diffMins}m`;
  return `${diffHours}h ${diffMins % 60}m`;
}
