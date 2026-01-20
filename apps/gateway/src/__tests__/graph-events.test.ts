/**
 * Tests for graph-events service.
 */

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import type { WebSocketHub } from "../ws/hub";

// Mock the logger (include child to match production usage)
const mockLogger = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
  child: () => mockLogger,
};

mock.module("../services/logger", () => ({
  logger: mockLogger,
}));

afterAll(() => {
  mock.restore();
});

// Import after mocking
import {
  type GraphEdgePayload,
  GraphEventsService,
  type GraphNodePayload,
  type GraphStatsPayload,
  getGraphEventsService,
  resetGraphEventsService,
} from "../services/graph-events";

describe("Graph Events Service", () => {
  let mockHub: WebSocketHub;
  let publishCalls: Array<{
    channel: unknown;
    type: string;
    payload: unknown;
    metadata: unknown;
  }>;

  beforeEach(() => {
    publishCalls = [];
    mockHub = {
      publish: (
        channel: unknown,
        type: string,
        payload: unknown,
        metadata: unknown,
      ) => {
        publishCalls.push({ channel, type, payload, metadata });
        return { id: "test", cursor: "test-cursor" };
      },
    } as unknown as WebSocketHub;
    resetGraphEventsService();
  });

  afterEach(() => {
    resetGraphEventsService();
  });

  describe("GraphEventsService", () => {
    test("can be instantiated with hub", () => {
      const service = new GraphEventsService(mockHub);
      expect(service).toBeDefined();
    });

    test("initial version is 1", () => {
      const service = new GraphEventsService(mockHub);
      expect(service.getVersion()).toBe(1);
    });

    test("incrementVersion increments and returns new version", () => {
      const service = new GraphEventsService(mockHub);
      expect(service.incrementVersion()).toBe(2);
      expect(service.getVersion()).toBe(2);
      expect(service.incrementVersion()).toBe(3);
    });
  });

  describe("getGraphEventsService", () => {
    test("requires hub on first call", () => {
      expect(() => getGraphEventsService()).toThrow(
        "GraphEventsService requires a WebSocketHub",
      );
    });

    test("returns same instance on subsequent calls", () => {
      const service1 = getGraphEventsService(mockHub);
      const service2 = getGraphEventsService();
      expect(service1).toBe(service2);
    });

    test("resetGraphEventsService clears singleton", () => {
      const service1 = getGraphEventsService(mockHub);
      resetGraphEventsService();
      const service2 = getGraphEventsService(mockHub);
      expect(service1).not.toBe(service2);
    });
  });

  describe("publishNodeAdded", () => {
    test("publishes node_added event to correct channel", () => {
      const service = new GraphEventsService(mockHub);
      const node: GraphNodePayload = {
        id: "agent:abc123",
        type: "agent",
        label: "Claude Agent",
        status: "active",
        data: { agentType: "claude" },
      };

      service.publishNodeAdded("workspace-1", node);

      expect(publishCalls).toHaveLength(1);
      expect(publishCalls[0]?.channel).toEqual({
        type: "workspace:graph",
        workspaceId: "workspace-1",
      });
      expect(publishCalls[0]?.type).toBe("graph.node_added");
      const payload = publishCalls[0]?.payload as Record<string, unknown>;
      expect(payload["updateType"]).toBe("node_added");
      expect(payload["node"]).toEqual(node);
      expect(payload["version"]).toBe(2); // Incremented from 1
    });

    test("includes stats when provided", () => {
      const service = new GraphEventsService(mockHub);
      const node: GraphNodePayload = {
        id: "agent:abc123",
        type: "agent",
        label: "Test",
        status: "active",
        data: {},
      };
      const stats: GraphStatsPayload = {
        totalNodes: 5,
        nodesByType: { agent: 3, file: 2, bead: 0 },
        totalEdges: 4,
        edgesByType: {
          reservation: 2,
          handoff: 1,
          message: 1,
          dependency: 0,
          conflict: 0,
        },
        activeAgents: 3,
        conflictCount: 0,
        pendingHandoffs: 1,
        activeMessages: 5,
      };

      service.publishNodeAdded("workspace-1", node, stats);

      const payload = publishCalls[0]?.payload as Record<string, unknown>;
      expect(payload["stats"]).toEqual(stats);
    });
  });

  describe("publishNodeRemoved", () => {
    test("publishes node_removed event", () => {
      const service = new GraphEventsService(mockHub);

      service.publishNodeRemoved("workspace-1", "file:/src/test.ts", "file");

      expect(publishCalls).toHaveLength(1);
      expect(publishCalls[0]?.type).toBe("graph.node_removed");
      const payload = publishCalls[0]?.payload as Record<string, unknown>;
      expect(payload["updateType"]).toBe("node_removed");
      const node = payload["node"] as GraphNodePayload;
      expect(node.id).toBe("file:/src/test.ts");
      expect(node.type).toBe("file");
    });
  });

  describe("publishNodeUpdated", () => {
    test("publishes node_updated event", () => {
      const service = new GraphEventsService(mockHub);
      const node: GraphNodePayload = {
        id: "agent:abc123",
        type: "agent",
        label: "Updated Agent",
        status: "paused",
        data: { loopCount: 10 },
      };

      service.publishNodeUpdated("workspace-1", node);

      expect(publishCalls[0]?.type).toBe("graph.node_updated");
      const payload = publishCalls[0]?.payload as Record<string, unknown>;
      expect(payload["updateType"]).toBe("node_updated");
      expect(payload["node"]).toEqual(node);
    });
  });

  describe("publishEdgeAdded", () => {
    test("publishes edge_added event", () => {
      const service = new GraphEventsService(mockHub);
      const edge: GraphEdgePayload = {
        id: "reservation:/src/file.ts",
        source: "agent:abc123",
        target: "file:/src/file.ts",
        type: "reservation",
        label: "reserved",
      };

      service.publishEdgeAdded("workspace-1", edge);

      expect(publishCalls[0]?.type).toBe("graph.edge_added");
      const payload = publishCalls[0]?.payload as Record<string, unknown>;
      expect(payload["updateType"]).toBe("edge_added");
      expect(payload["edge"]).toEqual(edge);
    });
  });

  describe("publishEdgeRemoved", () => {
    test("publishes edge_removed event", () => {
      const service = new GraphEventsService(mockHub);

      service.publishEdgeRemoved(
        "workspace-1",
        "handoff:handoff-123",
        "handoff",
      );

      expect(publishCalls[0]?.type).toBe("graph.edge_removed");
      const payload = publishCalls[0]?.payload as Record<string, unknown>;
      expect(payload["updateType"]).toBe("edge_removed");
      const edge = payload["edge"] as GraphEdgePayload;
      expect(edge.id).toBe("handoff:handoff-123");
      expect(edge.type).toBe("handoff");
    });
  });

  describe("publishEdgeUpdated", () => {
    test("publishes edge_updated event", () => {
      const service = new GraphEventsService(mockHub);
      const edge: GraphEdgePayload = {
        id: "handoff:h-123",
        source: "agent:a1",
        target: "agent:a2",
        type: "handoff",
        animated: false,
        metadata: { status: "completed" },
      };

      service.publishEdgeUpdated("workspace-1", edge);

      expect(publishCalls[0]?.type).toBe("graph.edge_updated");
      const payload = publishCalls[0]?.payload as Record<string, unknown>;
      expect(payload["edge"]).toEqual(edge);
    });
  });

  describe("publishFullRefresh", () => {
    test("publishes full_refresh event", () => {
      const service = new GraphEventsService(mockHub);

      service.publishFullRefresh("workspace-1");

      expect(publishCalls[0]?.type).toBe("graph.full_refresh");
      const payload = publishCalls[0]?.payload as Record<string, unknown>;
      expect(payload["updateType"]).toBe("full_refresh");
    });
  });

  describe("publishStatsUpdate", () => {
    test("publishes stats without incrementing version", () => {
      const service = new GraphEventsService(mockHub);
      const stats: GraphStatsPayload = {
        totalNodes: 10,
        nodesByType: { agent: 5, file: 4, bead: 1 },
        totalEdges: 8,
        edgesByType: {
          reservation: 3,
          handoff: 2,
          message: 2,
          dependency: 1,
          conflict: 0,
        },
        activeAgents: 4,
        conflictCount: 0,
        pendingHandoffs: 2,
        activeMessages: 10,
      };

      const initialVersion = service.getVersion();
      service.publishStatsUpdate("workspace-1", stats);

      expect(publishCalls[0]?.type).toBe("graph.stats");
      const payload = publishCalls[0]?.payload as Record<string, unknown>;
      expect(payload["stats"]).toEqual(stats);
      expect(payload["version"]).toBe(initialVersion); // Not incremented
      expect(service.getVersion()).toBe(initialVersion);
    });
  });

  describe("convenience methods", () => {
    describe("publishAgentSpawned", () => {
      test("publishes agent node added", () => {
        const service = new GraphEventsService(mockHub);

        service.publishAgentSpawned(
          "workspace-1",
          "agent-123",
          "Claude Dev",
          "claude",
        );

        expect(publishCalls).toHaveLength(1);
        const payload = publishCalls[0]?.payload as Record<string, unknown>;
        const node = payload["node"] as GraphNodePayload;
        expect(node.id).toBe("agent:agent-123");
        expect(node.type).toBe("agent");
        expect(node.label).toBe("Claude Dev");
        expect(node.status).toBe("active");
        expect(node.data["agentType"]).toBe("claude");
      });
    });

    describe("publishAgentTerminated", () => {
      test("publishes agent node removed", () => {
        const service = new GraphEventsService(mockHub);

        service.publishAgentTerminated("workspace-1", "agent-123");

        expect(publishCalls[0]?.type).toBe("graph.node_removed");
        const payload = publishCalls[0]?.payload as Record<string, unknown>;
        const node = payload["node"] as GraphNodePayload;
        expect(node.id).toBe("agent:agent-123");
        expect(node.type).toBe("agent");
      });
    });

    describe("publishReservationCreated", () => {
      test("publishes file node and reservation edge", () => {
        const service = new GraphEventsService(mockHub);

        service.publishReservationCreated(
          "workspace-1",
          "/src/app.ts",
          "agent-123",
          "2024-01-01T12:00:00Z",
        );

        expect(publishCalls).toHaveLength(2);

        // First call: node added
        const nodePayload = publishCalls[0]?.payload as Record<string, unknown>;
        const node = nodePayload["node"] as GraphNodePayload;
        expect(node.id).toBe("file:/src/app.ts");
        expect(node.type).toBe("file");
        expect(node.data["reservedBy"]).toBe("agent-123");

        // Second call: edge added
        const edgePayload = publishCalls[1]?.payload as Record<string, unknown>;
        const edge = edgePayload["edge"] as GraphEdgePayload;
        expect(edge.id).toBe("reservation:/src/app.ts");
        expect(edge.source).toBe("agent:agent-123");
        expect(edge.target).toBe("file:/src/app.ts");
        expect(edge.type).toBe("reservation");
      });
    });

    describe("publishReservationReleased", () => {
      test("publishes edge and node removal", () => {
        const service = new GraphEventsService(mockHub);

        service.publishReservationReleased("workspace-1", "/src/app.ts");

        expect(publishCalls).toHaveLength(2);

        // First: edge removed
        expect(publishCalls[0]?.type).toBe("graph.edge_removed");

        // Second: node removed
        expect(publishCalls[1]?.type).toBe("graph.node_removed");
      });
    });

    describe("publishHandoffInitiated", () => {
      test("publishes handoff edge to specific agent", () => {
        const service = new GraphEventsService(mockHub);

        service.publishHandoffInitiated(
          "workspace-1",
          "handoff-123",
          "agent-1",
          "agent-2",
          "Review the code changes",
        );

        const payload = publishCalls[0]?.payload as Record<string, unknown>;
        const edge = payload["edge"] as GraphEdgePayload;
        expect(edge.id).toBe("handoff:handoff-123");
        expect(edge.source).toBe("agent:agent-1");
        expect(edge.target).toBe("agent:agent-2");
        expect(edge.type).toBe("handoff");
        expect(edge.animated).toBe(true);
        expect(edge.label).toBe("Review the code changes");
      });

      test("publishes handoff edge to pool when target is any", () => {
        const service = new GraphEventsService(mockHub);

        service.publishHandoffInitiated(
          "workspace-1",
          "handoff-123",
          "agent-1",
          "any",
          "Help needed",
        );

        const payload = publishCalls[0]?.payload as Record<string, unknown>;
        const edge = payload["edge"] as GraphEdgePayload;
        expect(edge.target).toBe("pool:any");
      });
    });

    describe("publishHandoffCompleted", () => {
      test("publishes handoff edge removal", () => {
        const service = new GraphEventsService(mockHub);

        service.publishHandoffCompleted("workspace-1", "handoff-123");

        expect(publishCalls[0]?.type).toBe("graph.edge_removed");
        const payload = publishCalls[0]?.payload as Record<string, unknown>;
        const edge = payload["edge"] as GraphEdgePayload;
        expect(edge.id).toBe("handoff:handoff-123");
        expect(edge.type).toBe("handoff");
      });
    });

    describe("publishConflictDetected", () => {
      test("publishes node update and conflict edges", () => {
        const service = new GraphEventsService(mockHub);

        service.publishConflictDetected(
          "workspace-1",
          "conflict-123",
          "/src/shared.ts",
          ["agent-1", "agent-2"],
        );

        expect(publishCalls).toHaveLength(3);

        // First: node updated to conflict status
        const nodePayload = publishCalls[0]?.payload as Record<string, unknown>;
        const node = nodePayload["node"] as GraphNodePayload;
        expect(node.status).toBe("conflict");
        expect(node.data["conflicting"]).toBe(true);

        // Then: conflict edges for each agent
        for (let i = 1; i <= 2; i++) {
          const edgePayload = publishCalls[i]?.payload as Record<
            string,
            unknown
          >;
          const edge = edgePayload["edge"] as GraphEdgePayload;
          expect(edge.type).toBe("conflict");
        }
      });
    });

    describe("publishConflictResolved", () => {
      test("removes conflict edges and updates node status", () => {
        const service = new GraphEventsService(mockHub);

        service.publishConflictResolved(
          "workspace-1",
          "conflict-123",
          "/src/shared.ts",
          ["agent-1", "agent-2"],
        );

        expect(publishCalls).toHaveLength(3);

        // First two: edge removals
        expect(publishCalls[0]?.type).toBe("graph.edge_removed");
        expect(publishCalls[1]?.type).toBe("graph.edge_removed");

        // Last: node updated back to active
        const nodePayload = publishCalls[2]?.payload as Record<string, unknown>;
        const node = nodePayload["node"] as GraphNodePayload;
        expect(node.status).toBe("active");
        expect(node.data["conflicting"]).toBe(false);
      });
    });
  });

  describe("version increments", () => {
    test("each publish increments version", () => {
      const service = new GraphEventsService(mockHub);
      expect(service.getVersion()).toBe(1);

      const node: GraphNodePayload = {
        id: "test",
        type: "agent",
        label: "Test",
        status: "active",
        data: {},
      };

      service.publishNodeAdded("ws-1", node);
      expect(service.getVersion()).toBe(2);

      service.publishNodeRemoved("ws-1", "test", "agent");
      expect(service.getVersion()).toBe(3);

      service.publishFullRefresh("ws-1");
      expect(service.getVersion()).toBe(4);
    });
  });
});
