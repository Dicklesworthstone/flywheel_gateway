#!/usr/bin/env bun

/**
 * CLI runner for Type-Safe Gateway Client SDK generation & CI drift verification (`bd-3ix6h`).
 *
 * Usage:
 *   bun scripts/generate-sdk.ts           # Print generated SDK to stdout
 *   bun scripts/generate-sdk.ts --check   # Verify deterministic generation and real types
 */

import {
  generateClientSDK,
  generateClientTypes,
} from "../packages/shared/src/commands/codegen/client";
import { allCommands } from "../packages/shared/src/commands/commands";
import { createCommandRegistry } from "../packages/shared/src/commands/registry";

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");

const registry = createCommandRegistry([...allCommands]);
const sdkPass1 = generateClientSDK(registry, {
  className: "GeneratedFlywheelClient",
});
const sdkPass2 = generateClientSDK(registry, {
  className: "GeneratedFlywheelClient",
});
const typesOutput = generateClientTypes(registry);

if (checkOnly) {
  if (sdkPass1 !== sdkPass2) {
    console.error(
      "[SDK-GEN] Deterministic codegen check FAILED: output differs between runs",
    );
    process.exit(1);
  }
  if (typesOutput.includes("unknown; // Infer from Zod schema")) {
    console.error(
      "[SDK-GEN] Type inference check FAILED: found uninferred placeholder types",
    );
    process.exit(1);
  }
  console.log(`[SDK-GEN] status=pass commands=${registry.size}`);
  process.exit(0);
}

console.log(sdkPass1);
