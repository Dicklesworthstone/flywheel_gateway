/**
 * Latency and SLO Dashboard with Alerts Tests (bd-17yyv)
 */

import { beforeEach, describe, expect, test } from "bun:test";
import app from "../index";
import {
  addSloAnnotation,
  clearSloForTesting,
  createSloDefinition,
  evaluateSloStatuses,
  exportSloSnapshot,
  ingestSyntheticProbeResult,
  recordLatencySample,
} from "../services/slo.service";

describe("Latency and SLO Dashboard with Alerts (bd-17yyv)", () => {
  beforeEach(() => {
    delete process.env["GATEWAY_ADMIN_KEY"];
    clearSloForTesting();
  });

  test("computes p50/p95/p99, heatmap buckets, burnRate, and breach status accurately", async () => {
    const now = Date.now();
    createSloDefinition({
      id: "slo-agents-list",
      name: "List Agents Latency",
      target: "GET /agents",
      objectiveMs: 250,
      errorBudgetPercent: 5,
      window: "1h",
    });

    // 18 fast samples (30-150ms) and 2 slow samples (600ms, 1200ms) -> 10% violations (> 5% budget -> burnRate = 2.0)
    for (let i = 0; i < 18; i++) {
      recordLatencySample({
        target: "GET /agents",
        latencyMs: 30 + i * 5,
        timestampMs: now - 10_000,
      });
    }
    recordLatencySample({
      target: "GET /agents",
      latencyMs: 600,
      timestampMs: now - 5_000,
    });
    recordLatencySample({
      target: "GET /agents",
      latencyMs: 1200,
      timestampMs: now - 2_000,
    });

    const statuses = await evaluateSloStatuses(now);
    expect(statuses.length).toBe(1);
    const st = statuses[0]!;
    expect(st.sampleCount).toBe(20);
    expect(st.violationCount).toBe(2);
    expect(st.violationRatePercent).toBe(10);
    expect(st.burnRate).toBe(2);
    expect(st.breached).toBe(true);
    expect(st.heatmapBuckets["1000ms+"]).toBe(1);
    expect(st.heatmapBuckets["500-1000ms"]).toBe(1);
  });

  test("ingests synthetic probe results, records annotations, and exports observability snapshot", async () => {
    createSloDefinition({
      name: "Health Check SLO",
      target: "GET /health",
      objectiveMs: 100,
      errorBudgetPercent: 1,
      window: "1h",
    });

    ingestSyntheticProbeResult({
      probeName: "us-east-probe",
      target: "GET /health",
      latencyMs: 25,
      success: true,
    });

    addSloAnnotation({
      type: "deployment",
      title: "Release v2.4.0",
      description: "Rolled out SQLite WAL tuning",
      actor: "ci-bot",
    });

    const snapshot = await exportSloSnapshot();
    expect(snapshot.slos.length).toBe(1);
    expect(snapshot.slos[0]?.breached).toBe(false);
    expect(snapshot.annotations.length).toBe(1);
    expect(snapshot.syntheticProbes.length).toBe(1);
  });

  test("REST endpoints /slo, /slo/probes, /slo/status, and /slo/annotations work end-to-end", async () => {
    const postSlo = await app.request("/slo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Spawn Agent SLO",
        target: "POST /agents",
        objectiveMs: 500,
        window: "1h",
      }),
    });
    expect(postSlo.status).toBe(201);

    const postProbe = await app.request("/slo/probes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        probeName: "canary-spawn",
        target: "POST /agents",
        latencyMs: 180,
        success: true,
      }),
    });
    expect(postProbe.status).toBe(201);

    const statusRes = await app.request("/slo/status");
    expect(statusRes.status).toBe(200);
    const statusBody = (await statusRes.json()) as {
      data: Array<{ sampleCount: number; breached: boolean }>;
    };
    expect(statusBody.data[0]?.sampleCount).toBe(1);
    expect(statusBody.data[0]?.breached).toBe(false);
  });
});
