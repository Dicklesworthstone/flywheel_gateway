/**
 * Job Handlers Index
 *
 * Exports all job handlers and provides registration utility.
 */

import type { JobHandler, JobType } from "../../types/job.types";
import type { JobService } from "../../services/job.service";
import { CodebaseScanHandler } from "./codebase-scan.handler";
import { ContextBuildHandler } from "./context-build.handler";

// Handler registry
const handlers: Partial<Record<JobType, JobHandler>> = {
  codebase_scan: new CodebaseScanHandler(),
  context_build: new ContextBuildHandler(),
};

/**
 * Register all job handlers with the job service.
 */
export function registerJobHandlers(service: JobService): void {
  for (const [type, handler] of Object.entries(handlers)) {
    service.registerHandler(type as JobType, handler);
  }
}

export { CodebaseScanHandler } from "./codebase-scan.handler";
export { ContextBuildHandler } from "./context-build.handler";
