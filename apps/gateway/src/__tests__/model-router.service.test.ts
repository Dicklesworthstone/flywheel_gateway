/**
 * Model Routing and Failover Policies Tests (bd-3gwij)
 */

import { beforeEach, describe, expect, test } from "bun:test";
import app from "../index";
import {
  clearModelRouterForTesting,
  createRoutingPolicy,
  evaluateModelRouting,
  lintRoutingPolicy,
  listRoutingDecisions,
  revertRoutingPolicy,
  simulateRoutingPolicyWhatIf,
  updateRoutingPolicy,
} from "../services/model-router.service";

describe("Model Routing and Failover Policies (bd-3gwij)", () => {
  const prevAdminKey = process.env["GATEWAY_ADMIN_KEY"];

  beforeEach(() => {
    delete process.env["GATEWAY_ADMIN_KEY"];
    clearModelRouterForTesting();
  });

  test("evaluates policies in priority order and respects match criteria + bypass list", async () => {
    createRoutingPolicy({
      name: "low-priority-general",
      priority: 200,
      enabled: true,
      route: {
        preferred: [{ provider: "openai", model: "gpt-4.1-mini", weight: 1 }],
      },
    });

    createRoutingPolicy({
      name: "high-priority-code-edit",
      priority: 10,
      enabled: true,
      match: {
        workspaceId: "ws-prod",
        taskType: "code_edit",
        bypassAgentIds: ["agent-bypass-1"],
      },
      route: {
        preferred: [
          { provider: "anthropic", model: "claude-3-7-sonnet", weight: 1 },
        ],
      },
    });

    // Matches high-priority policy
    const d1 = await evaluateModelRouting({
      agentId: "agent-1",
      workspaceId: "ws-prod",
      taskType: "code_edit",
    });
    expect(d1.policyName).toBe("high-priority-code-edit");
    expect(d1.provider).toBe("anthropic");
    expect(d1.model).toBe("claude-3-7-sonnet");

    // Bypassed agent falls through to low-priority general policy
    const d2 = await evaluateModelRouting({
      agentId: "agent-bypass-1",
      workspaceId: "ws-prod",
      taskType: "code_edit",
    });
    expect(d2.policyName).toBe("low-priority-general");
    expect(d2.provider).toBe("openai");
    expect(d2.model).toBe("gpt-4.1-mini");
  });

  test("triggers automatic failover on rate_limit/timeout and places failed model in cooldown", async () => {
    createRoutingPolicy({
      name: "failover-policy",
      priority: 50,
      enabled: true,
      route: {
        preferred: [
          { provider: "anthropic", model: "claude-3-7-sonnet", weight: 1 },
          { provider: "openai", model: "gpt-4.1", weight: 1 },
          { provider: "google", model: "gemini-2.5-pro", weight: 1 },
        ],
      },
      failover: {
        maxAttempts: 2,
        onErrors: ["rate_limit", "timeout", "5xx"],
        cooldownMinutes: 5,
      },
    });

    const baseTime = 1_700_000_000_000;
    const d1 = await evaluateModelRouting(
      {
        agentId: "agent-failover",
        simulatedErrors: [
          {
            provider: "anthropic",
            model: "claude-3-7-sonnet",
            errorType: "rate_limit",
          },
        ],
      },
      baseTime,
    );

    expect(d1.failoverCount).toBe(1);
    expect(d1.provider).toBe("openai");
    expect(d1.model).toBe("gpt-4.1");
    expect(d1.steps.some((s) => s.outcome === "failed_over")).toBe(true);

    // Subsequent call within cooldown skips anthropic:claude-3-7-sonnet automatically
    const d2 = await evaluateModelRouting(
      {
        agentId: "agent-failover",
      },
      baseTime + 60_000,
    );
    expect(d2.provider).toBe("openai");
    expect(d2.model).toBe("gpt-4.1");
    expect(d2.steps[0]?.outcome).toBe("skipped_cooldown");

    // After cooldown expires (5m + 1s), anthropic:claude-3-7-sonnet is selected again
    const d3 = await evaluateModelRouting(
      {
        agentId: "agent-failover",
      },
      baseTime + 5 * 60_000 + 1000,
    );
    expect(d3.provider).toBe("anthropic");
    expect(d3.model).toBe("claude-3-7-sonnet");
  });

  test("lints policies for impossible constraints and supports version rollback + what-if simulation", () => {
    const lintBad = lintRoutingPolicy({
      name: "impossible-cost",
      route: {
        preferred: [
          {
            provider: "anthropic",
            model: "claude-opus-4",
            estimatedCostPer1kTokens: 0.05,
          },
        ],
        maxCostPer1kTokens: 0.01,
      },
    });
    expect(lintBad.valid).toBe(false);
    expect(
      lintBad.warnings.some((w) => w.code === "IMPOSSIBLE_CONSTRAINTS"),
    ).toBe(true);

    const policy = createRoutingPolicy({
      name: "versioned-policy",
      priority: 100,
      route: {
        preferred: [
          {
            provider: "openai",
            model: "gpt-4.1-mini",
            estimatedCostPer1kTokens: 0.001,
            estimatedP95LatencyMs: 350,
          },
        ],
      },
    });
    expect(policy.version).toBe(1);

    const updated = updateRoutingPolicy(policy.id, { priority: 20 });
    expect(updated?.version).toBe(2);
    expect(updated?.priority).toBe(20);

    const reverted = revertRoutingPolicy(policy.id, 1);
    expect(reverted?.version).toBe(3);
    expect(reverted?.priority).toBe(100);

    const sim = simulateRoutingPolicyWhatIf(
      {
        name: "sim-policy",
        match: { taskType: "triage" },
        route: {
          preferred: [
            {
              provider: "google",
              model: "gemini-2.5-flash",
              estimatedCostPer1kTokens: 0.0005,
              estimatedP95LatencyMs: 250,
            },
          ],
        },
      },
      [
        { taskType: "triage" },
        { taskType: "triage" },
        { taskType: "deep_refactor" },
      ],
    );
    expect(sim.totalRequests).toBe(3);
    expect(sim.matchedRequests).toBe(2);
    expect(sim.modelDistribution["google:gemini-2.5-flash"]).toBe(2);
  });

  test("REST endpoints /routing/policies, /routing/evaluate, and /routing/decisions work end-to-end", async () => {
    const createRes = await app.request("/routing/policies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "rest-policy",
        priority: 15,
        match: { workspaceId: "ws-rest" },
        route: {
          preferred: [
            { provider: "google", model: "gemini-2.5-pro", weight: 1 },
          ],
        },
      }),
    });
    expect(createRes.status).toBe(201);

    const evalRes = await app.request("/routing/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: "agent-rest-1",
        workspaceId: "ws-rest",
      }),
    });
    expect(evalRes.status).toBe(200);
    const evalBody = (await evalRes.json()) as {
      data: { provider: string; model: string; policyName: string };
    };
    expect(evalBody.data.provider).toBe("google");
    expect(evalBody.data.model).toBe("gemini-2.5-pro");
    expect(evalBody.data.policyName).toBe("rest-policy");

    const decisions = listRoutingDecisions({ agentId: "agent-rest-1" });
    expect(decisions.length).toBe(1);
    if (prevAdminKey === undefined) {
      delete process.env["GATEWAY_ADMIN_KEY"];
    } else {
      process.env["GATEWAY_ADMIN_KEY"] = prevAdminKey;
    }
  });
});
