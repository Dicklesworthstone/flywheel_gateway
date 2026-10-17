import type {
  BrClient,
  BrCloseOptions,
  BrCommandOptions,
  BrCreateInput,
  BrIssue,
  BrListOptions,
  BrReadyOptions,
  BrSyncOptions,
  BrSyncResult,
  BrSyncStatus,
  BrUpdateInput,
  BvGraphOptions,
  BvGraphResult,
  BvInsightsResult,
  BvPlanResult,
  BvTriageResult,
} from "@flywheel/flywheel-clients";
import {
  closeBrIssues,
  createBrIssue,
  getBrList,
  getBrReady,
  getBrShow,
  getBrSyncStatus,
  syncBr,
  updateBrIssues,
} from "./br.service";
import {
  getBvGraph,
  getBvInsights,
  getBvPlan,
  getBvTriage,
} from "./bv.service";

export interface CreateBeadsServiceOptions {
  brClient?: BrClient;
}

export interface BeadsService {
  // BV (triage/insights/plan/graph)
  getTriage: () => Promise<BvTriageResult>;
  getInsights: () => Promise<BvInsightsResult>;
  getPlan: () => Promise<BvPlanResult>;
  getGraph: (options?: BvGraphOptions) => Promise<BvGraphResult>;

  // BR CRUD operations
  ready: (options?: BrReadyOptions) => Promise<BrIssue[]>;
  list: (options?: BrListOptions) => Promise<BrIssue[]>;
  show: (
    ids: string | string[],
    options?: BrCommandOptions,
  ) => Promise<BrIssue[]>;
  create: (
    input: BrCreateInput,
    options?: BrCommandOptions,
  ) => Promise<BrIssue>;
  update: (
    ids: string | string[],
    input: BrUpdateInput,
    options?: BrCommandOptions,
  ) => Promise<BrIssue[]>;
  close: (
    ids: string | string[],
    options?: BrCloseOptions,
  ) => Promise<BrIssue[]>;

  // BR sync operations
  syncStatus: (options?: BrCommandOptions) => Promise<BrSyncStatus>;
  sync: (options?: BrSyncOptions) => Promise<BrSyncResult>;
}

export function createBeadsService(
  options: CreateBeadsServiceOptions = {},
): BeadsService {
  const brClient = options.brClient;

  return {
    // BV operations
    getTriage: () => getBvTriage(),
    getInsights: () => getBvInsights(),
    getPlan: () => getBvPlan(),
    getGraph: (options?: BvGraphOptions) => getBvGraph(options),

    // BR CRUD operations
    ready: (options?: BrReadyOptions) =>
      brClient ? brClient.ready(options) : getBrReady(options),
    list: (options?: BrListOptions) =>
      brClient ? brClient.list(options) : getBrList(options),
    show: (ids, options) =>
      brClient ? brClient.show(ids, options) : getBrShow(ids, options),
    create: (input, options) =>
      brClient
        ? brClient.create(input, options)
        : createBrIssue(input, options),
    update: (ids, input, options) =>
      brClient
        ? brClient.update(ids, input, options)
        : updateBrIssues(ids, input, options),
    close: (ids, options) =>
      brClient ? brClient.close(ids, options) : closeBrIssues(ids, options),

    // BR sync operations
    syncStatus: (options) =>
      brClient ? brClient.syncStatus(options) : getBrSyncStatus(options),
    sync: (options) => (brClient ? brClient.sync(options) : syncBr(options)),
  };
}
