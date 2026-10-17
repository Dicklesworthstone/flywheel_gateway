import { describe, expect, it } from "bun:test";
import { GatewaySdkClient, GatewaySdkError } from "@flywheel/flywheel-clients";
import {
  agentCommands,
  allCommands,
  createCommandRegistry,
  generateClientSDK,
  generateClientTypes,
  runParityCheck,
} from "@flywheel/shared";
import {
  captureFailureDiagnosticBundle,
  categorizeTestFailure,
  createTestLogger,
  generateFlakeReport,
} from "@flywheel/test-utils";
import { Hono } from "hono";
import { collaboration } from "../routes/collaboration";
import { conflicts } from "../routes/conflicts";
import { events } from "../routes/events";
import { featureFlags } from "../routes/feature-flags";
import { health } from "../routes/health";
import { routing } from "../routes/routing";
import { ru } from "../routes/ru";
import { setup } from "../routes/setup";
import { slo } from "../routes/slo";
import { system } from "../routes/system";
import { wsReplay } from "../routes/ws-replay";

describe("CI Flake Diagnostics & Type-Safe Gateway Client SDK (bd-1r6vi, bd-3540m, bd-gpov5, bd-62hcq, bd-3ix6h, bd-2bacm, bd-ng6he, bd-rx9gg, bd-7ojci.6)", () => {
  it("categorizes test failures, generates flake reports, and captures correlated diagnostic bundles", () => {
    expect(categorizeTestFailure("Test timed out after 5000ms")).toBe(
      "timeout",
    );
    expect(
      categorizeTestFailure("page.goto failed: net::ERR_CONNECTION_REFUSED"),
    ).toBe("navigation");
    expect(categorizeTestFailure("locator.click waiting for element")).toBe(
      "selector",
    );
    expect(categorizeTestFailure("HTTP 503 Internal Server Error")).toBe(
      "server_5xx",
    );
    expect(categorizeTestFailure("expect(received).toBe(expected)")).toBe(
      "assertion",
    );

    const report = generateFlakeReport([
      {
        testName: "should connect to agent",
        passed: false,
        durationMs: 5010,
        attempt: 1,
        errorMessage: "Test timed out after 5000ms",
      },
      {
        testName: "should connect to agent",
        passed: true,
        durationMs: 420,
        attempt: 2,
      },
    ]);
    expect(report.flakyRecoveredOnRetry).toBe(1);
    expect(report.flakyTestNames).toContain("should connect to agent");
    expect(report.failureCategories.timeout).toBe(1);

    const logger = createTestLogger();
    logger.error("Connection failed during handshake", {
      correlationId: "corr-123",
    });
    logger.info("Unrelated log entry", {
      correlationId: "corr-other",
    });
    const bundle = captureFailureDiagnosticBundle({
      testName: "should connect to agent",
      errorMessage: "page.goto failed: net::ERR_CONNECTION_REFUSED",
      gatewayLogs: logger.entries,
      correlationId: "corr-123",
      tracePath: "/tmp/trace.zip",
    });
    expect(bundle.category).toBe("navigation");
    expect(bundle.correlationId).toBe("corr-123");
    expect(bundle.correlatedGatewayLogs.length).toBe(1);
    expect(bundle.artifacts.tracePath).toBe("/tmp/trace.zip");
  });

  it("emits real TypeScript input and output types from Zod command schemas across all 34 Gateway commands", () => {
    const registry = createCommandRegistry([...allCommands]);
    expect(registry.size).toBeGreaterThanOrEqual(34);
    expect(registry.categories().length).toBeGreaterThanOrEqual(16);

    const parity = runParityCheck(registry);
    expect(parity.failed).toBe(0);
    expect(parity.warnings).toBe(0);

    const typesCode = generateClientTypes(registry);
    const sdkCode = generateClientSDK(registry, {
      className: "GeneratedFlywheelClient",
    });

    expect(typesCode).not.toContain("unknown; // Infer from Zod schema");
    expect(typesCode).toContain("export namespace Agent");
    expect(typesCode).toContain("export namespace Approval");
    expect(typesCode).toContain("export namespace Checkpoint");
    expect(typesCode).toContain("export namespace Context");
    expect(typesCode).toContain("export namespace Featureflag");
    expect(typesCode).toContain("export namespace Costcap");
    expect(typesCode).toContain("workingDirectory: string;");
    expect(sdkCode).toContain("export class GeneratedFlywheelClient");
    expect(sdkCode).toContain("Promise<Agent.SpawnOutput>");
    expect(sdkCode).toContain("Promise<Approval.DecideOutput>");
    expect(sdkCode).toContain("Promise<Checkpoint.CompactOutput>");
    expect(agentCommands.length).toBe(7);
  });

  it("executes typed query, mutation, SSE stream, and structured error handling via GatewaySdkClient", async () => {
    const app = new Hono();
    app.route("/health", health);
    app.route("/routing", routing);
    app.route("/events", events);
    app.route("/conflicts", conflicts);
    app.route("/ru", ru);
    app.route("/setup", setup);
    app.route("/feature-flags", featureFlags);
    app.route("/slo", slo);
    app.route("/system", system);
    app.route("/ws-replay", wsReplay);
    app.route("/collaboration", collaboration);

    const client = new GatewaySdkClient({
      baseUrl: "http://localhost",
      token: "test-token",
      fetch: ((input: RequestInfo | URL, init?: RequestInit) =>
        Promise.resolve(app.request(input, init))) as typeof fetch,
    });

    // 1. Health check (GET /health)
    const healthRes = await client.health();
    expect(["healthy", "degraded"]).toContain(healthRes.status);

    // 2. Mutating routing evaluation (POST /routing/evaluate)
    const decision = await client.evaluateRouting({
      taskType: "coding",
      contextHeadroomPercent: 50,
    });
    expect(decision.model).toBeDefined();
    expect(decision.provider).toBeDefined();

    // 3. Publish event + SSE streaming (POST /events/publish + GET /events/stream)
    const pub = await client.publishEvent({
      type: "sdk.tested",
      source: "sdk-test",
      payload: { ok: true },
    });
    expect(pub.event.type).toBe("sdk.tested");

    const streamed: string[] = [];
    for await (const ev of client.streamEvents({
      types: "sdk.tested",
      sinceSeq: 0,
    })) {
      streamed.push(ev.type);
    }
    expect(streamed).toContain("sdk.tested");

    // 4. Expanded Wave 7 domain methods (bd-7ojci.6)
    const gitStatus = await client.getGitCoordStatus({
      repositoryId: "repo-sdk",
    });
    expect(gitStatus).toBeDefined();

    const ruStatus = await client.getRuSyncStatus();
    expect(ruStatus).toBeDefined();

    const installPlan = await client.getSetupInstallPlan({ platform: "linux" });
    expect(installPlan).toBeDefined();

    const flags = await client.listFeatureFlags();
    expect(Array.isArray(flags)).toBe(true);

    const sloList = await client.listSlos();
    expect(Array.isArray(sloList)).toBe(true);

    const maint = await client.getMaintenanceStatus();
    expect(maint["mode"]).toBeDefined();

    const replayStats = await client.getWsReplayStats();
    expect(replayStats["totalEvents"]).toBeDefined();

    const bridgeStatus = await client.getCollaborationBridgeStatus();
    expect(bridgeStatus["initialized"]).toBeDefined();

    // 5. Structured error handling on 400 validation error
    let caughtError: GatewaySdkError | undefined;
    try {
      await client.request("POST", "/routing/evaluate", {
        contextHeadroomPercent: 500,
      });
    } catch (err) {
      if (err instanceof GatewaySdkError) {
        caughtError = err;
      }
    }
    expect(caughtError).toBeDefined();
    expect(caughtError?.status).toBe(400);
  });
});
