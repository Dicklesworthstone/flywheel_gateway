#!/usr/bin/env bun
/**
 * Auto-generate docs/coverage-matrix.md from the tool registry
 * and filesystem integration state.
 *
 * Usage:
 *   bun scripts/generate-coverage-matrix.ts          # generate
 *   bun scripts/generate-coverage-matrix.ts --check   # CI drift check
 *
 * bd-2gkx.9
 */

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// ============================================================================
// Types
// ============================================================================

interface ToolCoverage {
  name: string;
  displayName: string;
  phase: number;
  category: "agent" | "tool";
  registry: boolean;
  detection: boolean;
  install: boolean;
  client: boolean;
  service: boolean;
  route: boolean;
  ui: boolean;
  metrics: boolean;
  snapshot: boolean;
}

// ============================================================================
// Discovery
// ============================================================================

const ROOT = path.resolve(import.meta.dir, "..");
const CLIENTS_DIR = path.join(ROOT, "packages/flywheel-clients/src");
const SERVICES_DIR = path.join(ROOT, "apps/gateway/src/services");
const ROUTES_DIR = path.join(ROOT, "apps/gateway/src/routes");
const WEB_DIR = path.join(ROOT, "apps/web/src");
const MANIFEST_PATH =
  process.env["ACFS_MANIFEST_PATH"] ?? path.join(ROOT, "acfs.manifest.yaml");
const OUTPUT_PATH = path.join(ROOT, "docs/coverage-matrix.md");

/** Load manifest tools, falling back to fixture if manifest missing */
async function loadRegistryTools(): Promise<
  Array<{
    id: string;
    name: string;
    displayName?: string;
    category: "agent" | "tool";
    phase?: number;
    install?: unknown[];
    verify?: unknown;
    installedCheck?: unknown;
  }>
> {
  let manifestPath = MANIFEST_PATH;
  if (!existsSync(manifestPath)) {
    // Try golden fixture
    manifestPath = path.join(
      ROOT,
      "apps/gateway/src/__tests__/fixtures/valid-manifest.yaml",
    );
  }
  if (!existsSync(manifestPath)) {
    return [];
  }

  // yaml package is in apps/gateway, resolve from there
  const yamlPkgPath = path.join(ROOT, "apps/gateway/node_modules/yaml");
  let parse: (s: string) => unknown;
  try {
    const yamlMod = require(yamlPkgPath);
    parse = yamlMod.parse;
  } catch {
    // Fallback: try global
    try {
      const yamlMod = require("yaml");
      parse = yamlMod.parse;
    } catch {
      console.warn("yaml package not found, skipping manifest parse");
      return [];
    }
  }
  const content = await readFile(manifestPath, "utf-8");
  const data = parse(content) as { tools?: unknown[] };
  return (data.tools ?? []) as Array<{
    id: string;
    name: string;
    displayName?: string;
    category: "agent" | "tool";
    phase?: number;
    install?: unknown[];
    verify?: unknown;
    installedCheck?: unknown;
  }>;
}

/** Check if a directory exists for a tool client */
function hasClient(toolName: string): boolean {
  const aliases: Record<string, string> = {
    ubs: "scanner",
  };
  const dirName = aliases[toolName] ?? toolName;
  return existsSync(path.join(CLIENTS_DIR, dirName));
}

/** Check if a service file or directory exists */
function hasService(toolName: string): boolean {
  const patterns = [
    `${toolName}.service.ts`,
    `${toolName}-*.service.ts`,
    `tool-${toolName}.service.ts`,
  ];
  for (const pat of patterns) {
    // Simple check — just look for the file
    const base = pat.replace("*", "");
    if (existsSync(path.join(SERVICES_DIR, base))) return true;
  }

  // Also check for service references in common service files
  const commonServices = [
    "agent-detection.service.ts",
    "setup.service.ts",
    "snapshot.service.ts",
    "health-monitor.service.ts",
  ];
  for (const svc of commonServices) {
    const svcPath = path.join(SERVICES_DIR, svc);
    if (existsSync(svcPath)) {
      try {
        const content = require("node:fs").readFileSync(svcPath, "utf-8");
        if (
          content.includes(`"${toolName}"`) ||
          content.includes(`'${toolName}'`)
        ) {
          return true;
        }
      } catch {
        // ignore
      }
    }
  }
  return false;
}

/** Check if a route file references a tool */
function hasRoute(toolName: string): boolean {
  if (!existsSync(ROUTES_DIR)) return false;
  const routeFiles = require("node:fs").readdirSync(ROUTES_DIR) as string[];
  for (const file of routeFiles) {
    if (!file.endsWith(".ts")) continue;
    try {
      const content = require("node:fs").readFileSync(
        path.join(ROUTES_DIR, file),
        "utf-8",
      );
      if (
        content.includes(`/${toolName}`) ||
        content.includes(`"${toolName}"`) ||
        content.includes(`'${toolName}'`)
      ) {
        return true;
      }
    } catch {
      // ignore
    }
  }
  return false;
}

/** Check if web UI references a tool */
function hasUI(toolName: string): boolean {
  if (!existsSync(WEB_DIR)) return false;
  // Check pages and components
  const dirs = ["pages", "components", "hooks"];
  for (const dir of dirs) {
    const dirPath = path.join(WEB_DIR, dir);
    if (!existsSync(dirPath)) continue;
    try {
      const files = require("node:fs").readdirSync(dirPath, {
        recursive: true,
      }) as string[];
      for (const file of files) {
        if (
          !file.toString().endsWith(".tsx") &&
          !file.toString().endsWith(".ts")
        )
          continue;
        const content = require("node:fs").readFileSync(
          path.join(dirPath, file.toString()),
          "utf-8",
        );
        if (
          content.toLowerCase().includes(toolName.toLowerCase()) &&
          (content.includes(`/${toolName}`) ||
            content.includes(`"${toolName}"`) ||
            content.includes(`'${toolName}'`))
        ) {
          return true;
        }
      }
    } catch {
      // ignore
    }
  }
  return false;
}

/** Check snapshot service for tool inclusion */
function hasSnapshot(toolName: string): boolean {
  const snapshotPath = path.join(SERVICES_DIR, "snapshot.service.ts");
  if (!existsSync(snapshotPath)) return false;
  try {
    const content = require("node:fs").readFileSync(snapshotPath, "utf-8");
    return (
      content.includes(`"${toolName}"`) || content.includes(`'${toolName}'`)
    );
  } catch {
    return false;
  }
}

/** Check for metrics/alerting references */
function hasMetrics(toolName: string): boolean {
  // Check for prometheus metrics or alerting references
  const metricsFiles = [
    path.join(SERVICES_DIR, "metrics.service.ts"),
    path.join(SERVICES_DIR, "health-monitor.service.ts"),
    path.join(ROOT, "apps/gateway/src/middleware/metrics.ts"),
  ];
  for (const file of metricsFiles) {
    if (!existsSync(file)) continue;
    try {
      const content = require("node:fs").readFileSync(file, "utf-8");
      if (content.includes(toolName)) return true;
    } catch {
      // ignore
    }
  }
  return false;
}

// ============================================================================
// Matrix Generation
// ============================================================================

async function buildCoverageMatrix(): Promise<ToolCoverage[]> {
  const tools = await loadRegistryTools();
  const matrix: ToolCoverage[] = [];

  for (const tool of tools) {
    const name = tool.name;
    matrix.push({
      name,
      displayName: tool.displayName ?? name.toUpperCase(),
      phase: tool.phase ?? 999,
      category: tool.category,
      registry: true, // It's in the registry if we're iterating it
      detection: !!(tool.installedCheck || tool.verify),
      install: !!(tool.install && tool.install.length > 0),
      client: hasClient(name),
      service: hasService(name),
      route: hasRoute(name),
      ui: hasUI(name),
      metrics: hasMetrics(name),
      snapshot: hasSnapshot(name),
    });
  }

  // Also check for clients that exist but aren't in registry
  if (existsSync(CLIENTS_DIR)) {
    const clientDirs = require("node:fs")
      .readdirSync(CLIENTS_DIR)
      .filter(
        (d: string) =>
          !d.startsWith("_") &&
          !d.startsWith(".") &&
          !d.endsWith(".ts") &&
          d !== "toon",
      ) as string[];

    for (const dir of clientDirs) {
      const existing = matrix.find(
        (t) =>
          t.name === dir ||
          (dir === "scanner" && t.name === "ubs") ||
          (dir === "agentmail" && t.name === "agentmail"),
      );
      if (!existing) {
        matrix.push({
          name: dir,
          displayName: dir.toUpperCase(),
          phase: 999,
          category: "tool",
          registry: false,
          detection: false,
          install: false,
          client: true,
          service: hasService(dir),
          route: hasRoute(dir),
          ui: hasUI(dir),
          metrics: hasMetrics(dir),
          snapshot: hasSnapshot(dir),
        });
      }
    }
  }

  // Sort by phase then name
  matrix.sort((a, b) => a.phase - b.phase || a.name.localeCompare(b.name));

  return matrix;
}

function renderMarkdown(matrix: ToolCoverage[]): string {
  const check = (v: boolean) => (v ? "✓" : "-");
  const now = new Date().toISOString().split("T")[0];

  const lines: string[] = [
    "# Coverage Matrix: Tools × Integration Planes",
    "",
    "This document maps each tool's integration coverage across all integration planes, providing a comprehensive view of what's implemented and any gaps.",
    "",
    `**Last Updated**: ${now}`,
    "**Generated by**: `bun scripts/generate-coverage-matrix.ts`",
    "**Bead**: bd-2gkx.9 (Auto-generate coverage matrix from registry)",
    "",
    "## Integration Planes",
    "",
    "| Plane | Description |",
    "|-------|-------------|",
    "| **Registry** | Tool defined in ACFS manifest or FALLBACK_REGISTRY |",
    "| **Detection** | installedCheck and verify commands configured |",
    "| **Install** | Install spec with commands/installer defined |",
    "| **Client Adapter** | TypeScript client wrapper in `flywheel-clients` |",
    "| **Gateway Service** | Service layer in `apps/gateway/src/services/` |",
    "| **API Route** | REST endpoints in `apps/gateway/src/routes/` |",
    "| **UI Surface** | Web UI pages/components in `apps/web/` |",
    "| **Metrics/Alerts** | Prometheus metrics and alert rules |",
    "| **Snapshot** | Included in system snapshot aggregation |",
    "",
    "---",
    "",
    "## Coverage Matrix",
    "",
  ];

  // Group by phase
  const phases = new Map<number, ToolCoverage[]>();
  for (const tool of matrix) {
    const p = tool.phase;
    if (!phases.has(p)) phases.set(p, []);
    phases.get(p)!.push(tool);
  }

  const phaseLabels: Record<number, string> = {
    0: "Safety Tools (Phase 0)",
    1: "Core Tools (Phase 1)",
    2: "Recommended Tools (Phase 2)",
    999: "Additional Clients (No Phase)",
  };

  for (const [phase, tools] of Array.from(phases.entries()).sort(
    ([a], [b]) => a - b,
  )) {
    const label = phaseLabels[phase] ?? `Phase ${phase}`;
    lines.push(`### ${label}`, "");
    lines.push(
      "| Tool | Registry | Detection | Install | Client | Service | Route | UI | Metrics | Snapshot |",
    );
    lines.push(
      "|------|----------|-----------|---------|--------|---------|-------|----|---------|---------:|",
    );

    for (const t of tools) {
      lines.push(
        `| **${t.displayName}** | ${check(t.registry)} | ${check(t.detection)} | ${check(t.install)} | ${check(t.client)} | ${check(t.service)} | ${check(t.route)} | ${check(t.ui)} | ${check(t.metrics)} | ${check(t.snapshot)} |`,
      );
    }
    lines.push("");
  }

  // Summary
  const total = matrix.length;
  const counts = {
    registry: matrix.filter((t) => t.registry).length,
    detection: matrix.filter((t) => t.detection).length,
    install: matrix.filter((t) => t.install).length,
    client: matrix.filter((t) => t.client).length,
    service: matrix.filter((t) => t.service).length,
    route: matrix.filter((t) => t.route).length,
    ui: matrix.filter((t) => t.ui).length,
    metrics: matrix.filter((t) => t.metrics).length,
    snapshot: matrix.filter((t) => t.snapshot).length,
  };

  lines.push(
    "---",
    "",
    "## Summary",
    "",
    `| Plane | Coverage | Percentage |`,
    `|-------|----------|------------|`,
  );

  for (const [plane, count] of Object.entries(counts)) {
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    lines.push(`| ${plane} | ${count}/${total} | ${pct}% |`);
  }

  lines.push(
    "",
    "---",
    "",
    "*This file is auto-generated. Run `bun scripts/generate-coverage-matrix.ts` to update.*",
    "",
  );

  return lines.join("\n");
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const isCheck = process.argv.includes("--check");
  const matrix = await buildCoverageMatrix();
  const markdown = renderMarkdown(matrix);

  if (isCheck) {
    // CI drift check
    if (!existsSync(OUTPUT_PATH)) {
      console.error("❌ docs/coverage-matrix.md does not exist");
      process.exit(1);
    }
    const existing = await readFile(OUTPUT_PATH, "utf-8");

    // Compare ignoring the date line (which changes daily)
    const normalize = (s: string) =>
      s.replace(/\*\*Last Updated\*\*:.*/, "**Last Updated**: <date>");
    if (normalize(existing) !== normalize(markdown)) {
      console.error(
        "❌ docs/coverage-matrix.md is out of date. Run: bun scripts/generate-coverage-matrix.ts",
      );
      process.exit(1);
    }
    console.log("✓ docs/coverage-matrix.md is up to date");
  } else {
    await writeFile(OUTPUT_PATH, markdown);
    console.log(`✓ Generated ${OUTPUT_PATH}`);
    console.log(
      `  ${matrix.length} tools, ${Object.keys(matrix[0] ?? {}).length - 4} integration planes`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
