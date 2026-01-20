
import { describe, expect, it } from "bun:test";
import { InMemoryRateLimiter } from "../middleware/rate-limit";

describe("InMemoryRateLimiter Max Items", () => {
  it("should enforce maxItems limit", () => {
    const maxItems = 5;
    const limiter = new InMemoryRateLimiter(60000, maxItems);
    const config = { limit: 10, windowMs: 60000 };

    // Fill up to max
    for (let i = 0; i < maxItems; i++) {
      limiter.check(`key-${i}`, config);
    }
    expect(limiter.size()).toBe(maxItems);

    // Add one more
    limiter.check("key-overflow", config);
    expect(limiter.size()).toBe(maxItems);

    // The oldest one (key-0) should be gone
    // We can't easily check internal map keys without access, but we can infer
    // logic: checking key-0 again should reset it (count 1) instead of incrementing (count 2)
    // Wait, if it was evicted, it's gone. If we check it again, it's a NEW entry.
    // So its count should be 1.
    // But we only incremented it once before. So count would be 1 anyway unless we incremented multiple times.
    
    // Let's increment key-0 multiple times first.
    limiter.check("key-0", config); // count 2
    expect(limiter.check("key-0", config).remaining).toBe(8); // count 3

    // Fill others
    for (let i = 1; i < maxItems; i++) {
      limiter.check(`key-${i}`, config);
    }
    // Now we have key-0...key-4. key-0 is most recently used!
    // My implementation updates LRU on check.
    // So key-0 should be preserved. key-1 should be oldest?
    // Let's trace:
    // check key-0 (new) -> [key-0]
    // check key-0 (update) -> delete key-0, set key-0 -> [key-0]
    // check key-1..4 -> [key-0, key-1, key-2, key-3, key-4]
    
    // key-0 is the oldest because we refreshed key-1..4 after key-0 was refreshed.
    // Order: key-0, key-1, key-2, key-3, key-4 (newest)
    // Wait, let's trace carefully:
    // refresh key-0 -> key-1..4, key-0
    // refresh key-1 -> key-2..4, key-0, key-1
    // ...
    // refresh key-4 -> key-0, key-1..3, key-4
    // So key-0 IS the oldest.
    
    // Add overflow -> Evicts key-0.
    // State: key-1, key-2, key-3, key-4, key-overflow
    
    // Check key-0. New entry. -> Evicts key-1.
    // State: key-2, key-3, key-4, key-overflow, key-0
    
    const info0 = limiter.check("key-0", config);
    expect(info0.remaining).toBe(9); // count 1. Proof it was evicted.
    
    const info1 = limiter.check("key-1", config);
    expect(info1.remaining).toBe(9); // count 1. Proof it was evicted.
    
    // key-2 should NOT be evicted yet?
    // Check key-2. Should be count 3 (from loop).
    // State: key-3, key-4, key-overflow, key-0, key-1, key-2 (oops size 6 -> evicts key-2?)
    // No, checking key-2 updates it. But wait, `check` adds/updates then evicts.
    // `check(2)` -> update 2 (moves to end). Size 5. No eviction.
    // State: key-3, key-4, key-overflow, key-0, key-1, key-2
    // So key-2 should be preserved.
    
    const info2 = limiter.check("key-2", config); // count 3
    expect(info2.remaining).toBe(7); // 10 - 3 = 7
  });
});
