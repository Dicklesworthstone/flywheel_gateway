/**
 * Tests for generateSecureId (bd-1vr1.9).
 *
 * Format: `${prefix}_${Date.now()}_${suffix}` where suffix is alphanumeric.
 */

import { describe, expect, test } from "bun:test";
import { generateSecureId } from "../base-driver";

describe("generateSecureId", () => {
  test("produces prefixed ID with timestamp and suffix", () => {
    const id = generateSecureId("agent");
    // Format: agent_<timestamp>_<6 alphanumeric chars>
    expect(id).toMatch(/^agent_\d+_[A-Za-z0-9]{6}$/);
  });

  test("produces ID with custom suffix length", () => {
    const id = generateSecureId("x", 12);
    expect(id).toMatch(/^x_\d+_[A-Za-z0-9]{12}$/);
  });

  test("produces ID with suffix length 1", () => {
    const id = generateSecureId("p", 1);
    expect(id).toMatch(/^p_\d+_[A-Za-z0-9]$/);
  });

  test("produces unique IDs", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(generateSecureId("id"));
    }
    expect(ids.size).toBe(1000);
  });

  test("suffix uses only alphanumeric characters", () => {
    for (let i = 0; i < 50; i++) {
      const id = generateSecureId("t", 20);
      const suffix = id.split("_").pop()!;
      expect(suffix).toMatch(/^[A-Za-z0-9]{20}$/);
    }
  });

  test("distribution covers full charset", () => {
    const charCounts = new Map<string, number>();
    const sampleSize = 10000;

    for (let i = 0; i < sampleSize; i++) {
      const id = generateSecureId("t", 6);
      const suffix = id.split("_").pop()!;
      for (const ch of suffix) {
        charCounts.set(ch, (charCounts.get(ch) ?? 0) + 1);
      }
    }

    // 62 possible chars should all appear in 60000 samples
    expect(charCounts.size).toBe(62);
  });
});
