/**
 * Secret Loader Service Tests (bd-2n73.12)
 *
 * Tests secret loading from env vars, file-based secrets,
 * env mapping, and secure diagnostics.
 */

import { describe, expect, it, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadSecretsFromDir,
  resolveSecret,
  loadSecrets,
  secretDiagnostics,
  type ToolSecretSpec,
} from "../services/secret-loader.service";
import type { EnvMapping } from "../services/private-overlay.service";

// ============================================================================
// Helpers
// ============================================================================

const savedEnv: Record<string, string | undefined> = {};

function setEnv(key: string, value: string): void {
  if (!(key in savedEnv)) savedEnv[key] = process.env[key];
  process.env[key] = value;
}

function clearEnv(key: string): void {
  if (!(key in savedEnv)) savedEnv[key] = process.env[key];
  delete process.env[key];
}

function restoreEnv(): void {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  Object.keys(savedEnv).forEach((k) => delete savedEnv[k]);
}

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

// ============================================================================
// File-Based Secret Loading
// ============================================================================

describe("loadSecretsFromDir", () => {
  it("returns empty when dir does not exist", async () => {
    const result = await loadSecretsFromDir("/nonexistent/xyz");
    expect(result.entries).toHaveLength(0);
  });

  it("returns empty when no secrets index", async () => {
    const dir = makeTempDir("secret-empty-");
    const result = await loadSecretsFromDir(dir);
    expect(result.entries).toHaveLength(0);
    rmSync(dir, { recursive: true });
  });

  it("loads inline secrets from root secrets.yaml", async () => {
    const dir = makeTempDir("secret-inline-");
    writeFileSync(
      join(dir, "secrets.yaml"),
      "tools:\n  dcg:\n    apiKey: sk-test-123\n  cass:\n    token: tok-abc",
    );
    const result = await loadSecretsFromDir(dir);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].tool).toBe("dcg");
    expect(result.entries[0].key).toBe("apiKey");
    expect(result.entries[0].value).toBe("sk-test-123");
    rmSync(dir, { recursive: true });
  });

  it("loads file-referenced secrets", async () => {
    const dir = makeTempDir("secret-file-");
    mkdirSync(join(dir, "secrets"));
    writeFileSync(join(dir, "secrets", "dcg-key.txt"), "file-secret-value\n");
    writeFileSync(
      join(dir, "secrets", "secrets.yaml"),
      "tools:\n  dcg:\n    apiKey: \"file:dcg-key.txt\"",
    );
    const result = await loadSecretsFromDir(dir);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].value).toBe("file-secret-value");
    rmSync(dir, { recursive: true });
  });

  it("returns error for invalid YAML", async () => {
    const dir = makeTempDir("secret-bad-");
    writeFileSync(join(dir, "secrets.yaml"), "{{invalid yaml");
    const result = await loadSecretsFromDir(dir);
    expect(result.error).toBeDefined();
    expect(result.error).toContain("Failed to load secrets index");
    rmSync(dir, { recursive: true });
  });

  it("handles missing file reference gracefully", async () => {
    const dir = makeTempDir("secret-missing-file-");
    writeFileSync(
      join(dir, "secrets.yaml"),
      "tools:\n  dcg:\n    apiKey: \"file:nonexistent.txt\"",
    );
    const result = await loadSecretsFromDir(dir);
    expect(result.entries).toHaveLength(0); // File not found, skipped
    rmSync(dir, { recursive: true });
  });
});

// ============================================================================
// Secret Resolution
// ============================================================================

describe("resolveSecret", () => {
  afterEach(restoreEnv);

  const spec: ToolSecretSpec = {
    tool: "dcg",
    key: "apiKey",
    required: true,
    description: "DCG API key",
  };

  it("resolves from conventional env var", async () => {
    setEnv("TOOL_DCG_API_KEY", "env-secret");
    const result = await resolveSecret(spec);
    expect(result.found).toBe(true);
    expect(result.source).toBe("env");
    expect(result.value).toBe("env-secret");
  });

  it("resolves from env mapping", async () => {
    setEnv("MY_DCG_KEY", "mapped-secret");
    const mapping: EnvMapping = { toolSecrets: { dcg: "MY_DCG_KEY" } };
    const result = await resolveSecret(spec, mapping);
    expect(result.found).toBe(true);
    expect(result.source).toBe("mapping");
    expect(result.value).toBe("mapped-secret");
  });

  it("resolves from file entries", async () => {
    clearEnv("TOOL_DCG_API_KEY");
    const entries = [{ tool: "dcg", key: "apiKey", value: "file-secret" }];
    const result = await resolveSecret(spec, undefined, entries);
    expect(result.found).toBe(true);
    expect(result.source).toBe("file");
    expect(result.value).toBe("file-secret");
  });

  it("returns not found when no source available", async () => {
    clearEnv("TOOL_DCG_API_KEY");
    const result = await resolveSecret(spec);
    expect(result.found).toBe(false);
    expect(result.source).toBe("none");
    expect(result.value).toBeUndefined();
  });

  it("prefers env over file", async () => {
    setEnv("TOOL_DCG_API_KEY", "env-wins");
    const entries = [{ tool: "dcg", key: "apiKey", value: "file-loses" }];
    const result = await resolveSecret(spec, undefined, entries);
    expect(result.value).toBe("env-wins");
    expect(result.source).toBe("env");
  });
});

// ============================================================================
// Bulk Secret Loading
// ============================================================================

describe("loadSecrets", () => {
  afterEach(restoreEnv);

  it("loads from nonexistent private dir gracefully", async () => {
    clearEnv("TOOL_DCG_API_KEY");
    const specs: ToolSecretSpec[] = [
      { tool: "dcg", key: "apiKey", required: false, description: "test" },
    ];
    const result = await loadSecrets(specs, "/nonexistent/xyz");
    expect(result.secrets).toHaveLength(1);
    expect(result.secrets[0].found).toBe(false);
    expect(result.allRequiredPresent).toBe(true);
  });

  it("reports missing required secrets", async () => {
    clearEnv("TOOL_DCG_API_KEY");
    clearEnv("TOOL_CASS_API_KEY");
    const specs: ToolSecretSpec[] = [
      { tool: "dcg", key: "apiKey", required: true, description: "DCG key" },
      { tool: "cass", key: "apiKey", required: true, description: "CASS key" },
    ];
    const result = await loadSecrets(specs, "/nonexistent/xyz");
    expect(result.allRequiredPresent).toBe(false);
    expect(result.missingRequired).toEqual(["dcg:apiKey", "cass:apiKey"]);
  });

  it("reports all present when env vars set", async () => {
    setEnv("TOOL_DCG_API_KEY", "key1");
    setEnv("TOOL_CASS_API_KEY", "key2");
    const specs: ToolSecretSpec[] = [
      { tool: "dcg", key: "apiKey", required: true, description: "DCG" },
      { tool: "cass", key: "apiKey", required: true, description: "CASS" },
    ];
    const result = await loadSecrets(specs, "/nonexistent/xyz");
    expect(result.allRequiredPresent).toBe(true);
    expect(result.missingRequired).toHaveLength(0);
  });

  it("loads from file-based private dir", async () => {
    clearEnv("TOOL_DCG_API_KEY");
    const dir = makeTempDir("secret-load-");
    writeFileSync(
      join(dir, "secrets.yaml"),
      "tools:\n  dcg:\n    apiKey: file-based-secret",
    );
    const specs: ToolSecretSpec[] = [
      { tool: "dcg", key: "apiKey", required: true, description: "DCG" },
    ];
    const result = await loadSecrets(specs, dir);
    expect(result.allRequiredPresent).toBe(true);
    expect(result.secrets[0].source).toBe("file");
    rmSync(dir, { recursive: true });
  });
});

// ============================================================================
// Diagnostics
// ============================================================================

describe("secretDiagnostics", () => {
  it("generates safe summary without secret values", () => {
    const result = {
      secrets: [
        { tool: "dcg", key: "apiKey", found: true, source: "env" as const, value: "SHOULD_NOT_APPEAR" },
        { tool: "cass", key: "token", found: false, source: "none" as const },
        { tool: "slb", key: "apiKey", found: true, source: "file" as const, value: "ALSO_SECRET" },
      ],
      missingRequired: ["cass:token"],
      allRequiredPresent: false,
      errors: [],
    };

    const diag = secretDiagnostics(result);
    expect(diag.total).toBe(3);
    expect(diag.found).toBe(2);
    expect(diag.missing).toBe(1);
    expect(diag.missingRequired).toEqual(["cass:token"]);
    expect(diag.sources).toEqual({ env: 1, none: 1, file: 1 });

    // Verify no secret values in output
    const diagStr = JSON.stringify(diag);
    expect(diagStr).not.toContain("SHOULD_NOT_APPEAR");
    expect(diagStr).not.toContain("ALSO_SECRET");
  });
});
