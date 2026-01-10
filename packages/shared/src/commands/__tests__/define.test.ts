import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { defineCommand } from "../define";

describe("defineCommand", () => {
  const validInput = {
    name: "agent.spawn",
    description: "Spawn a new agent",
    input: z.object({ repoUrl: z.string().url(), task: z.string() }),
    output: z.object({ agentId: z.string() }),
    rest: { method: "POST" as const, path: "/agents" },
    metadata: { permissions: ["agent:write"], audit: true },
    aiHints: {
      whenToUse: "Use when starting a new agent to work on a task",
      examples: ["Spawn an agent to fix the login bug"],
      relatedCommands: ["agent.stop", "agent.status"],
    },
  };

  it("returns a valid CommandDefinition", () => {
    const cmd = defineCommand(validInput);
    expect(cmd.name).toBe("agent.spawn");
    expect(cmd.description).toBe("Spawn a new agent");
    expect(cmd.category).toBe("agent");
  });

  it("extracts path parameters correctly", () => {
    const cmd = defineCommand({
      ...validInput,
      name: "agent.get",
      rest: {
        method: "GET" as const,
        path: "/agents/:agentId/output/:chunkId",
      },
    });
    expect(cmd.pathParams).toEqual(["agentId", "chunkId"]);
  });

  it("extracts category from command name", () => {
    const cmd = defineCommand(validInput);
    expect(cmd.category).toBe("agent");

    const cmd2 = defineCommand({
      ...validInput,
      name: "checkpoint.create",
    });
    expect(cmd2.category).toBe("checkpoint");
  });

  it("validates required fields", () => {
    expect(() =>
      defineCommand({
        ...validInput,
        name: "invalid name with spaces",
      }),
    ).toThrow("Invalid command name");
  });

  it("requires REST path to start with /", () => {
    expect(() =>
      defineCommand({
        ...validInput,
        rest: { method: "POST" as const, path: "agents" },
      }),
    ).toThrow('Must start with "/"');
  });

  it("rejects DELETE commands marked as safe", () => {
    expect(() =>
      defineCommand({
        ...validInput,
        rest: { method: "DELETE" as const, path: "/agents/:agentId" },
        metadata: { permissions: ["agent:delete"], safe: true },
      }),
    ).toThrow("DELETE operation and cannot be marked as safe");
  });

  it("requires non-empty whenToUse hint", () => {
    expect(() =>
      defineCommand({
        ...validInput,
        aiHints: {
          ...validInput.aiHints,
          whenToUse: "",
        },
      }),
    ).toThrow("non-empty whenToUse");
  });

  it("requires at least one example", () => {
    expect(() =>
      defineCommand({
        ...validInput,
        aiHints: {
          ...validInput.aiHints,
          examples: [],
        },
      }),
    ).toThrow("at least one example");
  });

  it("handles commands without WebSocket binding", () => {
    const cmd = defineCommand(validInput);
    expect(cmd.ws).toBeUndefined();
  });

  it("includes WebSocket binding when provided", () => {
    const cmd = defineCommand({
      ...validInput,
      ws: { emitsEvents: ["agent:spawned"], subscribable: true },
    });
    expect(cmd.ws).toEqual({
      emitsEvents: ["agent:spawned"],
      subscribable: true,
    });
  });
});
