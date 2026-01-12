/**
 * WebSocket Flow Control
 *
 * Implements flow control signals for WebSocket connections,
 * allowing client to signal backpressure to server.
 */

export enum FlowControlSignal {
  /** Request server to pause sending */
  PAUSE = 'flow:pause',
  /** Request server to resume sending */
  RESUME = 'flow:resume',
  /** Acknowledge messages received */
  ACK = 'flow:ack',
  /** Request server to slow down */
  SLOW_DOWN = 'flow:slow_down',
}

export interface FlowControlMessage {
  type: FlowControlSignal;
  timestamp: number;
  metadata?: {
    /** Number of messages acknowledged */
    ackCount?: number;
    /** Current client queue depth */
    queueDepth?: number;
    /** Suggested rate (messages per second) */
    suggestedRate?: number;
  };
}

export interface FlowControlConfig {
  /** WebSocket instance to send signals on */
  socket: WebSocket | null;
  /** Interval for sending ACK signals (ms) */
  ackInterval: number;
  /** Enable automatic ACK signaling */
  autoAck: boolean;
}

const DEFAULT_CONFIG: FlowControlConfig = {
  socket: null,
  ackInterval: 1000,
  autoAck: true,
};

export class FlowControl {
  private config: FlowControlConfig;
  private ackTimer: ReturnType<typeof setInterval> | null = null;
  private pendingAckCount = 0;
  private isPaused = false;

  constructor(config: Partial<FlowControlConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (this.config.autoAck && this.config.socket) {
      this.startAutoAck();
    }
  }

  /**
   * Set the WebSocket to send signals on
   */
  setSocket(socket: WebSocket | null): void {
    this.config.socket = socket;

    if (socket && this.config.autoAck) {
      this.startAutoAck();
    } else {
      this.stopAutoAck();
    }
  }

  /**
   * Send a pause signal to server
   */
  pause(queueDepth?: number): void {
    if (this.isPaused) return;
    this.isPaused = true;

    this.send({
      type: FlowControlSignal.PAUSE,
      timestamp: Date.now(),
      metadata: queueDepth !== undefined ? { queueDepth } : undefined,
    });
  }

  /**
   * Send a resume signal to server
   */
  resume(queueDepth?: number): void {
    if (!this.isPaused) return;
    this.isPaused = false;

    this.send({
      type: FlowControlSignal.RESUME,
      timestamp: Date.now(),
      metadata: queueDepth !== undefined ? { queueDepth } : undefined,
    });
  }

  /**
   * Send acknowledgment for received messages
   */
  acknowledge(count: number): void {
    this.pendingAckCount += count;

    // If not using auto-ack, send immediately
    if (!this.config.autoAck) {
      this.flushAck();
    }
  }

  /**
   * Request server to slow down to specific rate
   */
  slowDown(suggestedRate: number, queueDepth?: number): void {
    this.send({
      type: FlowControlSignal.SLOW_DOWN,
      timestamp: Date.now(),
      metadata: {
        suggestedRate,
        queueDepth,
      },
    });
  }

  private send(message: FlowControlMessage): void {
    if (!this.config.socket || this.config.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      this.config.socket.send(JSON.stringify(message));
    } catch (error) {
      console.error('[FlowControl] Failed to send signal:', error);
    }
  }

  private startAutoAck(): void {
    if (this.ackTimer) return;

    this.ackTimer = setInterval(() => {
      this.flushAck();
    }, this.config.ackInterval);
  }

  private stopAutoAck(): void {
    if (this.ackTimer) {
      clearInterval(this.ackTimer);
      this.ackTimer = null;
    }
  }

  private flushAck(): void {
    if (this.pendingAckCount === 0) return;

    this.send({
      type: FlowControlSignal.ACK,
      timestamp: Date.now(),
      metadata: {
        ackCount: this.pendingAckCount,
      },
    });

    this.pendingAckCount = 0;
  }

  /**
   * Get current flow control state
   */
  getState(): { isPaused: boolean; pendingAckCount: number } {
    return {
      isPaused: this.isPaused,
      pendingAckCount: this.pendingAckCount,
    };
  }

  /**
   * Clean up resources
   */
  dispose(): void {
    this.stopAutoAck();
    this.flushAck();
    this.config.socket = null;
  }
}

/**
 * Create a flow control instance connected to backpressure manager
 */
export function createFlowControl(
  socket: WebSocket | null,
  config?: Partial<Omit<FlowControlConfig, 'socket'>>
): FlowControl {
  return new FlowControl({ ...config, socket });
}
