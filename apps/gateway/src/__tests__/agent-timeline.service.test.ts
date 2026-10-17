/**
 * Agent Session Replay and Timeline Tests (bd-67lwz)
 */

import { beforeEach, describe, expect, test } from "bun:test";
import app from "../index";
import {
  appendAgentTimelineEvent,
  clearAgentTimelineForTesting,
  exportAgentTimeline,
  getAgentTimelineEvent,
  pruneAgentTimelineEvents,
  queryAgentTimeline,
} from "../services/agent-timeline.service";

describe("Agent Session Replay and Timeline (bd-67lwz)", () => {
  beforeEach(() => {
    clearAgentTimelineForTesting();
  });

  test("normalizes and redacts sensitive secrets from summary and payload on append", () => {
    const ev = appendAgentTimelineEvent("agent-replay-1", {
      type: "tool.call",
      severity: "info",
      summary:
        "Executed curl with token ghp_1234567890abcdefghijklmnopqrstuvwxyzABCD",
      correlationId: "corr-101",
      durationMs: 42,
      payload: {
        command:
          "curl -H 'Authorization: Bearer sk-ant-api03-secret12345678901234567890'",
        apiKey: "super-secret-value",
        password: "my-secret-password",
      },
    });

    expect(ev.summary).not.toContain(
      "ghp_1234567890abcdefghijklmnopqrstuvwxyzABCD",
    );
    expect(JSON.stringify(ev.payload)).not.toContain("super-secret-value");
    expect(ev.payload["apiKey"]).toBe("super***lue");
    expect(ev.payload["password"]).toBe("[REMOVED]");

    const fetched = getAgentTimelineEvent("agent-replay-1", ev.id);
    expect(fetched?.id).toBe(ev.id);
  });

  test("supports cursor pagination (forward & backward) and filtering by type, severity, search, and time", () => {
    const t0 = 1_700_000_000_000;
    appendAgentTimelineEvent("agent-replay-2", {
      type: "agent.state",
      severity: "info",
      summary: "Agent spawned",
      timestamp: new Date(t0).toISOString(),
    });
    appendAgentTimelineEvent("agent-replay-2", {
      type: "tool.call",
      severity: "info",
      summary: "Running bun test",
      correlationId: "corr-xyz",
      timestamp: new Date(t0 + 1000).toISOString(),
    });
    appendAgentTimelineEvent("agent-replay-2", {
      type: "error",
      severity: "error",
      summary: "SQLite busy timeout",
      correlationId: "corr-xyz",
      timestamp: new Date(t0 + 2000).toISOString(),
    });
    appendAgentTimelineEvent("agent-replay-2", {
      type: "recovery.triggered",
      severity: "warning",
      summary: "Auto-recovery restarted agent",
      timestamp: new Date(t0 + 3000).toISOString(),
    });

    // Forward pagination page 1 (limit 2)
    const page1 = queryAgentTimeline("agent-replay-2", {
      limit: 2,
      direction: "forward",
    });
    expect(page1.events.length).toBe(2);
    expect(page1.hasMore).toBe(true);
    expect(page1.events[0]?.type).toBe("agent.state");
    expect(page1.events[1]?.type).toBe("tool.call");

    // Forward pagination page 2
    const page2 = queryAgentTimeline("agent-replay-2", {
      limit: 2,
      direction: "forward",
      cursor: Number(page1.nextCursor),
    });
    expect(page2.events.length).toBe(2);
    expect(page2.hasMore).toBe(false);
    expect(page2.events[0]?.type).toBe("error");
    expect(page2.events[1]?.type).toBe("recovery.triggered");

    // Backward pagination
    const backward = queryAgentTimeline("agent-replay-2", {
      limit: 2,
      direction: "backward",
    });
    expect(backward.events[0]?.type).toBe("recovery.triggered");
    expect(backward.events[1]?.type).toBe("error");

    // Filter by correlationId and search
    const filtered = queryAgentTimeline("agent-replay-2", {
      correlationId: "corr-xyz",
      search: "sqlite",
    });
    expect(filtered.events.length).toBe(1);
    expect(filtered.events[0]?.type).toBe("error");
  });

  test("prunes expired events by retention policy and exports JSON/CSV", () => {
    const now = Date.now();
    const tenDaysAgo = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString();
    const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString();

    appendAgentTimelineEvent("agent-replay-3", {
      type: "agent.state",
      severity: "info",
      summary: "Old session start",
      timestamp: tenDaysAgo,
    });
    appendAgentTimelineEvent("agent-replay-3", {
      type: "tool.result",
      severity: "info",
      summary: "Recent tool result",
      timestamp: oneHourAgo,
    });

    const pruned = pruneAgentTimelineEvents(7, now);
    expect(pruned).toBe(1);

    const remaining = queryAgentTimeline("agent-replay-3");
    expect(remaining.events.length).toBe(1);
    expect(remaining.events[0]?.summary).toBe("Recent tool result");

    const csvExport = exportAgentTimeline("agent-replay-3", "csv");
    expect(csvExport.contentType).toContain("text/csv");
    expect(csvExport.body).toContain("Recent tool result");
  });

  test("REST endpoints /agents/:agentId/timeline, /events/:eventId, and /timeline/export work end-to-end", async () => {
    const postRes = await app.request("/agents/agent-rest-tl/timeline", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "mail.sent",
        severity: "info",
        summary: "Sent coordination message to peer agent",
        correlationId: "thread-42",
        payload: { recipient: "BlueLake" },
      }),
    });
    expect(postRes.status).toBe(201);
    const postBody = (await postRes.json()) as { data: { id: string } };
    const eventId = postBody.data.id;

    const listRes = await app.request(
      "/agents/agent-rest-tl/timeline?types=mail.sent",
    );
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as {
      data: Array<{ id: string; summary: string }>;
    };
    expect(listBody.data.length).toBe(1);
    expect(listBody.data[0]?.id).toBe(eventId);

    const singleRes = await app.request(
      `/agents/agent-rest-tl/events/${eventId}`,
    );
    expect(singleRes.status).toBe(200);

    const exportRes = await app.request(
      "/agents/agent-rest-tl/timeline/export?format=json",
    );
    expect(exportRes.status).toBe(200);
    const exportedJson = (await exportRes.json()) as { totalEvents: number };
    expect(exportedJson.totalEvents).toBe(1);
  });
});
