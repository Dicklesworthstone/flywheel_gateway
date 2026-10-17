/**
 * Agent Replay/Debug Mode & Context Window Heat Map Service (bd-1zgxu, bd-u2cl8)
 *
 * Provides:
 * 1. Step-by-step Agent Replay/Debug Mode (bd-1zgxu):
 *    - Frame recording (`input`, `output`, `tool_call`, `tool_result`, `state_change`, `decision`)
 *    - Interactive replay debugger (`next`, `prev`, `jump`, conditional breakpoints)
 *    - Collaborative replay sharing
 * 2. Context Window Heat Map Visualization (bd-u2cl8):
 *    - Per-turn token attribution by category (`system`, `user`, `assistant`, `tool_call`, `tool_result`, `reasoning`, `code_block`)
 *    - Heat map bucket aggregation, peak pressure detection, and token optimization recommendations
 */

import { ulid } from "ulid";
import { z } from "zod";
import { redactSensitiveData } from "./audit-redaction.service";

// ============================================================================
// Replay/Debug Mode Schemas & Types (bd-1zgxu)
// ============================================================================

export const ReplayFrameTypeSchema = z.enum([
  "input",
  "output",
  "tool_call",
  "tool_result",
  "state_change",
  "decision",
]);

export const RecordReplayFrameSchema = z.object({
  agentId: z.string().min(1),
  sessionId: z.string().min(1),
  type: ReplayFrameTypeSchema,
  summary: z.string().min(1).max(400),
  data: z.record(z.string(), z.unknown()).default({}),
  stateSnapshot: z
    .object({
      agentState: z.string().default("working"),
      contextTokensUsed: z.number().int().min(0).default(0),
      activeTool: z.string().optional(),
      variables: z.record(z.string(), z.unknown()).default({}),
    })
    .default({ agentState: "working", contextTokensUsed: 0, variables: {} }),
  isError: z.boolean().default(false),
  timestamp: z.string().optional(),
});

export interface ReplayFrame {
  frameId: string;
  frameIndex: number;
  agentId: string;
  sessionId: string;
  type: z.infer<typeof ReplayFrameTypeSchema>;
  summary: string;
  data: Record<string, unknown>;
  stateSnapshot: {
    agentState: string;
    contextTokensUsed: number;
    activeTool?: string;
    variables: Record<string, unknown>;
  };
  isError: boolean;
  timestamp: string;
}

export const ReplayBreakpointSchema = z.object({
  frameType: ReplayFrameTypeSchema.optional(),
  onError: z.boolean().optional(),
  keywordMatch: z.string().optional(),
});

export type ReplayBreakpoint = z.infer<typeof ReplayBreakpointSchema>;

export interface ReplayDebugSession {
  id: string;
  agentId: string;
  sessionId: string;
  currentFrameIndex: number;
  totalFrames: number;
  currentFrame: ReplayFrame | null;
  pausedOnBreakpoint: boolean;
  breakpoints: ReplayBreakpoint[];
  sharedToken?: string;
  createdAt: string;
}

// ============================================================================
// Context Window Heat Map Schemas & Types (bd-u2cl8)
// ============================================================================

export const TokenCategorySchema = z.enum([
  "system",
  "user",
  "assistant",
  "tool_call",
  "tool_result",
  "reasoning",
  "code_block",
]);

export const TokenAttributionSchema = z.object({
  category: TokenCategorySchema,
  tokens: z.number().int().min(0),
  source: z.string().optional(),
  isCached: z.boolean().default(false),
});

export const RecordContextTurnSchema = z.object({
  agentId: z.string().min(1),
  sessionId: z.string().min(1),
  turn: z.number().int().min(1),
  contextLimit: z.number().int().positive().default(200_000),
  attributions: z.array(TokenAttributionSchema).min(1),
  timestamp: z.string().optional(),
});

export interface ContextTurnSnapshot {
  turn: number;
  timestamp: string;
  totalTokens: number;
  contextLimit: number;
  utilization: number;
  byCategory: Record<string, number>;
  attributions: Array<z.infer<typeof TokenAttributionSchema>>;
}

export interface ContextHeatMap {
  agentId: string;
  sessionId: string;
  totalTurns: number;
  peakTurn: number;
  peakUtilization: number;
  categoryTotals: Record<string, number>;
  categoryPercentages: Record<string, number>;
  buckets: ContextTurnSnapshot[];
  optimizationSuggestions: string[];
}

// ============================================================================
// State Stores
// ============================================================================

const framesBySessionKey = new Map<string, ReplayFrame[]>();
const debugSessionsStore = new Map<string, ReplayDebugSession>();
const contextTurnsBySessionKey = new Map<string, ContextTurnSnapshot[]>();

function sessionKey(agentId: string, sessionId: string): string {
  return `${agentId}::${sessionId}`;
}

// ============================================================================
// Replay/Debug Mode Implementation (bd-1zgxu)
// ============================================================================

export function recordReplayFrame(
  input: z.input<typeof RecordReplayFrameSchema>,
): ReplayFrame {
  const parsed = RecordReplayFrameSchema.parse(input);
  const key = sessionKey(parsed.agentId, parsed.sessionId);
  const list = framesBySessionKey.get(key) ?? [];

  const frame: ReplayFrame = {
    frameId: `frm_${ulid()}`,
    frameIndex: list.length,
    agentId: parsed.agentId,
    sessionId: parsed.sessionId,
    type: parsed.type,
    summary: parsed.summary,
    data: redactSensitiveData(parsed.data) as Record<string, unknown>,
    stateSnapshot: {
      agentState: parsed.stateSnapshot.agentState,
      contextTokensUsed: parsed.stateSnapshot.contextTokensUsed,
      ...(parsed.stateSnapshot.activeTool !== undefined && {
        activeTool: parsed.stateSnapshot.activeTool,
      }),
      variables: redactSensitiveData(parsed.stateSnapshot.variables) as Record<
        string,
        unknown
      >,
    },
    isError: parsed.isError,
    timestamp: parsed.timestamp ?? new Date().toISOString(),
  };

  list.push(frame);
  framesBySessionKey.set(key, list);
  return frame;
}

export function getRecordedReplayFrames(
  agentId: string,
  sessionId: string,
): ReplayFrame[] {
  return [...(framesBySessionKey.get(sessionKey(agentId, sessionId)) ?? [])];
}

function matchesBreakpoint(
  frame: ReplayFrame,
  breakpoints: ReplayBreakpoint[],
): boolean {
  for (const bp of breakpoints) {
    if (bp.onError && frame.isError) return true;
    if (bp.frameType && frame.type === bp.frameType) return true;
    if (
      bp.keywordMatch &&
      frame.summary.toLowerCase().includes(bp.keywordMatch.toLowerCase())
    ) {
      return true;
    }
  }
  return false;
}

export function startReplayDebugSession(params: {
  agentId: string;
  sessionId: string;
  breakpoints?: ReplayBreakpoint[];
}): ReplayDebugSession {
  const frames = getRecordedReplayFrames(params.agentId, params.sessionId);
  const breakpoints = params.breakpoints ?? [];
  const firstFrame = frames[0] ?? null;

  const session: ReplayDebugSession = {
    id: `rdbg_${ulid()}`,
    agentId: params.agentId,
    sessionId: params.sessionId,
    currentFrameIndex: 0,
    totalFrames: frames.length,
    currentFrame: firstFrame,
    pausedOnBreakpoint: firstFrame
      ? matchesBreakpoint(firstFrame, breakpoints)
      : false,
    breakpoints,
    createdAt: new Date().toISOString(),
  };

  debugSessionsStore.set(session.id, session);
  return session;
}

export function stepReplayDebugSession(
  debugSessionId: string,
  action: "next" | "prev" | "jump" | "continue_to_breakpoint",
  targetFrameIndex?: number,
): ReplayDebugSession | undefined {
  const dbg = debugSessionsStore.get(debugSessionId);
  if (!dbg) return undefined;
  const frames = getRecordedReplayFrames(dbg.agentId, dbg.sessionId);
  dbg.totalFrames = frames.length;
  if (frames.length === 0) return dbg;

  if (action === "next") {
    dbg.currentFrameIndex = Math.min(
      frames.length - 1,
      dbg.currentFrameIndex + 1,
    );
  } else if (action === "prev") {
    dbg.currentFrameIndex = Math.max(0, dbg.currentFrameIndex - 1);
  } else if (action === "jump" && targetFrameIndex !== undefined) {
    dbg.currentFrameIndex = Math.max(
      0,
      Math.min(frames.length - 1, targetFrameIndex),
    );
  } else if (action === "continue_to_breakpoint") {
    for (let i = dbg.currentFrameIndex + 1; i < frames.length; i++) {
      dbg.currentFrameIndex = i;
      if (matchesBreakpoint(frames[i]!, dbg.breakpoints)) {
        break;
      }
    }
  }

  const current = frames[dbg.currentFrameIndex] ?? null;
  dbg.currentFrame = current;
  dbg.pausedOnBreakpoint = current
    ? matchesBreakpoint(current, dbg.breakpoints)
    : false;
  return dbg;
}

export function shareReplayDebugSession(debugSessionId: string):
  | {
      shareToken: string;
      replaySession: ReplayDebugSession;
      frames: ReplayFrame[];
    }
  | undefined {
  const dbg = debugSessionsStore.get(debugSessionId);
  if (!dbg) return undefined;
  dbg.sharedToken = `shr_${ulid()}`;
  return {
    shareToken: dbg.sharedToken,
    replaySession: dbg,
    frames: getRecordedReplayFrames(dbg.agentId, dbg.sessionId),
  };
}

// ============================================================================
// Context Window Heat Map Implementation (bd-u2cl8)
// ============================================================================

export function recordContextTurn(
  input: z.input<typeof RecordContextTurnSchema>,
): ContextTurnSnapshot {
  const parsed = RecordContextTurnSchema.parse(input);
  const key = sessionKey(parsed.agentId, parsed.sessionId);
  const turns = contextTurnsBySessionKey.get(key) ?? [];

  const byCategory: Record<string, number> = {};
  let totalTokens = 0;
  for (const attr of parsed.attributions) {
    totalTokens += attr.tokens;
    byCategory[attr.category] = (byCategory[attr.category] ?? 0) + attr.tokens;
  }

  const snapshot: ContextTurnSnapshot = {
    turn: parsed.turn,
    timestamp: parsed.timestamp ?? new Date().toISOString(),
    totalTokens,
    contextLimit: parsed.contextLimit,
    utilization: Number(
      Math.min(1, totalTokens / parsed.contextLimit).toFixed(4),
    ),
    byCategory,
    attributions: parsed.attributions,
  };

  turns.push(snapshot);
  turns.sort((a, b) => a.turn - b.turn);
  contextTurnsBySessionKey.set(key, turns);
  return snapshot;
}

export function getContextHeatMap(
  agentId: string,
  sessionId: string,
): ContextHeatMap {
  const key = sessionKey(agentId, sessionId);
  const buckets = contextTurnsBySessionKey.get(key) ?? [];

  let peakTurn = 0;
  let peakUtilization = 0;
  const categoryTotals: Record<string, number> = {};
  let grandTotalTokens = 0;

  for (const b of buckets) {
    if (b.utilization >= peakUtilization) {
      peakUtilization = b.utilization;
      peakTurn = b.turn;
    }
    for (const [cat, tok] of Object.entries(b.byCategory)) {
      categoryTotals[cat] = (categoryTotals[cat] ?? 0) + tok;
      grandTotalTokens += tok;
    }
  }

  const categoryPercentages: Record<string, number> = {};
  for (const [cat, tok] of Object.entries(categoryTotals)) {
    categoryPercentages[cat] =
      grandTotalTokens > 0
        ? Number(((tok / grandTotalTokens) * 100).toFixed(2))
        : 0;
  }

  const suggestions: string[] = [];
  if ((categoryPercentages["tool_result"] ?? 0) > 40) {
    suggestions.push(
      "Tool results consume >40% of context tokens; use line-sliced file reads or output truncation.",
    );
  }
  if (peakUtilization >= 0.8) {
    suggestions.push(
      `Peak context utilization reached ${(peakUtilization * 100).toFixed(1)}% at turn ${peakTurn}; consider compacting or checkpointing earlier.`,
    );
  }
  if ((categoryPercentages["system"] ?? 0) > 30) {
    suggestions.push(
      "System prompt tokens exceed 30% of cumulative usage; enable prompt caching for system instructions.",
    );
  }

  return {
    agentId,
    sessionId,
    totalTurns: buckets.length,
    peakTurn,
    peakUtilization,
    categoryTotals,
    categoryPercentages,
    buckets,
    optimizationSuggestions: suggestions,
  };
}

export function clearReplayAndHeatMapForTesting(): void {
  framesBySessionKey.clear();
  debugSessionsStore.clear();
  contextTurnsBySessionKey.clear();
}
