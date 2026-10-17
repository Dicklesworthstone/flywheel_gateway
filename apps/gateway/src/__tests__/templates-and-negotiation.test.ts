/**
 * Cost Attribution Custom Tags (bd-1hnyy), Pipeline Templates Library (bd-2hv7t),
 * Agent Preset Templates (bd-fpdig), and Reservation Negotiation Protocol (bd-2befy) Tests
 */

import { beforeEach, describe, expect, test } from "bun:test";
import app from "../index";
import {
  aggregateCostsByTagKey,
  applyRetroactiveCostTags,
  assignScopedCostTags,
  clearCostTagsForTesting,
  recordTaggedCost,
  upsertTagDefinition,
} from "../services/cost-tags.service";
import {
  clearNegotiationsForTesting,
  initiateReservationNegotiation,
  respondToReservationNegotiation,
} from "../services/reservation-negotiation.service";
import {
  clearTemplatesForTesting,
  instantiateAgentFromTemplate,
  instantiatePipelineTemplate,
  listAgentTemplates,
  listPipelineTemplates,
} from "../services/templates-library.service";

describe("P2 Platform Capabilities (bd-1hnyy, bd-2hv7t, bd-fpdig, bd-2befy)", () => {
  beforeEach(() => {
    delete process.env["GATEWAY_ADMIN_KEY"];
    clearCostTagsForTesting();
    clearTemplatesForTesting();
    clearNegotiationsForTesting();
  });

  test("Cost Attribution Custom Tags: resolves agent < session < task < manual inheritance and aggregates slices (bd-1hnyy)", () => {
    upsertTagDefinition({
      key: "team",
      description: "Engineering team",
      allowedValues: ["platform", "infra", "product"],
      required: true,
      defaultValue: "platform",
    });

    assignScopedCostTags({
      scope: "agent",
      targetId: "ag-1",
      tags: { team: "infra", sprint: "sprint-41" },
    });
    assignScopedCostTags({
      scope: "session",
      targetId: "sess-1",
      tags: { sprint: "sprint-42", feature: "auth-v2" },
    });
    assignScopedCostTags({
      scope: "task",
      targetId: "task-1",
      tags: { feature: "oauth-pkce" },
    });

    const rec1 = recordTaggedCost({
      amountUsd: 12.5,
      agentId: "ag-1",
      sessionId: "sess-1",
      taskId: "task-1",
    });
    expect(rec1.tags["team"]).toBe("infra");
    expect(rec1.tags["sprint"]).toBe("sprint-42");
    expect(rec1.tags["feature"]).toBe("oauth-pkce");

    const rec2 = recordTaggedCost({
      amountUsd: 7.5,
      manualTags: { team: "product", feature: "billing" },
    });

    applyRetroactiveCostTags([rec2.id], { sprint: "sprint-42" });

    const byTeam = aggregateCostsByTagKey("team");
    expect(byTeam.slices).toEqual([
      { value: "infra", totalUsd: 12.5, recordCount: 1 },
      { value: "product", totalUsd: 7.5, recordCount: 1 },
    ]);
  });

  test("Pipeline Templates Library & Agent Preset Templates instantiate with variables and track usage (bd-2hv7t, bd-fpdig)", () => {
    const pipes = listPipelineTemplates();
    expect(pipes.length).toBeGreaterThanOrEqual(3);

    const pipeInstance = instantiatePipelineTemplate(
      "tpl_pipe_multifile_refactor",
      { MODULE_PATH: "apps/gateway/src/ws" },
    );
    expect(pipeInstance.resolvedSteps[0]?.commandOrPrompt).toContain(
      "apps/gateway/src/ws",
    );

    const agentPresets = listAgentTemplates("refactoring");
    expect(agentPresets.length).toBe(1);

    const agInstance = instantiateAgentFromTemplate("agt_tpl_refactor", {
      agentName: "WS Refactor Bot",
      maxCostPerSession: 25,
    });
    expect(agInstance.agentName).toBe("WS Refactor Bot");
    expect(agInstance.safetyConfig.maxCostPerSession).toBe(25);
    expect(listAgentTemplates("refactoring")[0]?.usageCount).toBe(1);
  });

  test("Reservation Negotiation Protocol assesses conflicts, proposes SPLIT_SCOPE / AUTO_RELEASE / HANDOFF, and transitions state (bd-2befy)", () => {
    // 1. Stale inactive holder -> auto_released
    const staleNeg = initiateReservationNegotiation({
      reservationId: "res-1",
      requesterAgentId: "ag-req",
      holderAgentId: "ag-stale",
      requestedPaths: ["src/index.ts"],
      holderPaths: ["src/index.ts"],
      holderInactiveForSeconds: 450,
      reservationAgeSeconds: 900,
    });
    expect(staleNeg.status).toBe("auto_released");

    // 2. Partial overlap -> SPLIT_SCOPE
    const splitNeg = initiateReservationNegotiation({
      reservationId: "res-2",
      requesterAgentId: "ag-req",
      holderAgentId: "ag-active",
      requestedPaths: ["src/index.ts", "src/utils/new-helper.ts"],
      holderPaths: ["src/index.ts"],
      holderInactiveForSeconds: 10,
      reservationAgeSeconds: 30,
    });
    expect(splitNeg.proposedStrategy).toBe("SPLIT_SCOPE");
    expect(splitNeg.nonOverlappingPaths).toEqual(["src/utils/new-helper.ts"]);

    // 3. Active holder full overlap -> REQUEST_HANDOFF -> holder approves
    const handoffNeg = initiateReservationNegotiation({
      reservationId: "res-3",
      requesterAgentId: "ag-req",
      holderAgentId: "ag-active",
      requestedPaths: ["src/index.ts"],
      holderPaths: ["src/index.ts"],
      holderInactiveForSeconds: 5,
      reservationAgeSeconds: 20,
    });
    expect(handoffNeg.proposedStrategy).toBe("REQUEST_HANDOFF");
    expect(handoffNeg.status).toBe("pending_holder_response");

    const approved = respondToReservationNegotiation(handoffNeg.id, {
      decision: "approve",
      reason: "Finished editing index.ts",
    });
    expect(approved?.status).toBe("approved");
  });

  test("REST endpoints under /templates work end-to-end", async () => {
    const pipesRes = await app.request("/templates/pipelines");
    expect(pipesRes.status).toBe(200);

    const agentsRes = await app.request("/templates/agents");
    expect(agentsRes.status).toBe(200);

    const negRes = await app.request("/templates/negotiations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reservationId: "res-http-1",
        requesterAgentId: "ag-a",
        holderAgentId: "ag-b",
        requestedPaths: ["src/app.ts"],
        holderPaths: ["src/app.ts"],
        forceAdminAcquire: true,
      }),
    });
    expect(negRes.status).toBe(201);
    const negBody = (await negRes.json()) as {
      data: { status: string; proposedStrategy: string };
    };
    expect(negBody.data.status).toBe("force_acquired");
    expect(negBody.data.proposedStrategy).toBe("FORCE_ACQUIRE");
  });
});
