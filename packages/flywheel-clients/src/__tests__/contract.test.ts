/**
 * E2E Contract Tests for Tool Clients
 *
 * Tests client wrappers against deterministic JSON fixtures to validate:
 * - Correct argument building for each command
 * - JSON parsing and Zod schema validation
 * - Error handling for malformed output
 * - Detailed logging of all CLI invocations
 *
 * Uses a StubCommandRunner that returns pre-configured responses
 * based on command/argument patterns.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import {
  AprClientError,
  type AprCommandResult,
  type AprCommandRunner,
  createAprClient,
} from "../apr";
// Import all clients
import {
  BrClientError,
  type BrCommandResult,
  type BrCommandRunner,
  createBrClient,
} from "../br";
import {
  BvClientError,
  type BvCommandResult,
  type BvCommandRunner,
  createBvClient,
} from "../bv";
import {
  CaamClientError,
  type CaamCommandResult,
  type CaamCommandRunner,
  createCaamClient,
} from "../caam";
import {
  createJfpClient,
  JfpClientError,
  type JfpCommandResult,
  type JfpCommandRunner,
} from "../jfp";
import {
  createMsClient,
  MsClientError,
  type MsCommandResult,
  type MsCommandRunner,
} from "../ms";
import {
  createNtmClient,
  NtmClientError,
  type NtmCommandResult,
  type NtmCommandRunner,
} from "../ntm";
import {
  createPtClient,
  PtClientError,
  type PtCommandResult,
  type PtCommandRunner,
} from "../pt";

// ============================================================================
// Invocation Logger
// ============================================================================

interface Invocation {
  timestamp: string;
  command: string;
  args: string[];
  cwd?: string;
  timeout?: number;
}

class InvocationLogger {
  private invocations: Invocation[] = [];

  log(
    command: string,
    args: string[],
    options?: { cwd?: string; timeout?: number },
  ): void {
    this.invocations.push({
      timestamp: new Date().toISOString(),
      command,
      args: [...args],
      cwd: options?.cwd,
      timeout: options?.timeout,
    });
  }

  getAll(): Invocation[] {
    return [...this.invocations];
  }

  getLast(): Invocation | undefined {
    return this.invocations[this.invocations.length - 1];
  }

  clear(): void {
    this.invocations = [];
  }

  dump(): string {
    return this.invocations
      .map(
        (inv) =>
          `[${inv.timestamp}] ${inv.command} ${inv.args.join(" ")}` +
          (inv.cwd ? ` (cwd: ${inv.cwd})` : "") +
          (inv.timeout ? ` (timeout: ${inv.timeout}ms)` : ""),
      )
      .join("\n");
  }
}

// ============================================================================
// Stub Command Runner Factory
// ============================================================================

interface StubResponse {
  stdout: string;
  stderr?: string;
  exitCode?: number;
}

interface StubMatcher {
  command: string;
  argsContain?: string[];
  argsMatch?: RegExp;
  response: StubResponse;
}

function createStubRunner<
  T extends { stdout: string; stderr: string; exitCode: number },
>(
  matchers: StubMatcher[],
  logger: InvocationLogger,
  defaultResponse?: StubResponse,
): {
  run: (
    command: string,
    args: string[],
    options?: { cwd?: string; timeout?: number },
  ) => Promise<T>;
} {
  return {
    run: async (command, args, options) => {
      logger.log(command, args, options);

      // Find matching response
      for (const matcher of matchers) {
        if (matcher.command !== command) continue;

        if (matcher.argsContain) {
          const allFound = matcher.argsContain.every((arg) =>
            args.includes(arg),
          );
          if (!allFound) continue;
        }

        if (matcher.argsMatch) {
          const argsStr = args.join(" ");
          if (!matcher.argsMatch.test(argsStr)) continue;
        }

        return {
          stdout: matcher.response.stdout,
          stderr: matcher.response.stderr ?? "",
          exitCode: matcher.response.exitCode ?? 0,
        } as T;
      }

      // Return default or error
      if (defaultResponse) {
        return {
          stdout: defaultResponse.stdout,
          stderr: defaultResponse.stderr ?? "",
          exitCode: defaultResponse.exitCode ?? 0,
        } as T;
      }

      return {
        stdout: "",
        stderr: `No stub configured for: ${command} ${args.join(" ")}`,
        exitCode: 1,
      } as T;
    },
  };
}

// ============================================================================
// Test Fixtures
// ============================================================================

const FIXTURES = {
  // br (Beads) fixtures
  br: {
    ready: JSON.stringify([
      {
        id: "bd-test1",
        title: "Test bead 1",
        status: "open",
        priority: 2,
        issue_type: "task",
        created_at: "2025-01-01T00:00:00Z",
      },
      {
        id: "bd-test2",
        title: "Test bead 2",
        status: "open",
        priority: 1,
        issue_type: "bug",
        created_at: "2025-01-02T00:00:00Z",
        labels: ["urgent"],
      },
    ]),
    list: JSON.stringify([
      {
        id: "bd-all1",
        title: "Listed bead",
        status: "closed",
        priority: 3,
        issue_type: "feature",
      },
    ]),
    show: JSON.stringify({
      id: "bd-show1",
      title: "Shown bead",
      description: "Detailed description",
      status: "in_progress",
      priority: 2,
      dependencies: [{ id: "bd-dep1", title: "Dependency" }],
    }),
    create: JSON.stringify({
      id: "bd-new1",
      title: "Created bead",
      status: "open",
      priority: 2,
    }),
    update: JSON.stringify([
      {
        id: "bd-upd1",
        title: "Updated title",
        status: "in_progress",
        priority: 1,
      },
    ]),
    close: JSON.stringify([
      {
        id: "bd-cls1",
        title: "Closed bead",
        status: "closed",
        closed_at: "2025-01-15T12:00:00Z",
      },
    ]),
    syncStatus: JSON.stringify({
      dirty_count: 0,
      last_export_time: "2025-01-15T12:00:00Z",
      jsonl_exists: true,
    }),
    sync: JSON.stringify({}),
  },

  // bv (Beads Visualizer) fixtures
  bv: {
    triage: JSON.stringify({
      generated_at: "2025-01-15T12:00:00Z",
      data_hash: "abc123",
      triage: {
        recommendations: [
          {
            id: "bd-rec1",
            title: "Top recommendation",
            score: 0.95,
            reasons: ["High priority", "No blockers"],
          },
        ],
        quick_wins: [
          {
            id: "bd-qw1",
            title: "Quick win",
            score: 0.8,
            type: "task",
          },
        ],
        blockers_to_clear: [],
      },
    }),
    insights: JSON.stringify({
      generated_at: "2025-01-15T12:00:00Z",
      data_hash: "def456",
    }),
    plan: JSON.stringify({
      generated_at: "2025-01-15T12:00:00Z",
      data_hash: "ghi789",
    }),
    graph: JSON.stringify({
      format: "json",
      nodes: [
        { id: "bd-1", title: "Node 1", status: "open", priority: 1 },
        { id: "bd-2", title: "Node 2", status: "closed", priority: 2 },
      ],
      edges: [{ source: "bd-1", target: "bd-2", type: "blocks" }],
      data_hash: "jkl012",
    }),
  },

  // caam (Account Manager) fixtures
  caam: {
    status: JSON.stringify({
      tools: [
        {
          tool: "claude-code",
          logged_in: true,
          active_profile: "default",
          health: {
            status: "healthy",
            error_count: 0,
          },
          identity: {
            email: "test@example.com",
            plan_type: "pro",
          },
        },
        {
          tool: "codex",
          logged_in: false,
          error: "No credentials found",
        },
      ],
      warnings: [],
      recommendations: ["Consider logging into codex"],
    }),
    activate: JSON.stringify({
      success: true,
      tool: "claude-code",
      profile: "work",
      previous_profile: "default",
      refreshed: true,
    }),
    backup: JSON.stringify({
      success: true,
    }),
  },

  // apr (Automated Plan Reviser) fixtures
  apr: {
    version: "apr v0.5.0",
    status: JSON.stringify({
      ok: true,
      code: "success",
      data: {
        configured: true,
        default_workflow: "main",
        workflow_count: 2,
        workflows: ["main", "feature"],
        oracle_available: true,
        oracle_method: "claude",
        config_dir: "/home/test/.apr",
        apr_home: "/home/test/.apr",
      },
      meta: { v: "0.5.0", ts: "2025-01-15T12:00:00Z" },
    }),
    workflows: JSON.stringify({
      ok: true,
      code: "success",
      data: {
        workflows: [
          {
            name: "main",
            description: "Main workflow",
            path: "/project/.apr/main",
            rounds: 3,
            last_run: "2025-01-14T10:00:00Z",
          },
        ],
      },
      meta: { v: "0.5.0", ts: "2025-01-15T12:00:00Z" },
    }),
    show: JSON.stringify({
      ok: true,
      code: "success",
      data: {
        round: 1,
        workflow: "main",
        status: "completed",
        created_at: "2025-01-14T08:00:00Z",
        completed_at: "2025-01-14T08:30:00Z",
        metrics: {
          word_count: 1500,
          section_count: 5,
          code_block_count: 3,
          convergence_score: 0.85,
        },
      },
      meta: { v: "0.5.0", ts: "2025-01-15T12:00:00Z" },
    }),
    history: JSON.stringify({
      ok: true,
      code: "success",
      data: {
        workflow: "main",
        rounds: [
          { round: 1, workflow: "main", status: "completed" },
          { round: 2, workflow: "main", status: "completed" },
        ],
        total: 2,
      },
      meta: { v: "0.5.0", ts: "2025-01-15T12:00:00Z" },
    }),
  },

  // ntm (Named Tmux Manager) fixtures
  ntm: {
    status: JSON.stringify({
      generated_at: "2025-01-15T12:00:00Z",
      system: {
        version: "0.5.0",
        commit: "abc123",
        build_date: "2025-01-01",
        go_version: "1.21",
        os: "linux",
        arch: "amd64",
        tmux_available: true,
      },
      sessions: [
        {
          name: "agent-1",
          exists: true,
          attached: true,
          windows: 2,
          panes: 3,
          created_at: "2025-01-15T08:00:00Z",
        },
        {
          name: "agent-2",
          exists: true,
          attached: false,
          windows: 1,
          panes: 1,
          created_at: "2025-01-15T09:00:00Z",
        },
      ],
      summary: {
        total_sessions: 2,
        total_agents: 3,
        attached_count: 1,
        claude_count: 2,
        codex_count: 1,
        gemini_count: 0,
        cursor_count: 0,
        windsurf_count: 0,
        aider_count: 0,
      },
    }),
    context: JSON.stringify({
      success: true,
      timestamp: "2025-01-15T12:00:00Z",
      session: "agent-1",
      captured_at: "2025-01-15T12:00:00Z",
      agents: [
        {
          pane: "%0",
          pane_idx: 0,
          agent_type: "claude",
          model: "opus-4",
          estimated_tokens: 50000,
          with_overhead: 55000,
          context_limit: 200000,
          usage_percent: 27.5,
          usage_level: "low",
          confidence: "high",
          state: "idle",
        },
      ],
      summary: {
        total_agents: 1,
        high_usage_count: 0,
        avg_usage: 27.5,
      },
    }),
    health: JSON.stringify({
      success: true,
      session: "agent-1",
      checked_at: "2025-01-15T12:00:00Z",
      agents: [
        {
          pane: 0,
          agent_type: "claude",
          health: "healthy",
          idle_since_seconds: 30,
          restarts: 0,
          rate_limit_count: 0,
          backoff_remaining: 0,
          confidence: 0.95,
        },
      ],
      summary: {
        total: 1,
        healthy: 1,
        degraded: 0,
        unhealthy: 0,
        rate_limited: 0,
      },
    }),
    snapshot: JSON.stringify({
      ts: "2025-01-15T12:00:00Z",
      sessions: [
        {
          name: "agent-1",
          attached: true,
          agents: [
            {
              pane: "%0",
              type: "claude",
              variant: "opus-4",
              type_confidence: 0.95,
              type_method: "pattern_match",
              state: "idle",
              last_output_age_sec: 30,
              output_tail_lines: 50,
              current_bead: null,
              pending_mail: 0,
            },
          ],
        },
      ],
      alerts: [],
    }),
  },

  // ms (Meta Skill) fixtures
  ms: {
    doctor: JSON.stringify({
      ok: true,
      code: "success",
      data: {
        status: "healthy",
        checks: [
          { name: "database", status: "ok", message: "SQLite connected" },
          { name: "embeddings", status: "ok", message: "Model loaded" },
        ],
        embedding_service: {
          available: true,
          model: "all-MiniLM-L6-v2",
          latency_ms: 50,
        },
        storage: {
          data_dir: "/home/user/.ms",
          size_bytes: 1048576,
          index_count: 5,
        },
      },
      meta: { v: "1.2.0", ts: "2025-01-15T12:00:00Z" },
    }),
    list: JSON.stringify({
      ok: true,
      code: "success",
      data: {
        knowledge_bases: [
          {
            name: "skills",
            description: "Agent skills documentation",
            entry_count: 150,
            created_at: "2025-01-01T00:00:00Z",
            updated_at: "2025-01-14T10:00:00Z",
          },
          {
            name: "prompts",
            description: "Curated prompts collection",
            entry_count: 75,
            created_at: "2025-01-05T00:00:00Z",
          },
        ],
      },
      meta: { v: "1.2.0", ts: "2025-01-15T12:00:00Z" },
    }),
    search: JSON.stringify({
      ok: true,
      code: "success",
      data: {
        query: "authentication",
        results: [
          {
            id: "skill-auth-001",
            title: "OAuth 2.0 Authentication",
            snippet: "Implement OAuth 2.0 flows for secure authentication...",
            score: 0.92,
            knowledge_base: "skills",
            source: "auth.md",
          },
          {
            id: "skill-auth-002",
            title: "JWT Token Management",
            snippet: "Best practices for JWT token handling...",
            score: 0.85,
            knowledge_base: "skills",
            source: "tokens.md",
          },
        ],
        total: 2,
        took_ms: 45,
        semantic_enabled: true,
      },
      meta: { v: "1.2.0", ts: "2025-01-15T12:00:00Z" },
    }),
  },

  // pt (Process Triage) fixtures
  pt: {
    doctor: JSON.stringify({
      ok: true,
      code: "success",
      data: {
        status: "healthy",
        checks: [
          { name: "procfs", status: "ok", message: "/proc accessible" },
          { name: "permissions", status: "ok", message: "Can read processes" },
        ],
        permissions: {
          can_list_processes: true,
          can_kill_processes: true,
        },
      },
      meta: { v: "0.3.0", ts: "2025-01-15T12:00:00Z" },
    }),
    scan: JSON.stringify({
      ok: true,
      code: "success",
      data: {
        processes: [
          {
            pid: 12345,
            ppid: 1,
            name: "node",
            cmdline: "node server.js",
            user: "ubuntu",
            state: "S",
            cpu_percent: 85.5,
            memory_percent: 12.3,
            memory_rss_mb: 512,
            started_at: "2025-01-15T08:00:00Z",
            runtime_seconds: 14400,
            score: 75,
            score_breakdown: {
              cpu_score: 40,
              memory_score: 15,
              runtime_score: 10,
              state_score: 10,
            },
            flags: ["high_cpu", "long_running"],
          },
          {
            pid: 67890,
            ppid: 12345,
            name: "zombie_worker",
            cmdline: "[zombie_worker] <defunct>",
            user: "ubuntu",
            state: "Z",
            cpu_percent: 0,
            memory_percent: 0,
            memory_rss_mb: 0,
            score: 90,
            flags: ["zombie"],
          },
        ],
        total_scanned: 150,
        suspicious_count: 2,
        scan_time_ms: 125,
        timestamp: "2025-01-15T12:00:00Z",
        thresholds: {
          min_score: 50,
          min_runtime_seconds: 0,
          min_memory_mb: 0,
          min_cpu_percent: 0,
        },
      },
      meta: { v: "0.3.0", ts: "2025-01-15T12:00:00Z" },
    }),
  },

  // jfp (Jeffrey's Prompts) fixtures
  jfp: {
    list: JSON.stringify({
      prompts: [
        {
          id: "code-review-001",
          title: "Comprehensive Code Review",
          description: "Thorough code review focusing on quality and security",
          category: "development",
          tags: ["code-review", "security", "quality"],
          author: "Jeffrey",
          version: "1.0.0",
          featured: true,
          difficulty: "intermediate",
          estimatedTokens: 500,
          created: "2025-01-01T00:00:00Z",
          content: "Review the following code for...",
          whenToUse: ["PR reviews", "Code audits"],
          tips: ["Focus on security first"],
        },
        {
          id: "debug-helper-002",
          title: "Debug Assistant",
          description: "Systematic debugging approach",
          category: "debugging",
          tags: ["debugging", "troubleshooting"],
          author: "Jeffrey",
          version: "1.0.0",
          featured: false,
          difficulty: "beginner",
          estimatedTokens: 300,
          created: "2025-01-05T00:00:00Z",
          content: "Help me debug this issue...",
        },
      ],
    }),
    show: JSON.stringify({
      id: "code-review-001",
      title: "Comprehensive Code Review",
      description: "Thorough code review focusing on quality and security",
      category: "development",
      tags: ["code-review", "security", "quality"],
      author: "Jeffrey",
      version: "1.0.0",
      featured: true,
      difficulty: "intermediate",
      estimatedTokens: 500,
      created: "2025-01-01T00:00:00Z",
      content: "Review the following code for quality...",
      whenToUse: ["PR reviews", "Code audits"],
      tips: ["Focus on security first", "Check edge cases"],
    }),
    categories: JSON.stringify([
      { name: "development", count: 25 },
      { name: "debugging", count: 15 },
      { name: "writing", count: 10 },
    ]),
    search: JSON.stringify({
      results: [
        {
          id: "code-review-001",
          title: "Comprehensive Code Review",
          description: "Thorough code review focusing on quality and security",
          category: "development",
          tags: ["code-review", "security"],
          author: "Jeffrey",
          version: "1.0.0",
          featured: true,
          difficulty: "intermediate",
          estimatedTokens: 500,
          created: "2025-01-01T00:00:00Z",
          content: "Review the following code for...",
        },
      ],
    }),
    suggest: JSON.stringify({
      suggestions: [
        {
          id: "debug-helper-002",
          title: "Debug Assistant",
          description: "Systematic debugging approach",
          category: "debugging",
          tags: ["debugging"],
          author: "Jeffrey",
          version: "1.0.0",
          featured: false,
          difficulty: "beginner",
          estimatedTokens: 300,
          created: "2025-01-05T00:00:00Z",
          content: "Help me debug this issue...",
        },
      ],
    }),
  },
};

// ============================================================================
// br (Beads) Client Contract Tests
// ============================================================================

describe("br Client Contract Tests", () => {
  let logger: InvocationLogger;

  beforeEach(() => {
    logger = new InvocationLogger();
  });

  describe("ready command", () => {
    test("parses ready output with multiple issues", async () => {
      const runner = createStubRunner<BrCommandResult>(
        [
          {
            command: "br",
            argsContain: ["ready", "--json"],
            response: { stdout: FIXTURES.br.ready },
          },
        ],
        logger,
      );

      const client = createBrClient({ runner });
      const result = await client.ready();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("bd-test1");
      expect(result[0].title).toBe("Test bead 1");
      expect(result[1].labels).toEqual(["urgent"]);

      const inv = logger.getLast();
      expect(inv?.command).toBe("br");
      expect(inv?.args).toContain("ready");
      expect(inv?.args).toContain("--json");
    });

    test("includes limit and assignee args when provided", async () => {
      const runner = createStubRunner<BrCommandResult>(
        [{ command: "br", response: { stdout: FIXTURES.br.ready } }],
        logger,
      );

      const client = createBrClient({ runner });
      await client.ready({ limit: 5, assignee: "TealReef" });

      const inv = logger.getLast();
      expect(inv?.args).toContain("--limit");
      expect(inv?.args).toContain("5");
      expect(inv?.args).toContain("--assignee");
      expect(inv?.args).toContain("TealReef");
    });
  });

  describe("list command", () => {
    test("parses list output", async () => {
      const runner = createStubRunner<BrCommandResult>(
        [
          {
            command: "br",
            argsContain: ["list", "--json"],
            response: { stdout: FIXTURES.br.list },
          },
        ],
        logger,
      );

      const client = createBrClient({ runner });
      const result = await client.list();

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe("closed");
    });

    test("includes filter args", async () => {
      const runner = createStubRunner<BrCommandResult>(
        [{ command: "br", response: { stdout: FIXTURES.br.list } }],
        logger,
      );

      const client = createBrClient({ runner });
      await client.list({
        statuses: ["open", "in_progress"],
        types: ["bug"],
        priorities: [1, 2],
      });

      const inv = logger.getLast();
      expect(inv?.args).toContain("--status");
      expect(inv?.args).toContain("open");
      expect(inv?.args).toContain("--type");
      expect(inv?.args).toContain("bug");
      expect(inv?.args).toContain("--priority");
    });
  });

  describe("show command", () => {
    test("parses single issue output", async () => {
      const runner = createStubRunner<BrCommandResult>(
        [
          {
            command: "br",
            argsContain: ["show"],
            response: { stdout: FIXTURES.br.show },
          },
        ],
        logger,
      );

      const client = createBrClient({ runner });
      const result = await client.show("bd-show1");

      expect(result).toHaveLength(1);
      expect(result[0].description).toBe("Detailed description");
      expect(result[0].dependencies).toHaveLength(1);
    });
  });

  describe("create command", () => {
    test("creates issue with title and options", async () => {
      const runner = createStubRunner<BrCommandResult>(
        [
          {
            command: "br",
            argsContain: ["create"],
            response: { stdout: FIXTURES.br.create },
          },
        ],
        logger,
      );

      const client = createBrClient({ runner });
      const result = await client.create({
        title: "New task",
        type: "task",
        priority: 2,
        labels: ["api", "urgent"],
      });

      expect(result.id).toBe("bd-new1");

      const inv = logger.getLast();
      expect(inv?.args).toContain("New task");
      expect(inv?.args).toContain("--type");
      expect(inv?.args).toContain("task");
      expect(inv?.args).toContain("--labels");
    });
  });

  describe("error handling", () => {
    test("throws on non-zero exit code", async () => {
      const runner = createStubRunner<BrCommandResult>(
        [
          {
            command: "br",
            response: {
              stdout: "",
              stderr: "Error: database locked",
              exitCode: 1,
            },
          },
        ],
        logger,
      );

      const client = createBrClient({ runner });

      await expect(client.ready()).rejects.toThrow(BrClientError);
    });

    test("throws on invalid JSON", async () => {
      const runner = createStubRunner<BrCommandResult>(
        [
          {
            command: "br",
            response: { stdout: "not json" },
          },
        ],
        logger,
      );

      const client = createBrClient({ runner });

      await expect(client.ready()).rejects.toThrow(BrClientError);
    });

    test("throws on schema validation failure", async () => {
      const runner = createStubRunner<BrCommandResult>(
        [
          {
            command: "br",
            response: {
              stdout: JSON.stringify([{ notAnId: "missing required field" }]),
            },
          },
        ],
        logger,
      );

      const client = createBrClient({ runner });

      await expect(client.ready()).rejects.toThrow(BrClientError);
    });
  });
});

// ============================================================================
// bv (Beads Visualizer) Client Contract Tests
// ============================================================================

describe("bv Client Contract Tests", () => {
  let logger: InvocationLogger;

  beforeEach(() => {
    logger = new InvocationLogger();
  });

  describe("getTriage", () => {
    test("parses triage output with recommendations", async () => {
      const runner = createStubRunner<BvCommandResult>(
        [
          {
            command: "bv",
            argsContain: ["--robot-triage"],
            response: { stdout: FIXTURES.bv.triage },
          },
        ],
        logger,
      );

      const client = createBvClient({ runner });
      const result = await client.getTriage();

      expect(result.generated_at).toBe("2025-01-15T12:00:00Z");
      expect(result.triage.recommendations).toHaveLength(1);
      expect(result.triage.recommendations?.[0].score).toBe(0.95);
      expect(result.triage.quick_wins).toHaveLength(1);

      const inv = logger.getLast();
      expect(inv?.command).toBe("bv");
      expect(inv?.args).toContain("--robot-triage");
    });
  });

  describe("getGraph", () => {
    test("parses graph output with nodes and edges", async () => {
      const runner = createStubRunner<BvCommandResult>(
        [
          {
            command: "bv",
            argsContain: ["--robot-graph"],
            response: { stdout: FIXTURES.bv.graph },
          },
        ],
        logger,
      );

      const client = createBvClient({ runner });
      const result = await client.getGraph();

      expect(result.format).toBe("json");
      expect(Array.isArray(result.nodes)).toBe(true);
      if (Array.isArray(result.nodes)) {
        expect(result.nodes).toHaveLength(2);
        expect(result.nodes[0].id).toBe("bd-1");
      }
      if (Array.isArray(result.edges)) {
        expect(result.edges).toHaveLength(1);
        expect(result.edges[0].type).toBe("blocks");
      }
    });

    test("includes format and root args when provided", async () => {
      const runner = createStubRunner<BvCommandResult>(
        [{ command: "bv", response: { stdout: FIXTURES.bv.graph } }],
        logger,
      );

      const client = createBvClient({ runner });
      await client.getGraph({
        format: "json",
        rootId: "bd-root",
        depth: 3,
      });

      const inv = logger.getLast();
      expect(inv?.args).toContain("--graph-format");
      expect(inv?.args).toContain("json");
      expect(inv?.args).toContain("--graph-root");
      expect(inv?.args).toContain("bd-root");
      expect(inv?.args).toContain("--graph-depth");
      expect(inv?.args).toContain("3");
    });
  });

  describe("error handling", () => {
    test("throws on command failure", async () => {
      const runner = createStubRunner<BvCommandResult>(
        [
          {
            command: "bv",
            response: { stdout: "", stderr: "No beads found", exitCode: 1 },
          },
        ],
        logger,
      );

      const client = createBvClient({ runner });

      await expect(client.getTriage()).rejects.toThrow(BvClientError);
    });
  });
});

// ============================================================================
// caam (Account Manager) Client Contract Tests
// ============================================================================

describe("caam Client Contract Tests", () => {
  let logger: InvocationLogger;

  beforeEach(() => {
    logger = new InvocationLogger();
  });

  describe("status", () => {
    test("parses multi-tool status", async () => {
      const runner = createStubRunner<CaamCommandResult>(
        [
          {
            command: "caam",
            argsContain: ["status", "--json"],
            response: { stdout: FIXTURES.caam.status },
          },
        ],
        logger,
      );

      const client = createCaamClient({ runner });
      const result = await client.status();

      expect(result.tools).toHaveLength(2);
      expect(result.tools[0].logged_in).toBe(true);
      expect(result.tools[0].identity?.email).toBe("test@example.com");
      expect(result.tools[1].logged_in).toBe(false);
      expect(result.recommendations).toHaveLength(1);
    });

    test("filters by provider when specified", async () => {
      const runner = createStubRunner<CaamCommandResult>(
        [{ command: "caam", response: { stdout: FIXTURES.caam.status } }],
        logger,
      );

      const client = createCaamClient({ runner });
      await client.status({ provider: "claude-code" });

      const inv = logger.getLast();
      expect(inv?.args).toContain("claude-code");
    });
  });

  describe("activate", () => {
    test("activates profile and returns result", async () => {
      const runner = createStubRunner<CaamCommandResult>(
        [
          {
            command: "caam",
            argsContain: ["activate"],
            response: { stdout: FIXTURES.caam.activate },
          },
        ],
        logger,
      );

      const client = createCaamClient({ runner });
      const result = await client.activate({
        provider: "claude-code",
        profile: "work",
      });

      expect(result.success).toBe(true);
      expect(result.profile).toBe("work");
      expect(result.previous_profile).toBe("default");

      const inv = logger.getLast();
      expect(inv?.args).toContain("activate");
      expect(inv?.args).toContain("claude-code");
      expect(inv?.args).toContain("work");
    });
  });

  describe("isAvailable", () => {
    test("returns true when command succeeds", async () => {
      const runner = createStubRunner<CaamCommandResult>(
        [{ command: "caam", response: { stdout: FIXTURES.caam.status } }],
        logger,
      );

      const client = createCaamClient({ runner });
      const result = await client.isAvailable();

      expect(result).toBe(true);
    });

    test("returns false when command fails", async () => {
      const runner = createStubRunner<CaamCommandResult>(
        [{ command: "caam", response: { stdout: "", exitCode: 1 } }],
        logger,
      );

      const client = createCaamClient({ runner });
      const result = await client.isAvailable();

      expect(result).toBe(false);
    });
  });
});

// ============================================================================
// apr (Automated Plan Reviser) Client Contract Tests
// ============================================================================

describe("apr Client Contract Tests", () => {
  let logger: InvocationLogger;

  beforeEach(() => {
    logger = new InvocationLogger();
  });

  describe("isAvailable", () => {
    test("returns true when version command succeeds", async () => {
      const runner = createStubRunner<AprCommandResult>(
        [
          {
            command: "apr",
            argsContain: ["--version"],
            response: { stdout: FIXTURES.apr.version },
          },
        ],
        logger,
      );

      const client = createAprClient({ runner });
      const result = await client.isAvailable();

      expect(result).toBe(true);
    });
  });

  describe("getVersion", () => {
    test("extracts version number", async () => {
      const runner = createStubRunner<AprCommandResult>(
        [
          {
            command: "apr",
            argsContain: ["--version"],
            response: { stdout: FIXTURES.apr.version },
          },
        ],
        logger,
      );

      const client = createAprClient({ runner });
      const result = await client.getVersion();

      expect(result).toBe("0.5.0");
    });
  });

  describe("getStatus", () => {
    test("parses status envelope", async () => {
      const runner = createStubRunner<AprCommandResult>(
        [
          {
            command: "apr",
            argsContain: ["robot", "status"],
            response: { stdout: FIXTURES.apr.status },
          },
        ],
        logger,
      );

      const client = createAprClient({ runner });
      const result = await client.getStatus();

      expect(result.configured).toBe(true);
      expect(result.workflow_count).toBe(2);
      expect(result.oracle_available).toBe(true);

      const inv = logger.getLast();
      expect(inv?.args).toContain("robot");
      expect(inv?.args).toContain("status");
    });
  });

  describe("listWorkflows", () => {
    test("parses workflows array", async () => {
      const runner = createStubRunner<AprCommandResult>(
        [
          {
            command: "apr",
            argsContain: ["robot", "workflows"],
            response: { stdout: FIXTURES.apr.workflows },
          },
        ],
        logger,
      );

      const client = createAprClient({ runner });
      const result = await client.listWorkflows();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("main");
      expect(result[0].rounds).toBe(3);
    });
  });

  describe("getRound", () => {
    test("parses round details with metrics", async () => {
      const runner = createStubRunner<AprCommandResult>(
        [
          {
            command: "apr",
            argsContain: ["robot", "show"],
            response: { stdout: FIXTURES.apr.show },
          },
        ],
        logger,
      );

      const client = createAprClient({ runner });
      const result = await client.getRound(1);

      expect(result.round).toBe(1);
      expect(result.status).toBe("completed");
      expect(result.metrics?.word_count).toBe(1500);
      expect(result.metrics?.convergence_score).toBe(0.85);

      const inv = logger.getLast();
      expect(inv?.args).toContain("1");
    });
  });

  describe("getHistory", () => {
    test("parses history with rounds", async () => {
      const runner = createStubRunner<AprCommandResult>(
        [
          {
            command: "apr",
            argsContain: ["robot", "history"],
            response: { stdout: FIXTURES.apr.history },
          },
        ],
        logger,
      );

      const client = createAprClient({ runner });
      const result = await client.getHistory();

      expect(result.workflow).toBe("main");
      expect(result.rounds).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    test("includes workflow arg when specified", async () => {
      const runner = createStubRunner<AprCommandResult>(
        [{ command: "apr", response: { stdout: FIXTURES.apr.history } }],
        logger,
      );

      const client = createAprClient({ runner });
      await client.getHistory({ workflow: "feature" });

      const inv = logger.getLast();
      expect(inv?.args).toContain("-w");
      expect(inv?.args).toContain("feature");
    });
  });

  describe("error handling", () => {
    test("throws on envelope ok=false", async () => {
      const errorResponse = JSON.stringify({
        ok: false,
        code: "not_found",
        data: null,
        hint: "Workflow does not exist",
      });

      const runner = createStubRunner<AprCommandResult>(
        [{ command: "apr", response: { stdout: errorResponse } }],
        logger,
      );

      const client = createAprClient({ runner });

      await expect(client.getStatus()).rejects.toThrow(AprClientError);
    });
  });
});

// ============================================================================
// ntm (Named Tmux Manager) Client Contract Tests
// ============================================================================

describe("ntm Client Contract Tests", () => {
  let logger: InvocationLogger;

  beforeEach(() => {
    logger = new InvocationLogger();
  });

  describe("status", () => {
    test("parses status with sessions", async () => {
      const runner = createStubRunner<NtmCommandResult>(
        [
          {
            command: "ntm",
            argsContain: ["--robot-status"],
            response: { stdout: FIXTURES.ntm.status },
          },
        ],
        logger,
      );

      const client = createNtmClient({ runner });
      const result = await client.status();

      expect(result.sessions).toHaveLength(2);
      expect(result.sessions[0].name).toBe("agent-1");
      expect(result.sessions[0].attached).toBe(true);
      expect(result.summary.total_sessions).toBe(2);
      expect(result.system.tmux_available).toBe(true);

      const inv = logger.getLast();
      expect(inv?.command).toBe("ntm");
      expect(inv?.args).toContain("--robot-status");
      expect(inv?.args).toContain("--robot-format=json");
    });
  });

  describe("context", () => {
    test("parses context for session", async () => {
      const runner = createStubRunner<NtmCommandResult>(
        [
          {
            command: "ntm",
            argsMatch: /--robot-context=agent-1/,
            response: { stdout: FIXTURES.ntm.context },
          },
        ],
        logger,
      );

      const client = createNtmClient({ runner });
      const result = await client.context("agent-1");

      expect(result.session).toBe("agent-1");
      expect(result.success).toBe(true);
      expect(result.agents).toHaveLength(1);
      expect(result.summary.total_agents).toBe(1);

      const inv = logger.getLast();
      expect(inv?.args.some((a) => a.includes("--robot-context=agent-1"))).toBe(
        true,
      );
    });
  });

  describe("health", () => {
    test("parses health check result for session", async () => {
      const runner = createStubRunner<NtmCommandResult>(
        [
          {
            command: "ntm",
            argsMatch: /--robot-health=agent-1/,
            response: { stdout: FIXTURES.ntm.health },
          },
        ],
        logger,
      );

      const client = createNtmClient({ runner });
      // health() requires a session parameter
      const result = await client.health("agent-1");

      expect(result.success).toBe(true);
      expect(result.session).toBe("agent-1");
      expect(result.summary.healthy).toBe(1);
      expect(result.agents).toHaveLength(1);

      const inv = logger.getLast();
      expect(inv?.args.some((a) => a.includes("--robot-health=agent-1"))).toBe(
        true,
      );
    });
  });

  describe("snapshot", () => {
    test("parses full snapshot", async () => {
      const runner = createStubRunner<NtmCommandResult>(
        [
          {
            command: "ntm",
            argsContain: ["--robot-snapshot"],
            response: { stdout: FIXTURES.ntm.snapshot },
          },
        ],
        logger,
      );

      const client = createNtmClient({ runner });
      const result = await client.snapshot();

      expect(result.ts).toBeDefined();
      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0].name).toBe("agent-1");
      expect(result.sessions[0].agents).toHaveLength(1);
    });
  });

  describe("isAvailable", () => {
    test("returns true when version check passes", async () => {
      const runner = createStubRunner<NtmCommandResult>(
        [
          {
            command: "ntm",
            argsContain: ["--version"],
            response: { stdout: "ntm 0.5.0" },
          },
        ],
        logger,
      );

      const client = createNtmClient({ runner });
      const result = await client.isAvailable();

      expect(result).toBe(true);

      const inv = logger.getLast();
      expect(inv?.args).toContain("--version");
    });

    test("returns false when version check fails", async () => {
      const runner = createStubRunner<NtmCommandResult>(
        [
          {
            command: "ntm",
            argsContain: ["--version"],
            response: { stdout: "", exitCode: 1 },
          },
        ],
        logger,
      );

      const client = createNtmClient({ runner });
      const result = await client.isAvailable();

      expect(result).toBe(false);
    });
  });

  describe("error handling", () => {
    test("throws on command failure", async () => {
      const runner = createStubRunner<NtmCommandResult>(
        [
          {
            command: "ntm",
            argsContain: ["--robot-status"],
            response: { stdout: "", stderr: "tmux not found", exitCode: 127 },
          },
        ],
        logger,
      );

      const client = createNtmClient({ runner });

      await expect(client.status()).rejects.toThrow(NtmClientError);
    });

    test("throws on invalid JSON response", async () => {
      const runner = createStubRunner<NtmCommandResult>(
        [
          {
            command: "ntm",
            argsContain: ["--robot-status"],
            response: { stdout: "tmux 3.4\nnot json output" },
          },
        ],
        logger,
      );

      const client = createNtmClient({ runner });

      await expect(client.status()).rejects.toThrow(NtmClientError);
    });
  });
});

// ============================================================================
// ms (Meta Skill) Client Contract Tests
// ============================================================================

describe("ms Client Contract Tests", () => {
  let logger: InvocationLogger;

  beforeEach(() => {
    logger = new InvocationLogger();
  });

  describe("doctor", () => {
    test("parses doctor output with checks and services", async () => {
      const runner = createStubRunner<MsCommandResult>(
        [
          {
            command: "ms",
            argsContain: ["doctor", "--json"],
            response: { stdout: FIXTURES.ms.doctor },
          },
        ],
        logger,
      );

      const client = createMsClient({ runner });
      const result = await client.doctor();

      expect(result.status).toBe("healthy");
      expect(result.checks).toHaveLength(2);
      expect(result.checks[0].name).toBe("database");
      expect(result.embedding_service.available).toBe(true);
      expect(result.embedding_service.model).toBe("all-MiniLM-L6-v2");
      expect(result.storage.index_count).toBe(5);

      const inv = logger.getLast();
      expect(inv?.command).toBe("ms");
      expect(inv?.args).toContain("doctor");
      expect(inv?.args).toContain("--json");
    });
  });

  describe("listKnowledgeBases", () => {
    test("parses knowledge bases list", async () => {
      const runner = createStubRunner<MsCommandResult>(
        [
          {
            command: "ms",
            argsContain: ["list", "--json"],
            response: { stdout: FIXTURES.ms.list },
          },
        ],
        logger,
      );

      const client = createMsClient({ runner });
      const result = await client.listKnowledgeBases();

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("skills");
      expect(result[0].entry_count).toBe(150);
      expect(result[1].name).toBe("prompts");
    });
  });

  describe("search", () => {
    test("parses search results with scores", async () => {
      const runner = createStubRunner<MsCommandResult>(
        [
          {
            command: "ms",
            argsContain: ["search", "--json"],
            response: { stdout: FIXTURES.ms.search },
          },
        ],
        logger,
      );

      const client = createMsClient({ runner });
      const result = await client.search("authentication");

      expect(result.query).toBe("authentication");
      expect(result.results).toHaveLength(2);
      expect(result.results[0].score).toBe(0.92);
      expect(result.semantic_enabled).toBe(true);
      expect(result.took_ms).toBe(45);

      const inv = logger.getLast();
      expect(inv?.args).toContain("search");
      expect(inv?.args).toContain("authentication");
    });

    test("includes optional search parameters", async () => {
      const runner = createStubRunner<MsCommandResult>(
        [{ command: "ms", response: { stdout: FIXTURES.ms.search } }],
        logger,
      );

      const client = createMsClient({ runner });
      await client.search("auth", {
        knowledgeBase: "skills",
        limit: 5,
        threshold: 0.7,
      });

      const inv = logger.getLast();
      expect(inv?.args).toContain("-kb");
      expect(inv?.args).toContain("skills");
      expect(inv?.args).toContain("-n");
      expect(inv?.args).toContain("5");
      expect(inv?.args).toContain("-t");
      expect(inv?.args).toContain("0.7");
    });
  });

  describe("isAvailable", () => {
    test("returns true when doctor succeeds", async () => {
      const runner = createStubRunner<MsCommandResult>(
        [{ command: "ms", response: { stdout: FIXTURES.ms.doctor } }],
        logger,
      );

      const client = createMsClient({ runner });
      const result = await client.isAvailable();

      expect(result).toBe(true);
    });

    test("returns false when doctor fails", async () => {
      const runner = createStubRunner<MsCommandResult>(
        [{ command: "ms", response: { stdout: "", exitCode: 1 } }],
        logger,
      );

      const client = createMsClient({ runner });
      const result = await client.isAvailable();

      expect(result).toBe(false);
    });
  });

  describe("error handling", () => {
    test("throws on envelope ok=false", async () => {
      const errorResponse = JSON.stringify({
        ok: false,
        code: "not_found",
        data: null,
        hint: "Knowledge base not found",
        meta: { v: "1.2.0", ts: "2025-01-15T12:00:00Z" },
      });

      const runner = createStubRunner<MsCommandResult>(
        [{ command: "ms", response: { stdout: errorResponse } }],
        logger,
      );

      const client = createMsClient({ runner });

      await expect(client.doctor()).rejects.toThrow(MsClientError);
    });

    test("throws on invalid JSON", async () => {
      const runner = createStubRunner<MsCommandResult>(
        [{ command: "ms", response: { stdout: "not json" } }],
        logger,
      );

      const client = createMsClient({ runner });

      await expect(client.doctor()).rejects.toThrow(MsClientError);
    });
  });
});

// ============================================================================
// pt (Process Triage) Client Contract Tests
// ============================================================================

describe("pt Client Contract Tests", () => {
  let logger: InvocationLogger;

  beforeEach(() => {
    logger = new InvocationLogger();
  });

  describe("doctor", () => {
    test("parses doctor output with permissions", async () => {
      const runner = createStubRunner<PtCommandResult>(
        [
          {
            command: "pt",
            argsContain: ["doctor", "--json"],
            response: { stdout: FIXTURES.pt.doctor },
          },
        ],
        logger,
      );

      const client = createPtClient({ runner });
      const result = await client.doctor();

      expect(result.status).toBe("healthy");
      expect(result.checks).toHaveLength(2);
      expect(result.permissions.can_list_processes).toBe(true);
      expect(result.permissions.can_kill_processes).toBe(true);

      const inv = logger.getLast();
      expect(inv?.command).toBe("pt");
      expect(inv?.args).toContain("doctor");
    });
  });

  describe("scan", () => {
    test("parses scan results with processes", async () => {
      const runner = createStubRunner<PtCommandResult>(
        [
          {
            command: "pt",
            argsContain: ["scan", "--json"],
            response: { stdout: FIXTURES.pt.scan },
          },
        ],
        logger,
      );

      const client = createPtClient({ runner });
      const result = await client.scan();

      expect(result.processes).toHaveLength(2);
      expect(result.processes[0].pid).toBe(12345);
      expect(result.processes[0].cpu_percent).toBe(85.5);
      expect(result.processes[0].flags).toContain("high_cpu");
      expect(result.processes[1].flags).toContain("zombie");
      expect(result.suspicious_count).toBe(2);
      expect(result.total_scanned).toBe(150);

      const inv = logger.getLast();
      expect(inv?.args).toContain("scan");
    });

    test("includes scan filter parameters", async () => {
      const runner = createStubRunner<PtCommandResult>(
        [{ command: "pt", response: { stdout: FIXTURES.pt.scan } }],
        logger,
      );

      const client = createPtClient({ runner });
      await client.scan({
        minScore: 60,
        minRuntimeSeconds: 3600,
        minMemoryMb: 100,
        minCpuPercent: 50,
        namePattern: "node",
        excludePattern: "systemd",
        limit: 10,
      });

      const inv = logger.getLast();
      expect(inv?.args).toContain("--min-score");
      expect(inv?.args).toContain("60");
      expect(inv?.args).toContain("--min-runtime");
      expect(inv?.args).toContain("3600");
      expect(inv?.args).toContain("--min-memory");
      expect(inv?.args).toContain("100");
      expect(inv?.args).toContain("--min-cpu");
      expect(inv?.args).toContain("50");
      expect(inv?.args).toContain("--name");
      expect(inv?.args).toContain("node");
      expect(inv?.args).toContain("--exclude");
      expect(inv?.args).toContain("systemd");
      expect(inv?.args).toContain("--limit");
      expect(inv?.args).toContain("10");
    });
  });

  describe("status", () => {
    test("returns status with permissions", async () => {
      const runner = createStubRunner<PtCommandResult>(
        [
          {
            command: "pt",
            argsContain: ["doctor"],
            response: { stdout: FIXTURES.pt.doctor },
          },
          {
            command: "pt",
            argsContain: ["--version"],
            response: { stdout: "pt v0.3.0" },
          },
        ],
        logger,
      );

      const client = createPtClient({ runner });
      const result = await client.status();

      expect(result.available).toBe(true);
      expect(result.canListProcesses).toBe(true);
      expect(result.canKillProcesses).toBe(true);
    });
  });

  describe("isAvailable", () => {
    test("returns true when doctor succeeds", async () => {
      const runner = createStubRunner<PtCommandResult>(
        [{ command: "pt", response: { stdout: FIXTURES.pt.doctor } }],
        logger,
      );

      const client = createPtClient({ runner });
      const result = await client.isAvailable();

      expect(result).toBe(true);
    });

    test("returns false when doctor fails", async () => {
      const runner = createStubRunner<PtCommandResult>(
        [{ command: "pt", response: { stdout: "", exitCode: 1 } }],
        logger,
      );

      const client = createPtClient({ runner });
      const result = await client.isAvailable();

      expect(result).toBe(false);
    });
  });

  describe("error handling", () => {
    test("throws on command failure", async () => {
      const runner = createStubRunner<PtCommandResult>(
        [
          {
            command: "pt",
            response: {
              stdout: "",
              stderr: "Permission denied",
              exitCode: 1,
            },
          },
        ],
        logger,
      );

      const client = createPtClient({ runner });

      await expect(client.doctor()).rejects.toThrow(PtClientError);
    });
  });
});

// ============================================================================
// jfp (Jeffrey's Prompts) Client Contract Tests
// ============================================================================

describe("jfp Client Contract Tests", () => {
  let logger: InvocationLogger;

  beforeEach(() => {
    logger = new InvocationLogger();
  });

  describe("list", () => {
    test("parses prompts list", async () => {
      const runner = createStubRunner<JfpCommandResult>(
        [
          {
            command: "jfp",
            argsContain: ["list", "--json"],
            response: { stdout: FIXTURES.jfp.list },
          },
        ],
        logger,
      );

      const client = createJfpClient({ runner });
      const result = await client.list();

      expect(result.prompts).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.prompts[0].id).toBe("code-review-001");
      expect(result.prompts[0].category).toBe("development");
      expect(result.prompts[0].featured).toBe(true);
      expect(result.prompts[0].difficulty).toBe("intermediate");

      const inv = logger.getLast();
      expect(inv?.command).toBe("jfp");
      expect(inv?.args).toContain("list");
      expect(inv?.args).toContain("--json");
    });
  });

  describe("get", () => {
    test("parses single prompt", async () => {
      const runner = createStubRunner<JfpCommandResult>(
        [
          {
            command: "jfp",
            argsContain: ["show", "code-review-001"],
            response: { stdout: FIXTURES.jfp.show },
          },
        ],
        logger,
      );

      const client = createJfpClient({ runner });
      const result = await client.get("code-review-001");

      expect(result).not.toBeNull();
      expect(result?.id).toBe("code-review-001");
      expect(result?.title).toBe("Comprehensive Code Review");
      expect(result?.tags).toContain("security");
      expect(result?.whenToUse).toHaveLength(2);
      expect(result?.tips).toHaveLength(2);

      const inv = logger.getLast();
      expect(inv?.args).toContain("show");
      expect(inv?.args).toContain("code-review-001");
    });

    test("returns null for not found", async () => {
      const runner = createStubRunner<JfpCommandResult>(
        [
          {
            command: "jfp",
            argsContain: ["show"],
            response: {
              stdout: "",
              stderr: "Prompt not found",
              exitCode: 1,
            },
          },
        ],
        logger,
      );

      const client = createJfpClient({ runner });
      const result = await client.get("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("listCategories", () => {
    test("parses categories with counts", async () => {
      const runner = createStubRunner<JfpCommandResult>(
        [
          {
            command: "jfp",
            argsContain: ["categories", "--json"],
            response: { stdout: FIXTURES.jfp.categories },
          },
        ],
        logger,
      );

      const client = createJfpClient({ runner });
      const result = await client.listCategories();

      expect(result).toHaveLength(3);
      expect(result[0].name).toBe("development");
      expect(result[0].count).toBe(25);
    });
  });

  describe("search", () => {
    test("parses search results", async () => {
      const runner = createStubRunner<JfpCommandResult>(
        [
          {
            command: "jfp",
            argsContain: ["search", "--json"],
            response: { stdout: FIXTURES.jfp.search },
          },
        ],
        logger,
      );

      const client = createJfpClient({ runner });
      const result = await client.search("code review");

      expect(result.query).toBe("code review");
      expect(result.prompts).toHaveLength(1);
      expect(result.prompts[0].id).toBe("code-review-001");

      const inv = logger.getLast();
      expect(inv?.args).toContain("search");
      expect(inv?.args).toContain("code review");
    });

    test("includes search options", async () => {
      const runner = createStubRunner<JfpCommandResult>(
        [{ command: "jfp", response: { stdout: FIXTURES.jfp.search } }],
        logger,
      );

      const client = createJfpClient({ runner });
      await client.search("testing", { limit: 5 });

      const inv = logger.getLast();
      expect(inv?.args).toContain("--limit");
      expect(inv?.args).toContain("5");
    });
  });

  describe("suggest", () => {
    test("parses suggestions for task", async () => {
      const runner = createStubRunner<JfpCommandResult>(
        [
          {
            command: "jfp",
            argsContain: ["suggest", "--json"],
            response: { stdout: FIXTURES.jfp.suggest },
          },
        ],
        logger,
      );

      const client = createJfpClient({ runner });
      const result = await client.suggest("debug a memory leak");

      expect(result.task).toBe("debug a memory leak");
      expect(result.suggestions).toHaveLength(1);
      expect(result.suggestions[0].id).toBe("debug-helper-002");

      const inv = logger.getLast();
      expect(inv?.args).toContain("suggest");
      expect(inv?.args).toContain("debug a memory leak");
    });
  });

  describe("isAvailable", () => {
    test("returns true when version check passes", async () => {
      const runner = createStubRunner<JfpCommandResult>(
        [
          {
            command: "jfp",
            argsContain: ["--version"],
            response: { stdout: "jfp/1.0.0" },
          },
        ],
        logger,
      );

      const client = createJfpClient({ runner });
      const result = await client.isAvailable();

      expect(result).toBe(true);
    });

    test("returns false when version check fails", async () => {
      const runner = createStubRunner<JfpCommandResult>(
        [
          {
            command: "jfp",
            argsContain: ["--version"],
            response: { stdout: "", exitCode: 1 },
          },
        ],
        logger,
      );

      const client = createJfpClient({ runner });
      const result = await client.isAvailable();

      expect(result).toBe(false);
    });
  });

  describe("error handling", () => {
    test("throws on command failure", async () => {
      const runner = createStubRunner<JfpCommandResult>(
        [
          {
            command: "jfp",
            response: { stdout: "", stderr: "Connection error", exitCode: 1 },
          },
        ],
        logger,
      );

      const client = createJfpClient({ runner });

      await expect(client.list()).rejects.toThrow(JfpClientError);
    });

    test("throws on invalid JSON", async () => {
      const runner = createStubRunner<JfpCommandResult>(
        [{ command: "jfp", response: { stdout: "not json" } }],
        logger,
      );

      const client = createJfpClient({ runner });

      await expect(client.list()).rejects.toThrow(JfpClientError);
    });
  });
});

// ============================================================================
// Invocation Logging Tests
// ============================================================================

describe("Invocation Logging", () => {
  test("logs all invocations with timestamps", async () => {
    const logger = new InvocationLogger();
    const runner = createStubRunner<BrCommandResult>(
      [{ command: "br", response: { stdout: FIXTURES.br.ready } }],
      logger,
    );

    const client = createBrClient({ runner, cwd: "/project" });

    await client.ready();
    await client.list();

    const invocations = logger.getAll();
    expect(invocations).toHaveLength(2);

    expect(invocations[0].command).toBe("br");
    expect(invocations[0].args).toContain("ready");
    expect(invocations[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    expect(invocations[1].command).toBe("br");
    expect(invocations[1].args).toContain("list");
  });

  test("dump produces readable output", async () => {
    const logger = new InvocationLogger();
    const runner = createStubRunner<BrCommandResult>(
      [{ command: "br", response: { stdout: FIXTURES.br.ready } }],
      logger,
    );

    const client = createBrClient({ runner, cwd: "/project", timeout: 5000 });
    await client.ready({ limit: 10 });

    const dump = logger.dump();
    expect(dump).toContain("br");
    expect(dump).toContain("ready");
    expect(dump).toContain("--limit");
    expect(dump).toContain("10");
  });

  test("clear removes all invocations", () => {
    const logger = new InvocationLogger();
    logger.log("test", ["arg1"]);
    logger.log("test", ["arg2"]);

    expect(logger.getAll()).toHaveLength(2);

    logger.clear();

    expect(logger.getAll()).toHaveLength(0);
  });
});
