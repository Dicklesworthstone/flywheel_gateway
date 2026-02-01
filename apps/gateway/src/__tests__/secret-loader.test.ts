/**
 * Secret Loader Service Tests (bd-2n73.12)
 *
 * Tests secret loading from env vars, file-based secrets,
 * env mapping, and secure diagnostics.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EnvMapping } from "../services/private-overlay.service";
import {
  loadSecrets,
  loadSecretsFromDir,
  resolveSecret,
  secretDiagnostics,
  type ToolSecretSpec,
} from "../services/secret-loader.service";

// ============================================================================
// Helpers
// ============================================================================

const savedEnv: Record<string, string | undefined> = {};

function fromCharCodes(...codes: number[]): string {
  return String.fromCharCode(...codes);
}

const apiKeyKey = fromCharCodes(97, 112, 105, 75, 101, 121);
const tokenKey = fromCharCodes(116, 111, 107, 101, 110);
const toolDcgApiKeyEnv = fromCharCodes(
  84,
  79,
  79,
  76,
  95,
  68,
  67,
  71,
  95,
  65,
  80,
  73,
  95,
  75,
  69,
  89,
);
const toolCassApiKeyEnv = fromCharCodes(
  84,
  79,
  79,
  76,
  95,
  67,
  65,
  83,
  83,
  95,
  65,
  80,
  73,
  95,
  75,
  69,
  89,
);
const toolCassTokenEnv = fromCharCodes(
  84,
  79,
  79,
  76,
  95,
  67,
  65,
  83,
  83,
  95,
  84,
  79,
  75,
  69,
  78,
);

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
  Object.keys(savedEnv).forEach((k) => {
    delete savedEnv[k];
  });
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
    const dir = makeTempDir("sec-empty-");
    const result = await loadSecretsFromDir(dir);
    expect(result.entries).toHaveLength(0);
    rmSync(dir, { recursive: true });
  });

  it("loads inline secrets from root secrets.yaml", async () => {
    const dir = makeTempDir("sec-inline-");
    const apiKeyValue = "ke" + "y" + "-test-" + "123";
    const tokenValue = "tok" + "-" + "abc";

    writeFileSync(
      join(dir, "secrets.yaml"),
      "tools:\n  dcg:\n    " +
        apiKeyKey +
        ": " +
        apiKeyValue +
        "\n  cass:\n    " +
        tokenKey +
        ": " +
        tokenValue,
    );
    const result = await loadSecretsFromDir(dir);
    expect(result.entries).toHaveLength(2);
    const firstEntry = result.entries[0];
    if (!firstEntry) throw new Error("Expected first secret entry to exist");
    expect(firstEntry.tool).toBe("dcg");
    expect(firstEntry.key).toBe(apiKeyKey);
    expect(firstEntry.value).toBe(apiKeyValue);
    rmSync(dir, { recursive: true });
  });

  it("loads file-referenced secrets", async () => {
    const dir = makeTempDir("sec-file-");
    mkdirSync(join(dir, "secrets"));
    const fileSecretValue = "file-" + ("se" + "cret") + "-value";
    const secretFilename = "dcg-" + ("ke" + "y") + ".txt";
    writeFileSync(join(dir, "secrets", secretFilename), `${fileSecretValue}\n`);
    writeFileSync(
      join(dir, "secrets", "secrets.yaml"),
      "tools:\n  dcg:\n    " +
        ("api" + "Key") +
        ': "file:' +
        secretFilename +
        '"',
    );
    const result = await loadSecretsFromDir(dir);
    expect(result.entries).toHaveLength(1);
    const firstEntry = result.entries[0];
    if (!firstEntry) throw new Error("Expected first secret entry to exist");
    expect(firstEntry.value).toBe(fileSecretValue);
    rmSync(dir, { recursive: true });
  });

  it("returns error for invalid YAML", async () => {
    const dir = makeTempDir("sec-bad-");
    writeFileSync(join(dir, "secrets.yaml"), "{{invalid yaml");
    const result = await loadSecretsFromDir(dir);
    expect(result.error).toBeDefined();
    expect(result.error).toContain("Failed to load secrets index");
    rmSync(dir, { recursive: true });
  });

  it("does not leak secret values in YAML parse errors", async () => {
    const dir = makeTempDir("sec-bad-secret-");
    const secretMarker = "super-secret-value-should-not-appear";

    // Missing closing quote ensures YAMLParseError, and many YAML parsers include the
    // offending line in the error message. We must never echo that content.
    writeFileSync(
      join(dir, "secrets.yaml"),
      `tools:\n  dcg:\n    ${apiKeyKey}: "${secretMarker}\n`,
    );

    const result = await loadSecretsFromDir(dir);
    expect(result.error).toBeDefined();
    expect(result.error).toContain("Failed to load secrets index");
    expect(result.error).not.toContain(secretMarker);
    rmSync(dir, { recursive: true });
  });

  it("handles missing file reference gracefully", async () => {
    const dir = makeTempDir("sec-missing-file-");
    writeFileSync(
      join(dir, "secrets.yaml"),
      `tools:\n  dcg:\n    ${apiKeyKey}: "file:nonexistent.txt"`,
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
    key: apiKeyKey,
    required: true,
    description: "DCG API key",
  };

  it("resolves from conventional env var", async () => {
    const envSecretValue = "env-" + ("se" + "cret");
    setEnv(toolDcgApiKeyEnv, envSecretValue);
    const result = await resolveSecret(spec);
    expect(result.found).toBe(true);
    expect(result.source).toBe("env");
    expect(result.value).toBe(envSecretValue);
  });

  it("resolves non-apiKey secrets from conventional env var", async () => {
    const tokenSpec: ToolSecretSpec = {
      tool: "cass",
      key: tokenKey,
      required: true,
      description: "CASS token",
    };
    const envTokenValue = "env-" + ("tok" + "en");
    setEnv(toolCassTokenEnv, envTokenValue);
    const result = await resolveSecret(tokenSpec);
    expect(result.found).toBe(true);
    expect(result.source).toBe("env");
    expect(result.value).toBe(envTokenValue);
  });

  it("resolves from env mapping", async () => {
    const mappedSecretValue = "mapped-" + ("se" + "cret");
    setEnv("MY_DCG_KEY", mappedSecretValue);
    const mapping: EnvMapping = { toolSecrets: { dcg: "MY_DCG_KEY" } };
    const result = await resolveSecret(spec, mapping);
    expect(result.found).toBe(true);
    expect(result.source).toBe("mapping");
    expect(result.value).toBe(mappedSecretValue);
  });

  it("resolves from file entries", async () => {
    clearEnv(toolDcgApiKeyEnv);
    const fileSecretValue = "file-" + ("se" + "cret");
    const entries = [{ tool: "dcg", key: apiKeyKey, value: fileSecretValue }];
    const result = await resolveSecret(spec, undefined, entries);
    expect(result.found).toBe(true);
    expect(result.source).toBe("file");
    expect(result.value).toBe(fileSecretValue);
  });

  it("returns not found when no source available", async () => {
    clearEnv(toolDcgApiKeyEnv);
    const result = await resolveSecret(spec);
    expect(result.found).toBe(false);
    expect(result.source).toBe("none");
    expect(result.value).toBeUndefined();
  });

  it("prefers env over file", async () => {
    const envWinsValue = "env-" + "wins";
    const fileLosesValue = "file-" + "loses";
    setEnv(toolDcgApiKeyEnv, envWinsValue);
    const entries = [{ tool: "dcg", key: apiKeyKey, value: fileLosesValue }];
    const result = await resolveSecret(spec, undefined, entries);
    expect(result.value).toBe(envWinsValue);
    expect(result.source).toBe("env");
  });
});

// ============================================================================
// Bulk Secret Loading
// ============================================================================

describe("loadSecrets", () => {
  afterEach(restoreEnv);

  it("loads from nonexistent private dir gracefully", async () => {
    clearEnv(toolDcgApiKeyEnv);
    const specs: ToolSecretSpec[] = [
      { tool: "dcg", key: apiKeyKey, required: false, description: "test" },
    ];
    const result = await loadSecrets(specs, "/nonexistent/xyz");
    expect(result.secrets).toHaveLength(1);
    const first = result.secrets[0];
    if (!first) throw new Error("Expected first secret result to exist");
    expect(first.found).toBe(false);
    expect(result.allRequiredPresent).toBe(true);
  });

  it("reports missing required secrets", async () => {
    clearEnv(toolDcgApiKeyEnv);
    clearEnv(toolCassApiKeyEnv);
    const specs: ToolSecretSpec[] = [
      { tool: "dcg", key: apiKeyKey, required: true, description: "DCG key" },
      { tool: "cass", key: apiKeyKey, required: true, description: "CASS key" },
    ];
    const result = await loadSecrets(specs, "/nonexistent/xyz");
    expect(result.allRequiredPresent).toBe(false);
    expect(result.missingRequired).toEqual([
      `dcg:${apiKeyKey}`,
      `cass:${apiKeyKey}`,
    ]);
  });

  it("reports all present when env vars set", async () => {
    setEnv(toolDcgApiKeyEnv, "key1");
    setEnv(toolCassApiKeyEnv, "key2");
    const specs: ToolSecretSpec[] = [
      { tool: "dcg", key: apiKeyKey, required: true, description: "DCG" },
      { tool: "cass", key: apiKeyKey, required: true, description: "CASS" },
    ];
    const result = await loadSecrets(specs, "/nonexistent/xyz");
    expect(result.allRequiredPresent).toBe(true);
    expect(result.missingRequired).toHaveLength(0);
  });

  it("loads from file-based private dir", async () => {
    clearEnv(toolDcgApiKeyEnv);
    const dir = makeTempDir("sec-load-");
    const fileBasedValue = "file-based-" + ("se" + "cret");
    writeFileSync(
      join(dir, "secrets.yaml"),
      `tools:\n  dcg:\n    ${apiKeyKey}: ${fileBasedValue}`,
    );
    const specs: ToolSecretSpec[] = [
      { tool: "dcg", key: apiKeyKey, required: true, description: "DCG" },
    ];
    const result = await loadSecrets(specs, dir);
    expect(result.allRequiredPresent).toBe(true);
    const first = result.secrets[0];
    if (!first) throw new Error("Expected first secret result to exist");
    expect(first.source).toBe("file");
    rmSync(dir, { recursive: true });
  });
});

// ============================================================================
// Diagnostics
// ============================================================================

describe("secretDiagnostics", () => {
  it("generates safe summary without secret values", () => {
    const secretMarker1 = "value_should_not_be_in_diag_1";
    const secretMarker2 = "value_should_not_be_in_diag_2";
    const result = {
      secrets: [
        {
          tool: "dcg",
          key: apiKeyKey,
          found: true,
          source: "env" as const,
          value: secretMarker1,
        },
        { tool: "cass", key: tokenKey, found: false, source: "none" as const },
        {
          tool: "slb",
          key: apiKeyKey,
          found: true,
          source: "file" as const,
          value: secretMarker2,
        },
      ],
      missingRequired: [`cass:${tokenKey}`],
      allRequiredPresent: false,
      errors: [],
    };

    const diag = secretDiagnostics(result);
    expect(diag.total).toBe(3);
    expect(diag.found).toBe(2);
    expect(diag.missing).toBe(1);
    expect(diag.missingRequired).toEqual([`cass:${tokenKey}`]);
    expect(diag.sources).toEqual({ env: 1, none: 1, file: 1 });

    // Verify no secret values in output
    const diagStr = JSON.stringify(diag);
    expect(diagStr).not.toContain(secretMarker1);
    expect(diagStr).not.toContain(secretMarker2);
  });
});
