/**
 * Pipeline Routes Tests
 *
 * Tests for the pipeline workflow engine REST API endpoints and service.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { CreatePipelineInput } from "../models/pipeline";
import { pipelines } from "../routes/pipelines";
import {
  cancelRun,
  clearAll,
  createPipeline,
  getPipeline,
  getRun,
  pauseRun,
  runPipeline,
} from "../services/pipeline.service";

// ============================================================================
// Test Setup
// ============================================================================

const app = new Hono();
app.route("/pipelines", pipelines);

beforeEach(() => {
  clearAll();
});

afterEach(() => {
  clearAll();
});

// ============================================================================
// Test Data
// ============================================================================

function createTestPipelineInput(): CreatePipelineInput {
  return {
    name: "Test Pipeline",
    description: "A test pipeline",
    trigger: {
      type: "manual",
      config: { type: "manual", config: { description: "Manual trigger" } },
      enabled: true,
    },
    steps: [
      {
        id: "step1",
        name: "First Step",
        type: "script",
        config: {
          type: "script",
          config: { script: "echo 'Hello World'" },
        },
      },
      {
        id: "step2",
        name: "Second Step",
        type: "script",
        config: {
          type: "script",
          config: { script: "echo 'Goodbye'" },
        },
        dependsOn: ["step1"],
      },
    ],
    tags: ["test", "example"],
  };
}

// ============================================================================
// Service Tests
// ============================================================================

describe("Pipeline Service", () => {
  describe("createPipeline", () => {
    test("creates pipeline with all required fields", () => {
      const input = createTestPipelineInput();
      const pipeline = createPipeline(input);

      expect(pipeline.id).toMatch(/^pipe_\d+_[a-z0-9]+$/);
      expect(pipeline.name).toBe("Test Pipeline");
      expect(pipeline.description).toBe("A test pipeline");
      expect(pipeline.version).toBe(1);
      expect(pipeline.enabled).toBe(true);
      expect(pipeline.steps).toHaveLength(2);
      expect(pipeline.tags).toEqual(["test", "example"]);
      expect(pipeline.stats.totalRuns).toBe(0);
      expect(pipeline.createdAt).toBeInstanceOf(Date);
    });

    test("creates pipeline with conditional step", () => {
      const input: CreatePipelineInput = {
        name: "Conditional Pipeline",
        trigger: {
          type: "manual",
          config: { type: "manual", config: {} },
        },
        steps: [
          {
            id: "check",
            name: "Check Condition",
            type: "conditional",
            config: {
              type: "conditional",
              config: {
                condition: "${context.shouldProceed} == true",
                thenSteps: ["proceed"],
                elseSteps: ["skip"],
              },
            },
          },
          {
            id: "proceed",
            name: "Proceed",
            type: "script",
            config: { type: "script", config: { script: "echo 'Proceeding'" } },
          },
          {
            id: "skip",
            name: "Skip",
            type: "script",
            config: { type: "script", config: { script: "echo 'Skipping'" } },
          },
        ],
      };

      const pipeline = createPipeline(input);
      expect(pipeline.steps[0]?.type).toBe("conditional");
    });

    test("creates pipeline with parallel steps", () => {
      const input: CreatePipelineInput = {
        name: "Parallel Pipeline",
        trigger: {
          type: "manual",
          config: { type: "manual", config: {} },
        },
        steps: [
          {
            id: "parallel",
            name: "Parallel Execution",
            type: "parallel",
            config: {
              type: "parallel",
              config: {
                steps: ["task1", "task2", "task3"],
                failFast: true,
                maxConcurrency: 2,
              },
            },
          },
          {
            id: "task1",
            name: "Task 1",
            type: "script",
            config: { type: "script", config: { script: "echo '1'" } },
          },
          {
            id: "task2",
            name: "Task 2",
            type: "script",
            config: { type: "script", config: { script: "echo '2'" } },
          },
          {
            id: "task3",
            name: "Task 3",
            type: "script",
            config: { type: "script", config: { script: "echo '3'" } },
          },
        ],
      };

      const pipeline = createPipeline(input);
      expect(pipeline.steps[0]?.type).toBe("parallel");
    });

    test("creates pipeline with approval step", () => {
      const input: CreatePipelineInput = {
        name: "Approval Pipeline",
        trigger: {
          type: "manual",
          config: { type: "manual", config: {} },
        },
        steps: [
          {
            id: "approval",
            name: "Require Approval",
            type: "approval",
            config: {
              type: "approval",
              config: {
                approvers: ["user_123", "user_456"],
                message: "Please approve this action",
                timeout: 3600000,
                onTimeout: "reject",
                minApprovals: 1,
              },
            },
          },
        ],
      };

      const pipeline = createPipeline(input);
      expect(pipeline.steps[0]?.type).toBe("approval");
    });
  });

  describe("getPipeline", () => {
    test("returns pipeline by id", () => {
      const input = createTestPipelineInput();
      const created = createPipeline(input);

      const retrieved = getPipeline(created.id);
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.name).toBe("Test Pipeline");
    });

    test("returns undefined for unknown id", () => {
      const retrieved = getPipeline("pipe_unknown");
      expect(retrieved).toBeUndefined();
    });
  });

  describe("runPipeline", () => {
    async function waitForRunToFinish(
      runId: string,
      timeoutMs = 10_000,
    ): Promise<ReturnType<typeof getRun>> {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const current = getRun(runId);
        if (current && current.status !== "running") return current;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`Timed out waiting for run to finish: ${runId}`);
    }

    test("creates a new run", async () => {
      const input = createTestPipelineInput();
      const pipeline = createPipeline(input);

      const run = await runPipeline(pipeline.id, {
        triggeredBy: { type: "user", id: "user_123" },
        params: { key: "value" },
      });

      expect(run.id).toMatch(/^run_\d+_[a-z0-9]+$/);
      expect(run.pipelineId).toBe(pipeline.id);
      expect(run.status).toBe("running");
      expect(run.triggeredBy.type).toBe("user");
      expect(run.triggerParams).toEqual({ key: "value" });
      expect(run.startedAt).toBeInstanceOf(Date);
    });

    test("executes script paths without shell interpolation (no -c)", async () => {
      const originalSpawn = Bun.spawn;
      const spawnedArgs: string[][] = [];

      Bun.spawn = ((args: string[], options: Record<string, unknown>) => {
        spawnedArgs.push(args);

        const encoder = new TextEncoder();
        const makeStream = () =>
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode(""));
              controller.close();
            },
          });

        const proc = {
          stdout: makeStream(),
          stderr: makeStream(),
          exited: Promise.resolve(0),
          exitCode: 0,
          kill: () => {},
        } as unknown as ReturnType<typeof Bun.spawn>;
        void options;
        return proc;
      }) as typeof Bun.spawn;

      try {
        const input: CreatePipelineInput = {
          name: "Path Script Pipeline",
          trigger: {
            type: "manual",
            config: { type: "manual", config: {} },
            enabled: true,
          },
          steps: [
            {
              id: "run_file",
              name: "Run script file",
              type: "script",
              config: {
                type: "script",
                config: {
                  script: "/tmp/test-script.sh",
                  isPath: true,
                  shell: "bash",
                },
              },
            },
          ],
        };

        const pipeline = createPipeline(input);
        const run = await runPipeline(pipeline.id);

        const finished = await waitForRunToFinish(run.id);
        expect(finished?.status).toBe("completed");

        expect(spawnedArgs.length).toBe(1);
        expect(spawnedArgs[0]).toEqual(["bash", "--", "/tmp/test-script.sh"]);
      } finally {
        Bun.spawn = originalSpawn;
      }
    });

    test("throws for unknown pipeline", async () => {
      await expect(runPipeline("pipe_unknown")).rejects.toThrow("not found");
    });

    test("throws for disabled pipeline", async () => {
      const input = createTestPipelineInput();
      const pipeline = createPipeline(input);
      pipeline.enabled = false;

      await expect(runPipeline(pipeline.id)).rejects.toThrow("disabled");
    });

    test("executes transform expressions without eval/new Function", async () => {
      const input: CreatePipelineInput = {
        name: "Transform Pipeline",
        trigger: {
          type: "manual",
          config: { type: "manual", config: {} },
          enabled: true,
        },
        steps: [
          {
            id: "transform",
            name: "Transform",
            type: "transform",
            config: {
              type: "transform",
              config: {
                operations: [
                  {
                    op: "map",
                    source: "items",
                    expression: "$item.value",
                    target: "values",
                  },
                  {
                    op: "filter",
                    source: "items",
                    condition: "$item.value > 1",
                    target: "filtered",
                  },
                  {
                    op: "reduce",
                    source: "values",
                    expression: "$acc + $item",
                    initial: 0,
                    target: "sum",
                  },
                ],
                outputVariable: "out",
              },
            },
          },
        ],
      };

      const pipeline = createPipeline(input);
      const run = await runPipeline(pipeline.id, {
        params: { items: [{ value: 1 }, { value: 2 }, { value: 3 }] },
      });

      const finished = await waitForRunToFinish(run.id);
      expect(finished?.status).toBe("completed");
      expect(finished?.context["values"]).toEqual([1, 2, 3]);
      expect(finished?.context["filtered"]).toEqual([
        { value: 2 },
        { value: 3 },
      ]);
      expect(finished?.context["sum"]).toBe(6);
    });

    test("blocks prototype-pollution paths in transform operations", async () => {
      const input: CreatePipelineInput = {
        name: "Unsafe Path Pipeline",
        retryPolicy: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
        trigger: {
          type: "manual",
          config: { type: "manual", config: {} },
          enabled: true,
        },
        steps: [
          {
            id: "transform",
            name: "Transform",
            type: "transform",
            config: {
              type: "transform",
              config: {
                operations: [
                  { op: "set", path: "__proto__.polluted", value: "yes" },
                ],
                outputVariable: "out",
              },
            },
          },
        ],
      };

      const pipeline = createPipeline(input);
      const run = await runPipeline(pipeline.id);

      const finished = await waitForRunToFinish(run.id);
      expect(finished?.status).toBe("failed");
      expect(finished?.error?.message).toContain("Unsafe path");
    });

    test("handles null intermediate values in transform paths", async () => {
      const input: CreatePipelineInput = {
        name: "Null Path Pipeline",
        trigger: {
          type: "manual",
          config: { type: "manual", config: {} },
          enabled: true,
        },
        contextDefaults: { foo: null },
        steps: [
          {
            id: "transform",
            name: "Transform",
            type: "transform",
            config: {
              type: "transform",
              config: {
                operations: [{ op: "set", path: "foo.bar", value: 123 }],
                outputVariable: "out",
              },
            },
          },
        ],
      };

      const pipeline = createPipeline(input);
      const run = await runPipeline(pipeline.id);

      const finished = await waitForRunToFinish(run.id);
      expect(finished?.status).toBe("completed");
      expect(finished?.context["foo"]).toEqual({ bar: 123 });
    });
  });

  describe("pauseRun", () => {
    test("pauses a running pipeline", async () => {
      const input = createTestPipelineInput();
      const pipeline = createPipeline(input);
      const run = await runPipeline(pipeline.id);

      const paused = pauseRun(run.id);
      expect(paused?.status).toBe("paused");
    });

    test("returns undefined for non-running pipeline", () => {
      const result = pauseRun("run_unknown");
      expect(result).toBeUndefined();
    });
  });

  describe("cancelRun", () => {
    test("cancels a running pipeline", async () => {
      const input = createTestPipelineInput();
      const pipeline = createPipeline(input);
      const run = await runPipeline(pipeline.id);

      const cancelled = cancelRun(run.id);
      expect(cancelled?.status).toBe("cancelled");
      expect(cancelled?.completedAt).toBeInstanceOf(Date);
    });

    test("cancels a running script by killing the subprocess", async () => {
      const originalSpawn = Bun.spawn;

      let killCalled = false;
      let spawnCalled = false;
      let resolveExited: (code: number) => void;

      Bun.spawn = ((args: string[], options: Record<string, unknown>) => {
        spawnCalled = true;

        const encoder = new TextEncoder();
        const makeStream = () =>
          new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode(""));
              controller.close();
            },
          });

        let proc:
          | (ReturnType<typeof Bun.spawn> & {
              kill: () => void;
              exitCode: number | null;
            })
          | undefined;

        const exited = new Promise<number>((resolve) => {
          resolveExited = resolve;
        });

        proc = {
          stdout: makeStream(),
          stderr: makeStream(),
          exited,
          exitCode: null,
          kill: () => {
            killCalled = true;
            proc!.exitCode = 143;
            resolveExited(143);
          },
        } as unknown as ReturnType<typeof Bun.spawn>;
        void options;
        void args;
        return proc;
      }) as typeof Bun.spawn;

      try {
        const input: CreatePipelineInput = {
          name: "Cancellable Script Pipeline",
          trigger: {
            type: "manual",
            config: { type: "manual", config: {} },
            enabled: true,
          },
          steps: [
            {
              id: "long_script",
              name: "Long script",
              type: "script",
              config: {
                type: "script",
                config: { script: "echo 'hang'", timeout: 60_000 },
              },
            },
          ],
        };

        const pipeline = createPipeline(input);
        const run = await runPipeline(pipeline.id);

        // Wait for the subprocess to start so the abort handler can kill it.
        const start = Date.now();
        while (!spawnCalled && Date.now() - start < 1000) {
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
        expect(spawnCalled).toBe(true);

        // Yield once so executeScript can register the abort listener.
        await new Promise((resolve) => setTimeout(resolve, 0));

        cancelRun(run.id);

        // Abort dispatch is synchronous in practice, but poll to avoid flakiness.
        const killStart = Date.now();
        while (!killCalled && Date.now() - killStart < 1000) {
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
        expect(killCalled).toBe(true);
      } finally {
        Bun.spawn = originalSpawn;
      }
    });
  });
});

// ============================================================================
// Route Tests
// ============================================================================

describe("Pipeline Routes", () => {
  describe("GET /pipelines", () => {
    test("returns empty list initially", async () => {
      const res = await app.request("/pipelines");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toHaveLength(0);
      expect(body.total).toBe(0);
    });

    test("returns pipelines", async () => {
      createPipeline(createTestPipelineInput());
      createPipeline({
        ...createTestPipelineInput(),
        name: "Another Pipeline",
      });

      const res = await app.request("/pipelines");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toHaveLength(2);
      expect(body.total).toBe(2);
    });

    test("filters by tags", async () => {
      createPipeline({ ...createTestPipelineInput(), tags: ["api"] });
      createPipeline({ ...createTestPipelineInput(), tags: ["ui"] });

      const res = await app.request("/pipelines?tags=api");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].tags).toContain("api");
    });

    test("filters by enabled status", async () => {
      const p1 = createPipeline(createTestPipelineInput());
      const p2 = createPipeline(createTestPipelineInput());
      p2.enabled = false;

      const res = await app.request("/pipelines?enabled=true");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].id).toBe(p1.id);
    });

    test("searches by name", async () => {
      createPipeline({ ...createTestPipelineInput(), name: "Build Pipeline" });
      createPipeline({ ...createTestPipelineInput(), name: "Deploy Pipeline" });

      const res = await app.request("/pipelines?search=Build");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].name).toBe("Build Pipeline");
    });
  });

  describe("POST /pipelines", () => {
    test("creates a new pipeline", async () => {
      const input = createTestPipelineInput();

      const res = await app.request("/pipelines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.name).toBe("Test Pipeline");
      expect(body.data.steps).toHaveLength(2);
    });

    test("validates request body", async () => {
      const res = await app.request("/pipelines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "" }), // Invalid: empty name
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_FAILED");
    });

    test("rejects unsafe transform expressions", async () => {
      const input: CreatePipelineInput = {
        name: "Unsafe Transform Pipeline",
        trigger: {
          type: "manual",
          config: { type: "manual", config: {} },
          enabled: true,
        },
        steps: [
          {
            id: "transform",
            name: "Transform",
            type: "transform",
            config: {
              type: "transform",
              config: {
                operations: [
                  {
                    op: "map",
                    source: "items",
                    expression: "$item.constructor.constructor('return 1')()",
                    target: "values",
                  },
                ],
                outputVariable: "out",
              },
            },
          },
        ],
      };

      const res = await app.request("/pipelines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_FAILED");
    });
  });

  describe("GET /pipelines/:id", () => {
    test("returns pipeline by id", async () => {
      const pipeline = createPipeline(createTestPipelineInput());

      const res = await app.request(`/pipelines/${pipeline.id}`);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.id).toBe(pipeline.id);
    });

    test("returns 404 for unknown id", async () => {
      const res = await app.request("/pipelines/pipe_unknown");

      expect(res.status).toBe(404);
    });
  });

  describe("PUT /pipelines/:id", () => {
    test("updates pipeline", async () => {
      const pipeline = createPipeline(createTestPipelineInput());

      const res = await app.request(`/pipelines/${pipeline.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Updated Pipeline",
          enabled: false,
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.name).toBe("Updated Pipeline");
      expect(body.data.enabled).toBe(false);
      expect(body.data.version).toBe(2);
    });

    test("returns 404 for unknown id", async () => {
      const res = await app.request("/pipelines/pipe_unknown", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Updated" }),
      });

      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /pipelines/:id", () => {
    test("deletes pipeline", async () => {
      const pipeline = createPipeline(createTestPipelineInput());

      const res = await app.request(`/pipelines/${pipeline.id}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.deleted).toBe(true);

      // Verify deleted
      expect(getPipeline(pipeline.id)).toBeUndefined();
    });

    test("returns 404 for unknown id", async () => {
      const res = await app.request("/pipelines/pipe_unknown", {
        method: "DELETE",
      });

      expect(res.status).toBe(404);
    });
  });

  describe("POST /pipelines/:id/run", () => {
    test("starts a pipeline run", async () => {
      const pipeline = createPipeline(createTestPipelineInput());

      const res = await app.request(
        `/pipelines/${pipeline.id}/run?user_id=user_123`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ params: { env: "test" } }),
        },
      );

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.pipelineId).toBe(pipeline.id);
      expect(body.data.status).toBe("running");
      expect(body.data.triggeredBy.type).toBe("user");
    });

    test("returns 400 for invalid JSON body", async () => {
      const pipeline = createPipeline(createTestPipelineInput());

      const res = await app.request(`/pipelines/${pipeline.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{invalid-json",
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("INVALID_REQUEST");
    });

    test("returns 404 for unknown pipeline", async () => {
      const res = await app.request("/pipelines/pipe_unknown/run", {
        method: "POST",
      });

      expect(res.status).toBe(404);
    });

    test("returns 400 for disabled pipeline", async () => {
      const pipeline = createPipeline(createTestPipelineInput());
      pipeline.enabled = false;

      const res = await app.request(`/pipelines/${pipeline.id}/run`, {
        method: "POST",
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("PIPELINE_DISABLED");
    });
  });

  describe("POST /pipelines/:id/pause", () => {
    test("pauses a running pipeline", async () => {
      const pipeline = createPipeline(createTestPipelineInput());
      const run = await runPipeline(pipeline.id);

      const res = await app.request(
        `/pipelines/${pipeline.id}/pause?run_id=${run.id}`,
        { method: "POST" },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.status).toBe("paused");
    });

    test("requires run_id parameter", async () => {
      const pipeline = createPipeline(createTestPipelineInput());

      const res = await app.request(`/pipelines/${pipeline.id}/pause`, {
        method: "POST",
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("INVALID_REQUEST");
    });
  });

  describe("POST /pipelines/:id/cancel", () => {
    test("cancels a running pipeline", async () => {
      const pipeline = createPipeline(createTestPipelineInput());
      const run = await runPipeline(pipeline.id);

      const res = await app.request(
        `/pipelines/${pipeline.id}/cancel?run_id=${run.id}`,
        { method: "POST" },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.status).toBe("cancelled");
    });
  });

  describe("GET /pipelines/:id/runs", () => {
    test("returns run history", async () => {
      const pipeline = createPipeline(createTestPipelineInput());
      await runPipeline(pipeline.id);
      await runPipeline(pipeline.id);

      const res = await app.request(`/pipelines/${pipeline.id}/runs`);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toHaveLength(2);
    });

    test("filters by status", async () => {
      const pipeline = createPipeline(createTestPipelineInput());
      const run1 = await runPipeline(pipeline.id);
      await runPipeline(pipeline.id);

      cancelRun(run1.id);

      const res = await app.request(
        `/pipelines/${pipeline.id}/runs?status=cancelled`,
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].status).toBe("cancelled");
    });

    test("returns 404 for unknown pipeline", async () => {
      const res = await app.request("/pipelines/pipe_unknown/runs");

      expect(res.status).toBe(404);
    });
  });

  describe("GET /pipelines/:id/runs/:runId", () => {
    test("returns run details with steps", async () => {
      const pipeline = createPipeline(createTestPipelineInput());
      const run = await runPipeline(pipeline.id);

      const res = await app.request(`/pipelines/${pipeline.id}/runs/${run.id}`);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.id).toBe(run.id);
      expect(body.data.steps).toBeDefined();
      expect(body.data.steps).toHaveLength(2);
    });

    test("returns 404 for unknown run", async () => {
      const pipeline = createPipeline(createTestPipelineInput());

      const res = await app.request(
        `/pipelines/${pipeline.id}/runs/run_unknown`,
      );

      expect(res.status).toBe(404);
    });
  });

  describe("POST /pipelines/:id/runs/:runId/approve", () => {
    test("requires step_id parameter", async () => {
      const pipeline = createPipeline(createTestPipelineInput());
      const run = await runPipeline(pipeline.id);

      const res = await app.request(
        `/pipelines/${pipeline.id}/runs/${run.id}/approve?user_id=user_123`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision: "approved" }),
        },
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain("step_id");
    });

    test("requires user_id parameter", async () => {
      const pipeline = createPipeline(createTestPipelineInput());
      const run = await runPipeline(pipeline.id);

      const res = await app.request(
        `/pipelines/${pipeline.id}/runs/${run.id}/approve?step_id=step1`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision: "approved" }),
        },
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain("user_id");
    });

    test("validates decision", async () => {
      const pipeline = createPipeline(createTestPipelineInput());
      const run = await runPipeline(pipeline.id);

      const res = await app.request(
        `/pipelines/${pipeline.id}/runs/${run.id}/approve?step_id=step1&user_id=user_123`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision: "invalid" }),
        },
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_FAILED");
    });
  });
});

// ============================================================================
// Step Execution Tests
// ============================================================================

describe("Step Execution", () => {
  test("sequential steps run in order", async () => {
    const input: CreatePipelineInput = {
      name: "Sequential",
      trigger: { type: "manual", config: { type: "manual", config: {} } },
      steps: [
        {
          id: "step1",
          name: "Step 1",
          type: "script",
          config: { type: "script", config: { script: "echo '1'" } },
        },
        {
          id: "step2",
          name: "Step 2",
          type: "script",
          config: { type: "script", config: { script: "echo '2'" } },
          dependsOn: ["step1"],
        },
        {
          id: "step3",
          name: "Step 3",
          type: "script",
          config: { type: "script", config: { script: "echo '3'" } },
          dependsOn: ["step2"],
        },
      ],
    };

    const pipeline = createPipeline(input);
    const run = await runPipeline(pipeline.id);

    expect(run.status).toBe("running");
    expect(pipeline.steps[0]?.dependsOn).toBeUndefined();
    expect(pipeline.steps[1]?.dependsOn).toEqual(["step1"]);
    expect(pipeline.steps[2]?.dependsOn).toEqual(["step2"]);
  });

  test("pipeline with context defaults", async () => {
    const input: CreatePipelineInput = {
      name: "Context Pipeline",
      trigger: { type: "manual", config: { type: "manual", config: {} } },
      steps: [
        {
          id: "step1",
          name: "Step 1",
          type: "script",
          config: {
            type: "script",
            config: { script: "echo ${PIPELINE_MESSAGE}" },
          },
        },
      ],
      contextDefaults: { message: "Hello from context" },
    };

    const pipeline = createPipeline(input);
    expect(pipeline.contextDefaults?.["message"]).toBe("Hello from context");

    const run = await runPipeline(pipeline.id, {
      params: { extra: "value" },
    });

    expect(run.context["message"]).toBe("Hello from context");
    expect(run.context["extra"]).toBe("value");
  });

  test("pipeline with retry policy", async () => {
    const input: CreatePipelineInput = {
      name: "Retry Pipeline",
      trigger: { type: "manual", config: { type: "manual", config: {} } },
      steps: [
        {
          id: "step1",
          name: "Step 1",
          type: "script",
          config: { type: "script", config: { script: "exit 0" } },
          retryPolicy: {
            maxRetries: 3,
            initialDelay: 100,
            maxDelay: 1000,
            multiplier: 2,
          },
        },
      ],
      retryPolicy: {
        maxRetries: 2,
        initialDelay: 50,
        maxDelay: 500,
      },
    };

    const pipeline = createPipeline(input);
    expect(pipeline.retryPolicy?.maxRetries).toBe(2);
    expect(pipeline.steps[0]?.retryPolicy?.maxRetries).toBe(3);
  });

  test("conditional step with condition", async () => {
    const input: CreatePipelineInput = {
      name: "Conditional",
      trigger: { type: "manual", config: { type: "manual", config: {} } },
      steps: [
        {
          id: "optional",
          name: "Optional Step",
          type: "script",
          config: { type: "script", config: { script: "echo 'Optional'" } },
          condition: "${context.runOptional} == true",
        },
      ],
    };

    const pipeline = createPipeline(input);
    expect(pipeline.steps[0]?.condition).toBe("${context.runOptional} == true");
  });

  test("step with continueOnFailure", async () => {
    const input: CreatePipelineInput = {
      name: "Continue Pipeline",
      trigger: { type: "manual", config: { type: "manual", config: {} } },
      steps: [
        {
          id: "step1",
          name: "May Fail",
          type: "script",
          config: { type: "script", config: { script: "exit 1" } },
          continueOnFailure: true,
        },
        {
          id: "step2",
          name: "Always Run",
          type: "script",
          config: { type: "script", config: { script: "echo 'Done'" } },
        },
      ],
    };

    const pipeline = createPipeline(input);
    expect(pipeline.steps[0]?.continueOnFailure).toBe(true);
  });
});

// ============================================================================
// Trigger Tests
// ============================================================================

describe("Pipeline Triggers", () => {
  test("schedule trigger", () => {
    const input: CreatePipelineInput = {
      name: "Scheduled",
      trigger: {
        type: "schedule",
        config: {
          type: "schedule",
          config: {
            cron: "0 0 * * *",
            timezone: "America/New_York",
          },
        },
      },
      steps: [
        {
          id: "step1",
          name: "Step",
          type: "script",
          config: { type: "script", config: { script: "echo 'Scheduled'" } },
        },
      ],
    };

    const pipeline = createPipeline(input);
    expect(pipeline.trigger.type).toBe("schedule");
    const config = pipeline.trigger.config as {
      type: "schedule";
      config: { cron: string };
    };
    expect(config.config.cron).toBe("0 0 * * *");
  });

  test("webhook trigger", () => {
    const webhookSecret =
      process.env["TEST_WEBHOOK_SECRET"] ?? crypto.randomUUID();
    const input: CreatePipelineInput = {
      name: "Webhook",
      trigger: {
        type: "webhook",
        config: {
          type: "webhook",
          config: {
            secret: webhookSecret,
            expectedHeaders: { "X-Custom-Header": "value" },
          },
        },
      },
      steps: [
        {
          id: "step1",
          name: "Step",
          type: "script",
          config: { type: "script", config: { script: "echo 'Webhook'" } },
        },
      ],
    };

    const pipeline = createPipeline(input);
    expect(pipeline.trigger.type).toBe("webhook");
  });

  test("bead_event trigger", () => {
    const input: CreatePipelineInput = {
      name: "Bead Event",
      trigger: {
        type: "bead_event",
        config: {
          type: "bead_event",
          config: {
            events: ["created", "closed"],
            beadType: ["bug", "feature"],
            beadPriority: [0, 1],
          },
        },
      },
      steps: [
        {
          id: "step1",
          name: "Step",
          type: "script",
          config: { type: "script", config: { script: "echo 'Bead event'" } },
        },
      ],
    };

    const pipeline = createPipeline(input);
    expect(pipeline.trigger.type).toBe("bead_event");
    const config = pipeline.trigger.config as {
      type: "bead_event";
      config: { events: string[] };
    };
    expect(config.config.events).toContain("created");
  });
});
