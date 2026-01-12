/**
 * WebSocket Backpressure Manager
 *
 * Handles flow control for WebSocket connections to prevent memory exhaustion
 * when the server sends data faster than the client can process.
 */

export interface BackpressureConfig {
  /** Start applying backpressure when queue reaches this size (default: 1000) */
  highWaterMark: number;
  /** Resume normal flow when queue drops to this size (default: 100) */
  lowWaterMark: number;
  /** Drop oldest messages if queue exceeds this size (default: 5000) */
  maxQueueSize: number;
  /** Batch processing interval in ms (default: 16ms for 60fps) */
  processingInterval: number;
  /** Maximum messages to process per batch (default: 100) */
  batchSize: number;
}

export interface BackpressureState {
  /** Current queue length */
  queueLength: number;
  /** Whether backpressure is currently applied */
  isPaused: boolean;
  /** Number of messages dropped due to overflow */
  droppedCount: number;
  /** Total messages processed */
  processedCount: number;
}

export type BackpressureCallback = (state: BackpressureState) => void;

const DEFAULT_CONFIG: BackpressureConfig = {
  highWaterMark: 1000,
  lowWaterMark: 100,
  maxQueueSize: 5000,
  processingInterval: 16,
  batchSize: 100,
};

export class BackpressureManager<T = unknown> {
  private queue: T[] = [];
  private isPaused = false;
  private droppedCount = 0;
  private processedCount = 0;
  private config: BackpressureConfig;
  private processingTimer: ReturnType<typeof setInterval> | null = null;
  private onStateChange?: BackpressureCallback;
  private onPause?: () => void;
  private onResume?: () => void;
  private messageHandler?: (messages: T[]) => void;

  constructor(config: Partial<BackpressureConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Set callback for when messages are ready to be processed
   */
  setMessageHandler(handler: (messages: T[]) => void): void {
    this.messageHandler = handler;
  }

  /**
   * Set callback for state changes (useful for UI updates)
   */
  setStateChangeHandler(handler: BackpressureCallback): void {
    this.onStateChange = handler;
  }

  /**
   * Set callbacks for pause/resume events (useful for signaling server)
   */
  setPauseHandlers(onPause: () => void, onResume: () => void): void {
    this.onPause = onPause;
    this.onResume = onResume;
  }

  /**
   * Start processing the queue
   */
  start(): void {
    if (this.processingTimer) return;

    this.processingTimer = setInterval(() => {
      this.processBatch();
    }, this.config.processingInterval);
  }

  /**
   * Stop processing the queue
   */
  stop(): void {
    if (this.processingTimer) {
      clearInterval(this.processingTimer);
      this.processingTimer = null;
    }
  }

  /**
   * Enqueue a message for processing
   */
  enqueue(message: T): void {
    // Check for overflow
    if (this.queue.length >= this.config.maxQueueSize) {
      // Drop oldest messages to make room, keeping the most recent
      const dropCount = this.queue.length - this.config.lowWaterMark + 1;
      this.queue.splice(0, dropCount);
      this.droppedCount += dropCount;
      console.warn(`[BackpressureManager] Queue overflow, dropped ${dropCount} old messages`);
    }

    this.queue.push(message);

    // Apply backpressure if needed
    if (this.queue.length >= this.config.highWaterMark && !this.isPaused) {
      this.pause();
    }

    this.notifyStateChange();
  }

  /**
   * Enqueue multiple messages at once
   */
  enqueueAll(messages: T[]): void {
    for (const message of messages) {
      this.enqueue(message);
    }
  }

  /**
   * Process a batch of messages
   */
  private processBatch(): void {
    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0, this.config.batchSize);
    this.processedCount += batch.length;

    // Invoke message handler
    if (this.messageHandler && batch.length > 0) {
      this.messageHandler(batch);
    }

    // Resume if below low water mark
    if (this.queue.length <= this.config.lowWaterMark && this.isPaused) {
      this.resume();
    }

    this.notifyStateChange();
  }

  /**
   * Manually process all pending messages immediately
   */
  flush(): T[] {
    const all = [...this.queue];
    this.processedCount += this.queue.length;
    this.queue = [];

    if (this.isPaused) {
      this.resume();
    }

    this.notifyStateChange();
    return all;
  }

  /**
   * Clear the queue without processing
   */
  clear(): void {
    this.droppedCount += this.queue.length;
    this.queue = [];

    if (this.isPaused) {
      this.resume();
    }

    this.notifyStateChange();
  }

  private pause(): void {
    this.isPaused = true;
    this.onPause?.();
    console.debug(`[BackpressureManager] Paused at queue length ${this.queue.length}`);
  }

  private resume(): void {
    this.isPaused = false;
    this.onResume?.();
    console.debug(`[BackpressureManager] Resumed at queue length ${this.queue.length}`);
  }

  private notifyStateChange(): void {
    this.onStateChange?.(this.getState());
  }

  /**
   * Get current state
   */
  getState(): BackpressureState {
    return {
      queueLength: this.queue.length,
      isPaused: this.isPaused,
      droppedCount: this.droppedCount,
      processedCount: this.processedCount,
    };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.droppedCount = 0;
    this.processedCount = 0;
    this.notifyStateChange();
  }

  /**
   * Update configuration at runtime
   */
  updateConfig(config: Partial<BackpressureConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.stop();
    this.queue = [];
    this.messageHandler = undefined;
    this.onStateChange = undefined;
    this.onPause = undefined;
    this.onResume = undefined;
  }
}

/**
 * Hook for using BackpressureManager in React components
 */
export function createBackpressureManager<T>(
  config?: Partial<BackpressureConfig>
): BackpressureManager<T> {
  return new BackpressureManager<T>(config);
}
