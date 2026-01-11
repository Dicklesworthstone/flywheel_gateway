import type {
  BvInsightsResult,
  BvPlanResult,
  BvTriageResult,
} from "@flywheel/flywheel-clients";
import { getLogger } from "../middleware/correlation";
import {
  getBvInsights,
  getBvPlan,
  getBvProjectRoot,
  getBvTriage,
} from "./bv.service";

export interface BeadsService {
  getTriage: () => Promise<BvTriageResult>;
  getInsights: () => Promise<BvInsightsResult>;
  getPlan: () => Promise<BvPlanResult>;
  syncBeads: () => Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }>;
}

export function createBeadsService(): BeadsService {
  return {
    getTriage: () => getBvTriage(),
    getInsights: () => getBvInsights(),
    getPlan: () => getBvPlan(),
    syncBeads: async () => {
      const log = getLogger();
      const proc = Bun.spawn(["bd", "sync"], {
        cwd: getBvProjectRoot(),
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, NO_COLOR: "1" },
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      await proc.exited;
      log.info({ exitCode: proc.exitCode }, "Beads sync command completed");
      return {
        exitCode: proc.exitCode ?? -1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      };
    },
  };
}
