import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/connection";
import { alertChannels as alertChannelsTable } from "../db/schema/alert-channels";
import { routes } from "../routes";
import {
  discordAdapter,
  slackAdapter,
  webhookAdapter,
} from "../services/alert-adapters";
import {
  clearAllChannels,
  clearAllDeliveries,
  clearAllRules,
  createChannel,
  createRule,
  decryptChannelConfig,
  encryptChannelConfig,
  getAllChannelHealth,
  getChannel,
  getChannelHealth,
  getDeliveries,
  listChannels,
  listRules,
  routeAlert,
  testChannel,
  updateChannel,
  updateRule,
} from "../services/alert-channel.service";
import { fireAlert } from "../services/alerts";

describe("Alert Channels Service & Adapters (bd-3c0o3)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    clearAllDeliveries();
    clearAllRules();
    clearAllChannels();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearAllDeliveries();
    clearAllRules();
    clearAllChannels();
  });

  describe("Credential Encryption at Rest (AES-256-GCM)", () => {
    it("encrypts and decrypts channel configuration round-trip", () => {
      const config = {
        url: "https://hooks.example.com/services/T00/B00/secret-token-123",
        secret: "super-secret-hmac-key",
        headers: { Authorization: "Bearer tok_xyz" },
      };

      const encrypted = encryptChannelConfig(config);
      expect(encrypted.startsWith("enc:v1:")).toBe(true);
      expect(encrypted).not.toContain("secret-token-123");
      expect(encrypted).not.toContain("super-secret-hmac-key");

      const decrypted = decryptChannelConfig(encrypted);
      expect(decrypted).toEqual(config);
    });

    it("stores encrypted config in SQLite alert_channels table", () => {
      const channel = createChannel({
        name: "Encrypted Webhook",
        type: "webhook",
        config: {
          url: "https://hooks.example.com/secret-path",
          secret: "my-hmac-secret",
        },
      });

      const rows = db
        .select()
        .from(alertChannelsTable)
        .where(eq(alertChannelsTable.id, channel.id))
        .all();

      expect(rows.length).toBe(1);
      expect(rows[0]?.config.startsWith("enc:v1:")).toBe(true);
      expect(rows[0]?.config).not.toContain("my-hmac-secret");

      const loaded = getChannel(channel.id);
      expect(loaded?.config["secret"]).toBe("my-hmac-secret");
    });
  });

  describe("Webhook Adapter", () => {
    it("sends POST with default JSON payload and HMAC-SHA256 signature", async () => {
      const calls: Array<{
        url: string;
        init?: RequestInit;
      }> = [];

      globalThis.fetch = mock(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          calls.push({ url: String(input), ...(init && { init }) });
          return new Response("ok", { status: 200 });
        },
      ) as unknown as typeof fetch;

      const result = await webhookAdapter.send(
        {
          id: "alert_123",
          type: "budget_exceeded",
          title: "Budget Threshold Exceeded",
          body: "Spend reached 95%",
          severity: "critical",
          category: "cost",
          timestamp: "2026-10-14T00:00:00.000Z",
        },
        {
          url: "https://hooks.example.com/webhook",
          secret: "signing_secret_123",
          headers: { "X-Custom-Header": "custom-val" },
        },
      );

      expect(result.success).toBe(true);
      expect(result.responseStatus).toBe(200);
      expect(calls.length).toBe(1);

      const headers = calls[0]?.init?.headers as Record<string, string>;
      expect(headers["X-Flywheel-Alert-Id"]).toBe("alert_123");
      expect(headers["X-Flywheel-Event"]).toBe("alert.fired");
      expect(headers["X-Custom-Header"]).toBe("custom-val");
      expect(headers["X-Flywheel-Timestamp"]).toBeDefined();
      expect(headers["X-Flywheel-Signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);
    });

    it("supports custom payloadTemplate variable substitution", async () => {
      let capturedBody = "";
      globalThis.fetch = mock(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          capturedBody = String(init?.body ?? "");
          return new Response("ok", { status: 200 });
        },
      ) as unknown as typeof fetch;

      const result = await webhookAdapter.send(
        {
          id: "alert_tpl",
          type: "safety_violation",
          title: "Blocked rm -rf",
          body: "DCG blocked command",
          severity: "error",
          category: "safety",
        },
        {
          url: "https://hooks.example.com/custom",
          payloadTemplate:
            '{"alert":"{{id}}","sev":"{{severity}}","msg":"{{title}}: {{body}}"}',
        },
      );

      expect(result.success).toBe(true);
      expect(JSON.parse(capturedBody)).toEqual({
        alert: "alert_tpl",
        sev: "error",
        msg: "Blocked rm -rf: DCG blocked command",
      });
    });

    it("blocks private network URLs for SSRF protection", async () => {
      const result = await webhookAdapter.send(
        {
          id: "alert_ssrf",
          type: "test",
          title: "SSRF Test",
          body: "Should be blocked",
          severity: "info",
        },
        {
          url: "http://127.0.0.1:8080/internal",
        },
      );

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("SSRF_BLOCKED");
    });
  });

  describe("Slack Adapter", () => {
    it("formats Block Kit messages with escaped mrkdwn and channel overrides", async () => {
      let capturedBody: Record<string, unknown> = {};
      globalThis.fetch = mock(
        async (_input: RequestInfo | URL, init?: RequestInit) => {
          capturedBody = JSON.parse(String(init?.body ?? "{}"));
          return new Response("ok", { status: 200 });
        },
      ) as unknown as typeof fetch;

      const result = await slackAdapter.send(
        {
          id: "alert_slack_1",
          type: "agent_stalled",
          title: "Agent Stalled",
          body: "Agent <alpha> & <beta> stopped responding",
          severity: "warning",
          category: "agent",
          link: "https://gateway.example.com/agents/1",
        },
        {
          webhookUrl: "https://hooks.slack.com/services/T00/B00/X00",
          channel: "#ops-alerts",
          username: "Flywheel Bot",
          iconEmoji: ":robot_face:",
        },
      );

      expect(result.success).toBe(true);
      expect(capturedBody["channel"]).toBe("#ops-alerts");
      expect(capturedBody["username"]).toBe("Flywheel Bot");
      expect(capturedBody["icon_emoji"]).toBe(":robot_face:");
      const blocks = capturedBody["blocks"] as Array<Record<string, unknown>>;
      expect(Array.isArray(blocks)).toBe(true);
      expect(blocks.length).toBeGreaterThanOrEqual(4);
      const section = blocks[1] as { text: { text: string } };
      expect(section.text.text).toContain("&lt;alpha&gt; &amp; &lt;beta&gt;");
    });
  });

  describe("Discord Adapter", () => {
    it("formats rich embeds with severity color and thread_id query parameter", async () => {
      let capturedUrl = "";
      let capturedBody: Record<string, unknown> = {};
      globalThis.fetch = mock(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          capturedUrl = String(input);
          capturedBody = JSON.parse(String(init?.body ?? "{}"));
          return new Response("ok", { status: 204 });
        },
      ) as unknown as typeof fetch;

      const result = await discordAdapter.send(
        {
          id: "alert_discord_1",
          type: "circuit_open",
          title: "Circuit Breaker Open",
          body: "Service *cass* failed",
          severity: "critical",
          category: "resilience",
        },
        {
          webhookUrl: "https://discord.com/api/webhooks/123/abc",
          username: "Flywheel",
          threadId: "thread_99",
        },
      );

      expect(result.success).toBe(true);
      expect(capturedUrl).toBe(
        "https://discord.com/api/webhooks/123/abc?thread_id=thread_99",
      );
      const embeds = capturedBody["embeds"] as Array<Record<string, unknown>>;
      expect(embeds.length).toBe(1);
      expect(embeds[0]?.["color"]).toBe(0xdc3545); // Critical red
    });
  });

  describe("Routing Rules Engine, Throttling, and Retries", () => {
    it("routes alerts to matching channels based on severity and metadata conditions", async () => {
      const deliveredUrls: string[] = [];
      globalThis.fetch = mock(async (input: RequestInfo | URL) => {
        deliveredUrls.push(String(input));
        return new Response("ok", { status: 200 });
      }) as unknown as typeof fetch;

      const slackCh = createChannel({
        name: "Ops Slack",
        type: "slack",
        config: { webhookUrl: "https://hooks.slack.com/services/T1/B1/X1" },
      });
      const discordCh = createChannel({
        name: "Billing Discord",
        type: "discord",
        config: { webhookUrl: "https://discord.com/api/webhooks/1/2" },
      });

      createRule({
        name: "High Severity Ops",
        priority: 10,
        condition: {
          minSeverity: "error",
          metadataMatch: [{ field: "env", operator: "eq", value: "prod" }],
        },
        channelIds: [slackCh.id],
      });

      createRule({
        name: "Cost Alerts",
        priority: 20,
        condition: {
          categories: ["cost"],
        },
        channelIds: [discordCh.id],
      });

      const records = await routeAlert({
        id: "alert_route_1",
        type: "cost_spike",
        title: "Cost Spike in Prod",
        body: "Hourly burn exceeded threshold",
        severity: "critical",
        category: "cost",
        metadata: { env: "prod" },
      });

      expect(records.length).toBe(2);
      expect(records.every((r) => r.status === "sent")).toBe(true);
      expect(deliveredUrls.length).toBe(2);
    });

    it("throttles excessive alerts when rule throttleMaxAlerts is exceeded", async () => {
      globalThis.fetch = mock(
        async () => new Response("ok", { status: 200 }),
      ) as unknown as typeof fetch;

      const ch = createChannel({
        name: "Throttled Webhook",
        type: "webhook",
        config: { url: "https://hooks.example.com/throttle" },
      });

      createRule({
        name: "Max 2 Per Minute",
        condition: { alertTypes: ["storm_test"] },
        channelIds: [ch.id],
        throttleWindowSeconds: 60,
        throttleMaxAlerts: 2,
      });

      const r1 = await routeAlert({
        id: "a1",
        type: "storm_test",
        title: "Alert 1",
        body: "1",
        severity: "warning",
      });
      const r2 = await routeAlert({
        id: "a2",
        type: "storm_test",
        title: "Alert 2",
        body: "2",
        severity: "warning",
      });
      const r3 = await routeAlert({
        id: "a3",
        type: "storm_test",
        title: "Alert 3",
        body: "3",
        severity: "warning",
      });

      expect(r1.length).toBe(1);
      expect(r2.length).toBe(1);
      expect(r3.length).toBe(0); // Throttled by rule
    });

    it("retries transient failures with exponential backoff and succeeds", async () => {
      let attempts = 0;
      globalThis.fetch = mock(async () => {
        attempts++;
        if (attempts < 3) {
          return new Response("server error", { status: 502 });
        }
        return new Response("ok", { status: 200 });
      }) as unknown as typeof fetch;

      const ch = createChannel({
        name: "Flaky Webhook",
        type: "webhook",
        config: { url: "https://hooks.example.com/flaky" },
      });

      createRule({
        name: "Flaky Rule",
        condition: { alertTypes: ["retry_test"] },
        channelIds: [ch.id],
      });

      const records = await routeAlert({
        id: "alert_retry_ok",
        type: "retry_test",
        title: "Retry Test",
        body: "Should succeed on 3rd attempt",
        severity: "error",
      });

      expect(records.length).toBe(1);
      expect(records[0]?.status).toBe("sent");
      expect(records[0]?.attempts).toBe(3);
      expect(attempts).toBe(3);

      const health = getChannelHealth(ch.id);
      expect(health?.successCount).toBe(1);
      expect(health?.errorCount).toBe(0);
    });

    it("marks delivery failed and increments channel errorCount after maxAttempts", async () => {
      globalThis.fetch = mock(async () => {
        return new Response("unavailable", { status: 503 });
      }) as unknown as typeof fetch;

      const ch = createChannel({
        name: "Down Webhook",
        type: "webhook",
        config: { url: "https://hooks.example.com/down" },
      });

      createRule({
        name: "Down Rule",
        condition: { alertTypes: ["down_test"] },
        channelIds: [ch.id],
      });

      const records = await routeAlert({
        id: "alert_retry_fail",
        type: "down_test",
        title: "Down Test",
        body: "Always fails",
        severity: "critical",
      });

      expect(records.length).toBe(1);
      expect(records[0]?.status).toBe("failed");
      expect(records[0]?.attempts).toBe(3);

      const health = getChannelHealth(ch.id);
      expect(health?.errorCount).toBe(1);
      expect(health?.successRate).toBe(0);
    });
  });

  describe("REST API Routes (/alert-channels) & Alert Service Integration", () => {
    const app = new Hono().route("/", routes);

    it("supports full CRUD, rules, deliveries, health, and test-alert via HTTP", async () => {
      globalThis.fetch = mock(
        async () => new Response("ok", { status: 200 }),
      ) as unknown as typeof fetch;

      // 1. Create channel
      const createRes = await app.request("/alert-channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Prod Slack",
          type: "slack",
          config: {
            webhookUrl: "https://hooks.slack.com/services/T99/B99/secret99",
          },
        }),
      });
      expect(createRes.status).toBe(201);
      const createdBody = await createRes.json();
      const channelId = createdBody.data.id as string;
      // Config URL path should be masked in API response
      expect(createdBody.data.config.webhookUrl).toBe(
        "https://hooks.slack.com/***",
      );

      // 2. Create routing rule via POST /alert-channels/rules
      const ruleRes = await app.request("/alert-channels/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Route All Critical",
          priority: 1,
          condition: { minSeverity: "warning" },
          channelIds: [channelId],
        }),
      });
      expect(ruleRes.status).toBe(201);

      // 3. List rules via GET /alert-channels/rules (verifies /:id does not shadow /rules)
      const listRulesRes = await app.request("/alert-channels/rules");
      expect(listRulesRes.status).toBe(200);
      const rulesBody = await listRulesRes.json();
      expect(rulesBody.data.length).toBe(1);

      // 4. Send test alert via POST /alert-channels/test-alert
      const testAlertRes = await app.request("/alert-channels/test-alert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "custom_alert",
          title: "API Test Alert",
          body: "Testing routing via API",
          severity: "critical",
        }),
      });
      expect(testAlertRes.status).toBe(200);
      const testAlertBody = await testAlertRes.json();
      expect(testAlertBody.data.matchedChannels).toBe(1);

      // 5. List deliveries via GET /alert-channels/deliveries
      const delRes = await app.request("/alert-channels/deliveries");
      expect(delRes.status).toBe(200);
      const delBody = await delRes.json();
      expect(delBody.data.length).toBe(1);
      expect(delBody.data[0].status).toBe("sent");

      // 6. Check channel health via GET /alert-channels/health
      const healthRes = await app.request("/alert-channels/health");
      expect(healthRes.status).toBe(200);
      const healthBody = await healthRes.json();
      expect(healthBody.data[0].successCount).toBe(1);
    });

    it("automatically routes alerts fired via fireAlert()", async () => {
      let webhookCalled = false;
      globalThis.fetch = mock(async () => {
        webhookCalled = true;
        return new Response("ok", { status: 200 });
      }) as unknown as typeof fetch;

      const ch = createChannel({
        name: "Auto Fire Channel",
        type: "webhook",
        config: { url: "https://hooks.example.com/autofire" },
      });

      createRule({
        name: "Auto Fire Rule",
        condition: { minSeverity: "error" },
        channelIds: [ch.id],
      });

      fireAlert(
        {
          id: "rule_test_fire",
          name: "Test Fire Rule",
          description: "Fires an alert",
          type: "system_health",
          severity: "critical",
          enabled: true,
          condition: () => true,
          title: "System Critical",
          message: "Disk full",
        },
        {
          metrics: {
            agents: { total: 1, byStatus: {} },
            tokens: { last24h: 0, quotaUsedPercent: 0 },
            performance: { avgResponseMs: 10, successRate: 1, errorCount: 0 },
            system: { memoryUsageMb: 100, cpuPercent: 10, wsConnections: 0 },
          },
          correlationId: "corr_123",
          timestamp: new Date(),
        },
      );

      // Wait briefly for async routeAlert to complete
      await Bun.sleep(30);
      expect(webhookCalled).toBe(true);
      expect(getDeliveries({ channelId: ch.id }).length).toBe(1);
    });
  });
});
