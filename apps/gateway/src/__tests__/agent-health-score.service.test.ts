import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { routes } from "../routes";
import { _clearAgentsForTest, _registerAgentForTest } from "../services/agent";
import {
  clearAgentErrorEvents,
  recordAgentErrorEvent,
} from "../services/agent-health-score.events";
import {
  calculateCompositeHealthScore,
  getAgentHealthScoreService,
} from "../services/agent-health-score.service";
import {
  clearAllChannels,
  clearAllDeliveries,
  clearAllRules,
  createChannel,
  createRule,
  getDeliveries,
} from "../services/alert-channel.service";

describe("AgentHealthScoreService - composite scoring & endpoints (bd-1x215)", () => {
  beforeEach(() => {
    _clearAgentsForTest();
    clearAgentErrorEvents();
    getAgentHealthScoreService().clearCache();
    clearAllDeliveries();
    clearAllRules();
    clearAllChannels();
  });

  afterEach(() => {
    _clearAgentsForTest();
    clearAgentErrorEvents();
    getAgentHealthScoreService().clearCache();
    clearAllDeliveries();
    clearAllRules();
    clearAllChannels();
  });

  test("returns 100 when all components are healthy", () => {
    const { score, componentScores } = calculateCompositeHealthScore({
      contextUtilization: 0,
      costBurnRate: 1,
      stateHealth: 100,
      errorRate: 0,
      reservationConflicts: 0,
    });

    expect(score).toBe(100);
    expect(componentScores.contextScore).toBe(100);
    expect(componentScores.costScore).toBe(100);
    expect(componentScores.stateScore).toBe(100);
    expect(componentScores.errorScore).toBe(100);
    expect(componentScores.conflictScore).toBe(100);
  });

  test("penalizes fully utilized context headroom", () => {
    const { score } = calculateCompositeHealthScore({
      contextUtilization: 100,
      costBurnRate: 1,
      stateHealth: 100,
      errorRate: 0,
      reservationConflicts: 0,
    });

    // contextScore=0 contributes 0.25*0, others are 100 → 75 total
    expect(score).toBe(75);
  });

  test("penalizes errors per minute, high cost burn, and reservation conflicts", () => {
    const { score, componentScores } = calculateCompositeHealthScore({
      contextUtilization: 20, // contextScore = 80
      costBurnRate: 2, // costScore = 50
      stateHealth: 60, // stateScore = 60
      errorRate: 3, // errorScore = 40
      reservationConflicts: 2, // conflictScore = 50
    });

    expect(componentScores).toEqual({
      contextScore: 80,
      costScore: 50,
      stateScore: 60,
      errorScore: 40,
      conflictScore: 50,
    });
    // 80*0.25 (20) + 50*0.20 (10) + 60*0.25 (15) + 40*0.20 (8) + 50*0.10 (5) = 58
    expect(score).toBe(58);
  });

  test("computes live agent score, caches with TTL, records DB history, and tracks declining trend", async () => {
    const agentId = `agent_health_test_${Date.now()}`;
    _registerAgentForTest({
      id: agentId,
      createdAt: new Date(),
    });

    const service = getAgentHealthScoreService();

    // First score (healthy)
    const first = await service.getAgentScore(agentId);
    expect(first.score).toBeGreaterThanOrEqual(80);
    expect(first.band).toBe("green");
    expect(first.cache.hit).toBe(false);

    // Cached hit
    const cached = await service.getAgentScore(agentId);
    expect(cached.cache.hit).toBe(true);

    // Inject errors and force refresh to observe declining trend
    recordAgentErrorEvent(agentId, "tool_error");
    recordAgentErrorEvent(agentId, "tool_error");
    const second = await service.getAgentScore(agentId, {
      forceRefresh: true,
    });
    expect(second.score).toBeLessThan(first.score);
    expect(second.trend).toBe("declining");
    expect(second.consecutiveDrops).toBe(1);

    // Verify DB history
    const history = service.getAgentHealthHistory(agentId);
    expect(history.entries.length).toBeGreaterThanOrEqual(2);
    expect(history.trend).toBe("declining");
  });

  test("serves GET /agents/health-scores, GET /agents/:agentId/health-score, and GET /agents/:agentId/health-history", async () => {
    const agentId = `agent_health_http_${Date.now()}`;
    _registerAgentForTest({
      id: agentId,
      createdAt: new Date(),
    });

    const app = new Hono().route("/", routes);

    const singleRes = await app.request(`/agents/${agentId}/health-score`);
    expect(singleRes.status).toBe(200);
    const singleBody = await singleRes.json();
    expect(singleBody.data.agentId).toBe(agentId);
    expect(typeof singleBody.data.score).toBe("number");

    const listRes = await app.request("/agents/health-scores");
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    expect(Array.isArray(listBody.data)).toBe(true);
    expect(
      listBody.data.some(
        (item: { agentId: string }) => item.agentId === agentId,
      ),
    ).toBe(true);

    const historyRes = await app.request(
      `/agents/${agentId}/health-history?limit=10`,
    );
    expect(historyRes.status).toBe(200);
    const historyBody = await historyRes.json();
    expect(historyBody.data.agentId).toBe(agentId);
    expect(historyBody.data.entries.length).toBeGreaterThanOrEqual(1);
  });

  test("triggers alert channel routing when agent experiences 3 consecutive drops", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("ok", { status: 200 })) as unknown as typeof fetch;

    try {
      const ch = createChannel({
        name: "Health Alert Channel",
        type: "webhook",
        config: { url: "https://hooks.example.com/health-alerts" },
      });
      createRule({
        name: "Agent Health Alerts",
        condition: { categories: ["agent_health"] },
        channelIds: [ch.id],
      });

      const agentId = `agent_health_alert_${Date.now()}`;
      _registerAgentForTest({
        id: agentId,
        createdAt: new Date(),
      });

      const service = getAgentHealthScoreService();
      await service.getAgentScore(agentId, { forceRefresh: true });

      // Drop 1
      recordAgentErrorEvent(agentId, "err1");
      await service.getAgentScore(agentId, { forceRefresh: true });

      // Drop 2
      recordAgentErrorEvent(agentId, "err2");
      await service.getAgentScore(agentId, { forceRefresh: true });

      // Drop 3 -> triggers declining_trend alert
      recordAgentErrorEvent(agentId, "err3");
      const fourth = await service.getAgentScore(agentId, {
        forceRefresh: true,
      });
      expect(fourth.consecutiveDrops).toBe(3);

      await Bun.sleep(25);
      const deliveries = getDeliveries({ channelId: ch.id });
      expect(deliveries.length).toBeGreaterThanOrEqual(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
