/**
 * WebSocket Message Queue
 *
 * A ring buffer implementation for efficient message storage
 * with O(1) operations and bounded memory usage.
 */

export interface QueueConfig {
  /** Maximum capacity of the queue */
  capacity: number;
  /** Whether to overwrite oldest entries when full (ring buffer mode) */
  overwriteOnFull: boolean;
}

export interface QueueStats {
  /** Current number of items */
  size: number;
  /** Maximum capacity */
  capacity: number;
  /** Total items ever added */
  totalAdded: number;
  /** Total items overwritten (in ring buffer mode) */
  totalOverwritten: number;
  /** Usage percentage */
  usagePercent: number;
}

const DEFAULT_CONFIG: QueueConfig = {
  capacity: 10000,
  overwriteOnFull: true,
};

export class MessageQueue<T> {
  private buffer: (T | undefined)[];
  private head = 0; // Next write position
  private tail = 0; // Next read position
  private count = 0;
  private totalAdded = 0;
  private totalOverwritten = 0;
  private config: QueueConfig;

  constructor(config: Partial<QueueConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.buffer = new Array(this.config.capacity);
  }

  /**
   * Add an item to the queue
   * @returns true if added, false if queue is full and not in ring buffer mode
   */
  push(item: T): boolean {
    if (this.count >= this.config.capacity) {
      if (this.config.overwriteOnFull) {
        // Ring buffer mode: overwrite oldest
        this.tail = (this.tail + 1) % this.config.capacity;
        this.totalOverwritten++;
        this.count--;
      } else {
        return false;
      }
    }

    this.buffer[this.head] = item;
    this.head = (this.head + 1) % this.config.capacity;
    this.count++;
    this.totalAdded++;
    return true;
  }

  /**
   * Add multiple items to the queue
   * @returns number of items actually added
   */
  pushAll(items: T[]): number {
    let added = 0;
    for (const item of items) {
      if (this.push(item)) {
        added++;
      }
    }
    return added;
  }

  /**
   * Remove and return the oldest item
   */
  shift(): T | undefined {
    if (this.count === 0) return undefined;

    const item = this.buffer[this.tail];
    this.buffer[this.tail] = undefined; // Help GC
    this.tail = (this.tail + 1) % this.config.capacity;
    this.count--;
    return item;
  }

  /**
   * Remove and return up to n oldest items
   */
  shiftN(n: number): T[] {
    const items: T[] = [];
    const toShift = Math.min(n, this.count);

    for (let i = 0; i < toShift; i++) {
      const item = this.shift();
      if (item !== undefined) {
        items.push(item);
      }
    }

    return items;
  }

  /**
   * Peek at the oldest item without removing
   */
  peek(): T | undefined {
    if (this.count === 0) return undefined;
    return this.buffer[this.tail];
  }

  /**
   * Peek at the newest item without removing
   */
  peekLast(): T | undefined {
    if (this.count === 0) return undefined;
    const lastIndex = (this.head - 1 + this.config.capacity) % this.config.capacity;
    return this.buffer[lastIndex];
  }

  /**
   * Get all items as an array (oldest first)
   */
  toArray(): T[] {
    const items: T[] = [];
    let index = this.tail;

    for (let i = 0; i < this.count; i++) {
      const item = this.buffer[index];
      if (item !== undefined) {
        items.push(item);
      }
      index = (index + 1) % this.config.capacity;
    }

    return items;
  }

  /**
   * Get the last n items (most recent)
   */
  getLast(n: number): T[] {
    const items: T[] = [];
    const start = Math.max(0, this.count - n);
    let index = (this.tail + start) % this.config.capacity;

    for (let i = start; i < this.count; i++) {
      const item = this.buffer[index];
      if (item !== undefined) {
        items.push(item);
      }
      index = (index + 1) % this.config.capacity;
    }

    return items;
  }

  /**
   * Clear all items
   */
  clear(): void {
    this.buffer = new Array(this.config.capacity);
    this.head = 0;
    this.tail = 0;
    this.count = 0;
  }

  /**
   * Check if queue is empty
   */
  isEmpty(): boolean {
    return this.count === 0;
  }

  /**
   * Check if queue is full
   */
  isFull(): boolean {
    return this.count >= this.config.capacity;
  }

  /**
   * Get current size
   */
  get size(): number {
    return this.count;
  }

  /**
   * Get queue statistics
   */
  getStats(): QueueStats {
    return {
      size: this.count,
      capacity: this.config.capacity,
      totalAdded: this.totalAdded,
      totalOverwritten: this.totalOverwritten,
      usagePercent: (this.count / this.config.capacity) * 100,
    };
  }

  /**
   * Reset statistics without clearing queue
   */
  resetStats(): void {
    this.totalAdded = this.count;
    this.totalOverwritten = 0;
  }

  /**
   * Iterate over items (oldest first)
   */
  *[Symbol.iterator](): Iterator<T> {
    let index = this.tail;
    for (let i = 0; i < this.count; i++) {
      const item = this.buffer[index];
      if (item !== undefined) {
        yield item;
      }
      index = (index + 1) % this.config.capacity;
    }
  }

  /**
   * Find items matching a predicate
   */
  filter(predicate: (item: T) => boolean): T[] {
    const result: T[] = [];
    for (const item of this) {
      if (predicate(item)) {
        result.push(item);
      }
    }
    return result;
  }

  /**
   * Find first item matching a predicate
   */
  find(predicate: (item: T) => boolean): T | undefined {
    for (const item of this) {
      if (predicate(item)) {
        return item;
      }
    }
    return undefined;
  }
}

/**
 * Create a message queue with default settings
 */
export function createMessageQueue<T>(
  capacity = 10000,
  overwriteOnFull = true
): MessageQueue<T> {
  return new MessageQueue<T>({ capacity, overwriteOnFull });
}
