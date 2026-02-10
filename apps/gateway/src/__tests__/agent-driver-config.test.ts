/**
 * Agent driver configuration tests.
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
  clearConfigCache,
  flywheelConfigSchema,
  loadConfig,
} from "../services/config.service";

const originalEnv: Record<string, string | undefined> = {};

function setEnv(key: string, value: string): void {
  if (!(key in originalEnv)) {
    originalEnv[key] = process.env[key];
  }
  process.env[key] = value;
}

function restoreEnv(): void {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }
    process.env[key] = value;
  }
  for (const key of Object.keys(originalEnv)) {
    delete originalEnv[key];
  }
}

describe("Agent driver configuration", () => {
  afterEach(() => {
    restoreEnv();
    clearConfigCache();
  });

  test("defaults to sdk driver", () => {
    const parsed = flywheelConfigSchema.parse({});
    expect(parsed.agent.defaultDriver).toBe("sdk");
  });

  test("accepts claude_code_ws as default driver", () => {
    const parsed = flywheelConfigSchema.parse({
      agent: { defaultDriver: "claude_code_ws" },
    });
    expect(parsed.agent.defaultDriver).toBe("claude_code_ws");
  });

  test("rejects unknown driver values", () => {
    const parsed = flywheelConfigSchema.safeParse({
      agent: { defaultDriver: "invalid-driver" },
    });
    expect(parsed.success).toBe(false);
  });

  test("AGENT_DRIVER overrides config", async () => {
    setEnv("AGENT_DRIVER", "claude_code_ws");
    const config = await loadConfig({ cwd: "/tmp", forceReload: true });
    expect(config.agent.defaultDriver).toBe("claude_code_ws");
  });
});
