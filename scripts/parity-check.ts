#!/usr/bin/env bun
/**
 * CLI runner for command registry parity check.
 *
 * Usage:
 *   bun scripts/parity-check.ts           # Console output
 *   bun scripts/parity-check.ts --json    # JSON output for CI
 *
 * Exit codes:
 *   0 - All checks passed
 *   1 - Validation errors found
 */

import { createCommandRegistry } from "../packages/shared/src/commands/registry";
import { agentCommands } from "../packages/shared/src/commands/commands/agent";
import {
  runParityCheck,
  formatReport,
  formatReportJSON,
} from "../packages/shared/src/commands/parity-check";

// Parse args
const args = process.argv.slice(2);
const jsonOutput = args.includes("--json");
const robot = args.includes("--robot");

// Build the command registry
const registry = createCommandRegistry([...agentCommands]);

// Run parity checks
const report = runParityCheck(registry);

// Output
if (jsonOutput || robot) {
  console.log(formatReportJSON(report));
} else {
  console.log(formatReport(report));
}

// Log for structured logging systems
if (report.failed === 0) {
  console.error(
    `[PARITY] check=registry status=pass commands=${report.totalCommands} warnings=${report.warnings}`,
  );
} else {
  console.error(
    `[PARITY] check=registry status=fail commands=${report.totalCommands} errors=${report.failed}`,
  );
}

// Exit with appropriate code
process.exit(report.failed > 0 ? 1 : 0);
