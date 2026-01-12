/**
 * WebSocket utilities for performance-optimized real-time communication
 */

export {
  BackpressureManager,
  createBackpressureManager,
  type BackpressureConfig,
  type BackpressureState,
  type BackpressureCallback,
} from './BackpressureManager';

export {
  FlowControl,
  FlowControlSignal,
  createFlowControl,
  type FlowControlMessage,
  type FlowControlConfig,
} from './FlowControl';

export {
  MessageQueue,
  createMessageQueue,
  type QueueConfig,
  type QueueStats,
} from './MessageQueue';
