import { describe, expect, it } from "bun:test";
import { z } from "zod";
import { defineCommand } from "../define";
import { createCommandRegistry, validateRegistry } from "../registry";

describe("createCommandRegistry", () => {
  const spawnCmd = defineCommand({
    name: "agent.spawn",
    description: "Spawn a new agent",
    input: z.object({ repoUrl: z.string() }),
    output: z.object({ agentId: z.string() }),
    rest: { method: "POST" as const, path: "/agents" },
    metadata: { permissions: ["agent:write"] },
    aiHints: {
      whenToUse: "Start a new agent",
      examples: ["Spawn an agent"],
      relatedCommands: ["agent.stop"],
    },
  });

  const stopCmd = defineCommand({
    name: "agent.stop",
    description: "Stop an agent",
    input: z.object({ agentId: z.string() }),
    output: z.object({ success: z.boolean() }),
    rest: { method: "DELETE" as const, path: "/agents/:agentId" },
    metadata: { permissions: ["agent:delete"] },
    aiHints: {
      whenToUse: "Stop a running agent",
      examples: ["Stop the agent"],
      relatedCommands: ["agent.spawn"],
    },
  });

  const checkpointCmd = defineCommand({
    name: "checkpoint.create",
    description: "Create a checkpoint",
    input: z.object({ agentId: z.string() }),
    output: z.object({ checkpointId: z.string() }),
    rest: { method: "POST" as const, path: "/agents/:agentId/checkpoints" },
    metadata: { permissions: ["checkpoint:write"] },
    aiHints: {
      whenToUse: "Save agent state",
      examples: ["Create a checkpoint"],
      relatedCommands: [],
    },
  });

  it("registers commands by name", () => {
    const registry = createCommandRegistry([spawnCmd, stopCmd]);
    expect(registry.get("agent.spawn")).toBe(spawnCmd);
    expect(registry.get("agent.stop")).toBe(stopCmd);
  });

  it("returns undefined for non-existent commands", () => {
    const registry = createCommandRegistry([spawnCmd]);
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("checks if command exists", () => {
    const registry = createCommandRegistry([spawnCmd]);
    expect(registry.has("agent.spawn")).toBe(true);
    expect(registry.has("nonexistent")).toBe(false);
  });

  it("lists all commands", () => {
    const registry = createCommandRegistry([spawnCmd, stopCmd, checkpointCmd]);
    expect(registry.all()).toHaveLength(3);
  });

  it("groups commands by category", () => {
    const registry = createCommandRegistry([spawnCmd, stopCmd, checkpointCmd]);
    const agentCmds = registry.byCategory("agent");
    expect(agentCmds).toHaveLength(2);
    expect(agentCmds.map((c) => c.name)).toContain("agent.spawn");
    expect(agentCmds.map((c) => c.name)).toContain("agent.stop");
  });

  it("lists all categories", () => {
    const registry = createCommandRegistry([spawnCmd, stopCmd, checkpointCmd]);
    const categories = registry.categories();
    expect(categories).toContain("agent");
    expect(categories).toContain("checkpoint");
  });

  it("reports correct size", () => {
    const registry = createCommandRegistry([spawnCmd, stopCmd]);
    expect(registry.size).toBe(2);
  });

  it("rejects duplicate command names", () => {
    expect(() => createCommandRegistry([spawnCmd, spawnCmd])).toThrow(
      "Duplicate command name",
    );
  });

  it("detects REST path conflicts", () => {
    const conflictingCmd = defineCommand({
      name: "agent.create",
      description: "Create a new agent (conflicts with spawn)",
      input: z.object({ repoUrl: z.string() }),
      output: z.object({ agentId: z.string() }),
      rest: { method: "POST" as const, path: "/agents" }, // Same path as spawnCmd
      metadata: { permissions: ["agent:write"] },
      aiHints: {
        whenToUse: "Create an agent",
        examples: ["Create an agent"],
        relatedCommands: [],
      },
    });
    expect(() => createCommandRegistry([spawnCmd, conflictingCmd])).toThrow(
      "REST path conflict",
    );
  });
});

describe("validateRegistry", () => {
  const validCmd = defineCommand({
    name: "agent.spawn",
    description: "Spawn a new agent",
    input: z.object({ repoUrl: z.string() }),
    output: z.object({ agentId: z.string() }),
    rest: { method: "POST" as const, path: "/agents" },
    metadata: { permissions: ["agent:write"] },
    aiHints: {
      whenToUse: "Start a new agent",
      examples: ["Spawn an agent"],
      relatedCommands: [],
    },
  });

  it("validates a correct registry", () => {
    const registry = createCommandRegistry([validCmd]);
    const result = validateRegistry(registry);
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("flags commands without permissions", () => {
    const noPermsCmd = defineCommand({
      name: "agent.list",
      description: "List agents",
      input: z.object({}),
      output: z.object({ agents: z.array(z.string()) }),
      rest: { method: "GET" as const, path: "/agents/list" },
      metadata: { permissions: [] },
      aiHints: {
        whenToUse: "List agents",
        examples: ["List all agents"],
        relatedCommands: [],
      },
    });
    const registry = createCommandRegistry([noPermsCmd]);
    const result = validateRegistry(registry);
    expect(result.issues.some((i) => i.includes("no permissions"))).toBe(true);
  });

  it("flags missing related commands", () => {
    const cmdWithMissingRelated = defineCommand({
      name: "agent.spawn",
      description: "Spawn agent",
      input: z.object({ repoUrl: z.string() }),
      output: z.object({ agentId: z.string() }),
      rest: { method: "POST" as const, path: "/agents" },
      metadata: { permissions: ["agent:write"] },
      aiHints: {
        whenToUse: "Start a new agent",
        examples: ["Spawn an agent"],
        relatedCommands: ["nonexistent.command"],
      },
    });
    const registry = createCommandRegistry([cmdWithMissingRelated]);
    const result = validateRegistry(registry);
    expect(
      result.issues.some((i) => i.includes("unknown related command")),
    ).toBe(true);
  });
});
