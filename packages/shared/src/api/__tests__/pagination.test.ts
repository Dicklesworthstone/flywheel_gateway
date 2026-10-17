/**
 * Unit tests for pagination utilities.
 */

import { describe, expect, it } from "bun:test";
import {
  buildPaginationMeta,
  CURSOR_EXPIRATION_MS,
  type CursorPayload,
  createCursor,
  DEFAULT_PAGINATION,
  decodeCursor,
  encodeCursor,
  normalizePaginationParams,
  parseListQuery,
  parsePaginationQuery,
} from "../pagination";

describe("pagination", () => {
  describe("cursor encoding", () => {
    it("should encode and decode payload correctly", () => {
      const payload: CursorPayload = {
        id: "agent_123",
        sortValue: 1705123456789,
        createdAt: Date.now(),
      };

      const cursor = encodeCursor(payload);
      const decoded = decodeCursor(cursor);

      expect(decoded).toBeDefined();
      expect(decoded?.id).toBe(payload.id);
      expect(decoded?.sortValue).toBe(payload.sortValue);
      expect(decoded?.createdAt).toBe(payload.createdAt);
    });

    it("should roundtrip payload without sortValue", () => {
      const payload: CursorPayload = {
        id: "checkpoint_abc",
        createdAt: Date.now(),
      };

      const cursor = encodeCursor(payload);
      const decoded = decodeCursor(cursor);

      expect(decoded).toBeDefined();
      expect(decoded?.id).toBe(payload.id);
      expect(decoded?.sortValue).toBeUndefined();
    });

    it("should produce URL-safe cursor strings", () => {
      const payload: CursorPayload = {
        id: "agent_with_special_chars/123",
        createdAt: Date.now(),
      };

      const cursor = encodeCursor(payload);

      // Should not contain URL-unsafe characters
      expect(cursor).not.toMatch(/[+/=]/);
      // Should be valid base64url
      expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it("should return undefined for expired cursor", () => {
      const oldTimestamp = Date.now() - CURSOR_EXPIRATION_MS - 1000;
      const payload: CursorPayload = {
        id: "agent_old",
        createdAt: oldTimestamp,
      };

      const cursor = encodeCursor(payload);
      const decoded = decodeCursor(cursor);

      expect(decoded).toBeUndefined();
    });

    it("should accept custom expiration time", () => {
      const shortExpiration = 1000; // 1 second
      const oldTimestamp = Date.now() - 2000; // 2 seconds ago
      const payload: CursorPayload = {
        id: "agent_recent",
        createdAt: oldTimestamp,
      };

      const cursor = encodeCursor(payload);

      // Should be expired with short expiration
      expect(decodeCursor(cursor, shortExpiration)).toBeUndefined();

      // Should still be valid with default expiration
      expect(decodeCursor(cursor, CURSOR_EXPIRATION_MS)).toBeDefined();
    });

    it("should return undefined for invalid cursor", () => {
      expect(decodeCursor("not-valid-base64!!!")).toBeUndefined();
      expect(decodeCursor("")).toBeUndefined();
    });

    it("should return undefined for invalid JSON in cursor", () => {
      const invalidJson = Buffer.from("not json").toString("base64url");
      expect(decodeCursor(invalidJson)).toBeUndefined();
    });

    it("should return undefined for cursor without required fields", () => {
      // Missing id
      const noId = Buffer.from(
        JSON.stringify({ createdAt: Date.now() }),
      ).toString("base64url");
      expect(decodeCursor(noId)).toBeUndefined();

      // Missing createdAt
      const noCreatedAt = Buffer.from(JSON.stringify({ id: "test" })).toString(
        "base64url",
      );
      expect(decodeCursor(noCreatedAt)).toBeUndefined();

      // Empty id
      const emptyId = Buffer.from(
        JSON.stringify({ id: "", createdAt: Date.now() }),
      ).toString("base64url");
      expect(decodeCursor(emptyId)).toBeUndefined();
    });

    it("should return undefined for non-object payload", () => {
      const stringPayload = Buffer.from(
        JSON.stringify("just a string"),
      ).toString("base64url");
      expect(decodeCursor(stringPayload)).toBeUndefined();

      const arrayPayload = Buffer.from(JSON.stringify([1, 2, 3])).toString(
        "base64url",
      );
      expect(decodeCursor(arrayPayload)).toBeUndefined();

      const nullPayload = Buffer.from(JSON.stringify(null)).toString(
        "base64url",
      );
      expect(decodeCursor(nullPayload)).toBeUndefined();
    });

    it("should reject invalid sortValue types", () => {
      const boolSortValue = Buffer.from(
        JSON.stringify({
          id: "test",
          createdAt: Date.now(),
          sortValue: true,
        }),
      ).toString("base64url");
      expect(decodeCursor(boolSortValue)).toBeUndefined();

      const objectSortValue = Buffer.from(
        JSON.stringify({
          id: "test",
          createdAt: Date.now(),
          sortValue: { nested: "value" },
        }),
      ).toString("base64url");
      expect(decodeCursor(objectSortValue)).toBeUndefined();
    });
  });

  describe("createCursor", () => {
    it("should create cursor with current timestamp", () => {
      const before = Date.now();
      const cursor = createCursor("agent_123");
      const after = Date.now();

      const decoded = decodeCursor(cursor);
      expect(decoded).toBeDefined();
      expect(decoded?.id).toBe("agent_123");
      expect(decoded?.createdAt).toBeGreaterThanOrEqual(before);
      expect(decoded?.createdAt).toBeLessThanOrEqual(after);
    });

    it("should include sortValue when provided", () => {
      const cursor = createCursor("agent_123", 1705123456789);
      const decoded = decodeCursor(cursor);

      expect(decoded?.sortValue).toBe(1705123456789);
    });

    it("should accept string sortValue", () => {
      const cursor = createCursor("agent_123", "2024-01-15T10:00:00Z");
      const decoded = decodeCursor(cursor);

      expect(decoded?.sortValue).toBe("2024-01-15T10:00:00Z");
    });
  });

  describe("normalizePaginationParams", () => {
    it("should use defaults for empty params", () => {
      const result = normalizePaginationParams({});

      expect(result.limit).toBe(DEFAULT_PAGINATION.limit);
      expect(result.cursor).toBeUndefined();
      expect(result.direction).toBe("forward");
    });

    it("should respect provided limit", () => {
      const result = normalizePaginationParams({ limit: 25 });

      expect(result.limit).toBe(25);
    });

    it("should cap limit at maxLimit", () => {
      const result = normalizePaginationParams({ limit: 500 });

      expect(result.limit).toBe(DEFAULT_PAGINATION.maxLimit);
    });

    it("should enforce minimum limit of 1", () => {
      const result = normalizePaginationParams({ limit: 0 });
      expect(result.limit).toBe(1);

      const negativeResult = normalizePaginationParams({ limit: -10 });
      expect(negativeResult.limit).toBe(1);
    });

    it("should detect forward direction with startingAfter", () => {
      const result = normalizePaginationParams({
        startingAfter: "cursor_abc",
      });

      expect(result.direction).toBe("forward");
      expect(result.cursor).toBe("cursor_abc");
    });

    it("should detect backward direction with endingBefore", () => {
      const result = normalizePaginationParams({
        endingBefore: "cursor_xyz",
      });

      expect(result.direction).toBe("backward");
      expect(result.cursor).toBe("cursor_xyz");
    });

    it("should prefer endingBefore over startingAfter", () => {
      const result = normalizePaginationParams({
        startingAfter: "cursor_abc",
        endingBefore: "cursor_xyz",
      });

      // endingBefore takes precedence
      expect(result.direction).toBe("backward");
      expect(result.cursor).toBe("cursor_xyz");
    });

    it("should accept custom defaults", () => {
      const result = normalizePaginationParams(
        { limit: 200 },
        { limit: 10, maxLimit: 50 },
      );

      expect(result.limit).toBe(50); // capped at custom maxLimit
    });
  });

  describe("parsePaginationQuery", () => {
    it("should parse empty query", () => {
      const result = parsePaginationQuery({});

      expect(result.limit).toBeUndefined();
      expect(result.startingAfter).toBeUndefined();
      expect(result.endingBefore).toBeUndefined();
    });

    it("should parse limit string to number", () => {
      const result = parsePaginationQuery({ limit: "25" });

      expect(result.limit).toBe(25);
    });

    it("should ignore invalid limit", () => {
      const result = parsePaginationQuery({ limit: "not-a-number" });

      expect(result.limit).toBeUndefined();
    });

    it("should parse starting_after", () => {
      const result = parsePaginationQuery({ starting_after: "cursor_abc" });

      expect(result.startingAfter).toBe("cursor_abc");
    });

    it("should parse ending_before", () => {
      const result = parsePaginationQuery({ ending_before: "cursor_xyz" });

      expect(result.endingBefore).toBe("cursor_xyz");
    });

    it("should parse all fields together", () => {
      const result = parsePaginationQuery({
        limit: "50",
        starting_after: "cursor_abc",
        ending_before: "cursor_xyz",
      });

      expect(result.limit).toBe(50);
      expect(result.startingAfter).toBe("cursor_abc");
      expect(result.endingBefore).toBe("cursor_xyz");
    });
  });

  describe("parseListQuery", () => {
    it("should use defaults for empty query", () => {
      const result = parseListQuery({});

      expect(result.limit).toBe(DEFAULT_PAGINATION.limit);
      expect(result.cursor).toBeUndefined();
      expect(result.sort).toBeUndefined();
      expect(result.direction).toBe("desc");
    });

    it("should parse limit and clamp to maxLimit", () => {
      expect(parseListQuery({ limit: "25" }).limit).toBe(25);

      const clamped = parseListQuery({ limit: "1000" }, { maxLimit: 200 });
      expect(clamped.limit).toBe(200);
    });

    it("should fall back to default limit for invalid limit values", () => {
      const result = parseListQuery(
        { limit: "not-a-number" },
        { maxLimit: 200 },
      );
      expect(result.limit).toBe(DEFAULT_PAGINATION.limit);
    });

    it("should drop invalid cursors", () => {
      const result = parseListQuery({ cursor: "not-valid-base64!!!" });
      expect(result.cursor).toBeUndefined();
      expect(result.cursorPayload).toBeUndefined();
    });

    it("should decode valid cursors and expose payload", () => {
      const cursor = createCursor("item_123", 1705123456789);
      const result = parseListQuery({ cursor });

      expect(result.cursor).toBe(cursor);
      expect(result.cursorPayload?.id).toBe("item_123");
      expect(result.cursorPayload?.sortValue).toBe(1705123456789);
    });

    it("should parse direction (case-insensitive) and fall back on invalid", () => {
      expect(parseListQuery({ direction: "ASC" }).direction).toBe("asc");
      expect(parseListQuery({ direction: "desc" }).direction).toBe("desc");
      expect(parseListQuery({ direction: "nope" }).direction).toBe("desc");
    });

    it("should enforce allowedSort when provided", () => {
      const allowed = ["created_at", "updated_at"] as const;

      const ok = parseListQuery(
        { sort: "updated_at" },
        { allowedSort: allowed, defaultSort: "created_at" },
      );
      expect(ok.sort).toBe("updated_at");

      const invalid = parseListQuery(
        { sort: "not-allowed" },
        { allowedSort: allowed, defaultSort: "created_at" },
      );
      expect(invalid.sort).toBe("created_at");
    });
  });

  describe("buildPaginationMeta", () => {
    interface TestItem {
      id: string;
      name: string;
      createdAt: number;
    }

    const testItems: TestItem[] = [
      { id: "item_1", name: "First", createdAt: 1000 },
      { id: "item_2", name: "Second", createdAt: 2000 },
      { id: "item_3", name: "Third", createdAt: 3000 },
    ];

    it("should indicate hasMore when items exceed limit", () => {
      // Simulating fetch of limit+1 items
      const items = [
        ...testItems,
        { id: "item_4", name: "Fourth", createdAt: 4000 },
      ];
      const meta = buildPaginationMeta(items, 3, (item) => item.id);

      expect(meta.hasMore).toBe(true);
    });

    it("should indicate no more when items at or below limit", () => {
      const meta = buildPaginationMeta(testItems, 3, (item) => item.id);

      expect(meta.hasMore).toBe(false);
    });

    it("should generate nextCursor when hasMore", () => {
      const items = [
        ...testItems,
        { id: "item_4", name: "Fourth", createdAt: 4000 },
      ];
      const meta = buildPaginationMeta(items, 3, (item) => item.id);

      expect(meta.nextCursor).toBeDefined();

      const decoded = decodeCursor(meta.nextCursor!);
      expect(decoded?.id).toBe("item_3"); // Last item of the page (excluding extra)
    });

    it("should not generate nextCursor when no more items", () => {
      const meta = buildPaginationMeta(testItems, 5, (item) => item.id);

      expect(meta.nextCursor).toBeUndefined();
    });

    it("should generate prevCursor for first item", () => {
      const meta = buildPaginationMeta(testItems, 3, (item) => item.id);

      expect(meta.prevCursor).toBeDefined();

      const decoded = decodeCursor(meta.prevCursor!);
      expect(decoded?.id).toBe("item_1");
    });

    it("should include sortValue in cursor when getSortValueFn provided", () => {
      const items = [
        ...testItems,
        { id: "item_4", name: "Fourth", createdAt: 4000 },
      ];
      const meta = buildPaginationMeta(
        items,
        3,
        (item) => item.id,
        (item) => item.createdAt,
      );

      const decoded = decodeCursor(meta.nextCursor!);
      expect(decoded?.sortValue).toBe(3000);
    });

    it("should handle empty items array", () => {
      const meta = buildPaginationMeta([] as TestItem[], 10, (item) => item.id);

      expect(meta.hasMore).toBe(false);
      expect(meta.nextCursor).toBeUndefined();
      expect(meta.prevCursor).toBeUndefined();
    });

    it("should handle single item", () => {
      const meta = buildPaginationMeta([testItems[0]!], 10, (item) => item.id);

      expect(meta.hasMore).toBe(false);
      expect(meta.prevCursor).toBeDefined();
    });
  });
});
