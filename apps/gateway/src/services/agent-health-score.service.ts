/**
 * Agent Health Score Service
 *
 * Computes a single, composite 0–100 health score per agent by combining:
 * - Context utilization headroom
 * - Cost burn rate (relative to fleet average in a short window)
 * - Lifecycle state duration health
 * - Recent error rate (events/minute)
 * - Reservation conflict count
 *
 * NOTE: This is an in-memory, real-time operational signal. It is intentionally
 * lightweight and cached with a short TTL.
 */

import { getLogger } from "../middleware/correlation";
import { LifecycleState } from "../models/agent-state";
import { getHub } from "../ws/hub";
import { getAgent, listAgents } from "./agent";
import { getAgentErrorRatePerMinute } from "./agent-health-score.events";
import { getAgentState } from "./agent-state-machine";
import { getCostSummary } from "./cost-tracker.service";
import { getActiveReservationConflictCount } from "./reservation.service";

export type HealthScoreBand = "green" | "yellow" | "red";

export interface HealthComponents {
  /** 0-100, higher = more utilized (less headroom) */
  contextUtilization: number;
  /** Ratio to expected (1.0 = normal). >1 = burning faster than baseline. */
  costBurnRate: number;
  /** 0-100 based on lifecycle state duration norms */
  stateHealth: number;
  /** Recent errors per minute (rolling window) */
  errorRate: number;
  /** Active reservation conflicts count */
  reservationConflicts: number;
}

export interface HealthComponentScores {
  contextScore: number;
  costScore: number;
  stateScore: number;
  errorScore: number;
  conflictScore: number;
}

export interface AgentHealthScoreResult {
  agentId: string;
  score: number;
  band: HealthScoreBand;
  components: HealthComponents;
  componentScores: HealthComponentScores;
  computedAt: string;
  cache: {
    hit: boolean;
    ttlMs: number;
  };
  debug?: {
    state?: string;
    stateDurationSeconds?: number;
    windowMs?: number;
  };
}

interface ScoreCacheEntry {
  value: Omit<AgentHealthScoreResult, "cache">;
  expiresAt: number;
}

const DEFAULT_CACHE_TTL_MS = 7_500;
const DEFAULT_COST_WINDOW_MS = 10 * 60_000;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function scoreToBand(score: number): HealthScoreBand {
  if (score >= 80) return "green";
  if (score >= 50) return "yellow";
  return "red";
}

export function calculateCompositeHealthScore(components: HealthComponents): {
  score: number;
  componentScores: HealthComponentScores;
} {
  const contextScore = clamp(100 - components.contextUtilization, 0, 100);
  const costScore = clamp(100 - (components.costBurnRate - 1) * 50, 0, 100);
  const stateScore = clamp(components.stateHealth, 0, 100);
  const errorScore = clamp(100 - components.errorRate * 20, 0, 100);
  const conflictScore = clamp(
    100 - components.reservationConflicts * 25,
    0,
    100,
  );

  const weighted =
    contextScore * 0.25 +
    costScore * 0.2 +
    stateScore * 0.25 +
    errorScore * 0.2 +
    conflictScore * 0.1;

  return {
    score: Math.round(clamp(weighted, 0, 100)),
    componentScores: {
      contextScore: Math.round(contextScore),
      costScore: Math.round(costScore),
      stateScore: Math.round(stateScore),
      errorScore: Math.round(errorScore),
      conflictScore: Math.round(conflictScore),
    },
  };
}

function calculateStateHealthScore(
  state: LifecycleState,
  stateEnteredAt: Date,
): { score: number; durationSeconds: number } {
  const now = Date.now();
  const durationSeconds = Math.max(0, (now - stateEnteredAt.getTime()) / 1000);

  if (state === LifecycleState.FAILED) return { score: 0, durationSeconds };
  if (state === LifecycleState.TERMINATED) return { score: 0, durationSeconds };

  if (state === LifecycleState.READY) return { score: 100, durationSeconds };

  // Norms chosen to match bd-1x215 spec (seconds).
  const norms: Partial<
    Record<LifecycleState, { normal: number; max: number }>
  > = {
    [LifecycleState.EXECUTING]: { normal: 1800, max: 3600 },
    [LifecycleState.PAUSED]: { normal: 3600, max: 7200 },
    [LifecycleState.INITIALIZING]: { normal: 60, max: 300 },
    [LifecycleState.SPAWNING]: { normal: 30, max: 180 },
    [LifecycleState.TERMINATING]: { normal: 30, max: 180 },
  };

  const rule = norms[state];
  if (!rule) return { score: 100, durationSeconds };

  if (durationSeconds <= rule.normal) return { score: 100, durationSeconds };
  if (durationSeconds >= rule.max) return { score: 0, durationSeconds };

  const ratio = (durationSeconds - rule.normal) / (rule.max - rule.normal);
  return { score: Math.round(100 - ratio * 100), durationSeconds };
}

function computeContextUtilizationPercent(input: {
  tokensUsed: number;
  maxTokens: number;
}): number {
  const maxTokens = Math.max(1, input.maxTokens);
  const used = clamp(input.tokensUsed, 0, Number.MAX_SAFE_INTEGER);
  return Math.round(clamp((used / maxTokens) * 100, 0, 100));
}

export class AgentHealthScoreService {
  private scoreCache = new Map<string, ScoreCacheEntry>();
  private lastPublishedScore = new Map<string, number>();

  constructor(
    private readonly config: {
      ttlMs?: number;
      costWindowMs?: number;
    } = {},
  ) {}

  clearCache(agentId?: string): void {
    if (agentId) {
      this.scoreCache.delete(agentId);
      return;
    }
    this.scoreCache.clear();
  }

  async getAgentScore(
    agentId: string,
    options: { forceRefresh?: boolean; agentCount?: number } = {},
  ): Promise<AgentHealthScoreResult> {
    const ttlMs = this.config.ttlMs ?? DEFAULT_CACHE_TTL_MS;
    const now = Date.now();
    const cached = this.scoreCache.get(agentId);
    if (!options.forceRefresh && cached && cached.expiresAt > now) {
      return {
        ...cached.value,
        cache: { hit: true, ttlMs },
      };
    }

    const log = getLogger();
    const costWindowMs = this.config.costWindowMs ?? DEFAULT_COST_WINDOW_MS;
    const errorWindowMs = 60_000;

    // Agent details (tokens, maxTokens, etc.)
    const agent = await getAgent(agentId);

    // State duration health
    const stateRecord = getAgentState(agentId);
    const state = stateRecord?.currentState;
    const stateEnteredAt = stateRecord?.stateEnteredAt;
    const stateHealth =
      state && stateEnteredAt
        ? calculateStateHealthScore(state, stateEnteredAt)
        : { score: 100, durationSeconds: 0 };

    const contextUtilization = computeContextUtilizationPercent({
      tokensUsed: agent.stats.tokensUsed,
      maxTokens: agent.config.maxTokens,
    });

    // Reservation conflict count (in-memory reservation service)
    const reservationConflicts = getActiveReservationConflictCount(agentId);

    // Error rate (events/min) - tracked via recordError()
    const errorRate = getAgentErrorRatePerMinute(agentId, errorWindowMs);

    // Cost burn rate - relative to fleet average in the same window. If no cost
    // data exists in the window, default to 1.0 (normal).
    let costBurnRate = 1;
    try {
      const agentCount =
        options.agentCount ?? (await listAgents({ limit: 1000 })).agents.length;
      costBurnRate = await this.computeCostBurnRate(
        agentId,
        agentCount,
        costWindowMs,
      );
    } catch (error) {
      log.debug({ agentId, error }, "health-score: cost burn rate unavailable");
      costBurnRate = 1;
    }

    const components: HealthComponents = {
      contextUtilization,
      costBurnRate,
      stateHealth: stateHealth.score,
      errorRate,
      reservationConflicts,
    };

    const composite = calculateCompositeHealthScore(components);

    const value: Omit<AgentHealthScoreResult, "cache"> = {
      agentId,
      score: composite.score,
      band: scoreToBand(composite.score),
      components,
      componentScores: composite.componentScores,
      computedAt: new Date().toISOString(),
      debug: {
        ...(state ? { state } : {}),
        ...(stateEnteredAt
          ? { stateDurationSeconds: Math.round(stateHealth.durationSeconds) }
          : {}),
        windowMs: costWindowMs,
      },
    };

    this.scoreCache.set(agentId, {
      value,
      expiresAt: now + ttlMs,
    });

    this.publishIfChanged(value);

    return { ...value, cache: { hit: false, ttlMs } };
  }

  async getScoresForAgents(
    agentIds: string[],
  ): Promise<AgentHealthScoreResult[]> {
    const agentCount = agentIds.length;
    const results = await Promise.all(
      agentIds.map(async (agentId) =>
        this.getAgentScore(agentId, { agentCount }),
      ),
    );
    // Worst-first is more useful for dashboards.
    return results.sort((a, b) => a.score - b.score);
  }

  private publishIfChanged(value: Omit<AgentHealthScoreResult, "cache">): void {
    const previous = this.lastPublishedScore.get(value.agentId);
    if (previous !== undefined && previous === value.score) {
      return;
    }

    this.lastPublishedScore.set(value.agentId, value.score);

    getHub().publish(
      { type: "agent:health", agentId: value.agentId },
      "health.score",
      value,
      {
        agentId: value.agentId,
      },
    );
  }

  private async computeCostBurnRate(
    agentId: string,
    agentCount: number,
    windowMs: number,
  ): Promise<number> {
    const now = new Date();
    const since = new Date(now.getTime() - windowMs);
    const windowMinutes = windowMs / 60_000;
    if (windowMinutes <= 0) return 1;

    const [agentSummary, fleetSummary] = await Promise.all([
      getCostSummary({ agentId, since, until: now }),
      getCostSummary({ since, until: now }),
    ]);

    const agentPerMinute = agentSummary.totalCostUnits / windowMinutes;
    const fleetPerMinute = fleetSummary.totalCostUnits / windowMinutes;
    const expectedPerAgent = fleetPerMinute / Math.max(1, agentCount);

    if (expectedPerAgent <= 0) return 1;
    return clamp(agentPerMinute / expectedPerAgent, 0, 20);
  }
}

let singleton: AgentHealthScoreService | undefined;

export function getAgentHealthScoreService(): AgentHealthScoreService {
  if (!singleton) {
    singleton = new AgentHealthScoreService();
  }
  return singleton;
}

let broadcasterInterval: Timer | null = null;
let broadcasterInFlight = false;

/**
 * Start a lightweight broadcaster that recomputes and publishes agent health
 * scores on a fixed interval (best-effort).
 */
export function startAgentHealthScoreBroadcaster(
  options: { intervalMs?: number; limit?: number } = {},
): void {
  if (broadcasterInterval) return;
  const intervalMs = options.intervalMs ?? 5_000;
  const limit = options.limit ?? 1000;
  const service = getAgentHealthScoreService();

  broadcasterInterval = setInterval(() => {
    if (broadcasterInFlight) return;
    broadcasterInFlight = true;

    (async () => {
      try {
        const agentsList = await listAgents({ limit });
        const agentIds = agentsList.agents.map((a) => a.agentId);
        const agentCount = agentIds.length;
        await Promise.all(
          agentIds.map((agentId) =>
            service.getAgentScore(agentId, { forceRefresh: true, agentCount }),
          ),
        );
      } catch (error) {
        getLogger().debug({ error }, "health-score: broadcaster tick failed");
      } finally {
        broadcasterInFlight = false;
      }
    })().catch(() => {
      broadcasterInFlight = false;
    });
  }, intervalMs);

  if (broadcasterInterval.unref) {
    broadcasterInterval.unref();
  }
}

export function stopAgentHealthScoreBroadcaster(): void {
  if (!broadcasterInterval) return;
  clearInterval(broadcasterInterval);
  broadcasterInterval = null;
}
