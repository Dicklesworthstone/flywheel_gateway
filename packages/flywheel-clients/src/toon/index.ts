/**
 * TOON Output Format Parser & Utilities
 *
 * TOON (from toon_rust) is a compact structured output format used by
 * CLI tools as an alternative to JSON/JSONL. This module provides:
 *
 * - Detection: identify TOON-formatted output vs JSON/plaintext
 * - Parsing: convert TOON strings into structured objects
 * - Normalization: unified output handling across JSON/JSONL/TOON/SARIF
 * - Schema validation: validate parsed TOON against Zod schemas
 *
 * When the toon_rust binary is available, it can also encode data to TOON.
 */

import type { OutputFormat } from "@flywheel/shared/types/tool-registry.types";
import { z } from "zod";

// ============================================================================
// Types
// ============================================================================

export interface ToonParseResult<T = unknown> {
  /** Whether the input was successfully parsed as TOON */
  ok: boolean;
  /** Parsed data (undefined if parsing failed) */
  data?: T;
  /** Raw input string */
  raw: string;
  /** Detected format of the input */
  detectedFormat: OutputFormat | "text";
  /** Parse error message if parsing failed */
  error?: string;
}

export interface NormalizedOutput<T = unknown> {
  /** The parsed data */
  data: T;
  /** Format the data was originally in */
  sourceFormat: OutputFormat | "text";
  /** Whether the output conformed to the standard envelope */
  envelopeCompliant: boolean;
}

/**
 * Standard JSON envelope used by many tools:
 * { "object": "type_name", "data": {...}, "error"?: {...} }
 */
export const StandardEnvelopeSchema = z.object({
  object: z.string().optional(),
  data: z.unknown(),
  error: z
    .object({
      code: z.string().optional(),
      message: z.string().optional(),
    })
    .optional(),
});

export type StandardEnvelope = z.infer<typeof StandardEnvelopeSchema>;

// ============================================================================
// Format Detection
// ============================================================================

/**
 * Detect the output format of a string.
 *
 * Detection rules:
 * - Starts with `{` or `[` → JSON
 * - Multiple lines each starting with `{` → JSONL
 * - Contains TOON markers (section headers with `─` or `│`) → TOON
 * - Otherwise → text
 */
export function detectOutputFormat(output: string): OutputFormat | "text" {
  const trimmed = output.trim();
  if (!trimmed) return "text";

  // JSON-like: starts with { or [
  if (trimmed[0] === "{" || trimmed[0] === "[") {
    try {
      const parsed = JSON.parse(trimmed);
      // Check SARIF before generic JSON
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        !Array.isArray(parsed)
      ) {
        const obj = parsed as Record<string, unknown>;
        if (
          obj["$schema"]?.toString().includes("sarif") ||
          (obj["version"]?.toString().startsWith("2.1") && obj["runs"])
        ) {
          return "sarif";
        }
      }
      return "json";
    } catch {
      // Could be JSONL if multiple lines
    }
  }

  // JSONL: multiple lines, each valid JSON
  const lines = trimmed.split("\n").filter((l) => l.trim());
  if (lines.length > 1 && lines.every((l) => l.trim().startsWith("{"))) {
    try {
      for (const line of lines) {
        JSON.parse(line.trim());
      }
      return "jsonl";
    } catch {
      // Not valid JSONL
    }
  }

  // TOON: compact structured format with box-drawing characters
  if (isToonFormat(trimmed)) {
    return "toon";
  }

  return "text";
}

/**
 * Check if output looks like TOON format.
 *
 * TOON uses box-drawing characters (─, │, ┌, ┐, └, ┘, ├, ┤)
 * for structured sections and key-value rendering.
 */
export function isToonFormat(output: string): boolean {
  // TOON markers: box-drawing chars used for section headers/borders
  const toonMarkers = /[─│┌┐└┘├┤┬┴┼]/;
  const lines = output.split("\n");

  // Need at least 2 lines with box-drawing to be TOON
  let markerCount = 0;
  for (const line of lines) {
    if (toonMarkers.test(line)) {
      markerCount++;
      if (markerCount >= 2) return true;
    }
  }

  return false;
}

// ============================================================================
// Parsing
// ============================================================================

/**
 * Parse TOON-formatted output into structured key-value sections.
 *
 * TOON format typically uses:
 * - Section headers: `─── Section Name ───`
 * - Key-value pairs: `│ key: value` or `key │ value`
 * - Tables: `│ col1 │ col2 │ col3 │`
 * - Separators: `├───┼───┤`
 */
export function parseToon(
  input: string,
): ToonParseResult<Record<string, unknown>> {
  const trimmed = input.trim();
  if (!trimmed) {
    return {
      ok: false,
      raw: input,
      detectedFormat: "text",
      error: "Empty input",
    };
  }

  if (!isToonFormat(trimmed)) {
    return {
      ok: false,
      raw: input,
      detectedFormat: detectOutputFormat(trimmed),
      error: "Input is not TOON format",
    };
  }

  try {
    const result = parseToonSections(trimmed);
    return { ok: true, data: result, raw: input, detectedFormat: "toon" };
  } catch (err) {
    return {
      ok: false,
      raw: input,
      detectedFormat: "toon",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Parse TOON sections into a structured object.
 * Extracts section headers and their key-value content.
 */
function parseToonSections(input: string): Record<string, unknown> {
  const lines = input.split("\n");
  const result: Record<string, unknown> = {};

  let currentSection = "_root";
  let currentValues: Record<string, string> = {};
  const sectionHeaderPattern = /^[─┌└├]+\s+(.+?)\s+[─┐┘┤]+$/;
  const kvPattern = /^│?\s*([^│:]+?)\s*[:│]\s*(.+?)\s*│?$/;

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    // Check for section header
    const headerMatch = sectionHeaderPattern.exec(trimmedLine);
    if (headerMatch?.[1]) {
      // Save previous section
      if (Object.keys(currentValues).length > 0) {
        result[currentSection] = currentValues;
      }
      currentSection = headerMatch[1].trim();
      currentValues = {};
      continue;
    }

    // Skip pure separator lines
    if (/^[─├┤┬┴┼│\s]+$/.test(trimmedLine)) continue;

    // Try key-value extraction
    const kvMatch = kvPattern.exec(trimmedLine);
    if (kvMatch?.[1] && kvMatch[2]) {
      const key = kvMatch[1].trim();
      const value = kvMatch[2].trim();
      if (key) currentValues[key] = value;
    }
  }

  // Save last section
  if (Object.keys(currentValues).length > 0) {
    result[currentSection] = currentValues;
  }

  return result;
}

// ============================================================================
// Normalization
// ============================================================================

/**
 * Normalize tool output from any supported format into a consistent structure.
 *
 * Handles:
 * - JSON: parse directly, unwrap envelope if present
 * - JSONL: parse each line, return array
 * - TOON: parse sections into object
 * - SARIF: parse as JSON, extract results
 * - text: wrap in { text: "..." }
 */
export function normalizeOutput<T = unknown>(
  output: string,
  expectedFormat?: OutputFormat,
): NormalizedOutput<T> {
  const format = expectedFormat ?? detectOutputFormat(output);
  const trimmed = output.trim();

  switch (format) {
    case "json": {
      const parsed = JSON.parse(trimmed) as unknown;
      const envelope = StandardEnvelopeSchema.safeParse(parsed);
      if (envelope.success && envelope.data.data !== undefined) {
        return {
          data: envelope.data.data as T,
          sourceFormat: "json",
          envelopeCompliant: true,
        };
      }
      return {
        data: parsed as T,
        sourceFormat: "json",
        envelopeCompliant: false,
      };
    }

    case "jsonl": {
      const lines = trimmed
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l.trim()) as unknown);
      return {
        data: lines as T,
        sourceFormat: "jsonl",
        envelopeCompliant: false,
      };
    }

    case "toon": {
      const result = parseToon(trimmed);
      return {
        data: (result.data ?? { raw: trimmed }) as T,
        sourceFormat: "toon",
        envelopeCompliant: false,
      };
    }

    case "sarif": {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      return {
        data: parsed as T,
        sourceFormat: "sarif",
        envelopeCompliant: false,
      };
    }

    case "csv": {
      const rows = parseCsvSimple(trimmed);
      return {
        data: rows as T,
        sourceFormat: "csv",
        envelopeCompliant: false,
      };
    }

    default: {
      return {
        data: { text: trimmed } as T,
        sourceFormat: "text",
        envelopeCompliant: false,
      };
    }
  }
}

/**
 * Parse simple CSV (no quoting) into array of header-keyed objects.
 */
function parseCsvSimple(input: string): Array<Record<string, string>> {
  const lines = input.split("\n").filter((l) => l.trim());
  const firstLine = lines[0];
  if (lines.length < 2 || !firstLine) return [];

  const headers = firstLine.split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.trim());
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      const header = headers[i];
      if (header) {
        row[header] = values[i] ?? "";
      }
    }
    return row;
  });
}

// ============================================================================
// Schema Validation
// ============================================================================

/**
 * Parse and validate TOON output against a Zod schema.
 */
export function parseToonWithSchema<T>(
  input: string,
  schema: z.ZodType<T>,
): ToonParseResult<T> {
  const result = parseToon(input);
  if (!result.ok || !result.data) return result as ToonParseResult<T>;

  const validated = schema.safeParse(result.data);
  if (!validated.success) {
    return {
      ok: false,
      raw: input,
      detectedFormat: "toon",
      error: `Schema validation failed: ${validated.error.issues.map((i) => i.message).join(", ")}`,
    };
  }

  return {
    ok: true,
    data: validated.data,
    raw: input,
    detectedFormat: "toon",
  };
}
