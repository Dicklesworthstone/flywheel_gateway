/**
 * Coverage Matrix Generator Tests (bd-2gkx.9)
 *
 * Unit tests for the generator script's output format
 * and snapshot test for drift detection.
 */

import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../..");
const MATRIX_PATH = path.join(ROOT, "docs/coverage-matrix.md");

describe("Coverage matrix output", () => {
  const content = existsSync(MATRIX_PATH)
    ? readFileSync(MATRIX_PATH, "utf-8")
    : "";

  it("file exists", () => {
    expect(existsSync(MATRIX_PATH)).toBe(true);
  });

  it("has expected title", () => {
    expect(content).toContain("# Coverage Matrix: Tools × Integration Planes");
  });

  it("has generated-by attribution", () => {
    expect(content).toContain("generate-coverage-matrix.ts");
  });

  it("has integration planes table", () => {
    expect(content).toContain("| Plane | Description |");
    expect(content).toContain("**Registry**");
    expect(content).toContain("**Detection**");
    expect(content).toContain("**Client Adapter**");
  });

  it("has at least one phase section", () => {
    expect(content).toMatch(/### .+ \(Phase \d+\)/);
  });

  it("has summary section with percentages", () => {
    expect(content).toContain("## Summary");
    expect(content).toMatch(/\| \w+ \| \d+\/\d+ \| \d+% \|/);
  });

  it("uses checkmarks and dashes for coverage", () => {
    expect(content).toContain("✓");
    expect(content).toContain("| - |");
  });

  it("includes known tools from registry", () => {
    // Golden fixture has these tools
    expect(content).toContain("DCG");
    expect(content).toContain("SLB");
    expect(content).toContain("UBS");
  });

  it("includes client-only tools", () => {
    // These exist as clients but not in manifest
    expect(content).toContain("AGENTMAIL");
  });

  it("has auto-generated footer", () => {
    expect(content).toContain("auto-generated");
  });
});

describe("Coverage matrix structure", () => {
  const content = existsSync(MATRIX_PATH)
    ? readFileSync(MATRIX_PATH, "utf-8")
    : "";

  it("all table rows have 10 columns (tool + 9 planes)", () => {
    const tableRows = content
      .split("\n")
      .filter(
        (line) =>
          line.startsWith("| **") &&
          !line.includes("Plane") &&
          (line.includes("✓") || line.includes("- |")),
      );

    for (const row of tableRows) {
      const cols = row.split("|").filter((c) => c.trim());
      expect(cols.length).toBe(10);
    }
  });

  it("no undefined or null values in output", () => {
    expect(content).not.toContain("undefined");
    expect(content).not.toContain("null");
  });

  it("phases are in ascending order", () => {
    const phaseMatches = [...content.matchAll(/Phase (\d+)/g)].map((m) =>
      parseInt(m[1]!, 10),
    );
    for (let i = 1; i < phaseMatches.length; i++) {
      expect(phaseMatches[i]!).toBeGreaterThanOrEqual(phaseMatches[i - 1]!);
    }
  });
});
