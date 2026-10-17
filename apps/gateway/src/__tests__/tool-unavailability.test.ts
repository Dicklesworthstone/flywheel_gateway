import { describe, expect, it } from "bun:test";
import {
  classifyToolUnavailability,
  getUnavailabilityHttpStatus,
  getUnavailabilityLabel,
  isRetryableUnavailability,
  type ToolUnavailabilityReason,
  UNAVAILABILITY_REASONS,
} from "@flywheel/shared/errors";

describe("classifyToolUnavailability", () => {
  describe("stderr pattern matching", () => {
    it("classifies 'command not found' as not_installed", () => {
      expect(
        classifyToolUnavailability({ stderr: "bash: dcg: command not found" }),
      ).toBe("not_installed");
    });

    it("classifies 'no such file or directory' as not_installed", () => {
      expect(
        classifyToolUnavailability({
          stderr:
            "Error: ENOENT: no such file or directory, stat '/usr/bin/dcg'",
        }),
      ).toBe("not_installed");
    });

    it("classifies 'is not recognized' (Windows) as not_installed", () => {
      expect(
        classifyToolUnavailability({
          stderr: "'dcg' is not recognized as an internal or external command",
        }),
      ).toBe("not_installed");
    });

    it("classifies 'permission denied' as permission_denied", () => {
      expect(
        classifyToolUnavailability({ stderr: "Error: Permission denied" }),
      ).toBe("permission_denied");
    });

    it("classifies EACCES as permission_denied", () => {
      expect(
        classifyToolUnavailability({
          stderr: "Error: EACCES: permission denied",
        }),
      ).toBe("permission_denied");
    });

    it("classifies 'not logged in' as auth_required", () => {
      expect(
        classifyToolUnavailability({ stderr: "Error: not logged in" }),
      ).toBe("auth_required");
    });

    it("classifies 'unauthorized' as auth_required", () => {
      expect(classifyToolUnavailability({ stderr: "401 Unauthorized" })).toBe(
        "auth_required",
      );
    });

    it("classifies 'no api key' as auth_required", () => {
      expect(
        classifyToolUnavailability({ stderr: "Error: no API key found" }),
      ).toBe("auth_required");
    });

    it("classifies 'token expired' as auth_expired", () => {
      expect(
        classifyToolUnavailability({ stderr: "Error: token expired" }),
      ).toBe("auth_expired");
    });

    it("classifies 'invalid token' as auth_expired", () => {
      expect(
        classifyToolUnavailability({
          stderr: "Error: invalid authentication token",
        }),
      ).toBe("auth_expired");
    });

    it("classifies 'unsupported version' as version_unsupported", () => {
      expect(
        classifyToolUnavailability({
          stderr: "Error: unsupported version 0.1",
        }),
      ).toBe("version_unsupported");
    });

    it("classifies 'minimum version' as version_unsupported", () => {
      expect(
        classifyToolUnavailability({
          stderr: "Error: minimum version 2.0.0 required",
        }),
      ).toBe("version_unsupported");
    });

    it("classifies 'config not found' as config_missing", () => {
      expect(
        classifyToolUnavailability({ stderr: "Error: config not found" }),
      ).toBe("config_missing");
    });

    it("classifies 'invalid config' as config_invalid", () => {
      expect(
        classifyToolUnavailability({
          stderr: "Error: invalid config at line 5",
        }),
      ).toBe("config_invalid");
    });

    it("classifies 'missing dependency' as dependency_missing", () => {
      expect(
        classifyToolUnavailability({
          stderr: "Error: missing dependency: libssl",
        }),
      ).toBe("dependency_missing");
    });

    it("classifies ECONNREFUSED as mcp_unreachable", () => {
      expect(
        classifyToolUnavailability({
          stderr: "Error: connect ECONNREFUSED 127.0.0.1:3000",
        }),
      ).toBe("mcp_unreachable");
    });

    it("classifies segfault as crash", () => {
      expect(
        classifyToolUnavailability({
          stderr: "Segmentation fault (core dumped)",
        }),
      ).toBe("crash");
    });

    it("classifies 'panic' as crash", () => {
      expect(
        classifyToolUnavailability({ stderr: "panic: runtime error" }),
      ).toBe("crash");
    });
  });

  describe("exit code mapping", () => {
    it("maps exit code 127 to not_installed", () => {
      expect(classifyToolUnavailability({ exitCode: 127 })).toBe(
        "not_installed",
      );
    });

    it("maps exit code 126 to permission_denied", () => {
      expect(classifyToolUnavailability({ exitCode: 126 })).toBe(
        "permission_denied",
      );
    });

    it("maps exit code 139 (SIGSEGV) to crash", () => {
      expect(classifyToolUnavailability({ exitCode: 139 })).toBe("crash");
    });

    it("maps exit code 134 (SIGABRT) to crash", () => {
      expect(classifyToolUnavailability({ exitCode: 134 })).toBe("crash");
    });

    it("maps exit code 2 to not_installed (convention)", () => {
      expect(classifyToolUnavailability({ exitCode: 2 })).toBe("not_installed");
    });
  });

  describe("error message fallback", () => {
    it("classifies from Error objects", () => {
      expect(
        classifyToolUnavailability({
          error: new Error("EACCES: permission denied"),
        }),
      ).toBe("permission_denied");
    });

    it("classifies from string errors", () => {
      expect(classifyToolUnavailability({ error: "command not found" })).toBe(
        "not_installed",
      );
    });
  });

  describe("priority: stderr > exit code", () => {
    it("stderr pattern wins over exit code", () => {
      // Exit code 2 would map to not_installed, but stderr says permission denied
      expect(
        classifyToolUnavailability({
          exitCode: 2,
          stderr: "permission denied",
        }),
      ).toBe("permission_denied");
    });
  });

  describe("fallback", () => {
    it("returns 'unknown' for unrecognized errors", () => {
      expect(
        classifyToolUnavailability({ exitCode: 42, stderr: "something weird" }),
      ).toBe("unknown");
    });

    it("returns 'unknown' for empty input", () => {
      expect(classifyToolUnavailability({})).toBe("unknown");
    });
  });
});

describe("UNAVAILABILITY_META helpers", () => {
  it("getUnavailabilityHttpStatus returns correct status", () => {
    expect(getUnavailabilityHttpStatus("not_installed")).toBe(404);
    expect(getUnavailabilityHttpStatus("permission_denied")).toBe(403);
    expect(getUnavailabilityHttpStatus("auth_required")).toBe(401);
    expect(getUnavailabilityHttpStatus("mcp_unreachable")).toBe(503);
    expect(getUnavailabilityHttpStatus("timeout")).toBe(408);
  });

  it("getUnavailabilityLabel returns human-readable labels", () => {
    expect(getUnavailabilityLabel("not_installed")).toBe("Not Installed");
    expect(getUnavailabilityLabel("auth_required")).toBe("Auth Required");
    expect(getUnavailabilityLabel("mcp_unreachable")).toBe("MCP Unreachable");
  });

  it("isRetryableUnavailability correctly identifies transient issues", () => {
    expect(isRetryableUnavailability("not_installed")).toBe(false);
    expect(isRetryableUnavailability("permission_denied")).toBe(false);
    expect(isRetryableUnavailability("auth_required")).toBe(false);
    expect(isRetryableUnavailability("mcp_unreachable")).toBe(true);
    expect(isRetryableUnavailability("timeout")).toBe(true);
    expect(isRetryableUnavailability("crash")).toBe(true);
    expect(isRetryableUnavailability("spawn_failed")).toBe(true);
  });

  it("UNAVAILABILITY_REASONS contains all reasons", () => {
    expect(UNAVAILABILITY_REASONS.length).toBe(14);
    expect(UNAVAILABILITY_REASONS).toContain("not_installed");
    expect(UNAVAILABILITY_REASONS).toContain("unknown");
  });
});

describe("CliClientError auto-classification", () => {
  it("auto-classifies unavailability reason from details", () => {
    const { CliClientError } = require("@flywheel/shared/errors");
    const err = new CliClientError("command_failed", "cmd failed", {
      exitCode: 127,
      stderr: "",
    });
    expect(err.details?.unavailabilityReason).toBe("not_installed");
  });

  it("auto-classifies from stderr patterns", () => {
    const { CliClientError } = require("@flywheel/shared/errors");
    const err = new CliClientError("command_failed", "cmd failed", {
      exitCode: 1,
      stderr: "Error: permission denied",
    });
    expect(err.details?.unavailabilityReason).toBe("permission_denied");
  });

  it("does not override explicit unavailabilityReason", () => {
    const { CliClientError } = require("@flywheel/shared/errors");
    const err = new CliClientError("command_failed", "cmd failed", {
      exitCode: 127,
      stderr: "",
      unavailabilityReason: "config_missing" as ToolUnavailabilityReason,
    });
    expect(err.details?.unavailabilityReason).toBe("config_missing");
  });
});
