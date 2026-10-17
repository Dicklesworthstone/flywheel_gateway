/**
 * Agent Replay/Debug Mode & Context Window Heat Map Tests (bd-1zgxu, bd-u2cl8)
 */

import { beforeEach, describe, expect, test } from "bun:test";
import app from "../index";
import {
  clearReplayAndHeatMapForTesting,
  getContextHeatMap,
  recordContextTurn,
  recordReplayFrame,
  shareReplayDebugSession,
  startReplayDebugSession,
  stepReplayDebugSession,
} from "../services/agent-replay.service";

describe("Agent Replay/Debug Mode & Context Window Heat Map (bd-1zgxu, bd-u2cl8)", () => {
  beforeEach(() => {
    delete process.env["GATEWAY_ADMIN_KEY"];
    clearReplayAndHeatMapForTesting();
  });

  test("records replay frames, steps forward/backward/jump, pauses on breakpoints, and shares session (bd-1zgxu)", () => {
    recordReplayFrame({
      agentId: "ag-debug",
      sessionId: "sess-debug",
      type: "input",
      summary: "User prompt: fix authentication bug",
    });
    recordReplayFrame({
      agentId: "ag-debug",
      sessionId: "sess-debug",
      type: "tool_call",
      summary: "Running grep on auth.ts",
    });
    recordReplayFrame({
      agentId: "ag-debug",
      sessionId: "sess-debug",
      type: "tool_result",
      summary: "Command failed with exit code 1",
      isError: true,
    });
    recordReplayFrame({
      agentId: "ag-debug",
      sessionId: "sess-debug",
      type: "decision",
      summary: "Switching to view_file fallback",
    });

    const dbg = startReplayDebugSession({
      agentId: "ag-debug",
      sessionId: "sess-debug",
      breakpoints: [{ onError: true }],
    });
    expect(dbg.currentFrameIndex).toBe(0);
    expect(dbg.totalFrames).toBe(4);

    // Step next
    const s1 = stepReplayDebugSession(dbg.id, "next");
    expect(s1?.currentFrameIndex).toBe(1);
    expect(s1?.pausedOnBreakpoint).toBe(false);

    // Continue to error breakpoint (frame index 2)
    const s2 = stepReplayDebugSession(dbg.id, "continue_to_breakpoint");
    expect(s2?.currentFrameIndex).toBe(2);
    expect(s2?.pausedOnBreakpoint).toBe(true);
    expect(s2?.currentFrame?.isError).toBe(true);

    // Step prev
    const s3 = stepReplayDebugSession(dbg.id, "prev");
    expect(s3?.currentFrameIndex).toBe(1);

    // Share session
    const shared = shareReplayDebugSession(dbg.id);
    expect(shared?.shareToken).toMatch(/^shr_/);
    expect(shared?.frames.length).toBe(4);
  });

  test("computes Context Window Heat Map category breakdowns, peak pressure turn, and optimization suggestions (bd-u2cl8)", () => {
    recordContextTurn({
      agentId: "ag-hm",
      sessionId: "sess-hm",
      turn: 1,
      contextLimit: 100_000,
      attributions: [
        { category: "system", tokens: 15_000, isCached: false },
        { category: "user", tokens: 5_000, isCached: false },
      ],
    });
    recordContextTurn({
      agentId: "ag-hm",
      sessionId: "sess-hm",
      turn: 2,
      contextLimit: 100_000,
      attributions: [
        { category: "tool_result", tokens: 65_000, isCached: false },
        { category: "assistant", tokens: 20_000, isCached: false },
      ],
    });

    const hm = getContextHeatMap("ag-hm", "sess-hm");
    expect(hm.totalTurns).toBe(2);
    expect(hm.peakTurn).toBe(2);
    expect(hm.peakUtilization).toBe(0.85);
    expect(hm.categoryPercentages["tool_result"]).toBeGreaterThan(50);
    expect(hm.optimizationSuggestions.length).toBeGreaterThanOrEqual(2);
  });

  test("REST endpoints /replays/frames, /replays/sessions, and /replays/context-heatmap work end-to-end", async () => {
    await app.request("/replays/frames", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: "ag-r1",
        sessionId: "s-r1",
        type: "input",
        summary: "Start session",
      }),
    });

    const sessRes = await app.request("/replays/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: "ag-r1", sessionId: "s-r1" }),
    });
    expect(sessRes.status).toBe(201);

    await app.request("/replays/context-heatmap/turns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: "ag-r1",
        sessionId: "s-r1",
        turn: 1,
        contextLimit: 50_000,
        attributions: [{ category: "user", tokens: 10_000 }],
      }),
    });

    const hmRes = await app.request("/replays/context-heatmap/ag-r1/s-r1");
    expect(hmRes.status).toBe(200);
    const hmBody = (await hmRes.json()) as {
      data: { totalTurns: number; peakUtilization: number };
    };
    expect(hmBody.data.totalTurns).toBe(1);
    expect(hmBody.data.peakUtilization).toBe(0.2);
  });
});
