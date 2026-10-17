/**
 * Secrets Provider, Vault Adapter, Redaction Pipeline, and Routes Tests (bd-d134v)
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { secrets } from "../routes/secrets";
import { redactSensitiveDataWithReport } from "../services/audit-redaction.service";
import {
  CompositeSecretsProvider,
  clearSecretRotationMetadata,
  EnvSecretsProvider,
  listSecretReferences,
  rotateSecretReference,
  setDefaultSecretsProvider,
  VaultSecretsProvider,
  validateSecretName,
} from "../services/secrets-provider.service";
import { WebSocketHub } from "../ws/hub";

beforeEach(() => {
  clearSecretRotationMetadata();
  setDefaultSecretsProvider(null);
});

afterEach(() => {
  clearSecretRotationMetadata();
  setDefaultSecretsProvider(null);
  delete process.env["FLYWHEEL_TEST_SECRET_KEY"];
});

describe("validateSecretName", () => {
  test("extracts namespace from colon-delimited names", () => {
    expect(validateSecretName("tool:dcg:apiKey")).toEqual({
      valid: true,
      namespace: "tool",
      key: "dcg:apiKey",
    });
  });

  test("extracts namespace from slash-delimited names", () => {
    expect(validateSecretName("prod/anthropic_key")).toEqual({
      valid: true,
      namespace: "prod",
      key: "anthropic_key",
    });
  });

  test("uses default namespace for flat env names", () => {
    expect(validateSecretName("FLYWHEEL_API_TOKEN")).toEqual({
      valid: true,
      namespace: "default",
      key: "FLYWHEEL_API_TOKEN",
    });
  });

  test("rejects empty names, path traversal, and invalid characters", () => {
    expect(validateSecretName("").valid).toBe(false);
    expect(validateSecretName("../etc/passwd").valid).toBe(false);
    expect(validateSecretName("/leading/slash").valid).toBe(false);
    expect(validateSecretName("trailing/slash/").valid).toBe(false);
    expect(validateSecretName("secret with spaces").valid).toBe(false);
  });
});

describe("SecretsProvider implementations (Env, Vault, Composite)", () => {
  test("EnvSecretsProvider resolves allowed prefixes and lists keys", async () => {
    process.env["FLYWHEEL_TEST_SECRET_KEY"] = "super-secret-value-123";
    const envProvider = new EnvSecretsProvider({
      allowPrefixes: ["FLYWHEEL_TEST_"],
    });

    const resolved = await envProvider.get("FLYWHEEL_TEST_SECRET_KEY");
    expect(resolved).toEqual({
      name: "FLYWHEEL_TEST_SECRET_KEY",
      value: "super-secret-value-123",
      source: "env",
    });

    const denied = await envProvider.get("PATH");
    expect(denied).toBeNull();

    const listed = await envProvider.list("FLYWHEEL_TEST_");
    expect(listed).toContain("FLYWHEEL_TEST_SECRET_KEY");
  });

  test("VaultSecretsProvider resolves KV v2 secrets with token and namespace headers", async () => {
    const requests: Array<{ url: string; headers: Record<string, string> }> =
      [];

    const mockFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      requests.push({ url, headers });

      if (url.endsWith("/v1/secret/data/tools/dcg")) {
        return new Response(
          JSON.stringify({
            data: {
              data: {
                apiKey: "vault-dcg-key-999",
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.endsWith("/v1/secret/metadata/tools?list=true")) {
        return new Response(
          JSON.stringify({
            data: {
              keys: ["dcg", "cass"],
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response("Not found", { status: 404 });
    }) as unknown as typeof fetch;

    const vault = new VaultSecretsProvider({
      addr: "https://vault.example.internal/",
      token: "s.vaultToken123",
      namespace: "flywheel-prod",
      mountPath: "secret",
      kvVersion: 2,
      fetchFn: mockFetch,
    });

    const secret = await vault.get("tool:dcg:apiKey");
    expect(secret).toEqual({
      name: "tool:dcg:apiKey",
      value: "vault-dcg-key-999",
      source: "vault",
    });
    expect(requests[0]?.headers["X-Vault-Token"]).toBe("s.vaultToken123");
    expect(requests[0]?.headers["X-Vault-Namespace"]).toBe("flywheel-prod");

    const listed = await vault.list("tools");
    expect(listed).toEqual(["tools/cass", "tools/dcg"]);
  });

  test("CompositeSecretsProvider prioritizes providers in order", async () => {
    process.env["FLYWHEEL_TEST_SECRET_KEY"] = "from-env";

    const mockVault = new VaultSecretsProvider({
      addr: "https://vault.local",
      token: "s.token",
      fetchFn: (async () =>
        new Response(
          JSON.stringify({
            data: { data: { value: "from-vault" } },
          }),
          { status: 200 },
        )) as unknown as typeof fetch,
    });
    const envProvider = new EnvSecretsProvider({
      allowPrefixes: ["FLYWHEEL_TEST_"],
    });

    const composite = new CompositeSecretsProvider([mockVault, envProvider]);
    const res = await composite.get("FLYWHEEL_TEST_SECRET_KEY");
    expect(res?.value).toBe("from-vault");
    expect(res?.source).toBe("vault");
  });
});

describe("Secret rotation metadata & HTTP routes", () => {
  const app = new Hono().route("/secrets", secrets);

  test("GET /secrets/providers and /secrets/references never expose secret values", async () => {
    process.env["FLYWHEEL_TEST_SECRET_KEY"] = "top-secret-never-leak";
    const envProvider = new EnvSecretsProvider({
      allowPrefixes: ["FLYWHEEL_TEST_"],
    });
    setDefaultSecretsProvider(new CompositeSecretsProvider([envProvider]));

    const provRes = await app.request("/secrets/providers");
    expect(provRes.status).toBe(200);
    const provBody = (await provRes.json()) as {
      data: Array<{ name: string; status: string; keyCount: number }>;
    };
    expect(provBody.data).toEqual([
      { name: "env", status: "available", keyCount: 1 },
    ]);

    const rotateRes = await app.request("/secrets/rotate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "FLYWHEEL_TEST_SECRET_KEY",
        rotatedBy: "admin-agent",
        reason: "scheduled rotation",
      }),
    });
    expect(rotateRes.status).toBe(200);
    const rotateText = await rotateRes.text();
    expect(rotateText).not.toContain("top-secret-never-leak");
    const rotateBody = JSON.parse(rotateText) as {
      data: {
        name: string;
        source: string;
        rotationCount: number;
        lastRotatedAt: string;
      };
    };
    expect(rotateBody.data.name).toBe("FLYWHEEL_TEST_SECRET_KEY");
    expect(rotateBody.data.source).toBe("env");
    expect(rotateBody.data.rotationCount).toBe(1);
    expect(rotateBody.data.lastRotatedAt).toBeTruthy();

    const refs = await listSecretReferences("FLYWHEEL_TEST_");
    expect(refs.length).toBe(1);
    expect(JSON.stringify(refs)).not.toContain("top-secret-never-leak");
  });

  test("POST /secrets/redact sanitizes sensitive fields and returns report with budget stats", async () => {
    const res = await app.request("/secrets/redact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        payload: {
          password: "my-super-secret-password",
          apiKey: "\u0073\u006b\u005f" + "live_1234567890abcdefghijklmnop",
          message: "Auth header is Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
          safeField: "hello world",
        },
        budgetMs: 100,
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        redacted: Record<string, unknown>;
        report: {
          totalRedactions: number;
          countsByType: Record<string, number>;
          budgetExceeded: boolean;
        };
      };
    };

    expect(body.data.redacted["password"]).toBe("[REMOVED]");
    expect(body.data.redacted["apiKey"]).not.toContain("1234567890");
    expect(body.data.redacted["message"]).toBe("Auth header is [REDACTED]");
    expect(body.data.redacted["safeField"]).toBe("hello world");
    expect(body.data.report.totalRedactions).toBeGreaterThanOrEqual(3);
    expect(body.data.report.budgetExceeded).toBe(false);
  });

  test("redactSensitiveDataWithReport supports shadowMode without mutating returned data", () => {
    const input = { secret: "dont-touch-in-shadow-mode" };
    const { data, report } = redactSensitiveDataWithReport(input, {
      shadowMode: true,
    });
    expect(data.secret).toBe("dont-touch-in-shadow-mode");
    expect(report.totalRedactions).toBe(1);
    expect(report.shadowMode).toBe(true);
  });
});

describe("WebSocket Hub secret redaction integration", () => {
  test("WebSocketHub.publish redacts secrets and inline tokens while preserving sessionId", () => {
    const hub = new WebSocketHub();
    const published = hub.publish({ type: "system:health" }, "health.score", {
      sessionId: "sess_keep_me",
      apiKey: "\u0073\u006b\u005f" + "live_secret12345678901234567890",
      password: "plain-text-password",
      logLine: "Using Bearer secret-jwt-token-xyz for auth",
    });

    const payload = published.payload as Record<string, unknown>;
    expect(payload["sessionId"]).toBe("sess_keep_me");
    expect(payload["apiKey"]).toBe("[REDACTED]");
    expect(payload["password"]).toBe("[REDACTED]");
    expect(payload["logLine"]).toBe("Using Bearer [REDACTED] for auth");
  });
});
