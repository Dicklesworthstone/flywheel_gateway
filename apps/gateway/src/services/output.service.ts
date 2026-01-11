/**
 * Output Streaming Service - Captures and distributes agent output.
 *
 * This service:
 * - Subscribes to agent driver events for real-time output
 * - Publishes output chunks to WebSocket hub for live streaming
 * - Maintains a ring buffer for cursor-based replay
 * - Provides REST API access to output history
 */

import type { AgentEvent, OutputLine } from "@flywheel/agent-drivers";
import type { Channel } from "../ws/channels";
import { getHub } from "../ws/hub";
import { logger } from "./logger";

// ============================================================================
// Types
// ============================================================================

/**
 * Output chunk with sequence for ordering and cursor-based pagination.
 */
export interface OutputChunk {
  /** Unique ID for this chunk (sequence-based) */
  id: string;
  /** Agent that produced this output */
  agentId: string;
  /** Monotonic sequence number for ordering */
  sequence: number;
  /** When the output was produced */
  timestamp: string;
  /** Type of output (text, tool_use, error, etc.) */
  type: string;
  /** The actual content */
  content: string | Record<string, unknown>;
  /** Stream type for PTY output */
  streamType: "stdout" | "stderr" | "system";
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Options for fetching output.
 */
export interface GetOutputOptions {
  /** Cursor to start from (exclusive) */
  cursor?: string;
  /** Maximum chunks to return */
  limit?: number;
  /** Filter by output types */
  types?: string[];
  /** Filter by stream type */
  streamType?: "stdout" | "stderr" | "system";
}

/**
 * Result of fetching output.
 */
export interface GetOutputResult {
  chunks: OutputChunk[];
  pagination: {
    cursor: string;
    hasMore: boolean;
  };
}

// ============================================================================
// In-Memory Storage
// ============================================================================

/**
 * Ring buffer for agent output chunks.
 */
class OutputBuffer {
  private buffer: OutputChunk[] = [];
  private readonly maxSize: number;
  private sequence = 0;

  constructor(maxSize = 1000) {
    this.maxSize = maxSize;
  }

  /**
   * Add a chunk to the buffer.
   */
  push(chunk: Omit<OutputChunk, "id" | "sequence">): OutputChunk {
    this.sequence++;
    const fullChunk: OutputChunk = {
      ...chunk,
      id: `out_${chunk.agentId}_${this.sequence}`,
      sequence: this.sequence,
    };

    this.buffer.push(fullChunk);

    // Trim if over capacity
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }

    return fullChunk;
  }

  /**
   * Get chunks after a cursor (sequence number).
   */
  getAfterCursor(cursor: string | undefined, limit: number): OutputChunk[] {
    let startIndex = 0;

    if (cursor) {
      const cursorSeq = parseInt(cursor, 10);
      if (!Number.isNaN(cursorSeq)) {
        // Find the first chunk with sequence > cursorSeq
        startIndex = this.buffer.findIndex((c) => c.sequence > cursorSeq);
        if (startIndex === -1) {
          return []; // No chunks after cursor
        }
      }
    }

    return this.buffer.slice(startIndex, startIndex + limit);
  }

  /**
   * Get all chunks.
   */
  getAll(): OutputChunk[] {
    return [...this.buffer];
  }

  /**
   * Get the latest cursor.
   */
  getLatestCursor(): string {
    if (this.buffer.length === 0) {
      return "0";
    }
    const last = this.buffer[this.buffer.length - 1];
    return String(last?.sequence ?? 0);
  }

  /**
   * Check if a cursor is still valid (within buffer range).
   */
  isValidCursor(cursor: string): boolean {
    if (this.buffer.length === 0) return true;
    const cursorSeq = parseInt(cursor, 10);
    if (Number.isNaN(cursorSeq)) return false;
    const oldest = this.buffer[0];
    return oldest ? cursorSeq >= oldest.sequence - 1 : true;
  }

  /**
   * Clear the buffer.
   */
  clear(): void {
    this.buffer = [];
    this.sequence = 0;
  }

  /**
   * Get buffer size.
   */
  size(): number {
    return this.buffer.length;
  }
}

// Per-agent output buffers
const outputBuffers = new Map<string, OutputBuffer>();

// Active subscriptions (agentId -> AbortController)
const activeSubscriptions = new Map<string, AbortController>();

// ============================================================================
// Output Service Functions
// ============================================================================

/**
 * Get or create an output buffer for an agent.
 */
function getOutputBuffer(agentId: string): OutputBuffer {
  let buffer = outputBuffers.get(agentId);
  if (!buffer) {
    buffer = new OutputBuffer();
    outputBuffers.set(agentId, buffer);
  }
  return buffer;
}

/**
 * Convert OutputLine to OutputChunk.
 */
function lineToChunk(
  agentId: string,
  line: OutputLine,
): Omit<OutputChunk, "id" | "sequence"> {
  // Determine stream type based on output type
  let streamType: "stdout" | "stderr" | "system" = "stdout";
  if (line.type === "error") {
    streamType = "stderr";
  } else if (line.type === "system") {
    streamType = "system";
  }

  const chunk: Omit<OutputChunk, "id" | "sequence"> = {
    agentId,
    timestamp: line.timestamp.toISOString(),
    type: line.type,
    content: line.content,
    streamType,
  };

  if (line.metadata) {
    chunk.metadata = line.metadata;
  }

  return chunk;
}

/**
 * Start streaming output from an agent.
 * Subscribes to the agent's event stream and publishes to WebSocket hub.
 *
 * @param agentId - The agent to stream output from
 * @param eventStream - Async iterable of agent events from the driver
 */
export async function startOutputStreaming(
  agentId: string,
  eventStream: AsyncIterable<AgentEvent>,
): Promise<void> {
  // Cancel any existing subscription
  stopOutputStreaming(agentId);

  const abortController = new AbortController();
  activeSubscriptions.set(agentId, abortController);

  const hub = getHub();
  const buffer = getOutputBuffer(agentId);
  const channel: Channel = { type: "agent:output", agentId };

  logger.info({ agentId }, "Starting output streaming");

  // Process events in background
  (async () => {
    try {
      for await (const event of eventStream) {
        // Check if we should stop
        if (abortController.signal.aborted) {
          break;
        }

        // Only process output events
        if (event.type !== "output") {
          continue;
        }

        // Convert to chunk and store in buffer
        const chunkData = lineToChunk(agentId, event.output);
        const chunk = buffer.push(chunkData);

        // Publish to WebSocket hub
        hub.publish(channel, "output.chunk", chunk, {
          agentId,
        });

        logger.debug(
          { agentId, sequence: chunk.sequence, type: chunk.type },
          "Output chunk published",
        );
      }
    } catch (error) {
      if (!abortController.signal.aborted) {
        logger.error({ error, agentId }, "Output streaming error");
      }
    } finally {
      // Only remove from map if we're still the registered controller
      // This prevents a new streaming session's controller from being deleted
      if (activeSubscriptions.get(agentId) === abortController) {
        activeSubscriptions.delete(agentId);
      }
      logger.info({ agentId }, "Output streaming stopped");
    }
  })();
}

/**
 * Stop streaming output from an agent.
 *
 * @param agentId - The agent to stop streaming
 */
export function stopOutputStreaming(agentId: string): void {
  const controller = activeSubscriptions.get(agentId);
  if (controller) {
    controller.abort();
    activeSubscriptions.delete(agentId);
  }
}

/**
 * Get output chunks for an agent with cursor-based pagination.
 *
 * @param agentId - The agent to get output from
 * @param options - Pagination and filtering options
 * @returns Output chunks and pagination info
 */
export function getOutput(
  agentId: string,
  options: GetOutputOptions = {},
): GetOutputResult {
  const buffer = outputBuffers.get(agentId);
  const limit = options.limit ?? 100;

  if (!buffer) {
    return {
      chunks: [],
      pagination: {
        cursor: "0",
        hasMore: false,
      },
    };
  }

  const hasFilters =
    (options.types?.length ?? 0) > 0 || options.streamType !== undefined;

  if (!hasFilters) {
    // No filters - simple case, fetch limit + 1 to check hasMore
    const chunks = buffer.getAfterCursor(options.cursor, limit + 1);
    const hasMore = chunks.length > limit;
    const result = hasMore ? chunks.slice(0, limit) : chunks;
    const lastChunk = result[result.length - 1];
    const nextCursor = lastChunk
      ? String(lastChunk.sequence)
      : (options.cursor ?? "0");

    return {
      chunks: result,
      pagination: {
        cursor: nextCursor,
        hasMore,
      },
    };
  }

  // With filters - need to fetch more to ensure we get enough matching items
  // Fetch in batches to find limit + 1 matching items
  const matchingChunks: OutputChunk[] = [];
  let currentCursor = options.cursor;
  const batchSize = limit * 2; // Fetch in larger batches for efficiency
  let exhausted = false;

  while (matchingChunks.length <= limit && !exhausted) {
    const batch = buffer.getAfterCursor(currentCursor, batchSize);
    if (batch.length === 0) {
      exhausted = true;
      break;
    }

    for (const chunk of batch) {
      // Apply filters
      const typeMatch =
        !options.types?.length || options.types.includes(chunk.type);
      const streamMatch =
        !options.streamType || chunk.streamType === options.streamType;

      if (typeMatch && streamMatch) {
        matchingChunks.push(chunk);
        if (matchingChunks.length > limit) {
          // We have enough, stop early
          break;
        }
      }
    }

    // Update cursor for next batch
    const lastInBatch = batch[batch.length - 1];
    currentCursor = lastInBatch ? String(lastInBatch.sequence) : currentCursor;

    // Check if we've exhausted the buffer
    if (batch.length < batchSize) {
      exhausted = true;
    }
  }

  const hasMore = matchingChunks.length > limit;
  const result = hasMore ? matchingChunks.slice(0, limit) : matchingChunks;
  const lastChunk = result[result.length - 1];
  const nextCursor = lastChunk
    ? String(lastChunk.sequence)
    : (options.cursor ?? "0");

  return {
    chunks: result,
    pagination: {
      cursor: nextCursor,
      hasMore,
    },
  };
}

/**
 * Backfill output for a reconnecting client.
 * Returns chunks since the given cursor.
 *
 * @param agentId - The agent to get output from
 * @param cursor - Last known cursor
 * @param limit - Maximum chunks to return
 * @returns Output chunks and whether cursor was expired
 */
export function backfillOutput(
  agentId: string,
  cursor: string,
  limit = 100,
): { chunks: OutputChunk[]; cursorExpired: boolean } {
  const buffer = outputBuffers.get(agentId);

  if (!buffer) {
    return { chunks: [], cursorExpired: false };
  }

  const cursorExpired = !buffer.isValidCursor(cursor);
  const chunks = cursorExpired
    ? buffer.getAll().slice(0, limit)
    : buffer.getAfterCursor(cursor, limit);

  return { chunks, cursorExpired };
}

/**
 * Clean up output buffer for an agent.
 * Called when agent is terminated.
 *
 * @param agentId - The agent to clean up
 */
export function cleanupOutputBuffer(agentId: string): void {
  stopOutputStreaming(agentId);
  outputBuffers.delete(agentId);
  logger.debug({ agentId }, "Output buffer cleaned up");
}

/**
 * Get output streaming stats.
 */
export function getOutputStats(): {
  activeStreams: number;
  bufferedAgents: number;
  totalChunks: number;
} {
  let totalChunks = 0;
  for (const buffer of outputBuffers.values()) {
    totalChunks += buffer.size();
  }

  return {
    activeStreams: activeSubscriptions.size,
    bufferedAgents: outputBuffers.size,
    totalChunks,
  };
}

/**
 * Manually push an output chunk (for testing or system messages).
 *
 * @param agentId - The agent ID
 * @param type - Output type
 * @param content - Output content
 * @param streamType - Stream type (stdout, stderr, system)
 * @returns The created chunk
 */
export function pushOutput(
  agentId: string,
  type: string,
  content: string | Record<string, unknown>,
  streamType: "stdout" | "stderr" | "system" = "stdout",
  metadata?: Record<string, unknown>,
): OutputChunk {
  const buffer = getOutputBuffer(agentId);
  const hub = getHub();
  const channel: Channel = { type: "agent:output", agentId };

  const chunk = buffer.push({
    agentId,
    timestamp: new Date().toISOString(),
    type,
    content,
    streamType,
    metadata,
  });

  // Publish to WebSocket hub
  hub.publish(channel, "output.chunk", chunk, {
    agentId,
  });

  return chunk;
}
