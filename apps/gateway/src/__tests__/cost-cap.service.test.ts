/**
 * Workspace Cost Caps and Auto-Throttle Tests (bd-1weoa)
 */

import { beforeEach, describe, expect, test } from "bun:test";
import app from "../index";
import {
  clearCostCapsForTesting,
  createCostCapOverride,
  evaluateWorkspaceCostCap,
  exportWorkspaceCostCapReport,
  recordWorkspaceSpend,
  upsertCostCapPolicy,
} from "../services/cost-cap.service";

describe("Workspace Cost Caps and Auto-Throttle (bd-1weoa)", () => {
  beforeEach(() => {
    delete process.env["GATEWAY_ADMIN_KEY"];
    clearCostCapsForTesting();
  });

  test("enforces soft cap downgrade and hard cap pause with safety floor for essential operations", async () => {
    upsertCostCapPolicy({
      workspaceId: "ws-budget-1",
      period: "daily",
      softCapUsd: 50,
      hardCapUsd: 100,
      safetyFloorEssentialAgents: 1,
      downgradeModel: { provider: "openai", model: "gpt-4.1-mini" },
      actions: {
        onSoftCap: "downgrade",
        onHardCap: "pause",
      },
    });

    // Under soft cap
    await recordWorkspaceSpend({ workspaceId: "ws-budget-1", amountUsd: 25 });
    const eval1 = await evaluateWorkspaceCostCap({
      workspaceId: "ws-budget-1",
    });
    expect(eval1.allowed).toBe(true);
    expect(eval1.status).toBe("within_budget");

    // Exceed soft cap ($60 >= $50)
    await recordWorkspaceSpend({ workspaceId: "ws-budget-1", amountUsd: 35 });
    const eval2 = await evaluateWorkspaceCostCap({
      workspaceId: "ws-budget-1",
    });
    expect(eval2.allowed).toBe(true);
    expect(eval2.status).toBe("soft_cap_exceeded");
    expect(eval2.action).toBe("downgrade");
    expect(eval2.downgradedTo?.model).toBe("gpt-4.1-mini");

    // Exceed hard cap ($110 >= $100)
    await recordWorkspaceSpend({ workspaceId: "ws-budget-1", amountUsd: 50 });
    const eval3 = await evaluateWorkspaceCostCap({
      workspaceId: "ws-budget-1",
    });
    expect(eval3.allowed).toBe(false);
    expect(eval3.status).toBe("hard_cap_exceeded");
    expect(eval3.action).toBe("pause");

    // Essential operation with 0 active essential agents is allowed via safety floor
    const evalFloor = await evaluateWorkspaceCostCap({
      workspaceId: "ws-budget-1",
      isEssentialOperation: true,
      activeEssentialAgents: 0,
    });
    expect(evalFloor.allowed).toBe(true);
    expect(evalFloor.status).toBe("safety_floor_allowed");
  });

  test("detects spend anomalies vs baseline, auto-suppresses known events, and supports temporary overrides", async () => {
    upsertCostCapPolicy({
      workspaceId: "ws-anom",
      softCapUsd: 100,
      hardCapUsd: 200,
      baselineHourlyUsd: 10,
      anomalySpikeMultiplier: 2, // threshold = $20
      suppressKnownEventTypes: ["scheduled_batch_eval"],
      actions: { onSoftCap: "notify", onHardCap: "pause" },
    });

    // Known event spike is auto-suppressed
    const s1 = await recordWorkspaceSpend({
      workspaceId: "ws-anom",
      amountUsd: 30,
      eventType: "scheduled_batch_eval",
    });
    expect(s1.anomalyDetected).toBe(true);
    expect(s1.anomalySuppressed).toBe(true);

    // Unexpected spike fires anomaly
    const s2 = await recordWorkspaceSpend({
      workspaceId: "ws-anom",
      amountUsd: 180,
      eventType: "ad_hoc_run",
    });
    expect(s2.anomalyDetected).toBe(true);
    expect(s2.anomalySuppressed).toBe(false);

    // Total spend is now $210 (>= $200 hard cap) -> blocked
    const blocked = await evaluateWorkspaceCostCap({ workspaceId: "ws-anom" });
    expect(blocked.allowed).toBe(false);

    // Apply temporary override of +$50
    createCostCapOverride({
      workspaceId: "ws-anom",
      additionalBudgetUsd: 50,
      expiresInMinutes: 30,
      reason: "Release hotfix verification",
      actor: "lead-eng",
    });

    const unblocked = await evaluateWorkspaceCostCap({
      workspaceId: "ws-anom",
    });
    expect(unblocked.allowed).toBe(true);
    expect(unblocked.effectiveHardCapUsd).toBe(250);

    const report = exportWorkspaceCostCapReport("ws-anom");
    expect(report.currentSpendUsd).toBe(210);
    expect(report.auditTrail.length).toBeGreaterThanOrEqual(4);
  });

  test("REST endpoints /cost-caps, /cost-caps/spend, /cost-caps/evaluate, and /cost-caps/:ws/report work end-to-end", async () => {
    const putRes = await app.request("/cost-caps", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: "ws-rest-cap",
        softCapUsd: 20,
        hardCapUsd: 40,
        actions: { onSoftCap: "throttle", onHardCap: "pause" },
      }),
    });
    expect(putRes.status).toBe(200);

    await app.request("/cost-caps/spend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: "ws-rest-cap", amountUsd: 45 }),
    });

    const evalRes = await app.request("/cost-caps/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: "ws-rest-cap" }),
    });
    expect(evalRes.status).toBe(200);
    const evalBody = (await evalRes.json()) as {
      data: { allowed: boolean; status: string };
    };
    expect(evalBody.data.allowed).toBe(false);
    expect(evalBody.data.status).toBe("hard_cap_exceeded");
  });
});
