import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  GraphBridgeService,
  resetGraphBridgeService,
} from "../services/graph-bridge";
import type { GraphEventsService } from "../services/graph-events";

describe("GraphBridgeService", () => {
  let mockGraphEvents: GraphEventsService;
  let _mockFetch: typeof fetch;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    resetGraphBridgeService();

    // Mock GraphEventsService
    mockGraphEvents = {
      publishNodeAdded: mock(() => {}),
      publishNodeRemoved: mock(() => {}),
      publishNodeUpdated: mock(() => {}),
      publishEdgeAdded: mock(() => {}),
      publishEdgeRemoved: mock(() => {}),
      publishEdgeUpdated: mock(() => {}),
      publishFullRefresh: mock(() => {}),
      publishStatsUpdate: mock(() => {}),
      getVersion: () => 1,
      incrementVersion: () => 2,
    } as unknown as GraphEventsService;

    // Store original fetch
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    // Restore original fetch
    globalThis.fetch = originalFetch;
  });

  describe("SSE mode", () => {
    it("should start SSE without blocking start()", async () => {
      const event = {
        type: "node_added",
        node: {
          id: "file:/src/test.ts",
          type: "file",
          data: { label: "test.ts", path: "/src/test.ts" },
          status: "active",
        },
        timestamp: new Date().toISOString(),
        version: 1,
      };

      globalThis.fetch = mock((_url: string, init?: RequestInit) => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
            );

            // Keep the stream open, but make sure `service.stop()` (which aborts
            // the fetch signal) deterministically terminates the read loop.
            init?.signal?.addEventListener("abort", () => controller.close(), {
              once: true,
            });
          },
        });

        return Promise.resolve(
          new Response(stream, {
            headers: { "content-type": "text/event-stream" },
          }),
        );
      }) as unknown as typeof fetch;

      const service = new GraphBridgeService({
        controlPlaneUrl: "http://localhost:8080",
        apiKey: "test-key",
        defaultWorkspaceId: "default",
        useSSE: true,
      });

      await Promise.race([
        service.start(mockGraphEvents),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error("start() timed out")), 1000),
        ),
      ]);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockGraphEvents.publishNodeAdded).toHaveBeenCalled();

      service.stop();
    });
  });

  describe("polling mode", () => {
    it("should poll control_plane for events", async () => {
      const mockResponse = {
        data: {
          data: [
            {
              type: "node_added",
              node: {
                id: "file:/src/test.ts",
                type: "file",
                data: { label: "test.ts", path: "/src/test.ts" },
                status: "active",
              },
              timestamp: new Date().toISOString(),
              version: 1,
            },
          ],
          currentVersion: 1,
        },
      };

      globalThis.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        } as Response),
      ) as unknown as typeof fetch;

      const service = new GraphBridgeService({
        controlPlaneUrl: "http://localhost:8080",
        apiKey: "test-key",
        defaultWorkspaceId: "default",
        useSSE: false,
        pollIntervalMs: 100,
      });

      await service.start(mockGraphEvents);

      // Wait for initial poll
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockGraphEvents.publishNodeAdded).toHaveBeenCalled();

      service.stop();
    });

    it("should respect sinceVersion parameter", async () => {
      let pollCount = 0;
      const fetchMock = mock((url: string) => {
        pollCount++;
        const sinceVersion = new URL(url).searchParams.get("sinceVersion");

        // First poll (sinceVersion=0) returns event
        if (sinceVersion === "0") {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                data: {
                  data: [
                    {
                      type: "node_added",
                      node: {
                        id: "file:/src/first.ts",
                        type: "file",
                        data: { label: "first.ts" },
                        status: "active",
                      },
                      timestamp: new Date().toISOString(),
                      version: 1,
                    },
                  ],
                  currentVersion: 1,
                },
              }),
          } as Response);
        }

        // Subsequent polls return empty
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: { data: [], currentVersion: 1 },
            }),
        } as Response);
      });

      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const service = new GraphBridgeService({
        controlPlaneUrl: "http://localhost:8080",
        apiKey: "test-key",
        defaultWorkspaceId: "default",
        useSSE: false,
        pollIntervalMs: 50,
      });

      await service.start(mockGraphEvents);

      // Wait for multiple polls
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(pollCount).toBeGreaterThan(1);
      // Should only publish once (from first poll)
      expect(mockGraphEvents.publishNodeAdded).toHaveBeenCalledTimes(1);

      service.stop();
    });

    it("should handle poll errors gracefully", async () => {
      let errorCount = 0;

      globalThis.fetch = mock(() => {
        errorCount++;
        if (errorCount <= 2) {
          return Promise.resolve({
            ok: false,
            status: 500,
          } as Response);
        }
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: { data: [], currentVersion: 0 },
            }),
        } as Response);
      }) as unknown as typeof fetch;

      const service = new GraphBridgeService({
        controlPlaneUrl: "http://localhost:8080",
        apiKey: "test-key",
        defaultWorkspaceId: "default",
        useSSE: false,
        pollIntervalMs: 50,
      });

      await service.start(mockGraphEvents);

      // Should not throw despite errors
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(errorCount).toBeGreaterThan(0);

      service.stop();
    });
  });

  describe("event handling", () => {
    it("should forward node_added events", async () => {
      const events = [
        {
          type: "node_added",
          node: {
            id: "agent:claude-1",
            type: "agent",
            data: {
              label: "Claude Agent",
              agentType: "claude",
            },
            status: "active",
          },
          timestamp: new Date().toISOString(),
          version: 1,
        },
      ];

      globalThis.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: { data: events, currentVersion: 1 },
            }),
        } as Response),
      ) as unknown as typeof fetch;

      const service = new GraphBridgeService({
        controlPlaneUrl: "http://localhost:8080",
        apiKey: "test-key",
        defaultWorkspaceId: "test-workspace",
        useSSE: false,
        pollIntervalMs: 100,
      });

      await service.start(mockGraphEvents);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockGraphEvents.publishNodeAdded).toHaveBeenCalledWith(
        "test-workspace",
        expect.objectContaining({
          id: "agent:claude-1",
          type: "agent",
          status: "active",
        }),
      );

      service.stop();
    });

    it("should forward edge_added events", async () => {
      const events = [
        {
          type: "edge_added",
          edge: {
            id: "reservation:/src/test.ts",
            source: "agent:claude-1",
            target: "file:/src/test.ts",
            type: "reservation",
            label: "reserved",
          },
          timestamp: new Date().toISOString(),
          version: 1,
        },
      ];

      globalThis.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: { data: events, currentVersion: 1 },
            }),
        } as Response),
      ) as unknown as typeof fetch;

      const service = new GraphBridgeService({
        controlPlaneUrl: "http://localhost:8080",
        apiKey: "test-key",
        defaultWorkspaceId: "test-workspace",
        useSSE: false,
        pollIntervalMs: 100,
      });

      await service.start(mockGraphEvents);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockGraphEvents.publishEdgeAdded).toHaveBeenCalledWith(
        "test-workspace",
        expect.objectContaining({
          id: "reservation:/src/test.ts",
          source: "agent:claude-1",
          target: "file:/src/test.ts",
          type: "reservation",
        }),
      );

      service.stop();
    });

    it("should forward node_removed events", async () => {
      const events = [
        {
          type: "node_removed",
          node: {
            id: "file:/src/deleted.ts",
            type: "file",
            data: {},
            status: "idle",
          },
          timestamp: new Date().toISOString(),
          version: 1,
        },
      ];

      globalThis.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: { data: events, currentVersion: 1 },
            }),
        } as Response),
      ) as unknown as typeof fetch;

      const service = new GraphBridgeService({
        controlPlaneUrl: "http://localhost:8080",
        apiKey: "test-key",
        defaultWorkspaceId: "test-workspace",
        useSSE: false,
        pollIntervalMs: 100,
      });

      await service.start(mockGraphEvents);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockGraphEvents.publishNodeRemoved).toHaveBeenCalledWith(
        "test-workspace",
        "file:/src/deleted.ts",
        "file",
      );

      service.stop();
    });

    it("should forward edge_removed events", async () => {
      const events = [
        {
          type: "edge_removed",
          edge: {
            id: "reservation:/src/test.ts",
            source: "",
            target: "",
            type: "reservation",
          },
          timestamp: new Date().toISOString(),
          version: 1,
        },
      ];

      globalThis.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: { data: events, currentVersion: 1 },
            }),
        } as Response),
      ) as unknown as typeof fetch;

      const service = new GraphBridgeService({
        controlPlaneUrl: "http://localhost:8080",
        apiKey: "test-key",
        defaultWorkspaceId: "test-workspace",
        useSSE: false,
        pollIntervalMs: 100,
      });

      await service.start(mockGraphEvents);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockGraphEvents.publishEdgeRemoved).toHaveBeenCalledWith(
        "test-workspace",
        "reservation:/src/test.ts",
        "reservation",
      );

      service.stop();
    });

    it("should forward full_refresh events", async () => {
      const events = [
        {
          type: "full_refresh",
          stats: {
            totalNodes: 5,
            nodesByType: { agent: 2, file: 3, bead: 0 },
            totalEdges: 3,
            edgesByType: {
              reservation: 2,
              handoff: 1,
              message: 0,
              dependency: 0,
              conflict: 0,
            },
            activeAgents: 2,
            conflictCount: 0,
            pendingHandoffs: 1,
            activeMessages: 0,
          },
          timestamp: new Date().toISOString(),
          version: 1,
        },
      ];

      globalThis.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: { data: events, currentVersion: 1 },
            }),
        } as Response),
      ) as unknown as typeof fetch;

      const service = new GraphBridgeService({
        controlPlaneUrl: "http://localhost:8080",
        apiKey: "test-key",
        defaultWorkspaceId: "test-workspace",
        useSSE: false,
        pollIntervalMs: 100,
      });

      await service.start(mockGraphEvents);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockGraphEvents.publishFullRefresh).toHaveBeenCalledWith(
        "test-workspace",
        expect.objectContaining({
          totalNodes: 5,
          activeAgents: 2,
        }),
      );

      service.stop();
    });
  });

  describe("lifecycle", () => {
    it("should not start twice", async () => {
      globalThis.fetch = mock(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: { data: [], currentVersion: 0 },
            }),
        } as Response),
      ) as unknown as typeof fetch;

      const service = new GraphBridgeService({
        controlPlaneUrl: "http://localhost:8080",
        apiKey: "test-key",
        defaultWorkspaceId: "default",
        useSSE: false,
        pollIntervalMs: 100,
      });

      await service.start(mockGraphEvents);
      await service.start(mockGraphEvents); // Should be no-op

      // Should not throw
      service.stop();
    });

    it("should stop cleanly", async () => {
      let fetchCallCount = 0;
      globalThis.fetch = mock(() => {
        fetchCallCount++;
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              data: { data: [], currentVersion: 0 },
            }),
        } as Response);
      }) as unknown as typeof fetch;

      const service = new GraphBridgeService({
        controlPlaneUrl: "http://localhost:8080",
        apiKey: "test-key",
        defaultWorkspaceId: "default",
        useSSE: false,
        pollIntervalMs: 50,
      });

      await service.start(mockGraphEvents);

      // Wait for polling to start
      await new Promise((resolve) => setTimeout(resolve, 100));

      const fetchCallsBefore = fetchCallCount;
      service.stop();

      await new Promise((resolve) => setTimeout(resolve, 100));

      const fetchCallsAfter = fetchCallCount;

      // After stopping, should not have made significantly more calls
      // Allow 1 extra call that might have been in-flight
      expect(fetchCallsAfter - fetchCallsBefore).toBeLessThanOrEqual(1);
    });
  });
});
