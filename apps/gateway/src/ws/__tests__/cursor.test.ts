/**
 * Tests for cursor encoding/decoding utilities.
 */

import { describe, expect, test } from "bun:test";
import {
  type CursorData,
  compareCursors,
  createCursor,
  decodeCursor,
  encodeCursor,
  isCursorExpired,
} from "../cursor";

describe("cursor utilities", () => {
  describe("encodeCursor / decodeCursor", () => {
    test("round-trips cursor data correctly", () => {
      const data: CursorData = { timestamp: 1704067200000, sequence: 42 };
      const encoded = encodeCursor(data);
      const decoded = decodeCursor(encoded);

      expect(decoded).toEqual(data);
    });

    test("encodes to URL-safe base64", () => {
      const data: CursorData = { timestamp: 1704067200000, sequence: 999 };
      const encoded = encodeCursor(data);

      // Should not contain +, /, or =
      expect(encoded).not.toContain("+");
      expect(encoded).not.toContain("/");
      // URL-safe base64 may have padding stripped
    });

    test("decodes valid cursor string", () => {
      // Manually constructed: "1704067200000:100" in base64url
      const data: CursorData = { timestamp: 1704067200000, sequence: 100 };
      const cursor = encodeCursor(data);
      const decoded = decodeCursor(cursor);

      expect(decoded).toEqual(data);
    });

    test("returns undefined for invalid base64", () => {
      const decoded = decodeCursor("not-valid-base64!!!");
      expect(decoded).toBeUndefined();
    });

    test("returns undefined for invalid format (missing colon)", () => {
      const invalid = Buffer.from("12345").toString("base64url");
      const decoded = decodeCursor(invalid);
      expect(decoded).toBeUndefined();
    });

    test("returns undefined for non-numeric parts", () => {
      const invalid = Buffer.from("abc:def").toString("base64url");
      const decoded = decodeCursor(invalid);
      expect(decoded).toBeUndefined();
    });

    test("returns undefined for negative values", () => {
      const invalid = Buffer.from("-100:50").toString("base64url");
      const decoded = decodeCursor(invalid);
      expect(decoded).toBeUndefined();
    });

    test("handles zero values", () => {
      const data: CursorData = { timestamp: 0, sequence: 0 };
      const encoded = encodeCursor(data);
      const decoded = decodeCursor(encoded);

      expect(decoded).toEqual(data);
    });

    test("handles large numbers", () => {
      const data: CursorData = {
        timestamp: Number.MAX_SAFE_INTEGER,
        sequence: 999999999,
      };
      const encoded = encodeCursor(data);
      const decoded = decodeCursor(encoded);

      expect(decoded).toEqual(data);
    });
  });

  describe("compareCursors", () => {
    test("returns 0 for equal cursors", () => {
      const a = encodeCursor({ timestamp: 1000, sequence: 5 });
      const b = encodeCursor({ timestamp: 1000, sequence: 5 });

      expect(compareCursors(a, b)).toBe(0);
    });

    test("compares by timestamp first", () => {
      const earlier = encodeCursor({ timestamp: 1000, sequence: 100 });
      const later = encodeCursor({ timestamp: 2000, sequence: 1 });

      expect(compareCursors(earlier, later)).toBe(-1);
      expect(compareCursors(later, earlier)).toBe(1);
    });

    test("compares by sequence when timestamps are equal", () => {
      const lower = encodeCursor({ timestamp: 1000, sequence: 5 });
      const higher = encodeCursor({ timestamp: 1000, sequence: 10 });

      expect(compareCursors(lower, higher)).toBe(-1);
      expect(compareCursors(higher, lower)).toBe(1);
    });

    test("returns undefined for invalid cursors", () => {
      const valid = encodeCursor({ timestamp: 1000, sequence: 5 });

      expect(compareCursors("invalid", valid)).toBeUndefined();
      expect(compareCursors(valid, "invalid")).toBeUndefined();
      expect(compareCursors("invalid", "also-invalid")).toBeUndefined();
    });
  });

  describe("isCursorExpired", () => {
    test("returns false for recent cursor", () => {
      const cursor = createCursor(1);
      const expired = isCursorExpired(cursor, 60000); // 1 minute TTL

      expect(expired).toBe(false);
    });

    test("returns true for old cursor", () => {
      const cursor = encodeCursor({
        timestamp: Date.now() - 120000,
        sequence: 1,
      }); // 2 minutes ago
      const expired = isCursorExpired(cursor, 60000); // 1 minute TTL

      expect(expired).toBe(true);
    });

    test("returns undefined for invalid cursor", () => {
      const expired = isCursorExpired("invalid", 60000);
      expect(expired).toBeUndefined();
    });

    test("handles exact boundary", () => {
      const now = Date.now();
      const cursor = encodeCursor({ timestamp: now - 60000, sequence: 1 }); // Exactly at TTL

      // At the boundary, should be expired (> TTL, not >=)
      const expired = isCursorExpired(cursor, 60000, now);
      expect(expired).toBe(false); // At exactly TTL, not yet expired
    });
  });

  describe("createCursor", () => {
    test("creates cursor with current timestamp", () => {
      const before = Date.now();
      const cursor = createCursor(42);
      const after = Date.now();

      const decoded = decodeCursor(cursor);
      expect(decoded).toBeDefined();
      expect(decoded?.sequence).toBe(42);
      expect(decoded?.timestamp).toBeGreaterThanOrEqual(before);
      expect(decoded?.timestamp).toBeLessThanOrEqual(after);
    });

    test("creates cursor with custom timestamp", () => {
      const timestamp = 1704067200000;
      const cursor = createCursor(99, timestamp);

      const decoded = decodeCursor(cursor);
      expect(decoded).toEqual({ timestamp, sequence: 99 });
    });
  });
});
