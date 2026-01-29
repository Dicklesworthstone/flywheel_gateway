/**
 * TOON Output Parser Tests (bd-2n73.8)
 *
 * Tests format detection, TOON parsing, output normalization,
 * and schema validation for the TOON output utilities.
 */

import { describe, expect, it } from "bun:test";
import { z } from "zod";
import {
  detectOutputFormat,
  isToonFormat,
  parseToon,
  parseToonWithSchema,
  normalizeOutput,
  StandardEnvelopeSchema,
} from "../toon";

// ============================================================================
// Format Detection
// ============================================================================

describe("detectOutputFormat", () => {
  it("detects valid JSON object", () => {
    expect(detectOutputFormat('{"key": "value"}')).toBe("json");
  });

  it("detects valid JSON array", () => {
    expect(detectOutputFormat('[1, 2, 3]')).toBe("json");
  });

  it("detects JSONL (multiple JSON objects)", () => {
    expect(detectOutputFormat('{"a":1}\n{"b":2}\n{"c":3}')).toBe("jsonl");
  });

  it("detects TOON format with box-drawing chars", () => {
    const toon = `┌─── Status ───┐
│ healthy: true │
└──────────────┘`;
    expect(detectOutputFormat(toon)).toBe("toon");
  });

  it("detects SARIF format", () => {
    const sarif = JSON.stringify({
      $schema: "https://sarif.example.com/schema",
      version: "2.1.0",
      runs: [],
    });
    expect(detectOutputFormat(sarif)).toBe("sarif");
  });

  it("returns text for plain text", () => {
    expect(detectOutputFormat("hello world")).toBe("text");
  });

  it("returns text for empty input", () => {
    expect(detectOutputFormat("")).toBe("text");
    expect(detectOutputFormat("   ")).toBe("text");
  });

  it("returns text for invalid JSON starting with {", () => {
    expect(detectOutputFormat("{not valid json")).toBe("text");
  });
});

// ============================================================================
// isToonFormat
// ============================================================================

describe("isToonFormat", () => {
  it("returns true for output with multiple box-drawing lines", () => {
    expect(isToonFormat("─── Header ───\n│ key: value │")).toBe(true);
  });

  it("returns false for plain text", () => {
    expect(isToonFormat("just some text")).toBe(false);
  });

  it("returns false for single box-drawing line", () => {
    expect(isToonFormat("─── Only one line")).toBe(false);
  });

  it("returns true for table-like TOON", () => {
    const table = `├───┼───┤
│ a │ b │
├───┼───┤`;
    expect(isToonFormat(table)).toBe(true);
  });
});

// ============================================================================
// parseToon
// ============================================================================

describe("parseToon", () => {
  it("parses section with key-value pairs", () => {
    const toon = `─── System Info ───
│ version: 1.2.3 │
│ status: healthy │
───────────────────`;
    const result = parseToon(toon);
    expect(result.ok).toBe(true);
    expect(result.detectedFormat).toBe("toon");
    const data = result.data as Record<string, Record<string, string>>;
    expect(data["System Info"]).toBeDefined();
    expect(data["System Info"]!["version"]).toBe("1.2.3");
    expect(data["System Info"]!["status"]).toBe("healthy");
  });

  it("parses multiple sections", () => {
    const toon = `─── Section A ───
│ key1: val1 │
─── Section B ───
│ key2: val2 │
─────────────────`;
    const result = parseToon(toon);
    expect(result.ok).toBe(true);
    const data = result.data as Record<string, Record<string, string>>;
    expect(data["Section A"]!["key1"]).toBe("val1");
    expect(data["Section B"]!["key2"]).toBe("val2");
  });

  it("returns error for empty input", () => {
    const result = parseToon("");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Empty");
  });

  it("returns error for non-TOON input", () => {
    const result = parseToon('{"json": true}');
    expect(result.ok).toBe(false);
    expect(result.detectedFormat).toBe("json");
    expect(result.error).toContain("not TOON");
  });

  it("handles key-value with colon separator", () => {
    const toon = `─── Config ───
│ host: localhost │
│ port: 8080 │
──────────────────`;
    const result = parseToon(toon);
    expect(result.ok).toBe(true);
    const config = (result.data as Record<string, Record<string, string>>)["Config"]!;
    expect(config["host"]).toBe("localhost");
    expect(config["port"]).toBe("8080");
  });

  it("skips pure separator lines", () => {
    const toon = `─── Data ───
├───────────┤
│ key: val  │
├───────────┤
────────────`;
    const result = parseToon(toon);
    expect(result.ok).toBe(true);
    const data = (result.data as Record<string, Record<string, string>>)["Data"]!;
    expect(data["key"]).toBe("val");
  });

  it("preserves raw input in result", () => {
    const input = "─── X ───\n│ a: b │\n─────────";
    const result = parseToon(input);
    expect(result.raw).toBe(input);
  });
});

// ============================================================================
// normalizeOutput
// ============================================================================

describe("normalizeOutput", () => {
  it("normalizes JSON with standard envelope", () => {
    const json = JSON.stringify({ object: "list", data: [1, 2, 3] });
    const result = normalizeOutput(json);
    expect(result.sourceFormat).toBe("json");
    expect(result.envelopeCompliant).toBe(true);
    expect(result.data).toEqual([1, 2, 3]);
  });

  it("normalizes JSON without envelope", () => {
    const json = JSON.stringify({ count: 5, items: [] });
    const result = normalizeOutput(json);
    expect(result.sourceFormat).toBe("json");
    expect(result.envelopeCompliant).toBe(false);
    expect((result.data as Record<string, unknown>)["count"]).toBe(5);
  });

  it("normalizes JSONL into array", () => {
    const jsonl = '{"a":1}\n{"b":2}';
    const result = normalizeOutput(jsonl);
    expect(result.sourceFormat).toBe("jsonl");
    expect(Array.isArray(result.data)).toBe(true);
    expect((result.data as unknown[]).length).toBe(2);
  });

  it("normalizes TOON output", () => {
    const toon = "─── Info ───\n│ status: ok │\n─────────────";
    const result = normalizeOutput(toon);
    expect(result.sourceFormat).toBe("toon");
    expect(result.envelopeCompliant).toBe(false);
  });

  it("normalizes plain text", () => {
    const result = normalizeOutput("hello world");
    expect(result.sourceFormat).toBe("text");
    expect((result.data as Record<string, string>)["text"]).toBe("hello world");
  });

  it("normalizes CSV", () => {
    const csv = "name,age\nAlice,30\nBob,25";
    const result = normalizeOutput(csv, "csv");
    expect(result.sourceFormat).toBe("csv");
    const rows = result.data as Array<Record<string, string>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]!["name"]).toBe("Alice");
    expect(rows[1]!["age"]).toBe("25");
  });

  it("respects explicit format override", () => {
    // Force text interpretation even for JSON-like input
    const result = normalizeOutput('{"key": "val"}', "json");
    expect(result.sourceFormat).toBe("json");
  });

  it("SARIF normalization preserves structure", () => {
    const sarif = JSON.stringify({ version: "2.1.0", runs: [{ results: [] }] });
    const result = normalizeOutput(sarif, "sarif");
    expect(result.sourceFormat).toBe("sarif");
    expect(
      (result.data as Record<string, unknown>)["version"],
    ).toBe("2.1.0");
  });
});

// ============================================================================
// Schema Validation
// ============================================================================

describe("parseToonWithSchema", () => {
  const TestSchema = z.object({
    Status: z.record(z.string(), z.string()).optional(),
  });

  it("validates parsed TOON against schema", () => {
    const toon = "─── Status ───\n│ health: ok │\n──────────────";
    const result = parseToonWithSchema(toon, TestSchema);
    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
  });

  it("returns error when schema validation fails", () => {
    const StrictSchema = z.object({
      required_field: z.string(),
    });
    const toon = "─── Other ───\n│ key: val │\n─────────────";
    const result = parseToonWithSchema(toon, StrictSchema);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Schema validation failed");
  });

  it("returns parse error for non-TOON input", () => {
    const result = parseToonWithSchema("plain text", TestSchema);
    expect(result.ok).toBe(false);
  });
});

// ============================================================================
// StandardEnvelopeSchema
// ============================================================================

describe("StandardEnvelopeSchema", () => {
  it("validates standard envelope", () => {
    const result = StandardEnvelopeSchema.safeParse({
      object: "list",
      data: { items: [] },
    });
    expect(result.success).toBe(true);
  });

  it("validates envelope with error", () => {
    const result = StandardEnvelopeSchema.safeParse({
      data: null,
      error: { code: "NOT_FOUND", message: "Not found" },
    });
    expect(result.success).toBe(true);
  });

  it("validates minimal envelope (data only)", () => {
    const result = StandardEnvelopeSchema.safeParse({ data: 42 });
    expect(result.success).toBe(true);
  });
});
