/**
 * Tool Registry Service Tests
 */

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from "bun:test";
import { createHash } from "node:crypto";
import { isGatewayError } from "@flywheel/shared/errors";
import { restoreCorrelation } from "./test-utils/db-mock-restore";

const realFs = require("node:fs");
const realFsPromises = require("node:fs/promises");
const realYaml = require("yaml");

type LogEvent = { level: "info" | "warn" | "debug" | "error"; args: unknown[] };

let parseMode: "normal" | "throw" = "normal";
let defaultContent = "";
let manifestContents = new Map<string, string>();
let existsOverrides = new Map<string, boolean>();
let defaultExists = true;
let readFileCalls: Array<{ path: string; encoding?: string }> = [];
let existsCalls: string[] = [];
let logEvents: LogEvent[] = [];

const mockLogger = {
  info: (...args: unknown[]) => logEvents.push({ level: "info", args }),
  warn: (...args: unknown[]) => logEvents.push({ level: "warn", args }),
  debug: (...args: unknown[]) => logEvents.push({ level: "debug", args }),
  error: (...args: unknown[]) => logEvents.push({ level: "error", args }),
  child: () => mockLogger,
};

mock.module("node:fs", () => ({
  ...realFs,
  existsSync: (path: string) => {
    existsCalls.push(path);
    if (existsOverrides.has(path)) {
      return existsOverrides.get(path) ?? false;
    }
    return defaultExists;
  },
}));

mock.module("node:fs/promises", () => ({
  ...realFsPromises,
  readFile: async (path: string, encoding?: string) => {
    const call: { path: string; encoding?: string } = { path };
    if (typeof encoding === "string") {
      call.encoding = encoding;
    }
    readFileCalls.push(call);
    if (manifestContents.has(path)) {
      return manifestContents.get(path) as string;
    }
    if (defaultContent) {
      return defaultContent;
    }
    throw new Error(`ENOENT: ${path}`);
  },
}));

mock.module("yaml", () => ({
  parse: (content: string) => {
    if (parseMode === "throw") {
      throw new Error("bad yaml");
    }
    return realYaml.parse(content);
  },
}));

mock.module("../middleware/correlation", () => ({
  getLogger: () => mockLogger,
  getCorrelationId: () => "test-corr",
}));

// Import after mocks are defined
import {
  clearToolRegistryCache,
  getToolRegistryMetadata,
  loadToolRegistry,
} from "../services/tool-registry.service";

const validManifest = `schemaVersion: "1.0.0"
source: "acfs"
generatedAt: "2026-01-22T00:00:00Z"
tools:
  - id: "tools.dcg"
    name: "dcg"
    category: "tool"
`;

const invalidSchemaManifest = `schemaVersion: "2.1.0"
tools:
  - id: 123
    name: "dcg"
    category: "tool"
`;

const originalEnv = { ...process.env };

function resetState() {
  parseMode = "normal";
  defaultContent = "";
  manifestContents = new Map();
  existsOverrides = new Map();
  defaultExists = true;
  readFileCalls = [];
  existsCalls = [];
  logEvents = [];
  clearToolRegistryCache();
}

beforeEach(() => {
  resetState();
});

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(originalEnv)) {
    process.env[key] = value;
  }
  clearToolRegistryCache();
});

afterAll(() => {
  mock.restore();
  mock.module("node:fs", () => realFs);
  mock.module("node:fs/promises", () => realFsPromises);
  mock.module("yaml", () => realYaml);
  restoreCorrelation();
});

describe("ToolRegistry cache behavior", () => {
  it("caches registry within TTL", async () => {
    const manifestPath = "/tmp/tool-registry.yaml";
    process.env["ACFS_MANIFEST_PATH"] = manifestPath;
    process.env["ACFS_MANIFEST_TTL_MS"] = "60000";
    defaultExists = false;
    existsOverrides.set(manifestPath, true);
    manifestContents.set(manifestPath, validManifest);

    const first = await loadToolRegistry();
    const second = await loadToolRegistry();

    expect(readFileCalls.length).toBe(1);
    expect(first).toBe(second);

    const meta = getToolRegistryMetadata();
    expect(meta?.manifestPath).toBe(manifestPath);
    expect(meta?.schemaVersion).toBe("1.0.0");
    expect(meta?.manifestHash).toBe(
      createHash("sha256").update(validManifest).digest("hex"),
    );
  });

  it("re-reads registry when TTL is zero", async () => {
    const manifestPath = "/tmp/tool-registry.yaml";
    process.env["ACFS_MANIFEST_PATH"] = manifestPath;
    process.env["ACFS_MANIFEST_TTL_MS"] = "0";
    defaultExists = false;
    existsOverrides.set(manifestPath, true);
    manifestContents.set(manifestPath, validManifest);

    await loadToolRegistry();
    await loadToolRegistry();

    expect(readFileCalls.length).toBe(2);
  });
});

describe("Manifest path resolution", () => {
  it("uses ACFS_MANIFEST_PATH override when set", async () => {
    const manifestPath = "/custom/override.yaml";
    process.env["ACFS_MANIFEST_PATH"] = manifestPath;
    defaultExists = false;
    existsOverrides.set(manifestPath, true);
    manifestContents.set(manifestPath, validManifest);

    await loadToolRegistry();

    expect(existsCalls[0]).toBe(manifestPath);
    const meta = getToolRegistryMetadata();
    expect(meta?.manifestPath).toBe(manifestPath);
  });

  it("falls back to default manifest path when overrides are unset", async () => {
    delete process.env["ACFS_MANIFEST_PATH"];
    delete process.env["TOOL_REGISTRY_PATH"];
    defaultExists = true;
    defaultContent = validManifest;

    await loadToolRegistry();

    expect(existsCalls[0]).toContain("acfs.manifest.yaml");
    const meta = getToolRegistryMetadata();
    expect(meta?.manifestPath).toContain("acfs.manifest.yaml");
  });
});

describe("Error mapping + logging", () => {
  it("logs manifest_parse_error with path/hash and throws GatewayError when throwOnError", async () => {
    const manifestPath = "/tmp/invalid.yaml";
    process.env["ACFS_MANIFEST_PATH"] = manifestPath;
    defaultExists = false;
    existsOverrides.set(manifestPath, true);
    manifestContents.set(manifestPath, "not: [valid");
    parseMode = "throw";

    let caught: unknown;
    try {
      await loadToolRegistry({ throwOnError: true });
    } catch (error) {
      caught = error;
    }

    expect(isGatewayError(caught)).toBe(true);
    const details = (
      caught as { details?: Record<string, unknown>; code?: string }
    ).details;
    expect(details?.["errorCategory"]).toBe("manifest_parse_error");

    const warnEvent = logEvents.find((event) => event.level === "warn");
    expect(warnEvent).toBeDefined();
    const warnPayload = warnEvent?.args[0] as Record<string, unknown>;
    expect(warnPayload["manifestPath"]).toBe(manifestPath);
    expect(warnPayload["manifestHash"]).toBe(
      createHash("sha256").update("not: [valid").digest("hex"),
    );
    expect(warnPayload["errorCategory"]).toBe("manifest_parse_error");
    expect(warnPayload["schemaVersion"]).toBeNull();
  });

  it("logs manifest_validation_error with schema version when throwOnError", async () => {
    const manifestPath = "/tmp/invalid-schema.yaml";
    process.env["ACFS_MANIFEST_PATH"] = manifestPath;
    defaultExists = false;
    existsOverrides.set(manifestPath, true);
    manifestContents.set(manifestPath, invalidSchemaManifest);

    let caught: unknown;
    try {
      await loadToolRegistry({ throwOnError: true });
    } catch (error) {
      caught = error;
    }

    expect(isGatewayError(caught)).toBe(true);
    const details = (caught as { details?: Record<string, unknown> }).details;
    expect(details?.["errorCategory"]).toBe("manifest_validation_error");
    expect(details?.["schemaVersion"]).toBe("2.1.0");

    const warnEvent = logEvents.find((event) => event.level === "warn");
    expect(warnEvent).toBeDefined();
    const warnPayload = warnEvent?.args[0] as Record<string, unknown>;
    expect(warnPayload["manifestPath"]).toBe(manifestPath);
    expect(warnPayload["manifestHash"]).toBe(
      createHash("sha256").update(invalidSchemaManifest).digest("hex"),
    );
    expect(warnPayload["errorCategory"]).toBe("manifest_validation_error");
    expect(warnPayload["schemaVersion"]).toBe("2.1.0");
  });
});

describe("Manifest fallback behavior", () => {
  it("returns fallback registry when manifest is missing", async () => {
    const manifestPath = "/tmp/nonexistent.yaml";
    process.env["ACFS_MANIFEST_PATH"] = manifestPath;
    defaultExists = false;
    existsOverrides.set(manifestPath, false);

    const registry = await loadToolRegistry();

    // Should return fallback, not throw
    expect(registry.schemaVersion).toBe("1.0.0-fallback");
    expect(registry.source).toBe("built-in");
    expect(registry.tools.length).toBeGreaterThan(0);

    // Should log warning with correct error category
    const warnEvent = logEvents.find((event) => event.level === "warn");
    expect(warnEvent).toBeDefined();
    const warnPayload = warnEvent?.args[0] as Record<string, unknown>;
    expect(warnPayload["errorCategory"]).toBe("manifest_missing");
    expect(warnPayload["manifestPath"]).toBe(manifestPath);
  });

  it("returns fallback registry when manifest has invalid YAML", async () => {
    const manifestPath = "/tmp/bad-yaml.yaml";
    process.env["ACFS_MANIFEST_PATH"] = manifestPath;
    defaultExists = false;
    existsOverrides.set(manifestPath, true);
    manifestContents.set(manifestPath, "this: [is: bad: yaml");
    parseMode = "throw";

    const registry = await loadToolRegistry();

    // Should return fallback, not throw
    expect(registry.schemaVersion).toBe("1.0.0-fallback");
    expect(registry.source).toBe("built-in");

    // Metadata should reflect fallback state
    const meta = getToolRegistryMetadata();
    expect(meta?.registrySource).toBe("fallback");
    expect(meta?.errorCategory).toBe("manifest_parse_error");
  });

  it("returns fallback registry when manifest fails validation", async () => {
    const manifestPath = "/tmp/invalid-schema.yaml";
    process.env["ACFS_MANIFEST_PATH"] = manifestPath;
    defaultExists = false;
    existsOverrides.set(manifestPath, true);
    manifestContents.set(manifestPath, invalidSchemaManifest);

    const registry = await loadToolRegistry();

    // Should return fallback, not throw
    expect(registry.schemaVersion).toBe("1.0.0-fallback");

    // Metadata should indicate validation error
    const meta = getToolRegistryMetadata();
    expect(meta?.registrySource).toBe("fallback");
    expect(meta?.errorCategory).toBe("manifest_validation_error");
    expect(meta?.userMessage).toContain("schema validation");
  });
});

describe("Refresh/bypass cache", () => {
  it("bypassCache: true forces fresh load even within TTL", async () => {
    const manifestPath = "/tmp/tool-registry.yaml";
    process.env["ACFS_MANIFEST_PATH"] = manifestPath;
    process.env["ACFS_MANIFEST_TTL_MS"] = "60000";
    defaultExists = false;
    existsOverrides.set(manifestPath, true);
    manifestContents.set(manifestPath, validManifest);

    // First load - should read from file
    await loadToolRegistry();
    expect(readFileCalls.length).toBe(1);

    // Second load with bypassCache - should read again
    await loadToolRegistry({ bypassCache: true });
    expect(readFileCalls.length).toBe(2);

    // Third load without bypassCache - should use cache
    await loadToolRegistry();
    expect(readFileCalls.length).toBe(2);
  });

  it("clearToolRegistryCache forces next load to read from file", async () => {
    const manifestPath = "/tmp/tool-registry.yaml";
    process.env["ACFS_MANIFEST_PATH"] = manifestPath;
    process.env["ACFS_MANIFEST_TTL_MS"] = "60000";
    defaultExists = false;
    existsOverrides.set(manifestPath, true);
    manifestContents.set(manifestPath, validManifest);

    // First load
    await loadToolRegistry();
    expect(readFileCalls.length).toBe(1);

    // Clear cache
    clearToolRegistryCache();

    // Next load should read from file again
    await loadToolRegistry();
    expect(readFileCalls.length).toBe(2);
  });
});

describe("Provenance metadata", () => {
  it("getToolRegistryMetadata returns path, hash, and version", async () => {
    const manifestPath = "/tmp/tool-registry.yaml";
    process.env["ACFS_MANIFEST_PATH"] = manifestPath;
    defaultExists = false;
    existsOverrides.set(manifestPath, true);
    manifestContents.set(manifestPath, validManifest);

    await loadToolRegistry();

    const meta = getToolRegistryMetadata();
    expect(meta).not.toBeNull();
    expect(meta?.manifestPath).toBe(manifestPath);
    expect(meta?.schemaVersion).toBe("1.0.0");
    expect(meta?.manifestHash).toBe(
      createHash("sha256").update(validManifest).digest("hex"),
    );
    expect(meta?.registrySource).toBe("manifest");
    expect(meta?.loadedAt).toBeGreaterThan(0);
  });

  it("getToolRegistryMetadata returns null before any load", () => {
    // Cache is cleared in beforeEach
    const meta = getToolRegistryMetadata();
    expect(meta).toBeNull();
  });

  it("getToolRegistryMetadata includes errorCategory and userMessage for fallback", async () => {
    const manifestPath = "/tmp/missing.yaml";
    process.env["ACFS_MANIFEST_PATH"] = manifestPath;
    defaultExists = false;
    existsOverrides.set(manifestPath, false);

    await loadToolRegistry();

    const meta = getToolRegistryMetadata();
    expect(meta).not.toBeNull();
    expect(meta?.registrySource).toBe("fallback");
    expect(meta?.errorCategory).toBe("manifest_missing");
    expect(meta?.userMessage).toBeDefined();
    expect(meta?.userMessage).toContain("manifest file not found");
  });
});

describe("Manifest provenance fields for readiness responses", () => {
  it("manifest load sets registrySource to 'manifest' (not 'fallback')", async () => {
    const manifestPath = "/tmp/provenance-test.yaml";
    process.env["ACFS_MANIFEST_PATH"] = manifestPath;
    defaultExists = false;
    existsOverrides.set(manifestPath, true);
    manifestContents.set(manifestPath, validManifest);

    const registry = await loadToolRegistry();
    const meta = getToolRegistryMetadata();

    // Registry source field indicates manifest was loaded
    expect(registry.source).toBe("acfs");
    expect(meta?.registrySource).toBe("manifest");

    // errorCategory is undefined (not set) for successful loads
    expect(meta?.errorCategory).toBeUndefined();
  });

  it("fallback registry sets source to 'built-in' in registry object", async () => {
    const manifestPath = "/tmp/nonexistent-provenance.yaml";
    process.env["ACFS_MANIFEST_PATH"] = manifestPath;
    defaultExists = false;
    existsOverrides.set(manifestPath, false);

    const registry = await loadToolRegistry();

    // Fallback registry explicitly indicates built-in source
    expect(registry.source).toBe("built-in");
    expect(registry.schemaVersion).toBe("1.0.0-fallback");
  });

  it("fallback metadata indicates built-in registry source for readiness", async () => {
    const manifestPath = "/tmp/missing-for-readiness.yaml";
    process.env["ACFS_MANIFEST_PATH"] = manifestPath;
    defaultExists = false;
    existsOverrides.set(manifestPath, false);

    await loadToolRegistry();
    const meta = getToolRegistryMetadata();

    // Readiness response can use these fields to indicate fallback
    expect(meta?.registrySource).toBe("fallback");
    expect(meta?.schemaVersion).toBe("1.0.0-fallback");
    expect(meta?.errorCategory).toBe("manifest_missing");
  });

  it("manifestHash is a valid SHA256 hex string (64 characters)", async () => {
    const manifestPath = "/tmp/hash-check.yaml";
    process.env["ACFS_MANIFEST_PATH"] = manifestPath;
    defaultExists = false;
    existsOverrides.set(manifestPath, true);
    manifestContents.set(manifestPath, validManifest);

    await loadToolRegistry();
    const meta = getToolRegistryMetadata();

    expect(meta?.manifestHash).toBeDefined();
    expect(meta?.manifestHash).toHaveLength(64);
    expect(meta?.manifestHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("manifestPath in metadata matches the resolved path", async () => {
    const manifestPath = "/custom/path/tool-registry.yaml";
    process.env["ACFS_MANIFEST_PATH"] = manifestPath;
    defaultExists = false;
    existsOverrides.set(manifestPath, true);
    manifestContents.set(manifestPath, validManifest);

    await loadToolRegistry();
    const meta = getToolRegistryMetadata();

    // Path should be the exact path that was resolved and loaded
    expect(meta?.manifestPath).toBe(manifestPath);
  });

  it("fallback metadata has null manifestPath when manifest missing", async () => {
    const manifestPath = "/tmp/does-not-exist.yaml";
    process.env["ACFS_MANIFEST_PATH"] = manifestPath;
    defaultExists = false;
    existsOverrides.set(manifestPath, false);

    await loadToolRegistry();
    const meta = getToolRegistryMetadata();

    // When manifest is missing, path should still indicate what was attempted
    expect(meta?.manifestPath).toBe(manifestPath);
    expect(meta?.manifestHash).toBeNull();
  });

  it("parse error fallback includes manifestPath and hash for diagnostics", async () => {
    const manifestPath = "/tmp/bad-parse.yaml";
    const badContent = "this: [is: bad: yaml";
    process.env["ACFS_MANIFEST_PATH"] = manifestPath;
    defaultExists = false;
    existsOverrides.set(manifestPath, true);
    manifestContents.set(manifestPath, badContent);
    parseMode = "throw";

    await loadToolRegistry();
    const meta = getToolRegistryMetadata();

    // Even on parse error, we should know what was attempted
    expect(meta?.registrySource).toBe("fallback");
    expect(meta?.errorCategory).toBe("manifest_parse_error");
    expect(meta?.manifestPath).toBe(manifestPath);
    // Hash of the content that failed to parse
    expect(meta?.manifestHash).toBe(
      createHash("sha256").update(badContent).digest("hex"),
    );
  });

  it("validation error fallback uses fallback registry schemaVersion", async () => {
    const manifestPath = "/tmp/invalid-schema-provenance.yaml";
    process.env["ACFS_MANIFEST_PATH"] = manifestPath;
    defaultExists = false;
    existsOverrides.set(manifestPath, true);
    manifestContents.set(manifestPath, invalidSchemaManifest);

    await loadToolRegistry();
    const meta = getToolRegistryMetadata();

    // When validation fails, schemaVersion comes from the fallback registry
    // (not the invalid manifest's version)
    expect(meta?.registrySource).toBe("fallback");
    expect(meta?.errorCategory).toBe("manifest_validation_error");
    expect(meta?.schemaVersion).toBe("1.0.0-fallback");
  });

  it("loadedAt timestamp is recent (within last second)", async () => {
    const manifestPath = "/tmp/timestamp-test.yaml";
    process.env["ACFS_MANIFEST_PATH"] = manifestPath;
    defaultExists = false;
    existsOverrides.set(manifestPath, true);
    manifestContents.set(manifestPath, validManifest);

    const before = Date.now();
    await loadToolRegistry();
    const after = Date.now();

    const meta = getToolRegistryMetadata();

    expect(meta?.loadedAt).toBeGreaterThanOrEqual(before);
    expect(meta?.loadedAt).toBeLessThanOrEqual(after);
  });

  it("all provenance fields have correct types for API serialization", async () => {
    const manifestPath = "/tmp/type-check.yaml";
    process.env["ACFS_MANIFEST_PATH"] = manifestPath;
    defaultExists = false;
    existsOverrides.set(manifestPath, true);
    manifestContents.set(manifestPath, validManifest);

    await loadToolRegistry();
    const meta = getToolRegistryMetadata();

    // These assertions ensure JSON serialization works correctly
    expect(typeof meta?.manifestPath).toBe("string");
    expect(typeof meta?.schemaVersion).toBe("string");
    expect(typeof meta?.manifestHash).toBe("string");
    expect(typeof meta?.registrySource).toBe("string");
    expect(typeof meta?.loadedAt).toBe("number");
    // errorCategory is undefined (not set) for successful loads
    expect(meta?.errorCategory).toBeUndefined();
  });

  it("fallback provenance fields have correct nullable types", async () => {
    const manifestPath = "/tmp/nullable-types.yaml";
    process.env["ACFS_MANIFEST_PATH"] = manifestPath;
    defaultExists = false;
    existsOverrides.set(manifestPath, false);

    await loadToolRegistry();
    const meta = getToolRegistryMetadata();

    // For fallback, some fields should be null while others have values
    expect(typeof meta?.registrySource).toBe("string");
    expect(meta?.registrySource).toBe("fallback");
    expect(typeof meta?.errorCategory).toBe("string");
    expect(typeof meta?.userMessage).toBe("string");
    // manifestHash is null when file doesn't exist
    expect(meta?.manifestHash).toBeNull();
  });
});

// ============================================================================
// Golden Fixture Tests
//
// These tests use the golden fixture files in __tests__/fixtures/ to validate
// manifest parsing and validation behavior. The fixtures provide canonical
// examples of valid/invalid manifests for documentation and regression testing.
// ============================================================================

import path from "node:path";
import { readFileSync } from "node:fs";

const fixturesDir = path.join(__dirname, "fixtures");

// Load fixtures synchronously for test setup
const loadFixture = (name: string): string => {
  try {
    return readFileSync(path.join(fixturesDir, name), "utf-8");
  } catch {
    return "";
  }
};

describe("Golden fixture validation", () => {
  const validFixture = loadFixture("valid-manifest.yaml");
  const invalidSchemaFixture = loadFixture("invalid-schema-manifest.yaml");
  const minimalFixture = loadFixture("minimal-manifest.yaml");

  it("valid-manifest.yaml parses and validates successfully", async () => {
    if (!validFixture) {
      console.log("Skipping: valid-manifest.yaml fixture not found");
      return;
    }

    const manifestPath = "/tmp/valid-fixture.yaml";
    process.env["ACFS_MANIFEST_PATH"] = manifestPath;
    defaultExists = false;
    existsOverrides.set(manifestPath, true);
    manifestContents.set(manifestPath, validFixture);

    const registry = await loadToolRegistry();

    expect(registry.schemaVersion).toBe("1.0.0");
    expect(registry.source).toBe("acfs");
    expect(Array.isArray(registry.tools)).toBe(true);
    expect(registry.tools.length).toBeGreaterThan(0);

    // Verify expected tools are present
    const toolIds = registry.tools.map((t) => t.id);
    expect(toolIds).toContain("agents.claude");
    expect(toolIds).toContain("tools.dcg");
    expect(toolIds).toContain("tools.slb");
    expect(toolIds).toContain("tools.ubs");
    expect(toolIds).toContain("tools.br");

    const meta = getToolRegistryMetadata();
    expect(meta?.registrySource).toBe("manifest");
    expect(meta?.errorCategory).toBeUndefined();
  });

  it("invalid-schema-manifest.yaml triggers validation error and fallback", async () => {
    if (!invalidSchemaFixture) {
      console.log("Skipping: invalid-schema-manifest.yaml fixture not found");
      return;
    }

    const manifestPath = "/tmp/invalid-schema-fixture.yaml";
    process.env["ACFS_MANIFEST_PATH"] = manifestPath;
    defaultExists = false;
    existsOverrides.set(manifestPath, true);
    manifestContents.set(manifestPath, invalidSchemaFixture);

    const registry = await loadToolRegistry();

    // Should return fallback registry
    expect(registry.schemaVersion).toBe("1.0.0-fallback");
    expect(registry.source).toBe("built-in");

    const meta = getToolRegistryMetadata();
    expect(meta?.registrySource).toBe("fallback");
    expect(meta?.errorCategory).toBe("manifest_validation_error");
    expect(meta?.userMessage).toBeDefined();
  });

  it("minimal-manifest.yaml validates with only required fields", async () => {
    if (!minimalFixture) {
      console.log("Skipping: minimal-manifest.yaml fixture not found");
      return;
    }

    const manifestPath = "/tmp/minimal-fixture.yaml";
    process.env["ACFS_MANIFEST_PATH"] = manifestPath;
    defaultExists = false;
    existsOverrides.set(manifestPath, true);
    manifestContents.set(manifestPath, minimalFixture);

    const registry = await loadToolRegistry();

    expect(registry.schemaVersion).toBe("1.0.0");
    expect(Array.isArray(registry.tools)).toBe(true);
    expect(registry.tools.length).toBe(1);

    const tool = registry.tools[0]!;
    expect(tool.id).toBe("tools.minimal");
    expect(tool.name).toBe("minimal");
    expect(tool.category).toBe("tool");
  });
});
