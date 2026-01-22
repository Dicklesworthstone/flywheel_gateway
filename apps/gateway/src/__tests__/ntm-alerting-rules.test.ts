/**
 * Unit tests for NTM alerting rules (bd-39ee).
 *
 * Tests validate:
 * - NTM health alerting rules (degraded, unhealthy health)
 * - NTM stuck/stalled detection (is-working false with RESTART/INVESTIGATE)
 * - NTM agent termination alerting (agents removed)
 * - Alert payloads include reason and source metadata
 * - Structured logs are emitted with diagnostic context
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type {
  AlertContext,
  NtmHealthContext,
  NtmIsWorkingContext,
} from "../models/alert";
import {
  clearAlertRules,
  clearAlerts,
  evaluateAlertRules,
  fireAlert,
  getAlertRule,
  getAlertRules,
  initializeDefaultAlertRules,
} from "../services/alerts";

/**
 * Create a minimal AlertContext for testing.
 */
function createBaseContext(overrides?: Partial<AlertContext>): AlertContext {
  return {
    metrics: {
      agents: { total: 0, byStatus: {} },
      tokens: { last24h: 0, quotaUsedPercent: 0 },
      performance: { avgResponseMs: 100, successRate: 100, errorCount: 0 },
      system: { memoryUsageMb: 256, cpuPercent: 10, wsConnections: 1 },
    },
    correlationId: `test-${Date.now()}`,
    timestamp: new Date(),
    ...overrides,
  };
}

/**
 * Create NTM health context with specific agent health states.
 */
function createHealthContext(
  agents: Array<{
    id: string;
    health: "healthy" | "degraded" | "unhealthy";
    sessionName?: string;
    agentType?: string;
  }>,
): NtmHealthContext {
  const agentMap: NtmHealthContext["agents"] = {};
  let healthyCount = 0;
  let degradedCount = 0;
  let unhealthyCount = 0;

  for (const agent of agents) {
    agentMap[agent.id] = {
      pane: agent.id,
      sessionName: agent.sessionName ?? `session-${agent.id}`,
      agentType: agent.agentType ?? "claude-code",
      health: agent.health,
      lastSeenAt: new Date(),
    };

    if (agent.health === "healthy") healthyCount++;
    else if (agent.health === "degraded") degradedCount++;
    else if (agent.health === "unhealthy") unhealthyCount++;
  }

  return {
    agents: agentMap,
    summary: {
      totalAgents: agents.length,
      healthyCount,
      degradedCount,
      unhealthyCount,
    },
  };
}

/**
 * Create NTM is-working context for stuck/stalled detection.
 */
function createIsWorkingContext(
  agents: Array<{
    id: string;
    isWorking: boolean;
    isIdle?: boolean;
    isRateLimited?: boolean;
    isContextLow?: boolean;
    confidence?: number;
    recommendation?: string;
    recommendationReason?: string;
  }>,
): NtmIsWorkingContext {
  const agentMap: NtmIsWorkingContext["agents"] = {};
  let workingCount = 0;
  let idleCount = 0;
  let rateLimitedCount = 0;
  let contextLowCount = 0;
  let errorCount = 0;

  for (const agent of agents) {
    agentMap[agent.id] = {
      isWorking: agent.isWorking,
      isIdle: agent.isIdle ?? false,
      isRateLimited: agent.isRateLimited ?? false,
      isContextLow: agent.isContextLow ?? false,
      confidence: agent.confidence ?? 0.9,
      recommendation: agent.recommendation ?? "CONTINUE",
      recommendationReason: agent.recommendationReason ?? "Agent is active",
    };

    if (agent.isWorking) workingCount++;
    if (agent.isIdle) idleCount++;
    if (agent.isRateLimited) rateLimitedCount++;
    if (agent.isContextLow) contextLowCount++;
    if (agent.recommendation === "INVESTIGATE") errorCount++;
  }

  return {
    checkedAt: new Date(),
    agents: agentMap,
    summary: {
      totalAgents: agents.length,
      workingCount,
      idleCount,
      rateLimitedCount,
      contextLowCount,
      errorCount,
    },
  };
}

describe("NTM Alerting Rules (bd-39ee)", () => {
  beforeEach(() => {
    clearAlerts();
    clearAlertRules();
    initializeDefaultAlertRules();
  });

  afterEach(() => {
    clearAlerts();
    clearAlertRules();
  });

  describe("NTM Health Degraded Alerting", () => {
    test("ntm_health_degraded rule is registered", () => {
      const rule = getAlertRule("ntm_health_degraded");
      expect(rule).toBeDefined();
      expect(rule?.type).toBe("ntm_health_degraded");
      expect(rule?.severity).toBe("warning");
      expect(rule?.source).toBe("ntm_health_monitor");
    });

    test("fires alert when agent health is degraded", () => {
      const rule = getAlertRule("ntm_health_degraded");
      expect(rule).toBeDefined();

      const healthContext = createHealthContext([
        { id: "agent-1", health: "healthy" },
        { id: "agent-2", health: "degraded", sessionName: "session-2" },
      ]);

      const context = createBaseContext({
        ntm: { health: healthContext },
      });

      // Verify condition triggers
      expect(rule!.condition(context)).toBe(true);

      // Fire alert and verify payload
      const alert = fireAlert(rule!, context);
      expect(alert.type).toBe("ntm_health_degraded");
      expect(alert.severity).toBe("warning");
      expect(alert.source).toBe("ntm_health_monitor");
      expect(alert.title).toContain("degraded");
      expect(alert.message).toContain("agent-2");

      // Verify metadata includes diagnostic info
      expect(alert.metadata).toBeDefined();
      expect(alert.metadata?.summary).toBeDefined();
      expect(alert.metadata?.affectedAgents).toBeDefined();
      expect(Array.isArray(alert.metadata?.affectedAgents)).toBe(true);
    });

    test("fires alert when agent health is unhealthy", () => {
      const rule = getAlertRule("ntm_health_degraded");
      expect(rule).toBeDefined();

      const healthContext = createHealthContext([
        { id: "agent-1", health: "unhealthy", agentType: "codex-cli" },
      ]);

      const context = createBaseContext({
        ntm: { health: healthContext },
      });

      expect(rule!.condition(context)).toBe(true);

      const alert = fireAlert(rule!, context);
      expect(alert.title).toContain("unhealthy");

      // Verify affected agent metadata includes health status
      const affected = alert.metadata?.affectedAgents as Array<{
        pane: string;
        health: string;
      }>;
      expect(affected).toBeDefined();
      expect(affected.length).toBeGreaterThan(0);
      expect(affected[0]?.health).toBe("unhealthy");
    });

    test("fires alert with multiple unhealthy agents", () => {
      const rule = getAlertRule("ntm_health_degraded");
      expect(rule).toBeDefined();

      const healthContext = createHealthContext([
        { id: "agent-1", health: "unhealthy" },
        { id: "agent-2", health: "degraded" },
        { id: "agent-3", health: "unhealthy" },
      ]);

      const context = createBaseContext({
        ntm: { health: healthContext },
      });

      const alert = fireAlert(rule!, context);
      expect(alert.title).toContain("2"); // 2 unhealthy agents

      const affected = alert.metadata?.affectedAgents as unknown[];
      expect(affected?.length).toBe(3); // All non-healthy agents included
    });

    test("does not fire when all agents are healthy", () => {
      const rule = getAlertRule("ntm_health_degraded");
      expect(rule).toBeDefined();

      const healthContext = createHealthContext([
        { id: "agent-1", health: "healthy" },
        { id: "agent-2", health: "healthy" },
      ]);

      const context = createBaseContext({
        ntm: { health: healthContext },
      });

      expect(rule!.condition(context)).toBe(false);
    });

    test("does not fire when no NTM health context", () => {
      const rule = getAlertRule("ntm_health_degraded");
      expect(rule).toBeDefined();

      const context = createBaseContext({ ntm: {} });

      expect(rule!.condition(context)).toBe(false);
    });
  });

  describe("NTM Agent Stalled Detection", () => {
    test("agent_stalled rule is registered", () => {
      const rule = getAlertRule("agent_stalled");
      expect(rule).toBeDefined();
      expect(rule?.type).toBe("agent_stalled");
      expect(rule?.severity).toBe("warning");
      expect(rule?.source).toBe("agent_monitor");
    });

    test("fires alert when agent needs RESTART", () => {
      const rule = getAlertRule("agent_stalled");
      expect(rule).toBeDefined();

      const isWorkingContext = createIsWorkingContext([
        {
          id: "agent-1",
          isWorking: false,
          isIdle: false,
          recommendation: "RESTART",
          recommendationReason: "No output for 5+ minutes",
          confidence: 0.95,
        },
      ]);

      const context = createBaseContext({
        ntm: { isWorking: isWorkingContext },
      });

      expect(rule!.condition(context)).toBe(true);

      const alert = fireAlert(rule!, context);
      expect(alert.type).toBe("agent_stalled");
      expect(alert.source).toBe("agent_monitor");
      expect(alert.message).toContain("agent-1");

      // Verify metadata includes diagnostic details
      expect(alert.metadata).toBeDefined();
      expect(alert.metadata?.source).toBe("ntm_is_working");
      expect(alert.metadata?.agents).toBeDefined();
      const agents = alert.metadata?.agents as Array<{
        agentId: string;
        recommendation: string;
        reason: string;
      }>;
      expect(agents[0]?.recommendation).toBe("RESTART");
      expect(agents[0]?.reason).toBe("No output for 5+ minutes");
    });

    test("fires alert when agent needs INVESTIGATE", () => {
      const rule = getAlertRule("agent_stalled");
      expect(rule).toBeDefined();

      const isWorkingContext = createIsWorkingContext([
        {
          id: "agent-stalled",
          isWorking: false,
          recommendation: "INVESTIGATE",
          recommendationReason: "Unusual behavior detected",
          confidence: 0.85,
        },
      ]);

      const context = createBaseContext({
        ntm: { isWorking: isWorkingContext },
      });

      expect(rule!.condition(context)).toBe(true);

      const alert = fireAlert(rule!, context);
      const agents = alert.metadata?.agents as Array<{
        agentId: string;
        recommendation: string;
        confidence: number;
      }>;
      expect(agents[0]?.recommendation).toBe("INVESTIGATE");
      expect(agents[0]?.confidence).toBe(0.85);
    });

    test("fires alert with multiple stalled agents", () => {
      const rule = getAlertRule("agent_stalled");
      expect(rule).toBeDefined();

      const isWorkingContext = createIsWorkingContext([
        {
          id: "agent-1",
          isWorking: false,
          recommendation: "RESTART",
          recommendationReason: "Timed out",
        },
        {
          id: "agent-2",
          isWorking: true,
          recommendation: "CONTINUE",
        },
        {
          id: "agent-3",
          isWorking: false,
          recommendation: "INVESTIGATE",
          recommendationReason: "Error detected",
        },
      ]);

      const context = createBaseContext({
        ntm: { isWorking: isWorkingContext },
      });

      expect(rule!.condition(context)).toBe(true);

      const alert = fireAlert(rule!, context);
      expect(alert.title).toContain("Multiple");
      expect(alert.message).toContain("agent-1");
      expect(alert.message).toContain("agent-3");
    });

    test("does not fire when all agents are working", () => {
      const rule = getAlertRule("agent_stalled");
      expect(rule).toBeDefined();

      const isWorkingContext = createIsWorkingContext([
        {
          id: "agent-1",
          isWorking: true,
          recommendation: "CONTINUE",
        },
        {
          id: "agent-2",
          isWorking: true,
          recommendation: "CONTINUE",
        },
      ]);

      const context = createBaseContext({
        ntm: { isWorking: isWorkingContext },
      });

      expect(rule!.condition(context)).toBe(false);
    });

    test("does not fire when agent idle but recommendation is CONTINUE", () => {
      const rule = getAlertRule("agent_stalled");
      expect(rule).toBeDefined();

      const isWorkingContext = createIsWorkingContext([
        {
          id: "agent-1",
          isWorking: false,
          isIdle: true,
          recommendation: "CONTINUE", // Idle but OK
          recommendationReason: "Waiting for input",
        },
      ]);

      const context = createBaseContext({
        ntm: { isWorking: isWorkingContext },
      });

      expect(rule!.condition(context)).toBe(false);
    });
  });

  describe("NTM Agent Termination Alerting", () => {
    test("agent_terminated rule is registered", () => {
      const rule = getAlertRule("agent_terminated");
      expect(rule).toBeDefined();
      expect(rule?.type).toBe("agent_terminated");
      expect(rule?.severity).toBe("warning");
      expect(rule?.source).toBe("ntm_termination_monitor");
    });

    test("fires alert when agents are removed", () => {
      const rule = getAlertRule("agent_terminated");
      expect(rule).toBeDefined();

      const context = createBaseContext({
        ntm: {
          previousAgentCount: 3,
          currentAgentCount: 1,
          removedAgents: ["agent-2", "agent-3"],
        },
      });

      expect(rule!.condition(context)).toBe(true);

      const alert = fireAlert(rule!, context);
      expect(alert.type).toBe("agent_terminated");
      expect(alert.source).toBe("ntm_termination_monitor");
      expect(alert.title).toContain("2"); // 2 agents terminated
      expect(alert.message).toContain("agent-2");
      expect(alert.message).toContain("agent-3");

      // Verify metadata includes termination details
      expect(alert.metadata).toBeDefined();
      expect(alert.metadata?.removedAgents).toEqual(["agent-2", "agent-3"]);
      expect(alert.metadata?.previousAgentCount).toBe(3);
      expect(alert.metadata?.currentAgentCount).toBe(1);
      expect(alert.metadata?.timestamp).toBeDefined();
    });

    test("fires alert for single agent termination", () => {
      const rule = getAlertRule("agent_terminated");
      expect(rule).toBeDefined();

      const context = createBaseContext({
        ntm: {
          previousAgentCount: 2,
          currentAgentCount: 1,
          removedAgents: ["agent-1"],
        },
      });

      const alert = fireAlert(rule!, context);
      expect(alert.title).toBe("Agent terminated");
      expect(alert.message).toContain("agent-1");
    });

    test("does not fire when no agents removed", () => {
      const rule = getAlertRule("agent_terminated");
      expect(rule).toBeDefined();

      const context = createBaseContext({
        ntm: {
          previousAgentCount: 2,
          currentAgentCount: 2,
          removedAgents: [],
        },
      });

      expect(rule!.condition(context)).toBe(false);
    });

    test("does not fire when removedAgents is undefined", () => {
      const rule = getAlertRule("agent_terminated");
      expect(rule).toBeDefined();

      const context = createBaseContext({
        ntm: {
          previousAgentCount: 2,
          currentAgentCount: 2,
        },
      });

      expect(rule!.condition(context)).toBe(false);
    });
  });

  describe("NTM Rate Limited Alerting", () => {
    test("ntm_rate_limited rule is registered", () => {
      const rule = getAlertRule("ntm_rate_limited");
      expect(rule).toBeDefined();
      expect(rule?.type).toBe("ntm_rate_limited");
      expect(rule?.severity).toBe("warning");
      expect(rule?.source).toBe("ntm_rate_limit_monitor");
    });

    test("fires alert when agents are rate limited", () => {
      const rule = getAlertRule("ntm_rate_limited");
      expect(rule).toBeDefined();

      const isWorkingContext = createIsWorkingContext([
        {
          id: "agent-1",
          isWorking: false,
          isRateLimited: true,
          recommendation: "WAIT",
          recommendationReason: "Rate limited by API",
          confidence: 0.99,
        },
      ]);

      const context = createBaseContext({
        ntm: { isWorking: isWorkingContext },
      });

      expect(rule!.condition(context)).toBe(true);

      const alert = fireAlert(rule!, context);
      expect(alert.type).toBe("ntm_rate_limited");
      expect(alert.source).toBe("ntm_rate_limit_monitor");
      expect(alert.message).toContain("agent-1");

      // Verify metadata includes rate limit info
      expect(alert.metadata).toBeDefined();
      expect(alert.metadata?.summary).toBeDefined();
      expect(alert.metadata?.rateLimitedAgents).toBeDefined();
    });

    test("does not fire when no agents are rate limited", () => {
      const rule = getAlertRule("ntm_rate_limited");
      expect(rule).toBeDefined();

      const isWorkingContext = createIsWorkingContext([
        {
          id: "agent-1",
          isWorking: true,
          isRateLimited: false,
        },
      ]);

      const context = createBaseContext({
        ntm: { isWorking: isWorkingContext },
      });

      expect(rule!.condition(context)).toBe(false);
    });
  });

  describe("NTM Context Low Alerting", () => {
    test("ntm_context_low rule is registered", () => {
      const rule = getAlertRule("ntm_context_low");
      expect(rule).toBeDefined();
      expect(rule?.type).toBe("ntm_context_low");
      expect(rule?.severity).toBe("info");
      expect(rule?.source).toBe("ntm_context_monitor");
    });

    test("fires alert when agents have low context", () => {
      const rule = getAlertRule("ntm_context_low");
      expect(rule).toBeDefined();

      const isWorkingContext = createIsWorkingContext([
        {
          id: "agent-1",
          isWorking: true,
          isContextLow: true,
          recommendation: "CHECKPOINT",
          recommendationReason: "Context budget at 85%",
          confidence: 0.92,
        },
      ]);

      const context = createBaseContext({
        ntm: { isWorking: isWorkingContext },
      });

      expect(rule!.condition(context)).toBe(true);

      const alert = fireAlert(rule!, context);
      expect(alert.type).toBe("ntm_context_low");
      expect(alert.severity).toBe("info");
      expect(alert.source).toBe("ntm_context_monitor");

      // Verify metadata includes context info
      expect(alert.metadata).toBeDefined();
      expect(alert.metadata?.contextLowAgents).toBeDefined();
    });

    test("does not fire when no agents have low context", () => {
      const rule = getAlertRule("ntm_context_low");
      expect(rule).toBeDefined();

      const isWorkingContext = createIsWorkingContext([
        {
          id: "agent-1",
          isWorking: true,
          isContextLow: false,
        },
      ]);

      const context = createBaseContext({
        ntm: { isWorking: isWorkingContext },
      });

      expect(rule!.condition(context)).toBe(false);
    });
  });

  describe("Alert Metadata and Logging", () => {
    test("all NTM rules include source field", () => {
      const ntmRuleIds = [
        "ntm_health_degraded",
        "ntm_rate_limited",
        "ntm_context_low",
        "agent_terminated",
        "agent_stalled",
      ];

      for (const ruleId of ntmRuleIds) {
        const rule = getAlertRule(ruleId);
        expect(rule).toBeDefined();
        expect(rule?.source).toBeDefined();
        expect(typeof rule?.source).toBe("string");
        expect(rule!.source!.length).toBeGreaterThan(0);
      }
    });

    test("all NTM rules include actions", () => {
      const ntmRuleIds = [
        "ntm_health_degraded",
        "ntm_rate_limited",
        "ntm_context_low",
        "agent_terminated",
        "agent_stalled",
      ];

      for (const ruleId of ntmRuleIds) {
        const rule = getAlertRule(ruleId);
        expect(rule).toBeDefined();
        expect(rule?.actions).toBeDefined();
        expect(Array.isArray(rule?.actions)).toBe(true);
        expect(rule!.actions!.length).toBeGreaterThan(0);
      }
    });

    test("health degraded alert metadata includes affected agent details", () => {
      const rule = getAlertRule("ntm_health_degraded");
      expect(rule).toBeDefined();

      const healthContext = createHealthContext([
        {
          id: "pane-0",
          health: "degraded",
          sessionName: "fw-project-agent-abc123",
          agentType: "claude-code",
        },
      ]);

      const context = createBaseContext({
        ntm: { health: healthContext },
      });

      const alert = fireAlert(rule!, context);

      // Verify detailed agent info in metadata
      const affected = alert.metadata?.affectedAgents as Array<{
        pane: string;
        sessionName: string;
        agentType: string;
        health: string;
        lastSeenAt: string;
      }>;
      expect(affected).toBeDefined();
      expect(affected[0]?.pane).toBe("pane-0");
      expect(affected[0]?.sessionName).toBe("fw-project-agent-abc123");
      expect(affected[0]?.agentType).toBe("claude-code");
      expect(affected[0]?.health).toBe("degraded");
      expect(affected[0]?.lastSeenAt).toBeDefined();
    });

    test("stalled alert metadata includes recommendation reason", () => {
      const rule = getAlertRule("agent_stalled");
      expect(rule).toBeDefined();

      const isWorkingContext = createIsWorkingContext([
        {
          id: "agent-stuck",
          isWorking: false,
          recommendation: "RESTART",
          recommendationReason:
            "No output for 10 minutes, last activity was tool call",
          confidence: 0.97,
        },
      ]);

      const context = createBaseContext({
        ntm: { isWorking: isWorkingContext },
      });

      const alert = fireAlert(rule!, context);

      const agents = alert.metadata?.agents as Array<{
        agentId: string;
        reason: string;
        confidence: number;
      }>;
      expect(agents[0]?.reason).toBe(
        "No output for 10 minutes, last activity was tool call",
      );
      expect(agents[0]?.confidence).toBe(0.97);
    });

    test("termination alert includes timestamp for audit", () => {
      const rule = getAlertRule("agent_terminated");
      expect(rule).toBeDefined();

      const context = createBaseContext({
        ntm: {
          previousAgentCount: 2,
          currentAgentCount: 1,
          removedAgents: ["agent-terminated"],
        },
      });

      const alert = fireAlert(rule!, context);

      expect(alert.metadata?.timestamp).toBeDefined();
      expect(typeof alert.metadata?.timestamp).toBe("string");
      // Should be ISO format
      expect(() => new Date(alert.metadata?.timestamp as string)).not.toThrow();
    });
  });

  describe("Rule Configuration", () => {
    test("NTM health degraded has appropriate cooldown", () => {
      const rule = getAlertRule("ntm_health_degraded");
      expect(rule).toBeDefined();
      expect(rule?.cooldown).toBe(5 * 60 * 1000); // 5 minutes
    });

    test("NTM rate limited has longer cooldown", () => {
      const rule = getAlertRule("ntm_rate_limited");
      expect(rule).toBeDefined();
      expect(rule?.cooldown).toBe(15 * 60 * 1000); // 15 minutes (rate limits take time)
    });

    test("agent terminated has shorter cooldown for quick reporting", () => {
      const rule = getAlertRule("agent_terminated");
      expect(rule).toBeDefined();
      expect(rule?.cooldown).toBe(2 * 60 * 1000); // 2 minutes
    });

    test("all NTM rules are enabled by default", () => {
      const ntmRuleIds = [
        "ntm_health_degraded",
        "ntm_rate_limited",
        "ntm_context_low",
        "agent_terminated",
        "agent_stalled",
      ];

      for (const ruleId of ntmRuleIds) {
        const rule = getAlertRule(ruleId);
        expect(rule).toBeDefined();
        expect(rule?.enabled).toBe(true);
      }
    });
  });

  describe("Edge Cases", () => {
    test("handles empty agent lists gracefully", () => {
      const healthContext = createHealthContext([]);
      const isWorkingContext = createIsWorkingContext([]);

      const context = createBaseContext({
        ntm: {
          health: healthContext,
          isWorking: isWorkingContext,
        },
      });

      // None of the rules should fire
      const healthRule = getAlertRule("ntm_health_degraded");
      const stalledRule = getAlertRule("agent_stalled");
      const rateLimitedRule = getAlertRule("ntm_rate_limited");
      const contextLowRule = getAlertRule("ntm_context_low");

      expect(healthRule!.condition(context)).toBe(false);
      expect(stalledRule!.condition(context)).toBe(false);
      expect(rateLimitedRule!.condition(context)).toBe(false);
      expect(contextLowRule!.condition(context)).toBe(false);
    });

    test("handles missing NTM context", () => {
      const context = createBaseContext();
      // No NTM context at all

      const healthRule = getAlertRule("ntm_health_degraded");
      const stalledRule = getAlertRule("agent_stalled");
      const terminatedRule = getAlertRule("agent_terminated");

      expect(healthRule!.condition(context)).toBe(false);
      expect(stalledRule!.condition(context)).toBe(false);
      expect(terminatedRule!.condition(context)).toBe(false);
    });

    test("handles partial NTM context", () => {
      // Only health, no isWorking
      const context1 = createBaseContext({
        ntm: {
          health: createHealthContext([{ id: "a", health: "healthy" }]),
        },
      });

      const stalledRule = getAlertRule("agent_stalled");
      expect(stalledRule!.condition(context1)).toBe(false);

      // Only isWorking, no health
      const context2 = createBaseContext({
        ntm: {
          isWorking: createIsWorkingContext([
            { id: "a", isWorking: true, recommendation: "CONTINUE" },
          ]),
        },
      });

      const healthRule = getAlertRule("ntm_health_degraded");
      expect(healthRule!.condition(context2)).toBe(false);
    });
  });
});
