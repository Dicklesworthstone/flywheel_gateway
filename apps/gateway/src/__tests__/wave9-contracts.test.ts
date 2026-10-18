import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { alerts } from "../routes/alerts";
import { backups } from "../routes/backups";
import { dashboards } from "../routes/dashboards";
import { handoffs } from "../routes/handoffs";
import jobs from "../routes/jobs";
import { pipelines } from "../routes/pipelines";
import { rch } from "../routes/rch";
import { scanner } from "../routes/scanner";
import { supervisor } from "../routes/supervisor";

describe("Wave 9 Full-Stack Contract & Integration Tests", () => {
  const app = new Hono();
  app.route("/dashboards", dashboards);
  app.route("/pipelines", pipelines);
  app.route("/rch", rch);
  app.route("/scanner", scanner);
  app.route("/handoffs", handoffs);
  app.route("/alerts", alerts);
  app.route("/supervisor", supervisor);
  app.route("/jobs", jobs);
  app.route("/backups", backups);

  test("Custom Dashboard widget data shapes match frontend widget components without TypeError", async () => {
    const createRes = await app.request("/dashboards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Wave 9 Contract Dashboard",
        description: "Verifies all widget data shapes",
        widgets: [
          {
            id: "w-metric",
            type: "metric-card",
            title: "Metric",
            position: { x: 0, y: 0, w: 3, h: 2 },
            config: {
              dataSource: { type: "api", endpoint: "/api/analytics/fleet" },
            },
          },
          {
            id: "w-pie",
            type: "cost-breakdown",
            title: "Pie",
            position: { x: 3, y: 0, w: 4, h: 3 },
            config: {
              dataSource: {
                type: "api",
                endpoint: "/api/cost-analytics/breakdown/model",
              },
            },
          },
          {
            id: "w-table",
            type: "table",
            title: "Table",
            position: { x: 0, y: 2, w: 6, h: 3 },
            config: { dataSource: { type: "api", endpoint: "/api/agents" } },
          },
          {
            id: "w-heatmap",
            type: "heatmap",
            title: "Heatmap",
            position: { x: 6, y: 2, w: 6, h: 3 },
            config: {
              dataSource: { type: "api", endpoint: "/api/velocity/trends" },
            },
          },
        ],
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()).data;

    // 1. Metric card must return trend object with numeric value
    const metricRes = await app.request(
      `/dashboards/${created.id}/widgets/w-metric/data`,
    );
    expect(metricRes.status).toBe(200);
    const metricData = (await metricRes.json()).data.data;
    expect(typeof metricData.value).toBe("number");
    expect(typeof metricData.trend).toBe("object");
    expect(typeof metricData.trend.value).toBe("number");
    expect(["up", "down", "flat"]).toContain(metricData.trend.direction);

    // 2. Pie / cost-breakdown must return items[] with { label, value, color }
    const pieRes = await app.request(
      `/dashboards/${created.id}/widgets/w-pie/data`,
    );
    expect(pieRes.status).toBe(200);
    const pieData = (await pieRes.json()).data.data;
    expect(Array.isArray(pieData.items)).toBe(true);
    expect(typeof pieData.items[0].label).toBe("string");
    expect(typeof pieData.items[0].value).toBe("number");

    // 3. Table must return columns[] of { key, label } and rows[] of objects
    const tableRes = await app.request(
      `/dashboards/${created.id}/widgets/w-table/data`,
    );
    expect(tableRes.status).toBe(200);
    const tableData = (await tableRes.json()).data.data;
    expect(Array.isArray(tableData.columns)).toBe(true);
    expect(typeof tableData.columns[0].key).toBe("string");
    expect(typeof tableData.columns[0].label).toBe("string");
    expect(typeof tableData.rows[0]).toBe("object");

    // 4. Heatmap must return columnLabels[] and rows[] with cells[]
    const heatmapRes = await app.request(
      `/dashboards/${created.id}/widgets/w-heatmap/data`,
    );
    expect(heatmapRes.status).toBe(200);
    const heatmapData = (await heatmapRes.json()).data.data;
    expect(Array.isArray(heatmapData.columnLabels)).toBe(true);
    expect(Array.isArray(heatmapData.rows)).toBe(true);
    expect(Array.isArray(heatmapData.rows[0].cells)).toBe(true);
  });

  test("Pipeline run control path-parameter aliases (/pipelines/:id/runs/:runId/pause|resume|cancel) are mounted", async () => {
    const pauseRes = await app.request(
      "/pipelines/pipe-nonexistent/runs/run-nonexistent/pause",
      { method: "POST" },
    );
    // Reaches handler and returns structured INVALID_STATE rather than Hono route 404
    expect(pauseRes.status).toBe(400);
    const pauseBody = await pauseRes.json();
    expect(pauseBody.error?.code).toBe("INVALID_STATE");

    const resumeRes = await app.request(
      "/pipelines/pipe-nonexistent/runs/run-nonexistent/resume",
      { method: "POST" },
    );
    expect(resumeRes.status).toBe(400);
    const resumeBody = await resumeRes.json();
    expect(resumeBody.error?.code).toBe("INVALID_STATE");

    const cancelRes = await app.request(
      "/pipelines/pipe-nonexistent/runs/run-nonexistent/cancel",
      { method: "POST" },
    );
    expect(cancelRes.status).toBe(400);
    const cancelBody = await cancelRes.json();
    expect(cancelBody.error?.code).toBe("INVALID_STATE");
  });

  test("RCH, Scanner, Handoffs, Alerts, Supervisor, Jobs, and Backups endpoints return valid envelopes", async () => {
    const [
      rchWorkersRes,
      scannerStatsRes,
      handoffStatsRes,
      alertsRes,
      supervisorRes,
      jobsRes,
      backupsRes,
    ] = await Promise.all([
      app.request("/rch/workers"),
      app.request("/scanner/stats"),
      app.request("/handoffs/stats"),
      app.request("/alerts"),
      app.request("/supervisor/status"),
      app.request("/jobs"),
      app.request("/backups?workspaceId=default"),
    ]);

    expect(rchWorkersRes.status).toBe(200);
    expect(scannerStatsRes.status).toBe(200);
    expect(handoffStatsRes.status).toBe(200);
    expect(alertsRes.status).toBe(200);
    expect(supervisorRes.status).toBe(200);
    expect(jobsRes.status).toBe(200);
    expect(backupsRes.status).toBe(200);

    const createBkpRes = await app.request("/backups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: "default",
        label: "wave9-contract-test",
      }),
    });
    expect(createBkpRes.status).toBe(201);
    const bkpData = (await createBkpRes.json()).data;
    expect(bkpData.integrityCheck).toBe("ok");
    expect(typeof bkpData.checksumSha256).toBe("string");
  });
});
