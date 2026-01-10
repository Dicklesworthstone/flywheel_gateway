/**
 * Ring Buffer implementation for WebSocket message history.
 *
 * Provides bounded-memory storage with cursor-based access for
 * reconnection replay. Features:
 * - Fixed capacity with FIFO eviction
 * - TTL-based expiration
 * - Cursor-based slicing for replay
 */

import {
  type CursorData,
  compareCursors,
  createCursor,
  decodeCursor,
} from "./cursor";

/**
 * Item stored in the ring buffer with metadata.
 */
interface BufferEntry<T> {
  /** The stored item */
  item: T;
  /** Cursor for this entry */
  cursor: string;
  /** Timestamp when added */
  timestamp: number;
  /** Sequence number */
  sequence: number;
}

/**
 * Configuration for the ring buffer.
 */
export interface RingBufferConfig {
  /** Maximum number of items to store */
  capacity: number;
  /** Time-to-live in milliseconds (0 = no expiry) */
  ttlMs: number;
}

/**
 * Generic ring buffer with cursor-based access.
 *
 * @template T - Type of items stored in the buffer
 */
export class RingBuffer<T> {
  private readonly capacity: number;
  private readonly ttlMs: number;
  private readonly buffer: BufferEntry<T>[] = [];
  private sequence = 0;

  constructor(config: RingBufferConfig) {
    if (config.capacity < 1) {
      throw new Error("Ring buffer capacity must be at least 1");
    }
    this.capacity = config.capacity;
    this.ttlMs = config.ttlMs;
  }

  /**
   * Push an item to the buffer.
   *
   * @param item - Item to add
   * @returns Cursor for the new entry
   */
  push(item: T): string {
    const now = Date.now();
    const seq = this.sequence++;
    const cursor = createCursor(seq, now);

    const entry: BufferEntry<T> = {
      item,
      cursor,
      timestamp: now,
      sequence: seq,
    };

    this.buffer.push(entry);

    // Evict oldest entries if over capacity
    while (this.buffer.length > this.capacity) {
      this.buffer.shift();
    }

    return cursor;
  }

  /**
   * Get an item by its cursor.
   *
   * @param cursor - The cursor to look up
   * @returns The item or undefined if not found/expired
   */
  get(cursor: string): T | undefined {
    const entry = this.findEntry(cursor);
    if (!entry) return undefined;

    // Check TTL
    if (this.ttlMs > 0 && this.isExpired(entry)) {
      return undefined;
    }

    return entry.item;
  }

  /**
   * Get items from a cursor position (exclusive) to the end.
   *
   * @param cursor - Starting cursor (exclusive)
   * @param limit - Maximum number of items to return
   * @returns Array of items after the cursor
   */
  slice(cursor: string, limit?: number): T[] {
    const cursorData = decodeCursor(cursor);
    if (!cursorData) return [];

    const now = Date.now();
    const results: T[] = [];

    for (const entry of this.buffer) {
      // Skip entries at or before the cursor
      if (entry.sequence <= cursorData.sequence) continue;

      // Skip expired entries
      if (this.ttlMs > 0 && now - entry.timestamp > this.ttlMs) continue;

      results.push(entry.item);

      if (limit !== undefined && results.length >= limit) break;
    }

    return results;
  }

  /**
   * Get all items from the beginning (optionally with limit).
   *
   * @param limit - Maximum number of items to return
   * @returns Array of items
   */
  getAll(limit?: number): T[] {
    const now = Date.now();
    const results: T[] = [];

    for (const entry of this.buffer) {
      // Skip expired entries
      if (this.ttlMs > 0 && now - entry.timestamp > this.ttlMs) continue;

      results.push(entry.item);

      if (limit !== undefined && results.length >= limit) break;
    }

    return results;
  }

  /**
   * Get the cursor of the latest entry.
   *
   * @returns The latest cursor or undefined if buffer is empty
   */
  getLatestCursor(): string | undefined {
    if (this.buffer.length === 0) return undefined;
    if (this.ttlMs <= 0) {
      return this.buffer[this.buffer.length - 1]!.cursor;
    }

    const now = Date.now();
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      const entry = this.buffer[i]!;
      if (now - entry.timestamp <= this.ttlMs) {
        return entry.cursor;
      }
    }

    return undefined;
  }

  /**
   * Get the cursor of the oldest (non-expired) entry.
   *
   * @returns The oldest valid cursor or undefined if buffer is empty
   */
  getOldestCursor(): string | undefined {
    const now = Date.now();

    for (const entry of this.buffer) {
      if (this.ttlMs > 0 && now - entry.timestamp > this.ttlMs) continue;
      return entry.cursor;
    }

    return undefined;
  }

  /**
   * Check if a cursor is still valid (exists and not expired).
   *
   * @param cursor - The cursor to check
   * @returns true if valid, false otherwise
   */
  isValidCursor(cursor: string): boolean {
    const entry = this.findEntry(cursor);
    if (!entry) return false;
    if (this.ttlMs > 0 && this.isExpired(entry)) return false;
    return true;
  }

  /**
   * Prune expired entries from the buffer.
   *
   * @returns Number of entries removed
   */
  prune(): number {
    if (this.ttlMs <= 0) return 0;

    const now = Date.now();
    const originalLength = this.buffer.length;

    // Filter in place to keep non-expired entries
    let writeIndex = 0;
    for (let readIndex = 0; readIndex < this.buffer.length; readIndex++) {
      const entry = this.buffer[readIndex]!;
      if (now - entry.timestamp <= this.ttlMs) {
        this.buffer[writeIndex] = entry;
        writeIndex++;
      }
    }

    this.buffer.length = writeIndex;
    return originalLength - writeIndex;
  }

  /**
   * Clear all entries from the buffer.
   */
  clear(): void {
    this.buffer.length = 0;
  }

  /**
   * Get the current number of entries (including potentially expired ones).
   */
  size(): number {
    return this.buffer.length;
  }

  /**
   * Get the number of non-expired entries.
   */
  validSize(): number {
    if (this.ttlMs <= 0) return this.buffer.length;

    const now = Date.now();
    let count = 0;
    for (const entry of this.buffer) {
      if (now - entry.timestamp <= this.ttlMs) count++;
    }
    return count;
  }

  /**
   * Get buffer utilization as a percentage (0-100).
   */
  utilization(): number {
    return (this.buffer.length / this.capacity) * 100;
  }

  /**
   * Find an entry by cursor.
   */
  private findEntry(cursor: string): BufferEntry<T> | undefined {
    const cursorData = decodeCursor(cursor);
    if (!cursorData) return undefined;

    // Binary search would be more efficient, but for typical buffer sizes
    // (< 10000) linear scan is fast enough
    for (const entry of this.buffer) {
      if (
        entry.sequence === cursorData.sequence &&
        entry.timestamp === cursorData.timestamp
      ) {
        return entry;
      }
    }

    return undefined;
  }

  /**
   * Check if an entry is expired.
   */
  private isExpired(entry: BufferEntry<T>): boolean {
    return Date.now() - entry.timestamp > this.ttlMs;
  }
}

/**
 * Pre-configured buffer configs for different channel types.
 */
export const BUFFER_CONFIGS: Record<string, RingBufferConfig> = {
  "agent:output": {
    capacity: 10000, // High volume, many messages
    ttlMs: 300000, // 5 minutes - reconnect window
  },
  "agent:state": {
    capacity: 100, // Low volume
    ttlMs: 3600000, // 1 hour - state history
  },
  "agent:tools": {
    capacity: 500, // Medium volume
    ttlMs: 600000, // 10 minutes
  },
  "workspace:agents": {
    capacity: 200,
    ttlMs: 1800000, // 30 minutes
  },
  "workspace:reservations": {
    capacity: 500,
    ttlMs: 1800000, // 30 minutes
  },
  "workspace:conflicts": {
    capacity: 500,
    ttlMs: 1800000, // 30 minutes
  },
  "user:mail": {
    capacity: 1000,
    ttlMs: 86400000, // 24 hours - important messages
  },
  "user:notifications": {
    capacity: 500,
    ttlMs: 3600000, // 1 hour
  },
  "system:health": {
    capacity: 60, // 1 per second
    ttlMs: 60000, // 1 minute
  },
  "system:metrics": {
    capacity: 120,
    ttlMs: 120000, // 2 minutes
  },
};

/**
 * Get buffer config for a channel type.
 *
 * @param channelType - The channel type prefix (e.g., "agent:output")
 * @returns Buffer configuration, or a default if not found
 */
export function getBufferConfig(channelType: string): RingBufferConfig {
  return (
    BUFFER_CONFIGS[channelType] ?? {
      capacity: 1000,
      ttlMs: 300000, // 5 minutes default
    }
  );
}
