/**
 * Tests for tool-health-diagnostics.service.ts
 */

import { describe, expect, it } from "bun:test";
import type { ToolDefinition } from "@flywheel/shared";
import type { DetectedCLI } from "../services/agent-detection.service";
import { computeHealthDiagnostics } from "../services/tool-health-diagnostics.service";

function makeTool(
  id: string,
  name: string,
  opts?: { depends?: string[]; displayName?: string },
): ToolDefinition {
  return {
    id,
    name,
    category: "tool",
    displayName: opts?.displayName ?? name,
    depends: opts?.depends,
  };
}

function makeCLI(name: string, available: boolean): DetectedCLI {
  return {
    name: name as DetectedCLI["name"],
    available,
    ...(available ? {} : { unavailabilityReason: "not_installed" as const }),
    capabilities: {
      streaming: false,
      toolUse: false,
      vision: false,
      codeExecution: false,
      fileAccess: false,
    },
    detectedAt: new Date(),
    durationMs: 1,
  };
}

describe("computeHealthDiagnostics", () => {
  it("returns all tools available when everything is detected", () => {
    const tools = [makeTool("tools.a", "a"), makeTool("tools.b", "b")];
    const clis = [makeCLI("a", true), makeCLI("b", true)];

    const result = computeHealthDiagnostics(tools, clis);

    expect(result.summary.totalTools).toBe(2);
    expect(result.summary.availableTools).toBe(2);
    expect(result.summary.unavailableTools).toBe(0);
    expect(result.cascadeFailures).toHaveLength(0);
    expect(result.tools.every((t) => t.available)).toBe(true);
  });

  it("marks unavailable tools with reason", () => {
    const tools = [makeTool("tools.a", "a")];
    const clis = [makeCLI("a", false)];

    const result = computeHealthDiagnostics(tools, clis);

    expect(result.summary.unavailableTools).toBe(1);
    expect(result.tools[0]!.available).toBe(false);
    expect(result.tools[0]!.reason).toBe("not_installed");
    expect(result.tools[0]!.reasonLabel).toBeDefined();
  });

  it("detects cascade failures through dependencies", () => {
    const tools = [
      makeTool("tools.tmux", "tmux", { displayName: "tmux" }),
      makeTool("tools.ntm", "ntm", {
        depends: ["tools.tmux"],
        displayName: "NTM",
      }),
    ];
    const clis = [makeCLI("tmux", false), makeCLI("ntm", false)];

    const result = computeHealthDiagnostics(tools, clis);

    expect(result.cascadeFailures).toHaveLength(1);
    expect(result.cascadeFailures[0]!.affectedTool).toBe("tools.ntm");
    expect(result.cascadeFailures[0]!.rootCause).toBe("tools.tmux");
    expect(result.cascadeFailures[0]!.path).toEqual([
      "tools.tmux",
      "tools.ntm",
    ]);

    const ntmDiag = result.tools.find((t) => t.toolId === "tools.ntm")!;
    expect(ntmDiag.rootCauseExplanation).toContain("tmux");
    expect(ntmDiag.rootCausePath).toEqual(["tools.tmux", "tools.ntm"]);
  });

  it("finds deep root cause through multi-level dependencies", () => {
    const tools = [
      makeTool("tools.a", "a"),
      makeTool("tools.b", "b", { depends: ["tools.a"] }),
      makeTool("tools.c", "c", { depends: ["tools.b"] }),
    ];
    const clis = [
      makeCLI("a", false),
      makeCLI("b", false),
      makeCLI("c", false),
    ];

    const result = computeHealthDiagnostics(tools, clis);

    const cDiag = result.tools.find((t) => t.toolId === "tools.c")!;
    expect(cDiag.rootCausePath![0]).toBe("tools.a");
    expect(result.summary.rootCauseTools).toContain("tools.a");
  });

  it("builds correct dependedBy reverse mapping", () => {
    const tools = [
      makeTool("tools.tmux", "tmux"),
      makeTool("tools.ntm", "ntm", { depends: ["tools.tmux"] }),
      makeTool("tools.cass", "cass", { depends: ["tools.tmux"] }),
    ];
    const clis = [
      makeCLI("tmux", true),
      makeCLI("ntm", true),
      makeCLI("cass", true),
    ];

    const result = computeHealthDiagnostics(tools, clis);

    const tmuxDiag = result.tools.find((t) => t.toolId === "tools.tmux")!;
    expect(tmuxDiag.dependedBy).toContain("tools.ntm");
    expect(tmuxDiag.dependedBy).toContain("tools.cass");
  });

  it("handles tools with no detection results as unavailable", () => {
    const tools = [makeTool("tools.mystery", "mystery")];
    const clis: DetectedCLI[] = [];

    const result = computeHealthDiagnostics(tools, clis);

    expect(result.tools[0]!.available).toBe(false);
    expect(result.summary.unavailableTools).toBe(1);
  });

  it("handles empty tool list", () => {
    const result = computeHealthDiagnostics([], []);

    expect(result.summary.totalTools).toBe(0);
    expect(result.cascadeFailures).toHaveLength(0);
  });

  it("does not report cascade when tool fails independently (deps available)", () => {
    const tools = [
      makeTool("tools.tmux", "tmux"),
      makeTool("tools.ntm", "ntm", { depends: ["tools.tmux"] }),
    ];
    const clis = [makeCLI("tmux", true), makeCLI("ntm", false)];

    const result = computeHealthDiagnostics(tools, clis);

    const ntmDiag = result.tools.find((t) => t.toolId === "tools.ntm")!;
    expect(ntmDiag.available).toBe(false);
    expect(ntmDiag.rootCausePath).toBeUndefined();
    expect(result.cascadeFailures).toHaveLength(0);
  });
});
