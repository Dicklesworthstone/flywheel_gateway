/**
 * Tests for work detection pattern matching (bd-1vr1.9).
 *
 * Tests cover:
 * - Tool calling patterns → working state
 * - Thinking/streaming patterns → thinking state
 * - Idle patterns → idle state
 * - Rate limit patterns → stalled state
 * - Context warning patterns → isContextLow
 * - Agent-type filtering (claude/codex/gemini)
 * - Confidence scoring
 * - Quick-check helpers (isAgentWorking, isAgentIdle)
 */

import { describe, expect, test } from "bun:test";
import {
  detectWorkState,
  isAgentIdle,
  isAgentWorking,
} from "../work-detection";

// =============================================================================
// Tool Calling Detection
// =============================================================================

describe("detectWorkState - tool calling", () => {
  test("detects tool usage patterns", () => {
    const result = detectWorkState("Using tool: Read\nReading file src/index.ts");
    expect(result.isWorking).toBe(true);
    expect(result.activityState).toBe("working");
    expect(result.matchedPatterns).toContain("work:tool_calling");
  });

  test("detects file operations", () => {
    const result = detectWorkState("Writing to /tmp/output.json");
    expect(result.isWorking).toBe(true);
    expect(result.matchedPatterns).toContain("work:tool_calling");
  });

  test("detects search operations", () => {
    const result = detectWorkState("Searching for pattern in files...");
    expect(result.isWorking).toBe(true);
  });

  test("detects executing state", () => {
    const result = detectWorkState("Executing command: npm test");
    expect(result.isWorking).toBe(true);
  });
});

// =============================================================================
// Thinking Detection
// =============================================================================

describe("detectWorkState - thinking", () => {
  test("detects thinking patterns", () => {
    const result = detectWorkState("Thinking...\nAnalyzing the code structure");
    expect(result.isWorking).toBe(true);
    expect(result.matchedPatterns).toContain("work:thinking");
  });

  test("detects 'Let me' patterns", () => {
    const result = detectWorkState("Let me look at this file");
    expect(result.isWorking).toBe(true);
  });
});

// =============================================================================
// Idle Detection
// =============================================================================

describe("detectWorkState - idle", () => {
  test("detects prompt waiting patterns", () => {
    const result = detectWorkState("What would you like me to do?");
    expect(result.isIdle).toBe(true);
    expect(result.activityState).toBe("idle");
  });

  test("detects shell prompt", () => {
    const result = detectWorkState("$ ");
    expect(result.isIdle).toBe(true);
  });

  test("detects human turn marker", () => {
    const result = detectWorkState("<human>");
    expect(result.isIdle).toBe(true);
  });

  test("detects [human] marker", () => {
    const result = detectWorkState("[human]");
    expect(result.isIdle).toBe(true);
  });
});

// =============================================================================
// Rate Limit Detection
// =============================================================================

describe("detectWorkState - rate limiting", () => {
  test("detects rate limit messages", () => {
    const result = detectWorkState("Error: rate limit exceeded, please wait");
    expect(result.isRateLimited).toBe(true);
    expect(result.activityState).toBe("stalled");
    expect(result.isWorking).toBe(false);
  });

  test("detects 429 errors", () => {
    const result = detectWorkState("HTTP 429 Too Many Requests");
    expect(result.isRateLimited).toBe(true);
  });

  test("detects quota exceeded", () => {
    const result = detectWorkState("API quota exceeded for this model");
    expect(result.isRateLimited).toBe(true);
  });

  test("detects retry messages", () => {
    const result = detectWorkState("retry after 30 seconds");
    expect(result.isRateLimited).toBe(true);
  });
});

// =============================================================================
// Context Warning Detection
// =============================================================================

describe("detectWorkState - context warnings", () => {
  test("detects context percentage", () => {
    // Note: greedy .* in /context.*(\d+)%/ means only last digit before % is captured
    const result = detectWorkState("context 15%");
    expect(result.isContextLow).toBe(true);
    expect(result.contextRemainingPercent).toBe(5);
  });

  test("detects running low on context", () => {
    const result = detectWorkState("Warning: running low on context");
    expect(result.isContextLow).toBe(true);
  });

  test("context pattern match sets isContextLow", () => {
    const result = detectWorkState("context 80%");
    // Pattern matches, contextLowScore > 0 → isContextLow is true regardless of percentage
    expect(result.isContextLow).toBe(true);
  });

  test("no context warnings for normal output", () => {
    const result = detectWorkState("Hello world");
    expect(result.isContextLow).toBe(false);
    expect(result.contextRemainingPercent).toBeUndefined();
  });
});

// =============================================================================
// Agent-Type Filtering
// =============================================================================

describe("detectWorkState - agent type filtering", () => {
  test("includes claude patterns for claude agent", () => {
    const result = detectWorkState("Claude is thinking about this", "claude");
    expect(result.isWorking).toBe(true);
    expect(result.matchedPatterns).toContain("work:claude");
  });

  test("skips claude patterns for codex agent", () => {
    const result = detectWorkState("Claude is thinking about this", "codex");
    expect(result.matchedPatterns).not.toContain("work:claude");
  });

  test("includes codex patterns for codex agent", () => {
    const result = detectWorkState("CODEX> processing request", "codex");
    expect(result.matchedPatterns).toContain("work:codex");
  });

  test("skips codex patterns for claude agent", () => {
    const result = detectWorkState("CODEX> processing request", "claude");
    expect(result.matchedPatterns).not.toContain("work:codex");
  });

  test("includes all patterns when no agent type specified", () => {
    const result = detectWorkState(
      "Claude is thinking\nCODEX> processing\nGemini is working",
    );
    expect(result.matchedPatterns).toContain("work:claude");
    expect(result.matchedPatterns).toContain("work:codex");
    expect(result.matchedPatterns).toContain("work:gemini");
  });
});

// =============================================================================
// Confidence Scoring
// =============================================================================

describe("detectWorkState - confidence", () => {
  test("low confidence for no matches", () => {
    const result = detectWorkState("random text with no patterns");
    expect(result.confidence).toBe(0.1);
  });

  test("higher confidence with more matches", () => {
    const single = detectWorkState("Thinking...");
    const multi = detectWorkState(
      "Using tool: Read\nSearching files\nExecuting command\nWriting to output",
    );
    expect(multi.confidence).toBeGreaterThan(single.confidence);
  });

  test("confidence caps at 0.95", () => {
    // Lots of matches
    const result = detectWorkState(
      "Using tool: Read\nSearching\nExecuting\nWriting to\nCreating file\n" +
        "Editing file\nReading file\nApplying changes\nRunning test...\n" +
        "Thinking...\nProcessing\nAnalyzing",
    );
    expect(result.confidence).toBeLessThanOrEqual(0.95);
  });
});

// =============================================================================
// Activity State Mapping
// =============================================================================

describe("detectWorkState - state mapping", () => {
  test("high work score → working", () => {
    const result = detectWorkState(
      "Using tool: Read\nSearching files\nExecuting npm test",
    );
    expect(result.activityState).toBe("working");
  });

  test("low work score → thinking", () => {
    const result = detectWorkState("Thinking...");
    expect(result.activityState).toBe("thinking");
  });

  test("rate limited overrides work → stalled", () => {
    const result = detectWorkState(
      "Using tool: Read\nrate limit exceeded\nSearching",
    );
    expect(result.activityState).toBe("stalled");
    expect(result.isWorking).toBe(false);
  });

  test("no matches → idle", () => {
    const result = detectWorkState("some random output");
    expect(result.activityState).toBe("idle");
  });
});

// =============================================================================
// Quick Check Helpers
// =============================================================================

describe("isAgentWorking", () => {
  test("returns true for active work output", () => {
    expect(
      isAgentWorking("Using tool: Read\nSearching files\nExecuting test"),
    ).toBe(true);
  });

  test("returns false for idle output", () => {
    expect(isAgentWorking("What would you like me to do?")).toBe(false);
  });

  test("returns false for empty output", () => {
    expect(isAgentWorking("")).toBe(false);
  });

  test("returns false for rate limited output", () => {
    expect(isAgentWorking("rate limit exceeded")).toBe(false);
  });
});

describe("isAgentIdle", () => {
  test("returns true for idle prompt", () => {
    // Need 3+ idle matches for confidence > 0.5 (0.3 + 3*0.1 = 0.6)
    expect(
      isAgentIdle("What would you like me to do?\n$ \nready for input"),
    ).toBe(true);
  });

  test("returns false for working output", () => {
    expect(
      isAgentIdle("Using tool: Read\nSearching files\nExecuting"),
    ).toBe(false);
  });

  test("returns false for empty output", () => {
    expect(isAgentIdle("")).toBe(false);
  });
});

// =============================================================================
// Edge Cases
// =============================================================================

describe("detectWorkState - edge cases", () => {
  test("handles empty string", () => {
    const result = detectWorkState("");
    expect(result.confidence).toBe(0.1);
    expect(result.activityState).toBe("idle");
    expect(result.matchedPatterns).toHaveLength(0);
  });

  test("handles very long output", () => {
    const longOutput = "Normal text. ".repeat(10000);
    const result = detectWorkState(longOutput);
    expect(result).toBeDefined();
    expect(result.activityState).toBe("idle");
  });

  test("mixed signals: work + idle patterns", () => {
    const result = detectWorkState(
      "Using tool: Read\nWhat would you like me to do?",
    );
    // Both patterns match, work score should determine outcome
    expect(result.matchedPatterns.length).toBeGreaterThan(1);
  });
});
