/**
 * Event Streaming API (Webhook and SSE) Tests (bd-2d0a3)
 */

import { beforeEach, describe, expect, test } from "bun:test";
import app from "../index";
import {
  clearEventStreamForTesting,
  createWebhookSubscription,
  listDeadLetterQueue,
  publishStreamEvent,
  setWebhookMaintenanceWindow,
  setWebhookSubscriptionEnabled,
  setWebhookTransportForTesting,
  verifyWebhookSignature,
  verifyWebhookSubscription,
} from "../services/event-stream.service";

describe("Event Streaming API — Webhooks and SSE (bd-2d0a3)", () => {
  beforeEach(() => {
    delete process.env["GATEWAY_ADMIN_KEY"];
    clearEventStreamForTesting();
  });

  test("enforces challenge/response verification, signs payloads with HMAC-SHA256, and respects maintenance windows", async () => {
    const sub = createWebhookSubscription({
      name: "ci-webhook",
      url: "https://example.com/webhook",
      secret: "topsecret12345",
      eventTypes: ["agent.spawned"],
      requireVerification: true,
    });
    expect(sub.verified).toBe(false);

    // Before verification, delivery is skipped
    const rUnverified = await publishStreamEvent({
      type: "agent.spawned",
      payload: { agentId: "a1" },
    });
    expect(rUnverified.receipts[0]?.status).toBe("skipped_unverified");

    // Verify challenge handshake
    const verified = verifyWebhookSubscription(sub.id, sub.challengeToken);
    expect(verified?.verified).toBe(true);

    let capturedBody = "";
    let capturedSig = "";
    setWebhookTransportForTesting(async ({ body, headers }) => {
      capturedBody = body;
      capturedSig = headers["X-Flywheel-Signature"] ?? "";
      return { ok: true, status: 200 };
    });

    const rDelivered = await publishStreamEvent({
      type: "agent.spawned",
      payload: { agentId: "a2" },
    });
    expect(rDelivered.receipts[0]?.status).toBe("delivered");
    expect(
      verifyWebhookSignature("topsecret12345", capturedBody, capturedSig),
    ).toBe(true);

    // Maintenance window suppresses delivery
    const now = Date.now();
    setWebhookMaintenanceWindow(sub.id, 15, now);
    const rMaint = await publishStreamEvent({
      type: "agent.spawned",
      payload: { agentId: "a3" },
      nowMs: now + 60_000,
    });
    expect(rMaint.receipts[0]?.status).toBe("suppressed_maintenance");

    // Disable subscription skips delivery
    setWebhookSubscriptionEnabled(sub.id, false);
    const rDisabled = await publishStreamEvent({
      type: "agent.spawned",
      payload: { agentId: "a4" },
      nowMs: now + 20 * 60_000,
    });
    expect(rDisabled.receipts[0]?.status).toBe("skipped_disabled");
  });

  test("retries failing webhook deliveries with exponential backoff and moves to DLQ after maxRetries", async () => {
    createWebhookSubscription({
      name: "flaky-webhook",
      url: "https://example.com/flaky",
      secret: "secretkey12345",
      eventTypes: ["*"],
      maxRetries: 3,
      baseDelayMs: 200,
      requireVerification: false,
    });

    setWebhookTransportForTesting(async () => ({
      ok: false,
      status: 503,
      error: "Service Unavailable",
    }));

    const res = await publishStreamEvent({
      type: "job.failed",
      payload: { jobId: "j1" },
    });

    expect(res.receipts[0]?.status).toBe("dlq");
    expect(res.receipts[0]?.attempts).toBe(3);
    expect(res.receipts[0]?.retryDelaysMs.length).toBe(2);
    expect(res.receipts[0]!.retryDelaysMs[1]!).toBeGreaterThan(
      res.receipts[0]!.retryDelaysMs[0]!,
    );

    const dlq = listDeadLetterQueue();
    expect(dlq.length).toBe(1);
    expect(dlq[0]?.lastError).toBe("Service Unavailable");
  });

  test("SSE endpoint /events/stream streams ordered events and supports Last-Event-ID / sinceSeq backfill", async () => {
    await app.request("/events/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "agent.started",
        payload: { id: "ag-1" },
      }),
    });
    await app.request("/events/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "agent.completed",
        payload: { id: "ag-1" },
      }),
    });

    const sseRes = await app.request("/events/stream?sinceSeq=1");
    expect(sseRes.status).toBe(200);
    expect(sseRes.headers.get("Content-Type")).toContain("text/event-stream");
    const text = await sseRes.text();
    expect(text).not.toContain("event: agent.started");
    expect(text).toContain("id: 2\nevent: agent.completed");
  });
});
