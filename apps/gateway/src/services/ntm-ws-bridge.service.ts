/**
 * NTM WebSocket Bridge Service
 *
 * Bridges NTM ingest events to WebSocket channels.
 * Publishes agent state changes and output from NTM sessions
 * to the appropriate agent:state and agent:output channels.
 *
 * Part of bead bd-28om: Bridge NTM output/state to WebSocket events.
 * Part of bead bd-pbt2: Backpressure/throttling for NTM ingest + WS events.
 *
 * Throttling behavior:
 * - Events are batched within a configurable window (default: 100ms)
 * - Per-agent debouncing coalesces rapid state changes
 * - Maximum events per batch prevents event storms (default: 50)
 * - Fallback: if batch limit exceeded, oldest events are dropped with warning
 */

import type { NtmClient, NtmTailOutput } from "@flywheel/flywheel-clients";
import type { WebSocketHub } from "../ws/hub";
import type { MessageMetadata } from "../ws/messages";
import type {
  NtmIngestService,
  NtmStateChangeEvent,
  TrackedNtmAgent,
} from "./ntm-ingest.service";
import { getLogger } from "../middleware/correlation";
import type { AgentOutputPayload, AgentStatePayload } from "./agent-events";

// =============================================================================
// Throttling Constants
// =============================================================================

/**
 * Default batch window in milliseconds.
 * Events within this window are coalesced before publishing.
 */
export const DEFAULT_BATCH_WINDOW_MS = 100;

/**
 * Default maximum events per batch.
 * Prevents event storms from overwhelming the WebSocket hub.
 */
export const DEFAULT_MAX_EVENTS_PER_BATCH = 50;

/**
 * Default per-agent debounce interval in milliseconds.
 * Rapid state changes for the same agent are coalesced.
 */
export const DEFAULT_DEBOUNCE_MS = 50;

// =============================================================================
// Throttled Event Batcher
// =============================================================================

/**
 * Event queued for batched publishing.
 */
interface QueuedEvent<T> {
  key: string;
  event: T;
  timestamp: number;
}

/**
 * Throttled event batcher for preventing WebSocket event storms.
 *
 * Features:
 * - Per-key debouncing: rapid events for the same key keep only the latest
 * - Batching window: events are collected and flushed periodically
 * - Max events cap: prevents runaway event accumulation
 * - Graceful degradation: drops oldest events when limit exceeded
 *
 * @template T The event type
 */
export class ThrottledEventBatcher<T> {
  private queue = new Map<string, QueuedEvent<T>>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private droppedCount = 0;
  private lastFlushTime = Date.now();

  constructor(
    private readonly onFlush: (
      events: Array<{ key: string; event: T }>,
    ) => void,
    private readonly config: {
      batchWindowMs: number;
      maxEventsPerBatch: number;
      debounceMs: number;
    },
  ) {}

  /**
   * Queue an event for batched publishing.
   * If an event with the same key exists and was queued within debounceMs,
   * the new event replaces it (coalescing).
   *
   * @param key - Unique key for debouncing (e.g., agentId)
   * @param event - The event to queue
   */
  enqueue(key: string, event: T): void {
    const now = Date.now();
    const existing = this.queue.get(key);

    // Per-key debouncing: replace if within debounce window
    if (existing && now - existing.timestamp < this.config.debounceMs) {
      // Update the existing entry with new event
      existing.event = event;
      existing.timestamp = now;
    } else {
      // Check if we're at capacity
      if (this.queue.size >= this.config.maxEventsPerBatch) {
        // Drop the oldest event
        let oldestKey: string | null = null;
        let oldestTime = Infinity;
        for (const [k, v] of this.queue) {
          if (v.timestamp < oldestTime) {
            oldestTime = v.timestamp;
            oldestKey = k;
          }
        }
        if (oldestKey) {
          this.queue.delete(oldestKey);
          this.droppedCount++;
        }
      }

      // Add the new event
      this.queue.set(key, { key, event, timestamp: now });
    }

    // Schedule flush if not already scheduled
    this.scheduleFlush();
  }

  /**
   * Immediately flush all queued events.
   * Useful for shutdown or when immediate delivery is needed.
   */
  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.queue.size === 0) return;

    const events = Array.from(this.queue.values()).map((q) => ({
      key: q.key,
      event: q.event,
    }));

    this.queue.clear();
    this.lastFlushTime = Date.now();

    try {
      this.onFlush(events);
    } catch {
      // Swallow errors to prevent breaking the batcher
    }
  }

  /**
   * Get statistics about the batcher.
   */
  getStats(): {
    queueSize: number;
    droppedCount: number;
    lastFlushTime: number;
  } {
    return {
      queueSize: this.queue.size,
      droppedCount: this.droppedCount,
      lastFlushTime: this.lastFlushTime,
    };
  }

  /**
   * Reset dropped event counter.
   */
  resetDroppedCount(): void {
    this.droppedCount = 0;
  }

  /**
   * Stop the batcher and flush remaining events.
   */
  stop(): void {
    this.flush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, this.config.batchWindowMs);

    // Don't prevent process exit
    if (this.flushTimer.unref) {
      this.flushTimer.unref();
    }
  }
}

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for the NTM WebSocket bridge.
 */
export interface NtmWsBridgeConfig {
  /** Interval between tail polling in milliseconds (default: 2000) */
  tailPollIntervalMs?: number;
  /** Number of lines to fetch from tail (default: 50) */
  tailLines?: number;
  /** Whether to enable output streaming (default: true) */
  enableOutputStreaming?: boolean;
  /** Batch window for event throttling in milliseconds (default: 100) */
  batchWindowMs?: number;
  /** Maximum events per batch before dropping (default: 50) */
  maxEventsPerBatch?: number;
  /** Per-agent debounce interval in milliseconds (default: 50) */
  debounceMs?: number;
  /** Whether to enable event throttling (default: true) */
  enableThrottling?: boolean;
}

/**
 * Tracks output state for an agent to avoid duplicate streaming.
 */
interface OutputState {
  /** Last lines seen (for overlap detection) */
  lastLines: string[];
  /** Hash of last content to detect changes */
  lastContentHash: string;
}

/**
 * Pane output structure from NTM tail.
 */
interface PaneOutput {
  type: string;
  state: string;
  lines: string[];
  truncated: boolean;
}

// =============================================================================
// Service Implementation
// =============================================================================

/**
 * Internal event type for batching.
 */
interface BatchableStateEvent {
  agentId: string;
  event: NtmStateChangeEvent;
  tracked: TrackedNtmAgent;
  isHealthChange: boolean;
}

/**
 * NTM WebSocket Bridge Service
 *
 * Subscribes to NTM ingest events and publishes them to WebSocket channels:
 * - State changes → agent:state:{agentId}
 * - Tail output → agent:output:{agentId}
 *
 * Throttling:
 * - Events are batched within a configurable window (default: 100ms)
 * - Rapid state changes for the same agent are debounced
 * - Maximum events per batch prevents event storms
 */
export class NtmWsBridgeService {
  private config: Required<NtmWsBridgeConfig>;
  private unsubscribeIngest: (() => void) | null = null;
  private tailPollInterval: ReturnType<typeof setInterval> | null = null;
  private outputStates = new Map<string, OutputState>();
  private running = false;
  private stateBatcher: ThrottledEventBatcher<BatchableStateEvent> | null =
    null;

  constructor(
    private hub: WebSocketHub,
    private ingestService: NtmIngestService,
    private ntmClient: NtmClient,
    config: NtmWsBridgeConfig = {},
  ) {
    this.config = {
      tailPollIntervalMs: config.tailPollIntervalMs ?? 2000,
      tailLines: config.tailLines ?? 50,
      enableOutputStreaming: config.enableOutputStreaming ?? true,
      batchWindowMs: config.batchWindowMs ?? DEFAULT_BATCH_WINDOW_MS,
      maxEventsPerBatch:
        config.maxEventsPerBatch ?? DEFAULT_MAX_EVENTS_PER_BATCH,
      debounceMs: config.debounceMs ?? DEFAULT_DEBOUNCE_MS,
      enableThrottling: config.enableThrottling ?? true,
    };
  }

  /**
   * Start the bridge service.
   */
  start(): void {
    if (this.running) return;

    const log = getLogger();
    this.running = true;

    // Initialize the state event batcher if throttling is enabled
    if (this.config.enableThrottling) {
      this.stateBatcher = new ThrottledEventBatcher<BatchableStateEvent>(
        (events) => this.flushBatchedEvents(events),
        {
          batchWindowMs: this.config.batchWindowMs,
          maxEventsPerBatch: this.config.maxEventsPerBatch,
          debounceMs: this.config.debounceMs,
        },
      );
    }

    // Subscribe to NTM ingest state change events
    this.unsubscribeIngest = this.ingestService.onStateChange((event) => {
      this.handleStateChangeEvent(event);
    });

    // Start polling for tail output if enabled
    if (this.config.enableOutputStreaming) {
      this.startTailPolling();
    }

    log.info(
      {
        tailPollIntervalMs: this.config.tailPollIntervalMs,
        tailLines: this.config.tailLines,
        outputStreamingEnabled: this.config.enableOutputStreaming,
        throttlingEnabled: this.config.enableThrottling,
        batchWindowMs: this.config.batchWindowMs,
        maxEventsPerBatch: this.config.maxEventsPerBatch,
        debounceMs: this.config.debounceMs,
      },
      "[NTM-WS-BRIDGE] Started NTM WebSocket bridge service",
    );
  }

  /**
   * Stop the bridge service.
   */
  stop(): void {
    const log = getLogger();
    this.running = false;

    if (this.unsubscribeIngest) {
      this.unsubscribeIngest();
      this.unsubscribeIngest = null;
    }

    if (this.tailPollInterval) {
      clearInterval(this.tailPollInterval);
      this.tailPollInterval = null;
    }

    // Flush any remaining batched events before stopping
    if (this.stateBatcher) {
      const stats = this.stateBatcher.getStats();
      if (stats.droppedCount > 0) {
        log.warn(
          { droppedCount: stats.droppedCount },
          "[NTM-WS-BRIDGE] Events were dropped due to throttling during this session",
        );
      }
      this.stateBatcher.stop();
      this.stateBatcher = null;
    }

    this.outputStates.clear();
    log.info("[NTM-WS-BRIDGE] Stopped NTM WebSocket bridge service");
  }

  /**
   * Get service status.
   */
  getStatus(): {
    running: boolean;
    trackedOutputStates: number;
    config: NtmWsBridgeConfig;
    throttling: {
      enabled: boolean;
      queueSize: number;
      droppedCount: number;
      lastFlushTime: number;
    };
  } {
    const batcherStats = this.stateBatcher?.getStats() ?? {
      queueSize: 0,
      droppedCount: 0,
      lastFlushTime: 0,
    };

    return {
      running: this.running,
      trackedOutputStates: this.outputStates.size,
      config: this.config,
      throttling: {
        enabled: this.config.enableThrottling,
        ...batcherStats,
      },
    };
  }

  // ===========================================================================
  // Event Handlers
  // ===========================================================================

  /**
   * Handle state change events from NTM ingest service.
   * Events are queued for batched publishing if throttling is enabled.
   */
  private handleStateChangeEvent(event: NtmStateChangeEvent): void {
    const log = getLogger();

    // Find the tracked agent to get the gateway agent ID
    const trackedAgents = this.ingestService.getTrackedAgents();
    const tracked = trackedAgents.get(event.pane);

    if (!tracked?.gatewayAgentId) {
      // No gateway agent registered for this pane - skip
      log.debug(
        { pane: event.pane, eventType: event.type },
        "[NTM-WS-BRIDGE] Skipping event for unregistered agent",
      );
      return;
    }

    const agentId = tracked.gatewayAgentId;
    const isHealthChange = event.type === "ntm.agent.health_changed";

    // If throttling is enabled, queue the event for batched publishing
    if (this.stateBatcher) {
      this.stateBatcher.enqueue(agentId, {
        agentId,
        event,
        tracked,
        isHealthChange,
      });
      return;
    }

    // Direct publishing when throttling is disabled
    if (isHealthChange) {
      this.publishHealthChange(agentId, event, tracked);
    } else {
      this.publishStateChange(agentId, event, tracked);
    }
  }

  /**
   * Flush batched events to the WebSocket hub.
   * Called by the ThrottledEventBatcher when the batch window expires.
   */
  private flushBatchedEvents(
    events: Array<{ key: string; event: BatchableStateEvent }>,
  ): void {
    const log = getLogger();

    if (events.length === 0) return;

    log.debug(
      { eventCount: events.length },
      "[NTM-WS-BRIDGE] Flushing batched events",
    );

    for (const { event: batchedEvent } of events) {
      if (batchedEvent.isHealthChange) {
        this.publishHealthChange(
          batchedEvent.agentId,
          batchedEvent.event,
          batchedEvent.tracked,
        );
      } else {
        this.publishStateChange(
          batchedEvent.agentId,
          batchedEvent.event,
          batchedEvent.tracked,
        );
      }
    }
  }

  /**
   * Publish a state change to the WebSocket hub.
   */
  private publishStateChange(
    agentId: string,
    event: NtmStateChangeEvent,
    tracked: TrackedNtmAgent,
  ): void {
    const payload: AgentStatePayload = {
      agentId,
      previousState: this.mapNtmStateToDisplayState(event.previousValue),
      currentState: this.mapNtmStateToDisplayState(event.newValue),
      reason: `ntm_${event.newValue}`,
      timestamp: event.timestamp.toISOString(),
      correlationId: `ntm-${event.pane}-${Date.now()}`,
    };

    const metadata: MessageMetadata = {
      correlationId: payload.correlationId,
      agentId,
    };

    this.hub.publish(
      { type: "agent:state", agentId },
      "state.change",
      payload,
      metadata,
    );

    getLogger().debug(
      { agentId, previousState: event.previousValue, newState: event.newValue },
      "[NTM-WS-BRIDGE] Published state change to WebSocket",
    );
  }

  /**
   * Publish a health change to the WebSocket hub.
   */
  private publishHealthChange(
    agentId: string,
    event: NtmStateChangeEvent,
    _tracked: TrackedNtmAgent,
  ): void {
    // Publish health changes as state changes with a special reason
    const payload: AgentStatePayload = {
      agentId,
      previousState: event.previousValue,
      currentState: event.newValue,
      reason: `ntm_health_${event.newValue}`,
      timestamp: event.timestamp.toISOString(),
      correlationId: `ntm-health-${event.pane}-${Date.now()}`,
    };

    const metadata: MessageMetadata = {
      correlationId: payload.correlationId,
      agentId,
    };

    this.hub.publish(
      { type: "agent:state", agentId },
      "state.change",
      payload,
      metadata,
    );

    getLogger().debug(
      {
        agentId,
        previousHealth: event.previousValue,
        newHealth: event.newValue,
      },
      "[NTM-WS-BRIDGE] Published health change to WebSocket",
    );
  }

  // ===========================================================================
  // Output Streaming
  // ===========================================================================

  /**
   * Start polling NTM tail for output streaming.
   */
  private startTailPolling(): void {
    this.tailPollInterval = setInterval(() => {
      if (this.running) {
        this.pollTailOutput().catch((err) => {
          getLogger().warn(
            { error: String(err) },
            "[NTM-WS-BRIDGE] Tail poll error",
          );
        });
      }
    }, this.config.tailPollIntervalMs);

    // Don't prevent process exit
    if (this.tailPollInterval.unref) {
      this.tailPollInterval.unref();
    }
  }

  /**
   * Poll NTM tail and publish new output to WebSocket.
   */
  private async pollTailOutput(): Promise<void> {
    const log = getLogger();
    const trackedAgents = this.ingestService.getTrackedAgents();

    // Group agents by session for efficient tail calls
    const sessionAgents = new Map<string, TrackedNtmAgent[]>();
    for (const agent of trackedAgents.values()) {
      if (!agent.gatewayAgentId) continue;
      const agents = sessionAgents.get(agent.sessionName) ?? [];
      agents.push(agent);
      sessionAgents.set(agent.sessionName, agents);
    }

    // Poll tail for each session
    for (const [sessionName, agents] of sessionAgents) {
      try {
        const tailOutput = await this.ntmClient.tail(sessionName, {
          lines: this.config.tailLines,
        });
        this.processSessionTail(sessionName, agents, tailOutput);
      } catch (err) {
        log.debug(
          { sessionName, error: String(err) },
          "[NTM-WS-BRIDGE] Failed to get tail for session",
        );
      }
    }
  }

  /**
   * Process tail output for a session and publish new content.
   */
  private processSessionTail(
    _sessionName: string,
    agents: TrackedNtmAgent[],
    tailOutput: NtmTailOutput,
  ): void {
    const log = getLogger();

    // Cast panes to proper type - NtmTailOutput.panes is Record<string, PaneOutput>
    const panes = tailOutput.panes as Record<string, PaneOutput>;

    for (const agent of agents) {
      const agentId = agent.gatewayAgentId;
      if (!agentId) continue;

      // Find the pane output for this agent
      // Pane format: "sessionName:window.pane" -> we need to match the pane part
      const paneKey = this.findPaneKey(agent.pane, panes);
      if (!paneKey) continue;

      const paneOutput = panes[paneKey];
      if (!paneOutput) continue;

      // Check if content has changed
      const content = paneOutput.lines.join("\n");
      const contentHash = this.hashContent(content);
      const outputState = this.outputStates.get(agent.pane);

      if (outputState?.lastContentHash === contentHash) {
        // No change in output
        continue;
      }

      // Calculate new content using overlap detection
      let newContent = "";

      if (outputState) {
        const oldLines = outputState.lastLines;
        const newLines = paneOutput.lines;

        // Check for overlap to find new lines
        // 1. Simple case: new lines appended (buffer not full)
        if (
          newLines.length > oldLines.length &&
          newLines.slice(0, oldLines.length).every((l, i) => l === oldLines[i])
        ) {
          newContent = newLines.slice(oldLines.length).join("\n");
        } else {
          // 2. Rolling buffer case: find suffix of old that matches prefix of new
          let overlapSize = 0;
          const maxOverlap = Math.min(oldLines.length, newLines.length);

          // Optimization: start checking from 1 line overlap up to max?
          // Or max down to 1? Max down to 1 prefers largest overlap (safest against repeating patterns)
          for (let i = maxOverlap; i > 0; i--) {
            // Check if suffix of old matches prefix of new
            const oldSuffix = oldLines.slice(oldLines.length - i);
            const newPrefix = newLines.slice(0, i);

            // Array equality check
            let match = true;
            for (let k = 0; k < i; k++) {
              if (oldSuffix[k] !== newPrefix[k]) {
                match = false;
                break;
              }
            }

            if (match) {
              overlapSize = i;
              break;
            }
          }

          if (overlapSize > 0) {
            newContent = newLines.slice(overlapSize).join("\n");
          } else {
            // No overlap - completely new content or disjoint buffer
            newContent = content;
          }
        }
      } else {
        // First time seeing this agent
        newContent = content;
      }

      // Update state
      this.outputStates.set(agent.pane, {
        lastLines: paneOutput.lines,
        lastContentHash: contentHash,
      });

      // Publish output chunk
      if (newContent.trim()) {
        this.publishOutput(agentId, newContent, paneOutput.state);

        log.debug(
          {
            agentId,
            pane: agent.pane,
            newContentLength: newContent.length,
            state: paneOutput.state,
          },
          "[NTM-WS-BRIDGE] Published output chunk to WebSocket",
        );
      }
    }
  }

  /**
   * Find the pane key in tail output that matches the agent's pane.
   */
  private findPaneKey(
    agentPane: string,
    panes: Record<string, unknown>,
  ): string | undefined {
    // Direct match
    if (agentPane in panes) return agentPane;

    // Try to extract pane index and match
    const paneMatch = agentPane.match(/\.(\d+)$/);
    if (paneMatch) {
      const paneIdx = paneMatch[1];
      for (const key of Object.keys(panes)) {
        if (key.endsWith(`.${paneIdx}`) || key === paneIdx) {
          return key;
        }
      }
    }

    return undefined;
  }

  /**
   * Publish output to the WebSocket hub.
   */
  private publishOutput(
    agentId: string,
    content: string,
    ntmState: string,
  ): void {
    const payload: AgentOutputPayload = {
      agentId,
      type: "text",
      content,
      timestamp: new Date().toISOString(),
      metadata: {
        source: "ntm",
        ntmState,
      },
    };

    const metadata: MessageMetadata = {
      agentId,
    };

    this.hub.publish(
      { type: "agent:output", agentId },
      "output.chunk",
      payload,
      metadata,
    );
  }

  // ===========================================================================
  // Helpers
  // ===========================================================================

  /**
   * Map NTM state to a display-friendly state string.
   */
  private mapNtmStateToDisplayState(ntmState: string): string {
    switch (ntmState) {
      case "idle":
        return "READY";
      case "waiting":
        return "READY";
      case "working":
        return "EXECUTING";
      case "thinking":
        return "EXECUTING";
      case "tool_calling":
        return "EXECUTING";
      case "error":
        return "FAILED";
      case "stalled":
        return "PAUSED";
      case "rate_limited":
        return "RATE_LIMITED";
      case "context_low":
        return "CONTEXT_WARNING";
      default:
        return ntmState.toUpperCase();
    }
  }

  /**
   * Simple hash function for content comparison.
   */
  private hashContent(content: string): string {
    // Use a simple hash for quick comparison
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(16);
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let defaultInstance: NtmWsBridgeService | null = null;

/**
 * Get the default NTM WebSocket bridge service instance.
 */
export function getNtmWsBridgeService(): NtmWsBridgeService | null {
  return defaultInstance;
}

/**
 * Set the default NTM WebSocket bridge service instance (for testing).
 */
export function setNtmWsBridgeService(
  service: NtmWsBridgeService | null,
): void {
  defaultInstance = service;
}

/**
 * Start the NTM WebSocket bridge service.
 */
export function startNtmWsBridge(
  hub: WebSocketHub,
  ingestService: NtmIngestService,
  ntmClient: NtmClient,
  config?: NtmWsBridgeConfig,
): NtmWsBridgeService {
  if (defaultInstance) {
    defaultInstance.stop();
  }
  defaultInstance = new NtmWsBridgeService(
    hub,
    ingestService,
    ntmClient,
    config,
  );
  defaultInstance.start();
  return defaultInstance;
}

/**
 * Stop the NTM WebSocket bridge service.
 */
export function stopNtmWsBridge(): void {
  if (defaultInstance) {
    defaultInstance.stop();
    defaultInstance = null;
  }
}
