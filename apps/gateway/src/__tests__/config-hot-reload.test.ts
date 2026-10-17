/**
 * Hot Configuration Reload, Version History, Rollback, and Explain-Config Tests
 * (bd-1t3b4, bd-2ufn8)
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import app from "../index";
import {
  explainConfigKey,
  getConfig,
  getConfigVersionHistory,
  resetConfigHistoryForTesting,
  rollbackConfigVersion,
  updateConfigRuntime,
} from "../services/config.service";

describe("Configuration Hot Reload, Version History & Explain-Config (bd-1t3b4, bd-2ufn8)", () => {
  beforeEach(() => {
    resetConfigHistoryForTesting();
  });

  afterEach(() => {
    resetConfigHistoryForTesting();
    delete process.env["OTEL_EXPORTER_OTLP_HEADERS"];
    delete process.env["RATE_LIMIT_PER_MINUTE"];
  });

  test("hot-reloads runtime keys, tracks version history, and flags restart-required keys", () => {
    expect(getConfig().security.rateLimitPerMinute).toBe(60);

    const update1 = updateConfigRuntime(
      {
        security: {
          ...getConfig().security,
          rateLimitPerMinute: 180,
        },
      },
      { changedBy: "ops@example.com", reason: "Traffic spike" },
    );

    expect(update1.version).toBe(2);
    expect(update1.restartRequired).toBe(false);
    expect(update1.changedKeys).toContain("security.rateLimitPerMinute");
    expect(getConfig().security.rateLimitPerMinute).toBe(180);

    // Changing server.port should flag restartRequired: true
    const update2 = updateConfigRuntime(
      {
        server: {
          ...getConfig().server,
          port: 4000,
        },
      },
      { changedBy: "ops@example.com", reason: "Port migration" },
    );

    expect(update2.version).toBe(3);
    expect(update2.restartRequired).toBe(true);
    expect(update2.restartRequiredKeys).toEqual(["server.port"]);

    const history = getConfigVersionHistory();
    expect(history.length).toBe(3);
    expect(history[1]?.changedBy).toBe("ops@example.com");
    expect(history[1]?.reason).toBe("Traffic spike");

    // Roll back to version 1 (initial defaults)
    const rolled = rollbackConfigVersion(1, {
      rolledBackBy: "ops@example.com",
    });
    expect(rolled.version).toBe(4);
    expect(rolled.rolledBackFromVersion).toBe(3);
    expect(rolled.rolledBackToVersion).toBe(1);
    expect(getConfig().security.rateLimitPerMinute).toBe(60);
    expect(getConfig().server.port).toBe(3000);
  });

  test("rejects invalid config updates and preserves previous valid state", () => {
    expect(() =>
      updateConfigRuntime({
        security: {
          ...getConfig().security,
          rateLimitPerMinute: -10,
        },
      }),
    ).toThrow(/Configuration validation failed/i);

    expect(getConfig().security.rateLimitPerMinute).toBe(60);
  });

  test("explainConfigKey reports source layer and redacts sensitive keys (bd-2ufn8)", () => {
    const defaultExp = explainConfigKey("security.rateLimitPerMinute");
    expect(defaultExp.effectiveValue).toBe(60);
    expect(defaultExp.source).toBe("default");
    expect(defaultExp.hotReloadable).toBe(true);
    expect(defaultExp.redacted).toBe(false);

    // Runtime override -> source becomes "runtime"
    updateConfigRuntime({
      security: {
        ...getConfig().security,
        rateLimitPerMinute: 240,
      },
    });
    const runtimeExp = explainConfigKey("security.rateLimitPerMinute");
    expect(runtimeExp.effectiveValue).toBe(240);
    expect(runtimeExp.source).toBe("runtime");

    // Sensitive key -> never returns effectiveValue verbatim
    updateConfigRuntime({
      otel: {
        ...getConfig().otel,
        otlpHeaders: "Authorization=Bearer topsecret123456",
      },
    });
    const secretExp = explainConfigKey("otel.otlpHeaders");
    expect(secretExp.redacted).toBe(true);
    expect(secretExp.set).toBe(true);
    expect(secretExp.effectiveValue).toBeUndefined();
    expect(JSON.stringify(secretExp)).not.toContain("topsecret123456");
  });

  test("REST endpoints: PATCH /config, GET /config/explain, GET /config/history, POST /config/rollback", async () => {
    const patchRes = await app.request("/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        patch: {
          security: {
            ...getConfig().security,
            rateLimitPerMinute: 150,
          },
        },
        reason: "API test update",
      }),
    });
    expect(patchRes.status).toBe(200);
    const patchBody = await patchRes.json();
    expect(patchBody.data.version).toBe(2);
    expect(patchBody.data.restartRequired).toBe(false);

    const explainRes = await app.request(
      "/config/explain?key=security.rateLimitPerMinute",
    );
    expect(explainRes.status).toBe(200);
    const explainBody = await explainRes.json();
    expect(explainBody.data.effectiveValue).toBe(150);
    expect(explainBody.data.source).toBe("runtime");

    const historyRes = await app.request("/config/history");
    expect(historyRes.status).toBe(200);
    const historyBody = await historyRes.json();
    expect(historyBody.data.length).toBe(2);

    const rollbackRes = await app.request("/config/rollback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: 1, reason: "Revert test" }),
    });
    expect(rollbackRes.status).toBe(200);
    const rollbackBody = await rollbackRes.json();
    expect(rollbackBody.data.config.security.rateLimitPerMinute).toBe(60);
  });
});
