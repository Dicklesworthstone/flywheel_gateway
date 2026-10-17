/**
 * Agent Auto-Recovery & Runbooks Unit + Integration Tests
 * (bd-hrs1t, bd-1f4kb, bd-3gbt7)
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import app from "../index";
import {
  clearRunbooksForTesting,
  createRunbook,
  getAgentRecoveryHistory,
  listRunbooks,
  simulateRunbookSandbox,
  triggerAgentRecovery,
} from "../services/runbook.service";

describe("Agent Auto-Recovery & Runbooks (bd-hrs1t, bd-1f4kb, bd-3gbt7)", () => {
  beforeEach(() => {
    clearRunbooksForTesting();
  });

  afterEach(() => {
    clearRunbooksForTesting();
  });

  test("DSL validation rejects runbooks with empty conditions or missing targetModel on downgrade_model (bd-1f4kb)", () => {
    expect(() =>
      createRunbook({
        name: "Invalid Empty Condition",
        condition: {},
        action: { type: "restart", requireApproval: false },
      }),
    ).toThrow(/at least one threshold predicate/i);

    expect(() =>
      createRunbook({
        name: "Invalid Model Downgrade",
        condition: { maxHealthScore: 40 },
        action: { type: "downgrade_model", requireApproval: false },
      }),
    ).toThrow(/targetModel is required/i);
  });

  test("triggers recovery for a stuck agent, blocks during cooldown, and prevents restart thrash via window caps (bd-3gbt7)", async () => {
    const rb = createRunbook({
      name: "Restart Stuck Agent",
      condition: {
        stuckDurationSeconds: 120,
        maxHealthScore: 50,
      },
      action: {
        type: "restart",
        requireApproval: false,
      },
      safetyRails: {
        cooldownSeconds: 60,
        maxActionsPerWindow: 2,
        windowSeconds: 3600,
        globalMaxActionsPerWindow: 10,
      },
    });

    const t0 = 1_700_000_000_000;
    const telemetry = {
      agentId: "agent-stuck-1",
      stuckDurationSeconds: 180,
      healthScore: 35,
    };

    // 1st trigger at t0 -> executes
    const r1 = await triggerAgentRecovery(telemetry, { nowMs: t0 });
    expect(r1.triggered).toBe(true);
    expect(r1.entries[0]?.status).toBe("executed");
    expect(r1.entries[0]?.explain.matched).toBe(true);

    // 2nd trigger 15s later -> blocked by 60s cooldown
    const r2 = await triggerAgentRecovery(telemetry, { nowMs: t0 + 15_000 });
    expect(r2.triggered).toBe(false);
    expect(r2.entries[0]?.status).toBe("blocked_safety_rail");
    expect(r2.entries[0]?.blockReason).toBe("cooldown");

    // 3rd trigger 70s later (cooldown elapsed) -> executes (2nd execution in window)
    const r3 = await triggerAgentRecovery(telemetry, { nowMs: t0 + 70_000 });
    expect(r3.triggered).toBe(true);
    expect(r3.entries[0]?.status).toBe("executed");

    // 4th trigger 140s later (cooldown elapsed, but maxActionsPerWindow=2 reached) -> blocked by agent_window_cap!
    const r4 = await triggerAgentRecovery(telemetry, { nowMs: t0 + 140_000 });
    expect(r4.triggered).toBe(false);
    expect(r4.entries[0]?.status).toBe("blocked_safety_rail");
    expect(r4.entries[0]?.blockReason).toBe("agent_window_cap");

    const history = getAgentRecoveryHistory("agent-stuck-1");
    expect(history.length).toBe(4);
    expect(history[0]?.runbookId).toBe(rb.id);
  });

  test("enforces globalMaxActionsPerWindow across multiple agents and approval gates for high-risk actions", async () => {
    createRunbook({
      name: "Global Cap & Approval Runbook",
      condition: { minErrorRatePercent: 50 },
      action: {
        type: "downgrade_model",
        targetModel: "claude-haiku-4-5",
        requireApproval: true,
      },
      safetyRails: {
        cooldownSeconds: 10,
        maxActionsPerWindow: 5,
        windowSeconds: 3600,
        globalMaxActionsPerWindow: 2,
      },
    });

    const t0 = 1_700_000_000_000;

    // Without approval -> pending_approval
    const unapproved = await triggerAgentRecovery(
      { agentId: "a1", errorRatePercent: 80 },
      { nowMs: t0, approved: false },
    );
    expect(unapproved.triggered).toBe(false);
    expect(unapproved.entries[0]?.status).toBe("pending_approval");
    expect(unapproved.entries[0]?.blockReason).toBe("approval_required");

    // Approved on a1 and a2 -> 2 global executions
    const exec1 = await triggerAgentRecovery(
      { agentId: "a1", errorRatePercent: 80 },
      { nowMs: t0 + 1_000, approved: true },
    );
    const exec2 = await triggerAgentRecovery(
      { agentId: "a2", errorRatePercent: 80 },
      { nowMs: t0 + 2_000, approved: true },
    );
    expect(exec1.triggered).toBe(true);
    expect(exec2.triggered).toBe(true);

    // 3rd agent a3 hits globalMaxActionsPerWindow=2 -> blocked by global_window_cap
    const exec3 = await triggerAgentRecovery(
      { agentId: "a3", errorRatePercent: 80 },
      { nowMs: t0 + 3_000, approved: true },
    );
    expect(exec3.triggered).toBe(false);
    expect(exec3.entries[0]?.blockReason).toBe("global_window_cap");
  });

  test("sandbox simulation evaluates historical traces without side effects and respects workspace inheritance", () => {
    const globalRb = createRunbook({
      name: "Global Rule",
      condition: { maxHealthScore: 40 },
      action: { type: "pause", requireApproval: false },
      safetyRails: {
        cooldownSeconds: 60,
        maxActionsPerWindow: 2,
        windowSeconds: 3600,
        globalMaxActionsPerWindow: 10,
      },
    });
    createRunbook({
      name: "Workspace-A Rule",
      workspaceId: "ws-a",
      condition: { maxHealthScore: 60 },
      action: { type: "notify", requireApproval: false },
    });

    expect(listRunbooks("ws-a").length).toBe(2);
    expect(listRunbooks("ws-b").length).toBe(1);

    const sim = simulateRunbookSandbox(globalRb, [
      {
        agentId: "sim-agent-1",
        healthScore: 80,
        timestamp: "2026-10-14T10:00:00.000Z",
      },
      {
        agentId: "sim-agent-1",
        healthScore: 30,
        timestamp: "2026-10-14T10:01:00.000Z",
      },
      {
        agentId: "sim-agent-1",
        healthScore: 25,
        timestamp: "2026-10-14T10:01:20.000Z",
      },
    ]);

    expect(sim.totalSamples).toBe(3);
    expect(sim.matchedCount).toBe(2);
    expect(sim.wouldExecuteCount).toBe(1);
    expect(sim.blockedByCooldownCount).toBe(1);
    // Sandbox must not mutate real recovery history
    expect(getAgentRecoveryHistory("sim-agent-1").length).toBe(0);
  });

  test("REST endpoints: POST /runbooks, POST /runbooks/:id/simulate, POST /runbooks/agents/:id/recover, GET /runbooks/agents/:id/history", async () => {
    const createRes = await app.request("/runbooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "API Stuck Agent Runbook",
        condition: { stuckDurationSeconds: 60 },
        action: { type: "interrupt", requireApproval: false },
      }),
    });
    expect(createRes.status).toBe(201);
    const createBody = await createRes.json();
    const runbookId = createBody.data.id as string;

    const simRes = await app.request(`/runbooks/${runbookId}/simulate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        samples: [{ agentId: "ag-1", stuckDurationSeconds: 90 }],
      }),
    });
    expect(simRes.status).toBe(200);
    const simBody = await simRes.json();
    expect(simBody.data.wouldExecuteCount).toBe(1);

    const recRes = await app.request("/runbooks/agents/ag-1/recover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        telemetry: { stuckDurationSeconds: 120 },
      }),
    });
    expect(recRes.status).toBe(200);
    const recBody = await recRes.json();
    expect(recBody.data.triggered).toBe(true);

    const histRes = await app.request("/runbooks/agents/ag-1/history");
    expect(histRes.status).toBe(200);
    const histBody = await histRes.json();
    expect(histBody.data.length).toBe(1);
    expect(histBody.data[0].explain.matched).toBe(true);
  });
});
