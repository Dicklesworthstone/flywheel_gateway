/**
 * Pipeline Templates Library & Agent Preset Templates Service (bd-2hv7t, bd-fpdig)
 *
 * Provides:
 * 1. Pipeline Templates Library (bd-2hv7t):
 *    - Built-in reusable pipeline patterns across CI/CD, Refactoring, and Quality categories
 *    - Variable substitution + instantiation into concrete pipeline configs
 *    - JSON import/export for team sharing
 * 2. Agent Template System with Preset Profiles (bd-fpdig):
 *    - Built-in preset agent profiles across refactoring, testing, documentation, and debugging
 *    - One-click preset instantiation with overrides + usage count tracking
 */

import { ulid } from "ulid";
import { z } from "zod";

// ============================================================================
// Pipeline Templates Library (bd-2hv7t)
// ============================================================================

export const PipelineTemplateCategorySchema = z.enum([
  "ci_cd",
  "refactoring",
  "quality",
  "custom",
]);

export const TemplateVariableSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  required: z.boolean().default(true),
  defaultValue: z.string().optional(),
});

export const TemplateStepSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(["script", "agent", "conditional", "approval", "parallel"]),
  commandOrPrompt: z.string().min(1),
});

export const CreatePipelineTemplateSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(120),
  description: z.string().max(500).default(""),
  category: PipelineTemplateCategorySchema.default("custom"),
  version: z.string().default("1.0.0"),
  author: z.string().default("flywheel"),
  variables: z.array(TemplateVariableSchema).default([]),
  steps: z.array(TemplateStepSchema).min(1),
});

export type PipelineTemplate = z.infer<typeof CreatePipelineTemplateSchema> & {
  id: string;
  builtIn: boolean;
  createdAt: string;
};

const BUILT_IN_PIPELINE_TEMPLATES: PipelineTemplate[] = [
  {
    id: "tpl_pipe_build_test_deploy",
    name: "Build -> Test -> Deploy",
    description: "Standard CI/CD verification and deployment pipeline",
    category: "ci_cd",
    version: "1.0.0",
    author: "flywheel",
    builtIn: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    variables: [
      {
        name: "TARGET_ENV",
        description: "Deployment environment",
        required: true,
        defaultValue: "staging",
      },
    ],
    steps: [
      {
        id: "step_typecheck",
        name: "Typecheck & Lint",
        type: "script",
        commandOrPrompt: "bun typecheck && bun lint",
      },
      {
        id: "step_test",
        name: "Run Unit & Integration Tests",
        type: "script",
        commandOrPrompt: "bun test",
      },
      {
        id: "step_deploy",
        name: "Deploy to Environment",
        type: "script",
        commandOrPrompt: "deploy --env {{TARGET_ENV}}",
      },
    ],
  },
  {
    id: "tpl_pipe_multifile_refactor",
    name: "Multi-file Refactor with Tests",
    description:
      "Agent-driven multi-file refactoring guarded by test verification",
    category: "refactoring",
    version: "1.0.0",
    author: "flywheel",
    builtIn: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    variables: [
      {
        name: "MODULE_PATH",
        description: "Target module directory",
        required: true,
      },
    ],
    steps: [
      {
        id: "step_refactor",
        name: "Refactor Target Module",
        type: "agent",
        commandOrPrompt:
          "Refactor {{MODULE_PATH}} while preserving public exports",
      },
      {
        id: "step_verify",
        name: "Verify Module Tests",
        type: "script",
        commandOrPrompt: "bun test {{MODULE_PATH}}",
      },
    ],
  },
  {
    id: "tpl_pipe_coverage_boost",
    name: "Test Coverage Improvement",
    description: "Identify uncovered paths and generate unit tests",
    category: "quality",
    version: "1.0.0",
    author: "flywheel",
    builtIn: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    variables: [
      {
        name: "SERVICE_NAME",
        description: "Service to test",
        required: true,
      },
    ],
    steps: [
      {
        id: "step_gen_tests",
        name: "Generate Unit Tests",
        type: "agent",
        commandOrPrompt: "Write unit tests for {{SERVICE_NAME}} edge cases",
      },
    ],
  },
];

// ============================================================================
// Agent Template System with Preset Profiles (bd-fpdig)
// ============================================================================

export const AgentTemplateCategorySchema = z.enum([
  "refactoring",
  "testing",
  "documentation",
  "debugging",
  "general",
  "custom",
]);

export const CreateAgentTemplateSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1).max(120),
  description: z.string().max(500).default(""),
  category: AgentTemplateCategorySchema.default("custom"),
  agentType: z.enum(["claude", "codex", "gemini"]).default("claude"),
  modelConfig: z.object({
    model: z.string().min(1),
    temperature: z.number().min(0).max(2).default(0.2),
    maxTokens: z.number().int().positive().default(8192),
  }),
  contextConfig: z
    .object({
      maxContextTokens: z.number().int().positive().default(200_000),
      rotationStrategy: z
        .enum(["sliding", "checkpoint", "summarize"])
        .default("checkpoint"),
    })
    .default({ maxContextTokens: 200_000, rotationStrategy: "checkpoint" }),
  safetyConfig: z
    .object({
      ruleSet: z.string().default("standard-dcg"),
      budgetLimit: z.number().positive().optional(),
      maxCostPerSession: z.number().positive().optional(),
    })
    .default({ ruleSet: "standard-dcg" }),
  toolPermissions: z
    .array(z.string())
    .default(["view_file", "replace_file_content", "run_command"]),
  environmentHints: z
    .object({
      recommendedFor: z.array(z.string()).optional(),
      notRecommendedFor: z.array(z.string()).optional(),
    })
    .optional(),
});

export type AgentTemplate = z.infer<typeof CreateAgentTemplateSchema> & {
  id: string;
  isBuiltIn: boolean;
  usageCount: number;
  createdAt: string;
};

const BUILT_IN_AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: "agt_tpl_refactor",
    name: "Deep TypeScript Refactorer",
    description:
      "Preset profile optimized for multi-file TypeScript/Bun refactoring",
    category: "refactoring",
    agentType: "claude",
    modelConfig: {
      model: "claude-3-7-sonnet",
      temperature: 0.1,
      maxTokens: 16_384,
    },
    contextConfig: {
      maxContextTokens: 200_000,
      rotationStrategy: "checkpoint",
    },
    safetyConfig: {
      ruleSet: "strict-dcg",
      maxCostPerSession: 15,
    },
    toolPermissions: [
      "view_file",
      "replace_file_content",
      "write_to_file",
      "run_command",
    ],
    environmentHints: {
      recommendedFor: ["typescript", "bun", "monorepo"],
    },
    isBuiltIn: true,
    usageCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "agt_tpl_testing",
    name: "Unit & Integration Test Specialist",
    description:
      "Preset profile for high-coverage unit and contract test authoring",
    category: "testing",
    agentType: "claude",
    modelConfig: {
      model: "claude-3-7-sonnet",
      temperature: 0.2,
      maxTokens: 8192,
    },
    contextConfig: {
      maxContextTokens: 150_000,
      rotationStrategy: "sliding",
    },
    safetyConfig: {
      ruleSet: "standard-dcg",
      maxCostPerSession: 10,
    },
    toolPermissions: ["view_file", "write_to_file", "run_command"],
    isBuiltIn: true,
    usageCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "agt_tpl_debugger",
    name: "Root-Cause Debugger",
    description:
      "Preset profile for root-cause analysis and race condition debugging",
    category: "debugging",
    agentType: "claude",
    modelConfig: {
      model: "claude-3-7-sonnet",
      temperature: 0,
      maxTokens: 12_000,
    },
    contextConfig: {
      maxContextTokens: 200_000,
      rotationStrategy: "summarize",
    },
    safetyConfig: {
      ruleSet: "standard-dcg",
      maxCostPerSession: 12,
    },
    toolPermissions: ["view_file", "replace_file_content", "run_command"],
    isBuiltIn: true,
    usageCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

// ============================================================================
// State Stores & Operations
// ============================================================================

const pipelineTemplatesStore = new Map<string, PipelineTemplate>();
const agentTemplatesStore = new Map<string, AgentTemplate>();

function ensureBuiltIns(): void {
  if (pipelineTemplatesStore.size === 0) {
    for (const t of BUILT_IN_PIPELINE_TEMPLATES) {
      pipelineTemplatesStore.set(t.id, structuredClone(t));
    }
  }
  if (agentTemplatesStore.size === 0) {
    for (const a of BUILT_IN_AGENT_TEMPLATES) {
      agentTemplatesStore.set(a.id, structuredClone(a));
    }
  }
}

export function listPipelineTemplates(category?: string): PipelineTemplate[] {
  ensureBuiltIns();
  const all = Array.from(pipelineTemplatesStore.values());
  if (!category) return all;
  return all.filter((t) => t.category === category);
}

export function createPipelineTemplate(
  input: z.input<typeof CreatePipelineTemplateSchema>,
): PipelineTemplate {
  ensureBuiltIns();
  const parsed = CreatePipelineTemplateSchema.parse(input);
  const tpl: PipelineTemplate = {
    ...parsed,
    id: parsed.id ?? `tpl_pipe_${ulid()}`,
    builtIn: false,
    createdAt: new Date().toISOString(),
  };
  pipelineTemplatesStore.set(tpl.id, tpl);
  return tpl;
}

export function instantiatePipelineTemplate(
  templateId: string,
  variableValues: Record<string, string>,
): {
  templateId: string;
  name: string;
  resolvedSteps: Array<z.infer<typeof TemplateStepSchema>>;
} {
  ensureBuiltIns();
  const tpl = pipelineTemplatesStore.get(templateId);
  if (!tpl) {
    throw new Error(`Pipeline template not found: ${templateId}`);
  }

  const resolvedVars: Record<string, string> = {};
  for (const v of tpl.variables) {
    const val = variableValues[v.name] ?? v.defaultValue;
    if (v.required && (val === undefined || val === "")) {
      throw new Error(`Missing required template variable: ${v.name}`);
    }
    if (val !== undefined) {
      resolvedVars[v.name] = val;
    }
  }

  const resolvedSteps = tpl.steps.map((step) => {
    let commandOrPrompt = step.commandOrPrompt;
    for (const [k, v] of Object.entries(resolvedVars)) {
      commandOrPrompt = commandOrPrompt.replaceAll(`{{${k}}}`, v);
    }
    return {
      ...step,
      commandOrPrompt,
    };
  });

  return {
    templateId: tpl.id,
    name: tpl.name,
    resolvedSteps,
  };
}

export function exportPipelineTemplate(
  templateId: string,
): PipelineTemplate | undefined {
  ensureBuiltIns();
  return pipelineTemplatesStore.get(templateId);
}

export function importPipelineTemplate(
  bundle: z.input<typeof CreatePipelineTemplateSchema>,
): PipelineTemplate {
  return createPipelineTemplate(bundle);
}

export function listAgentTemplates(category?: string): AgentTemplate[] {
  ensureBuiltIns();
  const all = Array.from(agentTemplatesStore.values());
  if (!category) return all;
  return all.filter((t) => t.category === category);
}

export function createAgentTemplate(
  input: z.input<typeof CreateAgentTemplateSchema>,
): AgentTemplate {
  ensureBuiltIns();
  const parsed = CreateAgentTemplateSchema.parse(input);
  const tpl: AgentTemplate = {
    ...parsed,
    id: parsed.id ?? `agt_tpl_${ulid()}`,
    isBuiltIn: false,
    usageCount: 0,
    createdAt: new Date().toISOString(),
  };
  agentTemplatesStore.set(tpl.id, tpl);
  return tpl;
}

export function instantiateAgentFromTemplate(
  templateId: string,
  overrides?: {
    agentName?: string;
    workspaceId?: string;
    maxCostPerSession?: number;
  },
) {
  ensureBuiltIns();
  const tpl = agentTemplatesStore.get(templateId);
  if (!tpl) {
    throw new Error(`Agent template not found: ${templateId}`);
  }
  tpl.usageCount++;

  return {
    instanceId: `ag_inst_${ulid()}`,
    templateId: tpl.id,
    agentName: overrides?.agentName ?? `${tpl.name} Instance`,
    workspaceId: overrides?.workspaceId ?? "default",
    agentType: tpl.agentType,
    modelConfig: structuredClone(tpl.modelConfig),
    contextConfig: structuredClone(tpl.contextConfig),
    safetyConfig: {
      ...tpl.safetyConfig,
      ...(overrides?.maxCostPerSession !== undefined && {
        maxCostPerSession: overrides.maxCostPerSession,
      }),
    },
    toolPermissions: [...tpl.toolPermissions],
  };
}

export function clearTemplatesForTesting(): void {
  pipelineTemplatesStore.clear();
  agentTemplatesStore.clear();
}
