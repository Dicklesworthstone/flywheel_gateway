import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createCursor } from "@flywheel/shared/api/pagination";
import { costRecords, db } from "../db";
import {
  clearCostData,
  getCostRecords,
} from "../services/cost-tracker.service";

async function insertCostRecord(input: { id: string; timestamp: Date }) {
  await db.insert(costRecords).values({
    id: input.id,
    timestamp: input.timestamp,

    organizationId: null,
    projectId: null,
    agentId: null,
    taskId: null,
    sessionId: null,

    model: "gpt-4",
    provider: "openai",

    promptTokens: 1,
    completionTokens: 1,
    cachedTokens: 0,

    promptCostUnits: 1,
    completionCostUnits: 1,
    cachedCostUnits: 0,
    totalCostUnits: 2,

    taskType: null,
    complexityTier: null,
    success: true,

    requestDurationMs: null,
    correlationId: null,
  });
}

describe("getCostRecords pagination", () => {
  beforeEach(async () => {
    await clearCostData();
  });

  afterEach(async () => {
    await clearCostData();
  });

  test("startingAfter does not skip rows when multiple records share the same timestamp", async () => {
    const ts = new Date("2025-01-01T00:00:00.000Z");

    await insertCostRecord({ id: "cost_1000_aaaa", timestamp: ts });
    await insertCostRecord({ id: "cost_1000_bbbb", timestamp: ts });
    await insertCostRecord({ id: "cost_1000_cccc", timestamp: ts });
    await insertCostRecord({
      id: "cost_0900_zzzz",
      timestamp: new Date("2024-12-31T23:59:59.000Z"),
    });

    const page1 = await getCostRecords({ limit: 2 });
    expect(page1.records.map((r) => r.id)).toEqual([
      "cost_1000_cccc",
      "cost_1000_bbbb",
    ]);

    expect(page1.nextCursor).toBeDefined();

    const page2 = await getCostRecords({
      limit: 2,
      startingAfter: page1.nextCursor!,
    });
    expect(page2.records.map((r) => r.id)).toEqual([
      "cost_1000_aaaa",
      "cost_0900_zzzz",
    ]);
  });

  test("startingAfter remains compatible with legacy cursors (id-only)", async () => {
    const ts = new Date("2025-01-01T00:00:00.000Z");

    await insertCostRecord({ id: "cost_1000_aaaa", timestamp: ts });
    await insertCostRecord({ id: "cost_1000_bbbb", timestamp: ts });
    await insertCostRecord({ id: "cost_1000_cccc", timestamp: ts });
    await insertCostRecord({
      id: "cost_0900_zzzz",
      timestamp: new Date("2024-12-31T23:59:59.000Z"),
    });

    const legacyCursor = createCursor("cost_1000_bbbb");
    const page2 = await getCostRecords({
      limit: 2,
      startingAfter: legacyCursor,
    });
    expect(page2.records.map((r) => r.id)).toEqual([
      "cost_1000_aaaa",
      "cost_0900_zzzz",
    ]);
  });
});
