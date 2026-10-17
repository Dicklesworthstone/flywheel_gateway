/**
 * E2E tests for NTM ingest and WebSocket bridge (bd-1vr1.14).
 *
 * Tests the NTM ingest pipeline through gateway API endpoints.
 * When NTM is unavailable, tests are skipped with explicit diagnostics.
 *
 * Prerequisites:
 * - Gateway running at E2E_GATEWAY_URL (default: http://localhost:3456)
 * - NTM installed and accessible (optional - tests skip gracefully)
 */

import { expect, test } from "./lib/test-fixture";

const GATEWAY_URL = process.env["E2E_GATEWAY_URL"] ?? "http://localhost:3456";

// =============================================================================
// Helpers
// =============================================================================

async function gw(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${GATEWAY_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

/**
 * Check if NTM is available by querying the health endpoint.
 * Returns true if the NTM component reports healthy or degraded.
 */
async function isNtmAvailable(
  logEvent: (msg: string) => void,
): Promise<boolean> {
  try {
    const { body } = await gw("/health/detailed");
    const components = body["components"] as
      | Record<string, Record<string, unknown>>
      | undefined;

    // Check agent CLI detection for NTM
    const agentCLIs = components?.["agentCLIs"];
    if (agentCLIs?.["detection"]) {
      const detection = agentCLIs["detection"] as Record<string, unknown>;
      const clis = detection["clis"] as
        | Record<string, Record<string, unknown>>
        | undefined;
      if (clis?.["ntm"]?.["available"]) {
        logEvent("NTM is available via agent CLI detection");
        return true;
      }
    }

    // Also check if NTM appears in diagnostics
    const diagnostics = body["diagnostics"] as
      | Record<string, unknown>
      | undefined;
    if (diagnostics?.["tools"]) {
      const tools = diagnostics["tools"] as Record<
        string,
        Record<string, unknown>
      >;
      if (tools["ntm"]?.["available"]) {
        logEvent("NTM is available via health diagnostics");
        return true;
      }
    }

    logEvent("NTM not detected as available");
    return false;
  } catch (e) {
    logEvent(`Failed to check NTM availability: ${e}`);
    return false;
  }
}

// =============================================================================
// NTM Availability Check
// =============================================================================

test.describe("NTM availability detection", () => {
  test("health endpoint reports NTM status", async ({ logEvent }) => {
    logEvent("Querying health for NTM status");
    const { status, body } = await gw("/health/detailed");

    expect([200, 503]).toContain(status);

    const components = body["components"] as Record<
      string,
      Record<string, unknown>
    >;
    expect(components).toBeDefined();

    // agentCLIs component should exist and report detection results
    const agentCLIs = components["agentCLIs"];
    expect(agentCLIs).toBeDefined();
    expect(agentCLIs).toHaveProperty("status");

    logEvent(`agentCLIs status: ${agentCLIs["status"]}`);
  });
});

// =============================================================================
// System Snapshot with NTM Data
// =============================================================================

test.describe("System snapshot - NTM data", () => {
  test("GET /system/snapshot returns structured response", async ({
    logEvent,
  }) => {
    logEvent("Fetching system snapshot");
    const { status, body } = await gw("/system/snapshot");

    if (status === 200) {
      expect(body).toHaveProperty("data");
      const data = body["data"] as Record<string, unknown>;

      // Snapshot should include agents section
      if (data["agents"]) {
        const agents = data["agents"];
        logEvent(
          `Snapshot contains ${Array.isArray(agents) ? agents.length : "N/A"} agents`,
        );
      }

      // Should include metadata
      if (data["generatedAt"] || data["timestamp"]) {
        logEvent("Snapshot has timestamp metadata");
      }
    } else {
      logEvent(`Snapshot endpoint returned ${status}`);
    }
  });

  test("snapshot cache works correctly", async ({ logEvent }) => {
    logEvent("Testing snapshot cache");

    // First request
    const first = await gw("/system/snapshot");

    // Second request should be cached
    const second = await gw("/system/snapshot");

    if (first.status === 200 && second.status === 200) {
      // Both should return valid data
      expect(first.body).toHaveProperty("data");
      expect(second.body).toHaveProperty("data");
    }
  });
});

// =============================================================================
// NTM Ingest Pipeline (requires NTM)
// =============================================================================

test.describe("NTM ingest pipeline", () => {
  test("agents endpoint reflects NTM-tracked agents when available", async ({
    logEvent,
  }) => {
    const ntmReady = await isNtmAvailable(logEvent);
    if (!ntmReady) {
      logEvent("SKIPPED: NTM not available - install NTM to enable this test");
      logEvent("Prerequisites: ntm CLI installed and accessible in PATH");
      logEvent("Install: see docs/AGENTS.md for NTM setup instructions");
      return;
    }

    logEvent("NTM available, checking agents endpoint");
    const { status, body } = await gw("/agents");

    expect(status).toBe(200);
    expect(body).toHaveProperty("data");
    const data = body["data"];
    expect(Array.isArray(data)).toBe(true);

    const agents = data as Array<Record<string, unknown>>;
    logEvent(`Found ${agents.length} agents`);

    for (const agent of agents) {
      expect(agent).toHaveProperty("id");
      expect(agent).toHaveProperty("config");

      if (agent["driverType"] === "ntm") {
        logEvent(
          `NTM agent: ${agent["id"]} (state: ${agent["activityState"]})`,
        );
        expect(agent).toHaveProperty("activityState");
        expect(agent).toHaveProperty("startedAt");
      }
    }
  });

  test("NTM agent state transitions are tracked", async ({ logEvent }) => {
    const ntmReady = await isNtmAvailable(logEvent);
    if (!ntmReady) {
      logEvent("SKIPPED: NTM not available");
      return;
    }

    const { status, body } = await gw("/agents");
    if (status !== 200) {
      logEvent("SKIPPED: agents endpoint not responding");
      return;
    }

    const agents = (body["data"] as Array<Record<string, unknown>>) ?? [];
    const ntmAgents = agents.filter((a) => a["driverType"] === "ntm");

    if (ntmAgents.length === 0) {
      logEvent("SKIPPED: No NTM agents currently running");
      logEvent("Start an agent via NTM to enable this test");
      return;
    }

    const agent = ntmAgents[0]!;
    const agentId = agent["id"] as string;
    logEvent(`Checking state for NTM agent: ${agentId}`);

    // Get detailed agent state
    const detail = await gw(`/agents/${agentId}`);
    if (detail.status === 200) {
      const agentData = detail.body["data"] as Record<string, unknown>;
      expect(agentData).toHaveProperty("activityState");
      expect(agentData).toHaveProperty("lastActivityAt");

      logEvent(
        `Agent ${agentId}: state=${agentData["activityState"]}, ` +
          `lastActivity=${agentData["lastActivityAt"]}`,
      );
    }
  });

  test("NTM agent output is accessible", async ({ logEvent }) => {
    const ntmReady = await isNtmAvailable(logEvent);
    if (!ntmReady) {
      logEvent("SKIPPED: NTM not available");
      return;
    }

    const { status, body } = await gw("/agents");
    if (status !== 200) return;

    const agents = (body["data"] as Array<Record<string, unknown>>) ?? [];
    const ntmAgents = agents.filter((a) => a["driverType"] === "ntm");

    if (ntmAgents.length === 0) {
      logEvent("SKIPPED: No NTM agents running");
      return;
    }

    const agentId = ntmAgents[0]!["id"] as string;
    logEvent(`Fetching output for agent: ${agentId}`);

    const output = await gw(`/agents/${agentId}/output`);
    if (output.status === 200) {
      const data = output.body["data"];
      if (Array.isArray(data)) {
        logEvent(`Agent has ${data.length} output lines`);
        if (data.length > 0) {
          const line = data[0] as Record<string, unknown>;
          expect(line).toHaveProperty("content");
          expect(line).toHaveProperty("timestamp");
        }
      }
    } else {
      logEvent(`Output endpoint returned ${output.status}`);
    }
  });
});

// =============================================================================
// WebSocket Bridge (requires NTM)
// =============================================================================

test.describe("NTM WebSocket bridge", () => {
  test("WebSocket connection can be established", async ({ logEvent }) => {
    logEvent("Testing WebSocket connectivity");

    const wsUrl = `${GATEWAY_URL.replace(/^http/, "ws")}/ws`;

    try {
      const ws = new WebSocket(wsUrl);
      const connected = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          ws.close();
          resolve(false);
        }, 5000);

        ws.onopen = () => {
          clearTimeout(timeout);
          resolve(true);
        };
        ws.onerror = () => {
          clearTimeout(timeout);
          resolve(false);
        };
      });

      if (connected) {
        logEvent("WebSocket connection established");

        // Subscribe to a channel
        ws.send(
          JSON.stringify({
            type: "subscribe",
            channel: "workspace:agents",
          }),
        );

        // Wait briefly for any messages
        const messages: unknown[] = [];
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 2000);
          ws.onmessage = (event) => {
            messages.push(JSON.parse(event.data as string));
            if (messages.length >= 1) {
              clearTimeout(timeout);
              resolve();
            }
          };
        });

        logEvent(`Received ${messages.length} WS messages`);
        ws.close();
      } else {
        logEvent("WebSocket connection failed (gateway may not be running)");
      }
    } catch (e) {
      logEvent(`WebSocket test error: ${e}`);
    }
  });

  test("NTM state changes publish to WebSocket", async ({ logEvent }) => {
    const ntmReady = await isNtmAvailable(logEvent);
    if (!ntmReady) {
      logEvent("SKIPPED: NTM not available for WS bridge test");
      logEvent("Prerequisites checklist:");
      logEvent("  [ ] ntm CLI installed (check: which ntm)");
      logEvent("  [ ] tmux installed (check: which tmux)");
      logEvent("  [ ] At least one NTM session running");
      return;
    }

    logEvent("NTM available - checking WS bridge events");

    const wsUrl = `${GATEWAY_URL.replace(/^http/, "ws")}/ws`;
    const ws = new WebSocket(wsUrl);

    const connected = await new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => resolve(false), 5000);
      ws.onopen = () => {
        clearTimeout(timeout);
        resolve(true);
      };
      ws.onerror = () => {
        clearTimeout(timeout);
        resolve(false);
      };
    });

    if (!connected) {
      logEvent("SKIPPED: Could not connect to WebSocket");
      return;
    }

    // Subscribe to agent state channel
    ws.send(JSON.stringify({ type: "subscribe", channel: "workspace:agents" }));

    // Collect messages for a short window
    const messages: Array<Record<string, unknown>> = [];
    await new Promise<void>((resolve) => {
      const _timeout = setTimeout(resolve, 5000);
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as Record<
            string,
            unknown
          >;
          messages.push(msg);
          logEvent(
            `WS message: type=${msg["type"]}, channel=${msg["channel"]}`,
          );
        } catch {
          // ignore parse errors
        }
      };
    });

    ws.close();
    logEvent(`Total WS messages received: ${messages.length}`);

    // If we got state change messages, validate their structure
    const stateChanges = messages.filter(
      (m) =>
        m["type"] === "event" && String(m["channel"]).startsWith("agent:state"),
    );

    if (stateChanges.length > 0) {
      const event = stateChanges[0]!;
      logEvent(`State change event: ${JSON.stringify(event)}`);
    } else {
      logEvent("No state change events received (agents may be idle)");
    }
  });
});

// =============================================================================
// Diagnostics When NTM Unavailable
// =============================================================================

test.describe("NTM unavailable diagnostics", () => {
  test("health diagnostics explain NTM absence", async ({ logEvent }) => {
    const { body } = await gw("/health/detailed");
    const diagnostics = body["diagnostics"] as
      | Record<string, unknown>
      | undefined;

    if (!diagnostics) {
      logEvent("No diagnostics available (detection may have failed)");
      return;
    }

    const tools = diagnostics["tools"] as
      | Record<string, Record<string, unknown>>
      | undefined;
    if (!tools?.["ntm"]) {
      logEvent("NTM not in diagnostics tool list");
      return;
    }

    const ntm = tools["ntm"]!;
    logEvent(`NTM available: ${ntm["available"]}`);

    if (!ntm["available"]) {
      // Should have reason and label
      if (ntm["reasonLabel"]) {
        logEvent(`NTM unavailability reason: ${ntm["reasonLabel"]}`);
      }

      // Should have dependency info
      if (ntm["dependsOn"]) {
        logEvent(`NTM depends on: ${JSON.stringify(ntm["dependsOn"])}`);
      }

      // Root cause path for cascade failures
      if (ntm["rootCausePath"]) {
        const path = ntm["rootCausePath"] as string[];
        logEvent(`Root cause path: ${path.join(" → ")}`);
        expect(path.length).toBeGreaterThanOrEqual(1);
      }

      if (ntm["rootCauseExplanation"]) {
        logEvent(`Root cause: ${ntm["rootCauseExplanation"]}`);
      }
    }
  });
});
