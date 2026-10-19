import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { alertChannels } from "../routes/alert-channels";
import { configRoutes } from "../routes/config";
import { dashboards } from "../routes/dashboards";
import { events } from "../routes/events";
import { knowledge } from "../routes/knowledge";
import { metrics } from "../routes/metrics";
import { processes } from "../routes/processes";
import { rbac } from "../routes/rbac";
import { replays } from "../routes/replays";
import { retryProfiles } from "../routes/retry-profiles";
import { secrets } from "../routes/secrets";
import { templates } from "../routes/templates";
import { wsReplay } from "../routes/ws-replay";

describe("Wave 10 Full-Stack Contract & Integration Tests", () => {
  const app = new Hono();
  app.route("/dashboards", dashboards);
  app.route("/config", configRoutes);
  app.route("/rbac", rbac);
  app.route("/secrets", secrets);
  app.route("/retry-profiles", retryProfiles);
  app.route("/alert-channels", alertChannels);
  app.route("/alerts/channels", alertChannels);
  app.route("/metrics", metrics);
  app.route("/events", events);
  app.route("/processes", processes);
  app.route("/replays", replays);
  app.route("/ws-replay", wsReplay);
  app.route("/knowledge", knowledge);
  app.route("/templates", templates);

  test("Custom Dashboard fetchWidgetData resolves static and live API data sources", async () => {
    const createRes = await app.request("/dashboards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Wave 10 Live Data Source Dashboard",
        description: "Verifies static and API widget data resolution",
        widgets: [
          {
            id: "w-static-metric",
            type: "metric-card",
            title: "Static Metric Override",
            position: { x: 0, y: 0, w: 3, h: 2 },
            config: {
              dataSource: { type: "static" },
              customOptions: {
                staticData: {
                  value: 99,
                  previousValue: 88,
                  change: 12.5,
                  changeDirection: "up",
                  unit: "ms",
                  trend: {
                    value: 12.5,
                    direction: "up",
                    isPositive: true,
                  },
                },
              },
            },
          },
          {
            id: "w-api-custom",
            type: "metric-card",
            title: "API Metric Source",
            position: { x: 3, y: 0, w: 3, h: 2 },
            config: {
              dataSource: { type: "api", endpoint: "/api/metrics" },
            },
          },
        ],
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()).data;

    // 1. Static widget merges customOptions.staticData and sets source="static"
    const staticRes = await app.request(
      `/dashboards/${created.id}/widgets/w-static-metric/data`,
    );
    expect(staticRes.status).toBe(200);
    const staticPayload = (await staticRes.json()).data.data;
    expect(staticPayload.source).toBe("static");
    expect(staticPayload.value).toBe(99);
    expect(staticPayload.unit).toBe("ms");

    // 2. API widget attaches endpoint metadata
    const apiRes = await app.request(
      `/dashboards/${created.id}/widgets/w-api-custom/data`,
    );
    expect(apiRes.status).toBe(200);
    const apiPayload = (await apiRes.json()).data.data;
    expect(apiPayload.endpoint).toBe("/api/metrics");
    expect(typeof apiPayload.value).toBe("number");
  });

  test("Settings governance routes (/config/history, /rbac/roles, /secrets/providers, /retry-profiles, /alert-channels) return valid envelopes", async () => {
    const [configRes, rbacRes, secretsRes, retryRes, alertChanRes, aliasRes] =
      await Promise.all([
        app.request("/config/history"),
        app.request("/rbac/roles"),
        app.request("/secrets/providers"),
        app.request("/retry-profiles"),
        app.request("/alert-channels"),
        app.request("/alerts/channels"),
      ]);

    expect(configRes.status).toBe(200);
    expect(rbacRes.status).toBe(200);
    expect(secretsRes.status).toBe(200);
    expect(retryRes.status).toBe(200);
    expect(alertChanRes.status).toBe(200);
    expect(aliasRes.status).toBe(200);

    const rbacBody = await rbacRes.json();
    expect(Array.isArray(rbacBody.data)).toBe(true);
    expect(rbacBody.data.length).toBeGreaterThan(0);

    const secretsBody = await secretsRes.json();
    expect(Array.isArray(secretsBody.data)).toBe(true);
  });

  test("Telemetry, Replay, Knowledge, and Templates routes return expected structures", async () => {
    const [
      metricsRes,
      snapshotsRes,
      eventsSubsRes,
      ptStatusRes,
      replaysRes,
      wsStatsRes,
      knowledgeAvailRes,
      agentTemplatesRes,
      pipelineTemplatesRes,
    ] = await Promise.all([
      app.request("/metrics"),
      app.request("/metrics/snapshots"),
      app.request("/events/subscriptions"),
      app.request("/processes/status"),
      app.request("/replays/frames/default/default"),
      app.request("/ws-replay/stats"),
      app.request("/knowledge/available"),
      app.request("/templates/agents"),
      app.request("/templates/pipelines"),
    ]);

    expect(metricsRes.status).toBe(200);
    expect(snapshotsRes.status).toBe(200);
    expect(eventsSubsRes.status).toBe(200);
    expect(ptStatusRes.status).toBe(200);
    expect(replaysRes.status).toBe(200);
    expect(wsStatsRes.status).toBe(200);
    expect(knowledgeAvailRes.status).toBe(200);
    expect(agentTemplatesRes.status).toBe(200);
    expect(pipelineTemplatesRes.status).toBe(200);

    const agentTemplatesBody = await agentTemplatesRes.json();
    expect(Array.isArray(agentTemplatesBody.data)).toBe(true);

    const wsStatsBody = await wsStatsRes.json();
    expect(typeof wsStatsBody.data.totalEvents).toBe("number");
  });
});
