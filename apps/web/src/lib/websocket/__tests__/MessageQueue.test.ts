import { describe, it, expect, beforeEach } from 'bun:test';
import { MessageQueue, createMessageQueue } from '../MessageQueue';

describe('MessageQueue', () => {
  let queue: MessageQueue<string>;

  beforeEach(() => {
    queue = new MessageQueue<string>({ capacity: 5, overwriteOnFull: true });
  });

  describe('push', () => {
    it('should add items to the queue', () => {
      queue.push('item1');
      queue.push('item2');

      expect(queue.size).toBe(2);
    });

    it('should return true when item is added', () => {
      const result = queue.push('item');
      expect(result).toBe(true);
    });

    it('should overwrite oldest item when full in ring buffer mode', () => {
      for (let i = 0; i < 7; i++) {
        queue.push(`item${i}`);
      }

      // Should still have capacity items
      expect(queue.size).toBe(5);
      // Oldest items should be overwritten
      expect(queue.peek()).toBe('item2');
    });

    it('should return false when full and not in ring buffer mode', () => {
      const fixedQueue = new MessageQueue<string>({
        capacity: 3,
        overwriteOnFull: false,
      });

      fixedQueue.push('a');
      fixedQueue.push('b');
      fixedQueue.push('c');
      const result = fixedQueue.push('d');

      expect(result).toBe(false);
      expect(fixedQueue.size).toBe(3);
    });
  });

  describe('pushAll', () => {
    it('should add multiple items', () => {
      const added = queue.pushAll(['a', 'b', 'c']);
      expect(added).toBe(3);
      expect(queue.size).toBe(3);
    });
  });

  describe('shift', () => {
    it('should remove and return the oldest item', () => {
      queue.push('first');
      queue.push('second');

      const item = queue.shift();

      expect(item).toBe('first');
      expect(queue.size).toBe(1);
    });

    it('should return undefined when queue is empty', () => {
      const item = queue.shift();
      expect(item).toBeUndefined();
    });
  });

  describe('shiftN', () => {
    it('should remove and return n oldest items', () => {
      queue.pushAll(['a', 'b', 'c', 'd']);

      const items = queue.shiftN(2);

      expect(items).toEqual(['a', 'b']);
      expect(queue.size).toBe(2);
    });

    it('should return all items if n > size', () => {
      queue.pushAll(['a', 'b']);

      const items = queue.shiftN(10);

      expect(items).toEqual(['a', 'b']);
      expect(queue.size).toBe(0);
    });
  });

  describe('peek', () => {
    it('should return oldest item without removing', () => {
      queue.push('first');
      queue.push('second');

      const item = queue.peek();

      expect(item).toBe('first');
      expect(queue.size).toBe(2);
    });

    it('should return undefined when empty', () => {
      expect(queue.peek()).toBeUndefined();
    });
  });

  describe('peekLast', () => {
    it('should return newest item without removing', () => {
      queue.push('first');
      queue.push('second');

      const item = queue.peekLast();

      expect(item).toBe('second');
      expect(queue.size).toBe(2);
    });
  });

  describe('toArray', () => {
    it('should return all items in order', () => {
      queue.pushAll(['a', 'b', 'c']);

      const arr = queue.toArray();

      expect(arr).toEqual(['a', 'b', 'c']);
    });

    it('should work after wrap-around', () => {
      // Fill and overflow to cause wrap-around
      for (let i = 0; i < 7; i++) {
        queue.push(`item${i}`);
      }

      const arr = queue.toArray();

      expect(arr).toEqual(['item2', 'item3', 'item4', 'item5', 'item6']);
    });
  });

  describe('getLast', () => {
    it('should return last n items', () => {
      queue.pushAll(['a', 'b', 'c', 'd']);

      const last = queue.getLast(2);

      expect(last).toEqual(['c', 'd']);
    });
  });

  describe('clear', () => {
    it('should remove all items', () => {
      queue.pushAll(['a', 'b', 'c']);
      queue.clear();

      expect(queue.size).toBe(0);
      expect(queue.isEmpty()).toBe(true);
    });
  });

  describe('isEmpty', () => {
    it('should return true when empty', () => {
      expect(queue.isEmpty()).toBe(true);
    });

    it('should return false when not empty', () => {
      queue.push('item');
      expect(queue.isEmpty()).toBe(false);
    });
  });

  describe('isFull', () => {
    it('should return true when at capacity', () => {
      queue.pushAll(['a', 'b', 'c', 'd', 'e']);
      expect(queue.isFull()).toBe(true);
    });

    it('should return false when not at capacity', () => {
      queue.push('a');
      expect(queue.isFull()).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return queue statistics', () => {
      queue.pushAll(['a', 'b']);
      // Cause overwrites
      queue.pushAll(['c', 'd', 'e', 'f', 'g']);

      const stats = queue.getStats();

      expect(stats.size).toBe(5);
      expect(stats.capacity).toBe(5);
      expect(stats.totalAdded).toBe(7);
      expect(stats.totalOverwritten).toBe(2);
      expect(stats.usagePercent).toBe(100);
    });
  });

  describe('iterator', () => {
    it('should be iterable', () => {
      queue.pushAll(['a', 'b', 'c']);

      const items = [...queue];

      expect(items).toEqual(['a', 'b', 'c']);
    });
  });

  describe('filter', () => {
    it('should return items matching predicate', () => {
      queue.pushAll(['apple', 'banana', 'apricot', 'cherry']);

      const filtered = queue.filter((item) => item.startsWith('a'));

      expect(filtered).toEqual(['apple', 'apricot']);
    });
  });

  describe('find', () => {
    it('should return first item matching predicate', () => {
      queue.pushAll(['apple', 'banana', 'apricot']);

      const found = queue.find((item) => item.includes('an'));

      expect(found).toBe('banana');
    });

    it('should return undefined if not found', () => {
      queue.pushAll(['apple', 'banana']);

      const found = queue.find((item) => item === 'cherry');

      expect(found).toBeUndefined();
    });
  });

  describe('createMessageQueue', () => {
    it('should create queue with specified capacity', () => {
      const q = createMessageQueue<number>(100, false);
      expect(q).toBeInstanceOf(MessageQueue);
    });
  });
});
