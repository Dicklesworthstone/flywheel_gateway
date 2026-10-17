import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import {
  BackpressureManager,
  createBackpressureManager,
} from "../BackpressureManager";

describe("BackpressureManager", () => {
  let manager: BackpressureManager<string>;

  beforeEach(() => {
    manager = new BackpressureManager<string>({
      highWaterMark: 10,
      lowWaterMark: 3,
      maxQueueSize: 20,
      processingInterval: 16,
      batchSize: 5,
    });
  });

  afterEach(() => {
    manager.dispose();
  });

  describe("enqueue", () => {
    it("should add messages to the queue", () => {
      manager.enqueue("message1");
      manager.enqueue("message2");

      const state = manager.getState();
      expect(state.queueLength).toBe(2);
    });

    it("should trigger pause when highWaterMark is reached", () => {
      const onPause = mock(() => {});
      manager.setPauseHandlers(onPause, () => {});

      // Add messages up to high water mark
      for (let i = 0; i < 10; i++) {
        manager.enqueue(`message${i}`);
      }

      expect(onPause).toHaveBeenCalled();
      expect(manager.getState().isPaused).toBe(true);
    });

    it("should drop oldest messages when maxQueueSize is exceeded", () => {
      // Fill queue to max
      for (let i = 0; i < 25; i++) {
        manager.enqueue(`message${i}`);
      }

      const state = manager.getState();
      // Should have dropped to lowWaterMark + 1
      expect(state.queueLength).toBeLessThanOrEqual(20);
      expect(state.droppedCount).toBeGreaterThan(0);
    });

    it("should not grow unbounded when watermarks are misconfigured", () => {
      const originalWarn = console.warn;
      console.warn = () => {};

      try {
        const misconfigured = new BackpressureManager<string>({
          highWaterMark: 10,
          lowWaterMark: 50,
          maxQueueSize: 20,
        });

        for (let i = 0; i < 200; i++) {
          misconfigured.enqueue(`message${i}`);
          const state = misconfigured.getState();
          expect(state.queueLength).toBeLessThanOrEqual(20);
          expect(state.droppedCount).toBeGreaterThanOrEqual(0);
        }

        misconfigured.dispose();
      } finally {
        console.warn = originalWarn;
      }
    });
  });

  describe("enqueueAll", () => {
    it("should add multiple messages at once", () => {
      const messages = ["msg1", "msg2", "msg3"];
      manager.enqueueAll(messages);

      expect(manager.getState().queueLength).toBe(3);
    });
  });

  describe("processing", () => {
    it("should process messages in batches when started", async () => {
      const processed: string[][] = [];
      manager.setMessageHandler((msgs) => processed.push(msgs));

      // Add messages
      for (let i = 0; i < 12; i++) {
        manager.enqueue(`message${i}`);
      }

      manager.start();

      // Wait for processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(processed.length).toBeGreaterThan(0);
      // First batch should have batchSize messages
      const firstBatch = processed[0];
      expect(firstBatch).toBeDefined();
      expect(firstBatch?.length).toBe(5);

      manager.stop();
    });

    it("should resume when queue drops below lowWaterMark", async () => {
      const onResume = mock(() => {});
      manager.setPauseHandlers(() => {}, onResume);

      // Fill past high water mark
      for (let i = 0; i < 15; i++) {
        manager.enqueue(`message${i}`);
      }

      expect(manager.getState().isPaused).toBe(true);

      // Start processing
      manager.setMessageHandler(() => {});
      manager.start();

      // Wait for processing to drain queue
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should have resumed
      expect(onResume).toHaveBeenCalled();

      manager.stop();
    });
  });

  describe("flush", () => {
    it("should return all messages and clear queue", () => {
      manager.enqueue("msg1");
      manager.enqueue("msg2");
      manager.enqueue("msg3");

      const flushed = manager.flush();

      expect(flushed).toEqual(["msg1", "msg2", "msg3"]);
      expect(manager.getState().queueLength).toBe(0);
    });

    it("should resume if was paused", () => {
      const onResume = mock(() => {});
      manager.setPauseHandlers(() => {}, onResume);

      // Fill past high water mark
      for (let i = 0; i < 15; i++) {
        manager.enqueue(`message${i}`);
      }

      expect(manager.getState().isPaused).toBe(true);

      manager.flush();

      expect(onResume).toHaveBeenCalled();
      expect(manager.getState().isPaused).toBe(false);
    });
  });

  describe("clear", () => {
    it("should clear queue and increment dropped count", () => {
      manager.enqueue("msg1");
      manager.enqueue("msg2");

      manager.clear();

      const state = manager.getState();
      expect(state.queueLength).toBe(0);
      expect(state.droppedCount).toBe(2);
    });
  });

  describe("getState", () => {
    it("should return current state", () => {
      manager.enqueue("msg1");

      const state = manager.getState();

      expect(state).toEqual({
        queueLength: 1,
        isPaused: false,
        droppedCount: 0,
        processedCount: 0,
      });
    });
  });

  describe("resetStats", () => {
    it("should reset dropped and processed counts", () => {
      manager.enqueue("msg1");
      manager.clear();

      manager.resetStats();

      const state = manager.getState();
      expect(state.droppedCount).toBe(0);
      expect(state.processedCount).toBe(0);
    });
  });

  describe("updateConfig", () => {
    it("should update configuration at runtime", () => {
      manager.updateConfig({ highWaterMark: 100 });

      // Fill to original high water mark (10)
      for (let i = 0; i < 10; i++) {
        manager.enqueue(`message${i}`);
      }

      // Should not be paused with new config
      expect(manager.getState().isPaused).toBe(false);
    });
  });

  describe("setStateChangeHandler", () => {
    it("should call handler on state changes", () => {
      const handler = mock(() => {});
      manager.setStateChangeHandler(handler);

      manager.enqueue("msg1");

      expect(handler).toHaveBeenCalled();
    });
  });

  describe("createBackpressureManager", () => {
    it("should create a new manager with config", () => {
      const mgr = createBackpressureManager<number>({ highWaterMark: 50 });
      expect(mgr).toBeInstanceOf(BackpressureManager);
      mgr.dispose();
    });
  });
});
