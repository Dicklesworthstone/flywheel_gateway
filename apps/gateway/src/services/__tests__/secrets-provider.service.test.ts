/**
 * Secrets Provider Service Tests (bd-d134v)
 */

import { afterEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CompositeSecretsProvider,
  EnvSecretsProvider,
  FileSecretsProvider,
  formatToolSecretName,
  parseToolSecretName,
} from "../secrets-provider.service";

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
  Object.keys(savedEnv).forEach((k) => {
    delete savedEnv[k];
  });
}

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

afterEach(() => {
  restoreEnv();
});

describe("formatToolSecretName/parseToolSecretName", () => {
  it("round-trips tool names", () => {
    const name = formatToolSecretName("dcg", "apiKey");
    expect(name).toBe("tool:dcg:apiKey");
    expect(parseToolSecretName(name)).toEqual({ tool: "dcg", key: "apiKey" });
  });

  it("returns null for invalid names", () => {
    expect(parseToolSecretName("tool:dcg")).toBeNull();
    expect(parseToolSecretName("not-a-tool")).toBeNull();
  });
});

describe("EnvSecretsProvider", () => {
  it("returns env secrets and lists by prefix", async () => {
    const token = `token-${randomUUID()}`;
    setEnv("APP_TOKEN", token);
    setEnv("OTHER_SECRET", `other-${randomUUID()}`);
    const provider = new EnvSecretsProvider({ allowPrefixes: ["APP_"] });

    const result = await provider.get("APP_TOKEN");
    expect(result?.value).toBe(token);
    expect(result?.source).toBe("env");

    const listed = await provider.list("APP_");
    expect(listed).toEqual(["APP_TOKEN"]);

    clearEnv("APP_TOKEN");
    clearEnv("OTHER_SECRET");
  });
});

describe("FileSecretsProvider", () => {
  it("loads tool secrets from secrets.yaml", async () => {
    const dir = makeTempDir("sec-provider-");
    const apiKey = `test-${randomUUID()}`;
    writeFileSync(
      join(dir, "secrets.yaml"),
      `tools:\n  dcg:\n    apiKey: ${apiKey}\n`,
    );

    const provider = new FileSecretsProvider({
      privateDir: dir,
      refreshIntervalMs: 0,
    });
    const name = formatToolSecretName("dcg", "apiKey");
    const result = await provider.get(name);
    expect(result?.value).toBe(apiKey);
    expect(result?.source).toBe("file");

    const listed = await provider.list("tool:dcg");
    expect(listed).toEqual([name]);

    rmSync(dir, { recursive: true });
  });

  it("handles file-referenced secrets", async () => {
    const dir = makeTempDir("sec-provider-file-");
    mkdirSync(join(dir, "secrets"));
    const fileName = `dcg-key-${randomUUID()}.txt`;
    const fileValue = `file-${randomUUID()}`;
    writeFileSync(join(dir, "secrets", fileName), `${fileValue}\n`);
    writeFileSync(
      join(dir, "secrets", "secrets.yaml"),
      `tools:\n  dcg:\n    apiKey: "file:${fileName}"\n`,
    );

    const provider = new FileSecretsProvider({
      privateDir: dir,
      refreshIntervalMs: 0,
    });
    const name = formatToolSecretName("dcg", "apiKey");
    const result = await provider.get(name);
    expect(result?.value).toBe(fileValue);

    rmSync(dir, { recursive: true });
  });
});

describe("CompositeSecretsProvider", () => {
  it("returns the first matching provider", async () => {
    const envToken = `env-${randomUUID()}`;
    setEnv("APP_TOKEN", envToken);
    const envProvider = new EnvSecretsProvider({ allowPrefixes: ["APP_"] });

    const dir = makeTempDir("sec-provider-composite-");
    const apiKey = `test-${randomUUID()}`;
    writeFileSync(
      join(dir, "secrets.yaml"),
      `tools:\n  dcg:\n    apiKey: ${apiKey}\n`,
    );
    const fileProvider = new FileSecretsProvider({
      privateDir: dir,
      refreshIntervalMs: 0,
    });

    const composite = new CompositeSecretsProvider([envProvider, fileProvider]);

    const envResult = await composite.get("APP_TOKEN");
    expect(envResult?.value).toBe(envToken);

    const toolName = formatToolSecretName("dcg", "apiKey");
    const fileResult = await composite.get(toolName);
    expect(fileResult?.value).toBe(apiKey);

    rmSync(dir, { recursive: true });
  });
});
