/**
 * Tests for tokenizer service.
 */

import { describe, expect, test } from "bun:test";
import {
  countTokens,
  countTokensMultiple,
  splitIntoChunks,
  truncateToTokens,
} from "../services/tokenizer.service";

describe("Tokenizer Service", () => {
  describe("countTokens", () => {
    test("returns 0 for empty string", () => {
      expect(countTokens("")).toBe(0);
    });

    test("returns 0 for null/undefined", () => {
      expect(countTokens(null as unknown as string)).toBe(0);
      expect(countTokens(undefined as unknown as string)).toBe(0);
    });

    test("counts tokens for simple text", () => {
      const text = "Hello world";
      const tokens = countTokens(text);
      // ~11 chars / 4 = ~3 tokens
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(10);
    });

    test("adjusts for code content", () => {
      const code = `
        import { foo } from 'bar';
        export function test() {
          const x = 1;
          return x;
        }
      `;
      const tokens = countTokens(code);
      // Code should have more tokens due to adjustment
      expect(tokens).toBeGreaterThan(0);
    });

    test("adjusts for structured content (JSON)", () => {
      const json = '{"name": "test", "value": 123, "nested": {"a": 1}}';
      const tokens = countTokens(json);
      expect(tokens).toBeGreaterThan(0);
    });

    test("adjusts for structured content (XML)", () => {
      const xml = "<root><child>value</child></root>";
      const tokens = countTokens(xml);
      expect(tokens).toBeGreaterThan(0);
    });

    test("handles high whitespace content", () => {
      const text = "word   word   word   word   word";
      const tokens = countTokens(text);
      expect(tokens).toBeGreaterThan(0);
    });
  });

  describe("countTokensMultiple", () => {
    test("returns 0 for empty array", () => {
      expect(countTokensMultiple([])).toBe(0);
    });

    test("sums tokens from multiple texts", () => {
      const texts = ["Hello", "World", "Test"];
      const total = countTokensMultiple(texts);
      const individual =
        countTokens("Hello") + countTokens("World") + countTokens("Test");
      expect(total).toBe(individual);
    });
  });

  describe("truncateToTokens", () => {
    test("returns empty string for empty input", () => {
      expect(truncateToTokens("", 100)).toBe("");
    });

    test("returns empty string for zero or negative maxTokens", () => {
      expect(truncateToTokens("Hello world", 0)).toBe("");
      expect(truncateToTokens("Hello world", -5)).toBe("");
    });

    test("returns original text if within budget", () => {
      const text = "Hello";
      const result = truncateToTokens(text, 100);
      expect(result).toBe(text);
    });

    test("truncates long text and adds ellipsis", () => {
      const text =
        "This is a very long text that needs to be truncated because it exceeds the token budget significantly.";
      const result = truncateToTokens(text, 5);
      expect(result.endsWith("...")).toBe(true);
      expect(result.length).toBeLessThan(text.length);
    });

    test("uses custom ellipsis", () => {
      const text =
        "This is a long text that needs truncation for the token budget.";
      const result = truncateToTokens(text, 5, " [truncated]");
      expect(result.endsWith("[truncated]")).toBe(true);
    });

    test("handles case where ellipsis equals max tokens", () => {
      const result = truncateToTokens("Long text here", 1, ".");
      // Should return just the ellipsis or empty
      expect(result.length).toBeLessThanOrEqual(2);
    });
  });

  describe("splitIntoChunks", () => {
    test("returns empty array for empty string", () => {
      expect(splitIntoChunks("", 100)).toEqual([]);
    });

    test("returns empty array for zero or negative maxTokens", () => {
      expect(splitIntoChunks("Hello world", 0)).toEqual([]);
      expect(splitIntoChunks("Hello world", -5)).toEqual([]);
    });

    test("returns single chunk if within budget", () => {
      const text = "Short text";
      const chunks = splitIntoChunks(text, 100);
      expect(chunks).toEqual([text]);
    });

    test("splits text into multiple chunks", () => {
      const text = `First paragraph with some content.

Second paragraph with more content.

Third paragraph with even more content.`;
      const chunks = splitIntoChunks(text, 10);
      expect(chunks.length).toBeGreaterThan(1);
    });

    test("handles very long paragraphs by splitting sentences", () => {
      const text =
        "First sentence. Second sentence. Third sentence. Fourth sentence. Fifth sentence. Sixth sentence.";
      const chunks = splitIntoChunks(text, 5);
      expect(chunks.length).toBeGreaterThan(0);
    });
  });
});
