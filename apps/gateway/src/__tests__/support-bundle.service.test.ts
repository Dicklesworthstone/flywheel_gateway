/**
 * Support Bundle, Redaction Hardening, and Sanitized Repro Harness Tests
 * (bd-1efrp, bd-163rq, bd-pwca9)
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import app from "../index";
import {
  clearSupportBundlesForTesting,
  createSupportBundle,
  downloadSupportBundle,
  previewSupportBundle,
  pruneExpiredSupportBundles,
  replaySupportBundle,
  type SupportBundleArtifact,
} from "../services/support-bundle.service";

describe("Support Bundle & Diagnostics Export (bd-1efrp, bd-163rq, bd-pwca9)", () => {
  beforeEach(() => {
    clearSupportBundlesForTesting();
  });

  afterEach(() => {
    clearSupportBundlesForTesting();
  });

  test("redaction hardening + no-leak suite: scrubs API keys, Bearer tokens, webhook URL query params, and config secrets", () => {
    const rawSecrets = [
      "sk-ant-api03-supersecretkeyvalue123456",
      "ghp_1234567890abcdefghijklmnopqrstuvwx",
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.supersecretjwt",
      "whsec_query_param_secret_998877",
      "T00000000/B00000000/SLACKWEBHOOKSECRET123456",
      "my-raw-database-password-999",
      "my-raw-client-secret-888",
    ];

    const status = createSupportBundle({
      seedConfigOverride: {
        password: rawSecrets[5],
        clientSecret: rawSecrets[6],
        nested: {
          webhookUrl: `https://example.com/webhook?token=${rawSecrets[3]}&env=prod`,
          slackUrl: `https://hooks.slack.com/services/${rawSecrets[4]}`,
        },
      },
      seedLogs: [
        {
          level: "error",
          msg: `Failed auth with Bearer ${rawSecrets[2]} and key ${rawSecrets[0]}`,
          authorization: `Bearer ${rawSecrets[2]}`,
        },
      ],
      seedEvents: [
        {
          type: "tool.call",
          payload: `git push https://${rawSecrets[1]}@github.com/org/repo.git`,
        },
      ],
    });

    const artifact = downloadSupportBundle(status.id);
    expect(artifact).toBeDefined();
    expect(artifact?.manifest.redactionReport.verifiedClean).toBe(true);
    expect(artifact?.manifest.redactionReport.totalRedactions).toBeGreaterThan(
      0,
    );

    const serialized = JSON.stringify(artifact);
    for (const secret of rawSecrets) {
      expect(serialized).not.toContain(secret);
    }
  });

  test("preview generates per-source size estimates and data-minimization warnings", () => {
    const preview = previewSupportBundle({
      logLimit: 600,
      seedLogs: [{ level: "info", msg: "Bearer secret_token_1234567890" }],
    });

    expect(preview.schemaVersion).toBe("1.0.0");
    expect(preview.totalEstimatedBytes).toBeGreaterThan(0);
    expect(
      preview.sources.some((s) => s.source === "build" && s.included),
    ).toBe(true);
    expect(preview.dataMinimizationWarnings.length).toBeGreaterThanOrEqual(2);
    expect(preview.requiredCoreFields).toContain("redactionReport");
  });

  test("retention cleanup removes expired support bundles", () => {
    const status = createSupportBundle({ retentionMinutes: 1 });
    expect(downloadSupportBundle(status.id)).toBeDefined();

    // Advance simulated clock past 1 minute retention
    const pruned = pruneExpiredSupportBundles(Date.now() + 120_000);
    expect(pruned).toBe(1);
    expect(downloadSupportBundle(status.id)).toBeUndefined();
  });

  test("sanitized repro harness replays events/jobs/logs and fails closed on unsanitized bundles", () => {
    const status = createSupportBundle({
      seedLogs: [{ level: "error", msg: "Agent timed out" }],
      seedEvents: [
        { type: "state.change", state: "error" },
        { type: "tool.end", tool: "bash" },
      ],
      seedJobs: [
        { id: "job-ok-1", status: "completed" },
        { id: "job-fail-2", status: "failed" },
      ],
    });

    const artifact = downloadSupportBundle(status.id)!;
    const replay = replaySupportBundle(artifact);

    expect(replay.verifiedSanitized).toBe(true);
    expect(replay.replayedEventsCount).toBe(2);
    expect(replay.replayedJobsCount).toBe(2);
    expect(replay.failedJobIds).toEqual(["job-fail-2"]);
    expect(replay.errorLogsCount).toBe(1);
    expect(
      replay.actionableDiagnostics.some((d) => d.includes("job-fail-2")),
    ).toBe(true);

    // Tamper with the bundle by injecting a raw secret -> must fail closed!
    const contaminated: SupportBundleArtifact = {
      ...artifact,
      logs: [{ msg: "Leaked key sk-ant-api03-leakedsecret1234567890" }],
    };
    expect(() => replaySupportBundle(contaminated)).toThrow(
      /unsanitized sensitive data detected/i,
    );
  });

  test("REST endpoints: preview -> create -> status -> download -> replay", async () => {
    const previewRes = await app.request("/support/bundles/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ includeSources: ["build", "config", "logs"] }),
    });
    expect(previewRes.status).toBe(200);
    const previewBody = await previewRes.json();
    expect(previewBody.data.totalEstimatedBytes).toBeGreaterThan(0);

    const createRes = await app.request("/support/bundles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        seedLogs: [
          { level: "error", msg: "Simulated error for support bundle" },
        ],
        seedJobs: [{ id: "job-err-99", status: "failed" }],
      }),
    });
    expect(createRes.status).toBe(201);
    const createBody = await createRes.json();
    const bundleId = createBody.data.id as string;
    expect(bundleId).toStartWith("sb_");

    const statusRes = await app.request(`/support/bundles/${bundleId}/status`);
    expect(statusRes.status).toBe(200);
    const statusBody = await statusRes.json();
    expect(statusBody.data.status).toBe("ready");

    const downloadRes = await app.request(
      `/support/bundles/${bundleId}/download`,
    );
    expect(downloadRes.status).toBe(200);
    expect(downloadRes.headers.get("Content-Disposition")).toContain(bundleId);

    const replayRes = await app.request(`/support/bundles/${bundleId}/replay`, {
      method: "POST",
    });
    expect(replayRes.status).toBe(200);
    const replayBody = await replayRes.json();
    expect(replayBody.data.failedJobIds).toEqual(["job-err-99"]);
  });
});
