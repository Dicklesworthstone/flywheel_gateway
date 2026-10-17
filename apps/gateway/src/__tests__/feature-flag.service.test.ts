/**
 * Feature Flag System Tests (bd-1kij1)
 */

import { beforeEach, describe, expect, test } from "bun:test";
import app from "../index";
import {
  clearFeatureFlagsForTesting,
  evaluateFeatureFlag,
  getFeatureFlagMetrics,
  setFeatureFlagKillSwitch,
  upsertFeatureFlag,
} from "../services/feature-flag.service";

describe("Feature Flag System (bd-1kij1)", () => {
  beforeEach(() => {
    delete process.env["GATEWAY_ADMIN_KEY"];
    clearFeatureFlagsForTesting();
  });

  test("evaluates percentage rollout deterministically, honors user/cohort targeting, and enforces kill switches", () => {
    upsertFeatureFlag({
      key: "new-dashboard-v2",
      name: "New Dashboard V2",
      enabled: true,
      rolloutPercentage: 50,
      targetUsers: ["user-vip"],
      targetCohorts: ["beta-testers"],
      variants: [
        { name: "control", weight: 50 },
        { name: "treatment", weight: 50 },
      ],
    });

    // VIP user always gets enabled
    const vip = evaluateFeatureFlag("new-dashboard-v2", { userId: "user-vip" });
    expect(vip.enabled).toBe(true);
    expect(vip.reason).toBe("target_user");
    expect(vip.variant).toBeDefined();

    // Cohort targeting always gets enabled
    const cohort = evaluateFeatureFlag("new-dashboard-v2", {
      userId: "user-normal",
      cohorts: ["beta-testers"],
    });
    expect(cohort.enabled).toBe(true);
    expect(cohort.reason).toBe("target_cohort");

    // Deterministic rollout across 100 sample users
    const firstPass = Array.from({ length: 100 }, (_, i) =>
      evaluateFeatureFlag("new-dashboard-v2", { userId: `sample-user-${i}` }),
    );
    const secondPass = Array.from({ length: 100 }, (_, i) =>
      evaluateFeatureFlag("new-dashboard-v2", { userId: `sample-user-${i}` }),
    );
    expect(firstPass.map((r) => r.enabled)).toEqual(
      secondPass.map((r) => r.enabled),
    );
    const enabledCount = firstPass.filter((r) => r.enabled).length;
    expect(enabledCount).toBeGreaterThan(25);
    expect(enabledCount).toBeLessThan(75);

    // Emergency kill switch overrides even VIP user
    setFeatureFlagKillSwitch("new-dashboard-v2", true);
    const killed = evaluateFeatureFlag("new-dashboard-v2", {
      userId: "user-vip",
    });
    expect(killed.enabled).toBe(false);
    expect(killed.reason).toBe("kill_switch");

    const metrics = getFeatureFlagMetrics("new-dashboard-v2");
    expect(metrics.evaluations).toBe(203);
  });

  test("REST endpoints /feature-flags, /feature-flags/:key/evaluate, and /kill-switch work end-to-end", async () => {
    const postRes = await app.request("/feature-flags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: "fast-ws-compression",
        name: "Fast WS Compression",
        enabled: true,
        rolloutPercentage: 100,
      }),
    });
    expect(postRes.status).toBe(201);

    const evalRes = await app.request(
      "/feature-flags/fast-ws-compression/evaluate",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "u-1" }),
      },
    );
    expect(evalRes.status).toBe(200);
    const evalBody = (await evalRes.json()) as {
      data: { enabled: boolean };
    };
    expect(evalBody.data.enabled).toBe(true);

    await app.request("/feature-flags/fast-ws-compression/kill-switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ killSwitch: true }),
    });

    const evalAfterKill = await app.request(
      "/feature-flags/fast-ws-compression/evaluate",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "u-1" }),
      },
    );
    const afterBody = (await evalAfterKill.json()) as {
      data: { enabled: boolean; reason: string };
    };
    expect(afterBody.data.enabled).toBe(false);
    expect(afterBody.data.reason).toBe("kill_switch");
  });
});
