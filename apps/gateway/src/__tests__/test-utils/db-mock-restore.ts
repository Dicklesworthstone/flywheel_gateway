/**
 * Utility for restoring real modules after tests that mock them.
 *
 * PROBLEM: Bun's mock.module() persists across test files, causing test pollution.
 * When one test file mocks "../db" or "drizzle-orm", other test files that run later
 * get the mock instead of the real module, causing failures.
 *
 * SOLUTION: Tests that mock these modules should call the restore functions in afterAll
 * to restore the real modules for subsequent test files.
 *
 * USAGE:
 * ```ts
 * import { afterAll } from "bun:test";
 * import { restoreRealDb, restoreDrizzleOrm } from "./test-utils/db-mock-restore";
 *
 * // Your mock.module calls here
 *
 * afterAll(() => {
 *   restoreRealDb();
 *   restoreDrizzleOrm(); // if you mocked drizzle-orm
 * });
 * ```
 */

import { mock } from "bun:test";
import * as flywheelClientsExports from "@flywheel/flywheel-clients";
import * as drizzleOrmExports from "drizzle-orm";
import {
  db as canonicalDb,
  sqlite as canonicalSqlite,
} from "../../db/connection";
import * as schema from "../../db/schema";

const AGENT_DETECTION_REAL = "../../services/agent-detection.service?real";
const BV_SERVICE_REAL = "../../services/bv.service?real";
const CASS_SERVICE_REAL = "../../services/cass.service?real";
const CM_SERVICE_REAL = "../../services/cm.service?real";
const TOOL_REGISTRY_REAL = "../../services/tool-registry.service?real";

const agentDetectionServiceExports = await import(AGENT_DETECTION_REAL);
const bvServiceExports = await import(BV_SERVICE_REAL);
const cassServiceExports = await import(CASS_SERVICE_REAL);
const cmServiceExports = await import(CM_SERVICE_REAL);
const toolRegistryServiceExports = await import(TOOL_REGISTRY_REAL);

/**
 * Restore the real db module after tests that mock it.
 * Call this in afterAll() for any test file that uses mock.module("../db", ...).
 */
export function restoreRealDb(): void {
  // Re-mock with the canonical connection so all services and tests share the same in-memory DB
  mock.module("../../db", () => ({
    db: canonicalDb,
    sqlite: canonicalSqlite,
    ...schema,
  }));

  mock.module("../db", () => ({
    db: canonicalDb,
    sqlite: canonicalSqlite,
    ...schema,
  }));
}

/**
 * Restore the real drizzle-orm module after tests that mock it.
 * Call this in afterAll() for any test file that uses mock.module("drizzle-orm", ...).
 */
export function restoreDrizzleOrm(): void {
  mock.module("drizzle-orm", () => drizzleOrmExports);
}

/**
 * Restore the real @flywheel/flywheel-clients module after tests that mock it.
 * Call this in afterAll() for any test file that uses mock.module("@flywheel/flywheel-clients", ...).
 */
export function restoreFlywheelClients(): void {
  mock.module("@flywheel/flywheel-clients", () => flywheelClientsExports);
}

/**
 * Restore the real utils/response module after tests that mock it.
 * Call this in afterAll() for any test file that uses mock.module("../utils/response", ...).
 */
export function restoreResponseUtils(): void {
  // Import the real module dynamically to avoid circular dependencies
  const realResponse = require("../../utils/response");
  mock.module("../utils/response", () => realResponse);
  mock.module("../../utils/response", () => realResponse);
}

/**
 * Restore the real middleware/correlation module after tests that mock it.
 * Call this in afterAll() for any test file that uses mock.module("../middleware/correlation", ...).
 */
export function restoreCorrelation(): void {
  const realCorrelation = require("../../middleware/correlation");
  mock.module("../middleware/correlation", () => realCorrelation);
  mock.module("../../middleware/correlation", () => realCorrelation);
}

/**
 * Restore the real tool-registry.service module after tests that mock it.
 * Call this in afterAll() for any test file that uses mock.module("../services/tool-registry.service", ...).
 */
export function restoreToolRegistryService(): void {
  mock.module(
    "../services/tool-registry.service",
    () => toolRegistryServiceExports,
  );
  mock.module(
    "../../services/tool-registry.service",
    () => toolRegistryServiceExports,
  );
  mock.module("./tool-registry.service", () => toolRegistryServiceExports);
  mock.module(
    "../../services/tool-registry.service.ts",
    () => toolRegistryServiceExports,
  );
  mock.module(
    "../services/tool-registry.service.ts",
    () => toolRegistryServiceExports,
  );
  mock.module("./tool-registry.service.ts", () => toolRegistryServiceExports);
}

/**
 * Restore the real agent-detection.service module after tests that mock it.
 * Call this in afterAll() for any test file that uses mock.module("../services/agent-detection.service", ...).
 */
export function restoreAgentDetectionService(): void {
  mock.module(
    "../services/agent-detection.service",
    () => agentDetectionServiceExports,
  );
  mock.module(
    "../../services/agent-detection.service",
    () => agentDetectionServiceExports,
  );
  mock.module("./agent-detection.service", () => agentDetectionServiceExports);
  mock.module(
    "../../services/agent-detection.service.ts",
    () => agentDetectionServiceExports,
  );
  mock.module(
    "../services/agent-detection.service.ts",
    () => agentDetectionServiceExports,
  );
  mock.module(
    "./agent-detection.service.ts",
    () => agentDetectionServiceExports,
  );
}

/**
 * Restore the real bv.service module after tests that mock it.
 * Call this in afterAll() for any test file that uses mock.module("../services/bv.service", ...).
 */
export function restoreBvService(): void {
  mock.module("../services/bv.service", () => bvServiceExports);
  mock.module("../../services/bv.service", () => bvServiceExports);
  mock.module("./bv.service", () => bvServiceExports);
  mock.module("../services/bv.service.ts", () => bvServiceExports);
  mock.module("../../services/bv.service.ts", () => bvServiceExports);
  mock.module("./bv.service.ts", () => bvServiceExports);
}

/**
 * Restore the real cass.service module after tests that mock it.
 * Call this in afterAll() for any test file that uses mock.module("../services/cass.service", ...).
 */
export function restoreCassService(): void {
  mock.module("../services/cass.service", () => cassServiceExports);
  mock.module("../../services/cass.service", () => cassServiceExports);
  mock.module("./cass.service", () => cassServiceExports);
  mock.module("../services/cass.service.ts", () => cassServiceExports);
  mock.module("../../services/cass.service.ts", () => cassServiceExports);
  mock.module("./cass.service.ts", () => cassServiceExports);
}

/**
 * Restore the real cm.service module after tests that mock it.
 */
export function restoreCmService(): void {
  mock.module("../services/cm.service", () => cmServiceExports);
  mock.module("../../services/cm.service", () => cmServiceExports);
  mock.module("./cm.service", () => cmServiceExports);
  mock.module("../services/cm.service.ts", () => cmServiceExports);
  mock.module("../../services/cm.service.ts", () => cmServiceExports);
  mock.module("./cm.service.ts", () => cmServiceExports);
}
