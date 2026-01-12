import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { FlowControl, FlowControlSignal, createFlowControl } from '../FlowControl';

describe('FlowControl', () => {
  let flowControl: FlowControl;
  let mockSocket: WebSocket;
  let sentMessages: string[];

  beforeEach(() => {
    sentMessages = [];
    mockSocket = {
      readyState: WebSocket.OPEN,
      send: (data: string) => {
        sentMessages.push(data);
      },
    } as unknown as WebSocket;

    flowControl = new FlowControl({ socket: mockSocket, autoAck: false });
  });

  afterEach(() => {
    flowControl.dispose();
  });

  describe('pause', () => {
    it('should send PAUSE signal', () => {
      flowControl.pause();

      expect(sentMessages.length).toBe(1);
      const msg = JSON.parse(sentMessages[0]);
      expect(msg.type).toBe(FlowControlSignal.PAUSE);
    });

    it('should include queueDepth in metadata if provided', () => {
      flowControl.pause(500);

      const msg = JSON.parse(sentMessages[0]);
      expect(msg.metadata.queueDepth).toBe(500);
    });

    it('should not send multiple pause signals', () => {
      flowControl.pause();
      flowControl.pause();

      expect(sentMessages.length).toBe(1);
    });
  });

  describe('resume', () => {
    it('should send RESUME signal after pause', () => {
      flowControl.pause();
      flowControl.resume();

      expect(sentMessages.length).toBe(2);
      const msg = JSON.parse(sentMessages[1]);
      expect(msg.type).toBe(FlowControlSignal.RESUME);
    });

    it('should not send resume if not paused', () => {
      flowControl.resume();
      expect(sentMessages.length).toBe(0);
    });
  });

  describe('acknowledge', () => {
    it('should send immediately when autoAck is false', () => {
      flowControl.acknowledge(5);
      flowControl.acknowledge(3);

      // With autoAck=false, sends immediately so pendingAckCount is always 0
      const state = flowControl.getState();
      expect(state.pendingAckCount).toBe(0);
      // Should have sent 2 ACK messages
      expect(sentMessages.length).toBe(2);
      const msg1 = JSON.parse(sentMessages[0]);
      const msg2 = JSON.parse(sentMessages[1]);
      expect(msg1.type).toBe(FlowControlSignal.ACK);
      expect(msg1.metadata.ackCount).toBe(5);
      expect(msg2.metadata.ackCount).toBe(3);
    });
  });

  describe('slowDown', () => {
    it('should send SLOW_DOWN signal with suggested rate', () => {
      flowControl.slowDown(100, 1000);

      expect(sentMessages.length).toBe(1);
      const msg = JSON.parse(sentMessages[0]);
      expect(msg.type).toBe(FlowControlSignal.SLOW_DOWN);
      expect(msg.metadata.suggestedRate).toBe(100);
      expect(msg.metadata.queueDepth).toBe(1000);
    });
  });

  describe('setSocket', () => {
    it('should update the socket', () => {
      const newSentMessages: string[] = [];
      const newSocket = {
        readyState: WebSocket.OPEN,
        send: (data: string) => newSentMessages.push(data),
      } as unknown as WebSocket;

      flowControl.setSocket(newSocket);
      flowControl.pause();

      expect(newSentMessages.length).toBe(1);
      expect(sentMessages.length).toBe(0);
    });

    it('should handle null socket gracefully', () => {
      flowControl.setSocket(null);
      flowControl.pause();

      // Should not throw
      expect(sentMessages.length).toBe(0);
    });
  });

  describe('getState', () => {
    it('should return current state', () => {
      flowControl.pause();

      const state = flowControl.getState();

      expect(state.isPaused).toBe(true);
      // pendingAckCount is 0 when autoAck is false (sends immediately)
      expect(state.pendingAckCount).toBe(0);
    });
  });

  describe('auto ack', () => {
    it('should send ACK signals periodically when enabled', async () => {
      const autoAckControl = new FlowControl({
        socket: mockSocket,
        autoAck: true,
        ackInterval: 50,
      });

      autoAckControl.acknowledge(5);

      // Wait for auto-ack interval
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(sentMessages.length).toBeGreaterThan(0);
      const msg = JSON.parse(sentMessages[0]);
      expect(msg.type).toBe(FlowControlSignal.ACK);
      expect(msg.metadata.ackCount).toBe(5);

      autoAckControl.dispose();
    });
  });

  describe('dispose', () => {
    it('should flush pending acks on dispose', () => {
      flowControl.acknowledge(5);
      flowControl.dispose();

      expect(sentMessages.length).toBe(1);
      const msg = JSON.parse(sentMessages[0]);
      expect(msg.type).toBe(FlowControlSignal.ACK);
    });
  });

  describe('createFlowControl', () => {
    it('should create a flow control instance', () => {
      const fc = createFlowControl(mockSocket, { autoAck: false });
      expect(fc).toBeInstanceOf(FlowControl);
      fc.dispose();
    });
  });

  describe('socket not ready', () => {
    it('should not send when socket is not open', () => {
      const closedSocket = {
        readyState: WebSocket.CLOSED,
        send: mock(() => {}),
      } as unknown as WebSocket;

      const fc = new FlowControl({ socket: closedSocket, autoAck: false });
      fc.pause();

      expect(closedSocket.send).not.toHaveBeenCalled();
      fc.dispose();
    });
  });
});
