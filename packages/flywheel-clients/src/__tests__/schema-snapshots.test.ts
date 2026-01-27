/**
 * Schema Snapshot Tests for Tool JSON Outputs
 *
 * These tests persist expected JSON shapes as snapshots to detect schema drift.
 * When a tool's output format changes unexpectedly, these tests will fail,
 * alerting maintainers to update schemas or investigate breaking changes.
 *
 * Related:
 * - bd-20sm: Schema snapshot tests for tool JSON outputs
 * - bd-33u3: Tool JSON schema versioning + compatibility policy (ADR-006)
 *
 * How it works:
 * 1. Define representative fixture data for each tool's JSON output
 * 2. Parse through Zod schemas to validate structure
 * 3. Snapshot the parsed result to detect structural changes
 *
 * Why snapshots:
 * - Persists expected shapes in .snap files for git tracking
 * - Fails when schema structure changes (new required fields, type changes)
 * - Documents expected output format for each tool
 */

import { describe, expect, test } from "bun:test";
import { z } from "zod";

// Import all schemas via the client modules
import {
  type BrIssue,
  type BrSyncStatus,
  createBrClient,
  type BrCommandRunner,
  type BrCommandResult,
} from "../br";
import {
  createBvClient,
  type BvCommandRunner,
  type BvCommandResult,
} from "../bv";
import {
  createCaamClient,
  type CaamCommandRunner,
  type CaamCommandResult,
} from "../caam";
import {
  createAprClient,
  type AprCommandRunner,
  type AprCommandResult,
} from "../apr";
import {
  createNtmClient,
  type NtmCommandRunner,
  type NtmCommandResult,
} from "../ntm";
import {
  createMsClient,
  type MsCommandRunner,
  type MsCommandResult,
} from "../ms";
import {
  createPtClient,
  type PtCommandRunner,
  type PtCommandResult,
} from "../pt";
import {
  createJfpClient,
  type JfpCommandRunner,
  type JfpCommandResult,
} from "../jfp";
import {
  createCassClient,
  type CassCommandRunner,
  type CassCommandResult,
} from "../cass";
import {
  createCMClient,
  type CMCommandRunner,
  type CMCommandResult,
} from "../cm";
import {
  createRuClient,
  type RuCommandRunner,
  type RuCommandResult,
} from "../ru";

// ============================================================================
// Fixture Factory: Creates a stub runner that returns predefined JSON
// ============================================================================

function createFixtureRunner<T extends { stdout: string; stderr: string; exitCode: number }>(
  fixture: string,
): { run: () => Promise<T> } {
  return {
    run: async () =>
      ({
        stdout: fixture,
        stderr: "",
        exitCode: 0,
      }) as T,
  };
}

// ============================================================================
// Tool Fixtures: Representative JSON outputs for each tool
// ============================================================================

const SCHEMA_FIXTURES = {
  // -------------------------------------------------------------------------
  // br (Beads Issue Tracker)
  // -------------------------------------------------------------------------
  br: {
    issue: JSON.stringify({
      id: "bd-abc12",
      title: "Implement feature X",
      description: "Detailed description of the feature",
      status: "in_progress",
      priority: 2,
      issue_type: "task",
      created_at: "2026-01-15T08:00:00Z",
      created_by: "agent:BlueLake",
      updated_at: "2026-01-27T12:00:00Z",
      assignee: "agent:MagentaHeron",
      owner: "human:jeffrey",
      labels: ["api", "backend", "priority-high"],
      dependency_count: 2,
      dependent_count: 1,
      dependencies: [
        { id: "bd-dep01", title: "Setup database", status: "closed", priority: 1 },
        { id: "bd-dep02", title: "Define API spec", status: "open", priority: 2, dep_type: "blocks" },
      ],
      dependents: [
        { id: "bd-child1", title: "Write tests", status: "open" },
      ],
      parent: "bd-epic1",
      external_ref: "GH#123",
      due_at: "2026-02-01T00:00:00Z",
      compaction_level: 0,
      original_size: 1500,
    }),
    issueList: JSON.stringify([
      {
        id: "bd-test1",
        title: "First bead",
        status: "open",
        priority: 1,
        issue_type: "bug",
        labels: ["urgent"],
      },
      {
        id: "bd-test2",
        title: "Second bead",
        status: "closed",
        priority: 3,
        issue_type: "feature",
        closed_at: "2026-01-26T10:00:00Z",
      },
    ]),
    syncStatus: JSON.stringify({
      dirty_count: 3,
      last_export_time: "2026-01-27T11:00:00Z",
      last_import_time: "2026-01-27T10:00:00Z",
      jsonl_content_hash: "sha256:abc123def456",
      jsonl_exists: true,
      jsonl_newer: false,
      db_newer: true,
    }),
  },

  // -------------------------------------------------------------------------
  // bv (Beads Visualizer / Graph-Aware Triage)
  // -------------------------------------------------------------------------
  bv: {
    triage: JSON.stringify({
      generated_at: "2026-01-27T12:00:00Z",
      data_hash: "hash123abc",
      triage: {
        recommendations: [
          {
            id: "bd-rec1",
            title: "High-priority unblocked task",
            score: 0.95,
            reasons: ["No blockers", "High priority", "Clear scope"],
            priority: 1,
            status: "open",
          },
          {
            id: "bd-rec2",
            title: "Quick documentation fix",
            score: 0.82,
            reasons: ["Small scope", "No dependencies"],
            type: "docs",
          },
        ],
        quick_wins: [
          {
            id: "bd-qw1",
            title: "Fix typo in README",
            score: 0.9,
            type: "docs",
            estimated_minutes: 5,
          },
        ],
        blockers_to_clear: [
          {
            id: "bd-blocker1",
            title: "Database migration",
            score: 0.88,
            blocked_count: 3,
            priority: 1,
          },
        ],
      },
    }),
    graph: JSON.stringify({
      format: "json",
      nodes: [
        { id: "bd-1", title: "Root task", status: "open", priority: 1 },
        { id: "bd-2", title: "Child task", status: "in_progress", priority: 2 },
        { id: "bd-3", title: "Completed task", status: "closed", priority: 3 },
      ],
      edges: [
        { source: "bd-1", target: "bd-2", type: "blocks" },
        { source: "bd-2", target: "bd-3", type: "depends_on" },
      ],
      data_hash: "graph123hash",
    }),
  },

  // -------------------------------------------------------------------------
  // caam (CLI Account Manager)
  // -------------------------------------------------------------------------
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
            last_check: "2026-01-27T12:00:00Z",
          },
          identity: {
            email: "user@example.com",
            plan_type: "max",
            usage_percent: 45,
          },
        },
        {
          tool: "codex",
          logged_in: true,
          active_profile: "work",
          health: {
            status: "degraded",
            error_count: 2,
            last_error: "Rate limit exceeded",
          },
          identity: {
            email: "work@company.com",
            plan_type: "pro",
          },
        },
        {
          tool: "gemini",
          logged_in: false,
          error: "No credentials found",
        },
      ],
      warnings: ["Codex rate limit count elevated"],
      recommendations: ["Consider switching to backup profile for codex"],
    }),
    activate: JSON.stringify({
      success: true,
      tool: "claude-code",
      profile: "backup",
      previous_profile: "default",
      refreshed: true,
      message: "Profile switched successfully",
    }),
  },

  // -------------------------------------------------------------------------
  // apr (Automated Plan Reviser)
  // -------------------------------------------------------------------------
  apr: {
    status: JSON.stringify({
      ok: true,
      code: "success",
      data: {
        configured: true,
        default_workflow: "main",
        workflow_count: 3,
        workflows: ["main", "feature", "hotfix"],
        oracle_available: true,
        oracle_method: "claude",
        config_dir: "/home/user/.apr",
        apr_home: "/home/user/.apr",
      },
      meta: { v: "0.6.0", ts: "2026-01-27T12:00:00Z" },
    }),
    workflows: JSON.stringify({
      ok: true,
      code: "success",
      data: {
        workflows: [
          {
            name: "main",
            description: "Primary development workflow",
            path: "/project/.apr/main",
            rounds: 5,
            last_run: "2026-01-27T10:00:00Z",
            status: "active",
          },
          {
            name: "feature",
            description: "Feature branch workflow",
            path: "/project/.apr/feature",
            rounds: 2,
            status: "idle",
          },
        ],
      },
      meta: { v: "0.6.0", ts: "2026-01-27T12:00:00Z" },
    }),
    round: JSON.stringify({
      ok: true,
      code: "success",
      data: {
        round: 3,
        workflow: "main",
        status: "completed",
        created_at: "2026-01-27T08:00:00Z",
        completed_at: "2026-01-27T08:45:00Z",
        metrics: {
          word_count: 2500,
          section_count: 8,
          code_block_count: 5,
          convergence_score: 0.92,
          diff_lines_added: 150,
          diff_lines_removed: 45,
        },
      },
      meta: { v: "0.6.0", ts: "2026-01-27T12:00:00Z" },
    }),
    history: JSON.stringify({
      ok: true,
      code: "success",
      data: {
        workflow: "main",
        rounds: [
          { round: 1, workflow: "main", status: "completed", created_at: "2026-01-25T10:00:00Z" },
          { round: 2, workflow: "main", status: "completed", created_at: "2026-01-26T10:00:00Z" },
          { round: 3, workflow: "main", status: "completed", created_at: "2026-01-27T08:00:00Z" },
        ],
        total: 3,
      },
      meta: { v: "0.6.0", ts: "2026-01-27T12:00:00Z" },
    }),
  },

  // -------------------------------------------------------------------------
  // ntm (Named Tmux Manager)
  // -------------------------------------------------------------------------
  ntm: {
    status: JSON.stringify({
      generated_at: "2026-01-27T12:00:00Z",
      system: {
        version: "0.8.0",
        commit: "abc123def",
        build_date: "2026-01-15",
        go_version: "1.22",
        os: "linux",
        arch: "amd64",
        tmux_available: true,
      },
      sessions: [
        {
          name: "flywheel",
          exists: true,
          attached: true,
          windows: 3,
          panes: 6,
          created_at: "2026-01-27T08:00:00Z",
          agents: [
            { type: "claude", variant: "opus-4.5", pane: "%0", window: 0, pane_idx: 0, is_active: true },
            { type: "codex", variant: "o3", pane: "%1", window: 0, pane_idx: 1, is_active: false },
          ],
        },
        {
          name: "smartedgar",
          exists: true,
          attached: false,
          windows: 2,
          panes: 4,
          created_at: "2026-01-26T14:00:00Z",
        },
      ],
      summary: {
        total_sessions: 2,
        total_agents: 4,
        attached_count: 1,
        claude_count: 2,
        codex_count: 1,
        gemini_count: 1,
        cursor_count: 0,
        windsurf_count: 0,
        aider_count: 0,
      },
    }),
    snapshot: JSON.stringify({
      ts: "2026-01-27T12:00:00Z",
      sessions: [
        {
          name: "flywheel",
          attached: true,
          agents: [
            {
              pane: "%0",
              type: "claude",
              variant: "opus-4.5",
              type_confidence: 0.98,
              type_method: "prompt_analysis",
              state: "working",
              last_output_age_sec: 5,
              output_tail_lines: 100,
              current_bead: "bd-20sm",
              pending_mail: 0,
            },
            {
              pane: "%1",
              type: "codex",
              variant: "o3",
              type_confidence: 0.95,
              type_method: "pattern_match",
              state: "idle",
              last_output_age_sec: 120,
              output_tail_lines: 50,
              current_bead: null,
              pending_mail: 2,
            },
          ],
        },
      ],
      alerts: [
        {
          id: "alert-001",
          type: "context_high",
          severity: "warning",
          message: "Agent claude/%0 context usage at 75%",
          session: "flywheel",
          pane: "%0",
          context: { usage_percent: 75, threshold: 70 },
          created_at: "2026-01-27T11:55:00Z",
          duration_ms: 300000,
          count: 1,
        },
      ],
      alert_summary: {
        total_active: 1,
        by_severity: { warning: 1 },
        by_type: { context_high: 1 },
      },
    }),
    health: JSON.stringify({
      success: true,
      session: "flywheel",
      checked_at: "2026-01-27T12:00:00Z",
      agents: [
        {
          pane: 0,
          agent_type: "claude",
          health: "healthy",
          idle_since_seconds: 5,
          restarts: 0,
          rate_limit_count: 0,
          backoff_remaining: 0,
          confidence: 0.98,
        },
        {
          pane: 1,
          agent_type: "codex",
          health: "degraded",
          idle_since_seconds: 120,
          restarts: 1,
          last_error: "Temporary rate limit",
          rate_limit_count: 2,
          backoff_remaining: 30,
          confidence: 0.95,
        },
      ],
      summary: {
        total: 2,
        healthy: 1,
        degraded: 1,
        unhealthy: 0,
        rate_limited: 1,
      },
    }),
    context: JSON.stringify({
      success: true,
      timestamp: "2026-01-27T12:00:00Z",
      session: "flywheel",
      captured_at: "2026-01-27T12:00:00Z",
      agents: [
        {
          pane: "%0",
          pane_idx: 0,
          agent_type: "claude",
          model: "opus-4.5",
          estimated_tokens: 75000,
          with_overhead: 82500,
          context_limit: 200000,
          usage_percent: 41.25,
          usage_level: "medium",
          confidence: "high",
          state: "working",
        },
      ],
      summary: {
        total_agents: 1,
        high_usage_count: 0,
        avg_usage: 41.25,
      },
    }),
  },

  // -------------------------------------------------------------------------
  // ms (Meta Skill)
  // -------------------------------------------------------------------------
  ms: {
    doctor: JSON.stringify({
      ok: true,
      code: "success",
      data: {
        status: "healthy",
        checks: [
          { name: "database", status: "ok", message: "SQLite connected" },
          { name: "embeddings", status: "ok", message: "Model loaded (all-MiniLM-L6-v2)" },
          { name: "index", status: "ok", message: "Index up to date" },
        ],
        embedding_service: {
          available: true,
          model: "all-MiniLM-L6-v2",
          latency_ms: 45,
        },
        storage: {
          data_dir: "/home/user/.ms",
          size_bytes: 2097152,
          index_count: 12,
        },
      },
      meta: { v: "1.3.0", ts: "2026-01-27T12:00:00Z" },
    }),
    list: JSON.stringify({
      ok: true,
      code: "success",
      data: {
        knowledge_bases: [
          {
            name: "skills",
            description: "Agent skills and capabilities documentation",
            entry_count: 200,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-27T10:00:00Z",
          },
          {
            name: "prompts",
            description: "Curated prompt templates",
            entry_count: 85,
            created_at: "2026-01-10T00:00:00Z",
            updated_at: "2026-01-26T15:00:00Z",
          },
        ],
      },
      meta: { v: "1.3.0", ts: "2026-01-27T12:00:00Z" },
    }),
    search: JSON.stringify({
      ok: true,
      code: "success",
      data: {
        query: "git workflow",
        results: [
          {
            id: "skill-git-001",
            title: "Git Branch Management",
            snippet: "Best practices for managing git branches in multi-agent workflows...",
            score: 0.94,
            knowledge_base: "skills",
            source: "git-workflow.md",
          },
          {
            id: "skill-git-002",
            title: "Commit Message Standards",
            snippet: "Standardized commit message format for automated agents...",
            score: 0.87,
            knowledge_base: "skills",
            source: "commit-standards.md",
          },
        ],
        total: 2,
        took_ms: 38,
        semantic_enabled: true,
      },
      meta: { v: "1.3.0", ts: "2026-01-27T12:00:00Z" },
    }),
  },

  // -------------------------------------------------------------------------
  // pt (Process Triage)
  // -------------------------------------------------------------------------
  pt: {
    doctor: JSON.stringify({
      ok: true,
      code: "success",
      data: {
        status: "healthy",
        checks: [
          { name: "procfs", status: "ok", message: "/proc accessible" },
          { name: "permissions", status: "ok", message: "Can read process info" },
          { name: "cgroups", status: "ok", message: "cgroups v2 available" },
        ],
        permissions: {
          can_list_processes: true,
          can_kill_processes: true,
        },
      },
      meta: { v: "0.4.0", ts: "2026-01-27T12:00:00Z" },
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
            cmdline: "node /app/server.js",
            user: "ubuntu",
            state: "S",
            cpu_percent: 92.5,
            memory_percent: 18.3,
            memory_rss_mb: 756,
            started_at: "2026-01-27T06:00:00Z",
            runtime_seconds: 21600,
            score: 85,
            score_breakdown: {
              cpu_score: 45,
              memory_score: 20,
              runtime_score: 10,
              state_score: 10,
            },
            flags: ["high_cpu", "long_running", "high_memory"],
          },
          {
            pid: 67890,
            ppid: 12345,
            name: "defunct_worker",
            cmdline: "[defunct_worker] <defunct>",
            user: "ubuntu",
            state: "Z",
            cpu_percent: 0,
            memory_percent: 0,
            memory_rss_mb: 0,
            score: 95,
            score_breakdown: {
              cpu_score: 0,
              memory_score: 0,
              runtime_score: 0,
              state_score: 95,
            },
            flags: ["zombie"],
          },
        ],
        total_scanned: 185,
        suspicious_count: 2,
        scan_time_ms: 142,
        timestamp: "2026-01-27T12:00:00Z",
        thresholds: {
          min_score: 50,
          min_runtime_seconds: 0,
          min_memory_mb: 0,
          min_cpu_percent: 0,
        },
      },
      meta: { v: "0.4.0", ts: "2026-01-27T12:00:00Z" },
    }),
  },

  // -------------------------------------------------------------------------
  // jfp (Jeffrey's Prompts)
  // -------------------------------------------------------------------------
  jfp: {
    list: JSON.stringify({
      prompts: [
        {
          id: "code-review-001",
          title: "Comprehensive Code Review",
          description: "Thorough code review focusing on quality, security, and maintainability",
          category: "development",
          tags: ["code-review", "security", "quality", "best-practices"],
          author: "Jeffrey",
          version: "2.0.0",
          featured: true,
          difficulty: "intermediate",
          estimatedTokens: 600,
          created: "2026-01-01T00:00:00Z",
          content: "Review the following code for quality, security, and maintainability...",
          whenToUse: ["PR reviews", "Code audits", "Pre-merge checks"],
          tips: ["Focus on security first", "Check for edge cases", "Verify error handling"],
        },
        {
          id: "debug-systematic-002",
          title: "Systematic Debugging",
          description: "Step-by-step debugging methodology for complex issues",
          category: "debugging",
          tags: ["debugging", "troubleshooting", "methodology"],
          author: "Jeffrey",
          version: "1.5.0",
          featured: false,
          difficulty: "advanced",
          estimatedTokens: 450,
          created: "2026-01-10T00:00:00Z",
          content: "Apply systematic debugging methodology...",
        },
      ],
    }),
    show: JSON.stringify({
      id: "code-review-001",
      title: "Comprehensive Code Review",
      description: "Thorough code review focusing on quality, security, and maintainability",
      category: "development",
      tags: ["code-review", "security", "quality", "best-practices"],
      author: "Jeffrey",
      version: "2.0.0",
      featured: true,
      difficulty: "intermediate",
      estimatedTokens: 600,
      created: "2026-01-01T00:00:00Z",
      content: "Review the following code for quality, security, and maintainability...",
      whenToUse: ["PR reviews", "Code audits", "Pre-merge checks"],
      tips: ["Focus on security first", "Check for edge cases", "Verify error handling"],
    }),
    categories: JSON.stringify([
      { name: "development", count: 30 },
      { name: "debugging", count: 18 },
      { name: "writing", count: 12 },
      { name: "analysis", count: 8 },
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
          version: "2.0.0",
          featured: true,
          difficulty: "intermediate",
          estimatedTokens: 600,
          created: "2026-01-01T00:00:00Z",
          content: "Review the following code...",
        },
      ],
    }),
    suggest: JSON.stringify({
      suggestions: [
        {
          id: "debug-systematic-002",
          title: "Systematic Debugging",
          description: "Step-by-step debugging methodology",
          category: "debugging",
          tags: ["debugging", "troubleshooting"],
          author: "Jeffrey",
          version: "1.5.0",
          featured: false,
          difficulty: "advanced",
          estimatedTokens: 450,
          created: "2026-01-10T00:00:00Z",
          content: "Apply systematic debugging methodology...",
        },
      ],
    }),
  },

  // -------------------------------------------------------------------------
  // cass (Cross-Agent Session Search)
  // -------------------------------------------------------------------------
  cass: {
    health: JSON.stringify({
      healthy: true,
      latency_ms: 12,
      _meta: {
        elapsed_ms: 15,
        data_dir: "/home/user/.cass",
        db_path: "/home/user/.cass/index.db",
        index_freshness_seconds: 300,
      },
    }),
    search: JSON.stringify({
      count: 3,
      cursor: "cursor_abc123",
      hits: [
        {
          agent: "claude-code",
          content: "Implemented the authentication flow using JWT tokens...",
          created_at: 1706356800,
          line_number: 245,
          match_type: "semantic",
          origin_kind: "session",
          score: 0.94,
          snippet: "...using JWT tokens for secure authentication...",
          source_id: "session-001",
          source_path: "/home/user/.claude/sessions/abc123.jsonl",
          title: "Authentication Implementation",
          workspace: "/data/projects/backend",
        },
        {
          agent: "codex",
          content: "Added OAuth2 support with refresh token handling...",
          created_at: 1706270400,
          line_number: 189,
          match_type: "lexical",
          origin_kind: "session",
          score: 0.87,
          snippet: "...OAuth2 support with refresh tokens...",
          source_path: "/home/user/.codex/sessions/def456.jsonl",
          workspace: "/data/projects/backend",
        },
        {
          agent: "claude-code",
          line_number: 512,
          source_path: "/home/user/.claude/sessions/ghi789.jsonl",
          score: 0.72,
        },
      ],
      hits_clamped: false,
      limit: 10,
      max_tokens: 4000,
      offset: 0,
      query: "authentication JWT",
      request_id: "req-xyz789",
      total_matches: 3,
      _meta: {
        elapsed_ms: 85,
        wildcard_fallback: false,
      },
    }),
    view: JSON.stringify({
      path: "/home/user/.claude/sessions/abc123.jsonl",
      line_number: 245,
      context_before: [
        "User: Can you help implement authentication?",
        "Assistant: I'll implement JWT-based authentication.",
      ],
      content: "Implemented the authentication flow using JWT tokens with proper expiration handling.",
      context_after: [
        "The token includes user ID, role, and expiration timestamp.",
        "Refresh tokens are stored securely in httpOnly cookies.",
      ],
      role: "assistant",
      agent: "claude-code",
    }),
    expand: JSON.stringify({
      path: "/home/user/.claude/sessions/abc123.jsonl",
      target_line: 245,
      messages: [
        {
          line_number: 240,
          role: "user",
          content: "Can you help implement authentication?",
          timestamp: 1706356700,
        },
        {
          line_number: 242,
          role: "assistant",
          content: "I'll implement JWT-based authentication. Here's the plan...",
          timestamp: 1706356750,
        },
        {
          line_number: 245,
          role: "assistant",
          content: "Implemented the authentication flow using JWT tokens...",
          timestamp: 1706356800,
        },
      ],
      total_messages: 3,
    }),
  },

  // -------------------------------------------------------------------------
  // cm (Cass-Memory / Procedural Memory)
  // -------------------------------------------------------------------------
  cm: {
    context: JSON.stringify({
      success: true,
      task: "implement authentication",
      relevantBullets: [
        {
          id: "rule-auth-001",
          text: "Always use bcrypt with cost factor >= 12 for password hashing",
          category: "security",
          scope: "authentication",
          state: "active",
          kind: "rule",
          confidence: 0.95,
          sourceCount: 15,
          lastApplied: "2026-01-26T10:00:00Z",
          helpfulCount: 12,
          harmfulCount: 0,
          score: 0.92,
        },
        {
          id: "rule-auth-002",
          text: "Set JWT expiration to 15 minutes for access tokens, 7 days for refresh tokens",
          category: "security",
          scope: "authentication",
          state: "active",
          kind: "rule",
          confidence: 0.88,
          sourceCount: 8,
          score: 0.85,
        },
      ],
      antiPatterns: [
        {
          id: "anti-auth-001",
          text: "Never store plaintext passwords or use MD5/SHA1 for password hashing",
          category: "security",
          scope: "authentication",
          state: "active",
          kind: "anti-pattern",
          confidence: 0.99,
          score: 0.98,
        },
      ],
      historySnippets: [
        {
          source_path: "/home/user/.claude/sessions/abc123.jsonl",
          line_number: 245,
          agent: "claude-code",
          workspace: "/data/projects/backend",
          title: "JWT Implementation",
          snippet: "Used jsonwebtoken library with RS256 signing...",
          score: 0.91,
          created_at: 1706356800,
          origin: { kind: "local" },
        },
      ],
      deprecatedWarnings: [],
      suggestedCassQueries: [
        "JWT token implementation",
        "bcrypt password hashing",
        "OAuth2 refresh token",
      ],
    }),
    quickstart: JSON.stringify({
      success: true,
      summary: "CM provides procedural memory for coding agents",
      oneCommand: "cm context \"your task description\" --json",
      expectations: {
        input: "A task description string",
        output: "Relevant rules, anti-patterns, and history snippets",
      },
      whatItReturns: [
        "relevantBullets - Rules applicable to your task",
        "antiPatterns - Things to avoid",
        "historySnippets - Past relevant session excerpts",
      ],
      doNotDo: [
        "Don't skip reading returned rules before starting work",
        "Don't ignore anti-patterns",
        "Don't forget to record outcomes for feedback",
      ],
      protocol: {
        start: "cm context \"task\" --json",
        during: "Follow returned rules",
        end: "cm outcome success/failure rule-ids --json",
      },
      examples: [
        "cm context \"implement user authentication\" --json",
        "cm context \"refactor database queries\" --workspace /project --json",
      ],
      operatorNote: {
        automation: "Can be integrated into agent startup scripts",
        health: "Use cm doctor --json to check system health",
      },
      soloUser: {
        description: "For individual developers without agent swarms",
        manualReflection: ["Review rules weekly", "Add new learnings manually"],
        onboarding: ["Start with cm quickstart", "Run cm stats to see coverage"],
      },
      inlineFeedbackFormat: {
        helpful: "[CM-HELPFUL: rule-id]",
        harmful: "[CM-HARMFUL: rule-id reason]",
      },
    }),
    stats: JSON.stringify({
      success: true,
      total: 150,
      byScope: {
        authentication: 25,
        database: 40,
        api: 35,
        testing: 30,
        general: 20,
      },
      byState: {
        active: 130,
        deprecated: 15,
        pending: 5,
      },
      byKind: {
        rule: 100,
        "anti-pattern": 30,
        procedure: 20,
      },
      scoreDistribution: {
        excellent: 45,
        good: 60,
        neutral: 35,
        atRisk: 10,
      },
      topPerformers: [
        {
          id: "rule-db-001",
          text: "Always use parameterized queries",
          score: 0.99,
          helpfulCount: 50,
        },
      ],
      mostHelpful: [
        {
          id: "rule-api-001",
          text: "Return appropriate HTTP status codes",
          helpfulCount: 45,
          score: 0.95,
        },
      ],
      atRiskCount: 10,
      staleCount: 5,
    }),
    doctor: JSON.stringify({
      success: true,
      version: "0.4.0",
      generatedAt: "2026-01-27T12:00:00Z",
      overallStatus: "healthy",
      checks: [
        {
          category: "database",
          item: "SQLite connection",
          status: "pass",
          message: "Database connected successfully",
          details: { path: "/home/user/.cm/playbook.db", size_mb: 2.5 },
        },
        {
          category: "cass",
          item: "CASS integration",
          status: "pass",
          message: "CASS available for history search",
          details: { latency_ms: 12 },
        },
        {
          category: "playbook",
          item: "Rule coverage",
          status: "warn",
          message: "Some categories have low coverage",
          details: { low_coverage: ["testing"] },
          fix: "Add more rules for testing category",
        },
      ],
    }),
    playbookList: JSON.stringify({
      success: true,
      bullets: [
        {
          id: "rule-001",
          text: "Use meaningful variable names",
          category: "code-quality",
          scope: "general",
          state: "active",
          kind: "rule",
          confidence: 0.9,
          score: 0.88,
        },
        {
          id: "rule-002",
          text: "Write tests before implementation",
          category: "testing",
          scope: "general",
          state: "active",
          kind: "procedure",
          confidence: 0.85,
          score: 0.82,
        },
      ],
    }),
    outcome: JSON.stringify({
      success: true,
      message: "Outcome recorded successfully",
      recorded: 3,
    }),
  },

  // -------------------------------------------------------------------------
  // ru (Repo Updater)
  // -------------------------------------------------------------------------
  ru: {
    version: JSON.stringify({
      version: "0.12.0",
      commit: "abc123def",
      date: "2026-01-15",
    }),
    status: JSON.stringify({
      repos: 25,
      cloned: 22,
      dirty: 3,
      synced: 19,
      last_sync: "2026-01-27T10:00:00Z",
    }),
    list: JSON.stringify([
      {
        name: "flywheel_gateway",
        fullName: "owner/flywheel_gateway",
        path: "/data/projects/flywheel_gateway",
        remote: "git@github.com:owner/flywheel_gateway.git",
        branch: "main",
        commit: "abc123",
        dirty: false,
        cloned: true,
        group: "primary",
        lastSync: "2026-01-27T10:00:00Z",
      },
      {
        name: "smartedgar_mcp",
        fullName: "owner/smartedgar_mcp",
        path: "/data/projects/smartedgar_mcp",
        remote: "git@github.com:owner/smartedgar_mcp.git",
        branch: "main",
        commit: "def456",
        dirty: true,
        cloned: true,
        group: "secondary",
        lastSync: "2026-01-26T15:00:00Z",
      },
    ]),
    sync: JSON.stringify({
      success: true,
      repo: "owner/flywheel_gateway",
      commit: "abc123def456",
      commits: 3,
      files: 12,
      message: "Sync completed successfully",
    }),
    sweepPhase1: JSON.stringify({
      phase: "phase1",
      success: true,
      repo: "owner/flywheel_gateway",
      message: "Analysis complete",
      actions: [
        { type: "update_deps", count: 5 },
        { type: "fix_lint", count: 12 },
      ],
      duration_ms: 45000,
    }),
    sweepPhase2: JSON.stringify({
      phase: "phase2",
      success: true,
      repo: "owner/flywheel_gateway",
      message: "Plan generated",
      plan: {
        actions: [
          { type: "commit", message: "Update dependencies" },
          { type: "pr", title: "Automated maintenance" },
        ],
        estimated_duration_ms: 30000,
        risk_level: "low",
      },
      duration_ms: 120000,
    }),
    sweepPhase3: JSON.stringify({
      phase: "phase3",
      success: true,
      repo: "owner/flywheel_gateway",
      message: "Execution complete",
      duration_ms: 25000,
    }),
  },
};

// ============================================================================
// br (Beads) Schema Snapshot Tests
// ============================================================================

describe("br Schema Snapshots", () => {
  test("issue shape matches snapshot", async () => {
    const runner = createFixtureRunner<BrCommandResult>(SCHEMA_FIXTURES.br.issue);
    const client = createBrClient({ runner: runner as BrCommandRunner });
    const result = await client.show("bd-abc12");
    expect(result[0]).toMatchSnapshot();
  });

  test("issue list shape matches snapshot", async () => {
    const runner = createFixtureRunner<BrCommandResult>(SCHEMA_FIXTURES.br.issueList);
    const client = createBrClient({ runner: runner as BrCommandRunner });
    const result = await client.list();
    expect(result).toMatchSnapshot();
  });

  test("sync status shape matches snapshot", async () => {
    const runner = createFixtureRunner<BrCommandResult>(SCHEMA_FIXTURES.br.syncStatus);
    const client = createBrClient({ runner: runner as BrCommandRunner });
    const result = await client.syncStatus();
    expect(result).toMatchSnapshot();
  });
});

// ============================================================================
// bv (Beads Visualizer) Schema Snapshot Tests
// ============================================================================

describe("bv Schema Snapshots", () => {
  test("triage shape matches snapshot", async () => {
    const runner = createFixtureRunner<BvCommandResult>(SCHEMA_FIXTURES.bv.triage);
    const client = createBvClient({ runner: runner as BvCommandRunner });
    const result = await client.getTriage();
    expect(result).toMatchSnapshot();
  });

  test("graph shape matches snapshot", async () => {
    const runner = createFixtureRunner<BvCommandResult>(SCHEMA_FIXTURES.bv.graph);
    const client = createBvClient({ runner: runner as BvCommandRunner });
    const result = await client.getGraph();
    expect(result).toMatchSnapshot();
  });
});

// ============================================================================
// caam (Account Manager) Schema Snapshot Tests
// ============================================================================

describe("caam Schema Snapshots", () => {
  test("status shape matches snapshot", async () => {
    const runner = createFixtureRunner<CaamCommandResult>(SCHEMA_FIXTURES.caam.status);
    const client = createCaamClient({ runner: runner as CaamCommandRunner });
    const result = await client.status();
    expect(result).toMatchSnapshot();
  });

  test("activate shape matches snapshot", async () => {
    const runner = createFixtureRunner<CaamCommandResult>(SCHEMA_FIXTURES.caam.activate);
    const client = createCaamClient({ runner: runner as CaamCommandRunner });
    const result = await client.activate({ provider: "claude-code", profile: "backup" });
    expect(result).toMatchSnapshot();
  });
});

// ============================================================================
// apr (Automated Plan Reviser) Schema Snapshot Tests
// ============================================================================

describe("apr Schema Snapshots", () => {
  test("status shape matches snapshot", async () => {
    const runner = createFixtureRunner<AprCommandResult>(SCHEMA_FIXTURES.apr.status);
    const client = createAprClient({ runner: runner as AprCommandRunner });
    const result = await client.getStatus();
    expect(result).toMatchSnapshot();
  });

  test("workflows shape matches snapshot", async () => {
    const runner = createFixtureRunner<AprCommandResult>(SCHEMA_FIXTURES.apr.workflows);
    const client = createAprClient({ runner: runner as AprCommandRunner });
    const result = await client.listWorkflows();
    expect(result).toMatchSnapshot();
  });

  test("round shape matches snapshot", async () => {
    const runner = createFixtureRunner<AprCommandResult>(SCHEMA_FIXTURES.apr.round);
    const client = createAprClient({ runner: runner as AprCommandRunner });
    const result = await client.getRound(3);
    expect(result).toMatchSnapshot();
  });

  test("history shape matches snapshot", async () => {
    const runner = createFixtureRunner<AprCommandResult>(SCHEMA_FIXTURES.apr.history);
    const client = createAprClient({ runner: runner as AprCommandRunner });
    const result = await client.getHistory();
    expect(result).toMatchSnapshot();
  });
});

// ============================================================================
// ntm (Named Tmux Manager) Schema Snapshot Tests
// ============================================================================

describe("ntm Schema Snapshots", () => {
  test("status shape matches snapshot", async () => {
    const runner = createFixtureRunner<NtmCommandResult>(SCHEMA_FIXTURES.ntm.status);
    const client = createNtmClient({ runner: runner as NtmCommandRunner });
    const result = await client.status();
    expect(result).toMatchSnapshot();
  });

  test("snapshot shape matches snapshot", async () => {
    const runner = createFixtureRunner<NtmCommandResult>(SCHEMA_FIXTURES.ntm.snapshot);
    const client = createNtmClient({ runner: runner as NtmCommandRunner });
    const result = await client.snapshot();
    expect(result).toMatchSnapshot();
  });

  test("health shape matches snapshot", async () => {
    const runner = createFixtureRunner<NtmCommandResult>(SCHEMA_FIXTURES.ntm.health);
    const client = createNtmClient({ runner: runner as NtmCommandRunner });
    const result = await client.health("flywheel");
    expect(result).toMatchSnapshot();
  });

  test("context shape matches snapshot", async () => {
    const runner = createFixtureRunner<NtmCommandResult>(SCHEMA_FIXTURES.ntm.context);
    const client = createNtmClient({ runner: runner as NtmCommandRunner });
    const result = await client.context("flywheel");
    expect(result).toMatchSnapshot();
  });
});

// ============================================================================
// ms (Meta Skill) Schema Snapshot Tests
// ============================================================================

describe("ms Schema Snapshots", () => {
  test("doctor shape matches snapshot", async () => {
    const runner = createFixtureRunner<MsCommandResult>(SCHEMA_FIXTURES.ms.doctor);
    const client = createMsClient({ runner: runner as MsCommandRunner });
    const result = await client.doctor();
    expect(result).toMatchSnapshot();
  });

  test("list shape matches snapshot", async () => {
    const runner = createFixtureRunner<MsCommandResult>(SCHEMA_FIXTURES.ms.list);
    const client = createMsClient({ runner: runner as MsCommandRunner });
    const result = await client.listKnowledgeBases();
    expect(result).toMatchSnapshot();
  });

  test("search shape matches snapshot", async () => {
    const runner = createFixtureRunner<MsCommandResult>(SCHEMA_FIXTURES.ms.search);
    const client = createMsClient({ runner: runner as MsCommandRunner });
    const result = await client.search("git workflow");
    expect(result).toMatchSnapshot();
  });
});

// ============================================================================
// pt (Process Triage) Schema Snapshot Tests
// ============================================================================

describe("pt Schema Snapshots", () => {
  test("doctor shape matches snapshot", async () => {
    const runner = createFixtureRunner<PtCommandResult>(SCHEMA_FIXTURES.pt.doctor);
    const client = createPtClient({ runner: runner as PtCommandRunner });
    const result = await client.doctor();
    expect(result).toMatchSnapshot();
  });

  test("scan shape matches snapshot", async () => {
    const runner = createFixtureRunner<PtCommandResult>(SCHEMA_FIXTURES.pt.scan);
    const client = createPtClient({ runner: runner as PtCommandRunner });
    const result = await client.scan();
    expect(result).toMatchSnapshot();
  });
});

// ============================================================================
// jfp (Jeffrey's Prompts) Schema Snapshot Tests
// ============================================================================

describe("jfp Schema Snapshots", () => {
  test("list shape matches snapshot", async () => {
    const runner = createFixtureRunner<JfpCommandResult>(SCHEMA_FIXTURES.jfp.list);
    const client = createJfpClient({ runner: runner as JfpCommandRunner });
    const result = await client.list();
    expect(result).toMatchSnapshot();
  });

  test("show shape matches snapshot", async () => {
    const runner = createFixtureRunner<JfpCommandResult>(SCHEMA_FIXTURES.jfp.show);
    const client = createJfpClient({ runner: runner as JfpCommandRunner });
    const result = await client.get("code-review-001");
    expect(result).toMatchSnapshot();
  });

  test("categories shape matches snapshot", async () => {
    const runner = createFixtureRunner<JfpCommandResult>(SCHEMA_FIXTURES.jfp.categories);
    const client = createJfpClient({ runner: runner as JfpCommandRunner });
    const result = await client.listCategories();
    expect(result).toMatchSnapshot();
  });

  test("search shape matches snapshot", async () => {
    const runner = createFixtureRunner<JfpCommandResult>(SCHEMA_FIXTURES.jfp.search);
    const client = createJfpClient({ runner: runner as JfpCommandRunner });
    const result = await client.search("code review");
    expect(result).toMatchSnapshot();
  });

  test("suggest shape matches snapshot", async () => {
    const runner = createFixtureRunner<JfpCommandResult>(SCHEMA_FIXTURES.jfp.suggest);
    const client = createJfpClient({ runner: runner as JfpCommandRunner });
    const result = await client.suggest("debug memory leak");
    expect(result).toMatchSnapshot();
  });
});

// ============================================================================
// cass (Cross-Agent Session Search) Schema Snapshot Tests
// ============================================================================

describe("cass Schema Snapshots", () => {
  test("health shape matches snapshot", async () => {
    const runner = createFixtureRunner<CassCommandResult>(SCHEMA_FIXTURES.cass.health);
    const client = createCassClient({ runner: runner as CassCommandRunner });
    const result = await client.health({ includeMeta: true });
    expect(result).toMatchSnapshot();
  });

  test("search shape matches snapshot", async () => {
    const runner = createFixtureRunner<CassCommandResult>(SCHEMA_FIXTURES.cass.search);
    const client = createCassClient({ runner: runner as CassCommandRunner });
    const result = await client.search("authentication JWT");
    expect(result).toMatchSnapshot();
  });

  test("view shape matches snapshot", async () => {
    const runner = createFixtureRunner<CassCommandResult>(SCHEMA_FIXTURES.cass.view);
    const client = createCassClient({ runner: runner as CassCommandRunner });
    const result = await client.view("/home/user/.claude/sessions/abc123.jsonl", { line: 245 });
    expect(result).toMatchSnapshot();
  });

  test("expand shape matches snapshot", async () => {
    const runner = createFixtureRunner<CassCommandResult>(SCHEMA_FIXTURES.cass.expand);
    const client = createCassClient({ runner: runner as CassCommandRunner });
    const result = await client.expand("/home/user/.claude/sessions/abc123.jsonl", { line: 245 });
    expect(result).toMatchSnapshot();
  });
});

// ============================================================================
// cm (Cass-Memory) Schema Snapshot Tests
// ============================================================================

describe("cm Schema Snapshots", () => {
  test("context shape matches snapshot", async () => {
    const runner = createFixtureRunner<CMCommandResult>(SCHEMA_FIXTURES.cm.context);
    const client = createCMClient({ runner: runner as CMCommandRunner });
    const result = await client.context("implement authentication");
    expect(result).toMatchSnapshot();
  });

  test("quickstart shape matches snapshot", async () => {
    const runner = createFixtureRunner<CMCommandResult>(SCHEMA_FIXTURES.cm.quickstart);
    const client = createCMClient({ runner: runner as CMCommandRunner });
    const result = await client.quickstart();
    expect(result).toMatchSnapshot();
  });

  test("stats shape matches snapshot", async () => {
    const runner = createFixtureRunner<CMCommandResult>(SCHEMA_FIXTURES.cm.stats);
    const client = createCMClient({ runner: runner as CMCommandRunner });
    const result = await client.stats();
    expect(result).toMatchSnapshot();
  });

  test("doctor shape matches snapshot", async () => {
    const runner = createFixtureRunner<CMCommandResult>(SCHEMA_FIXTURES.cm.doctor);
    const client = createCMClient({ runner: runner as CMCommandRunner });
    const result = await client.doctor();
    expect(result).toMatchSnapshot();
  });

  test("playbook list shape matches snapshot", async () => {
    const runner = createFixtureRunner<CMCommandResult>(SCHEMA_FIXTURES.cm.playbookList);
    const client = createCMClient({ runner: runner as CMCommandRunner });
    const result = await client.listPlaybook();
    expect(result).toMatchSnapshot();
  });

  test("outcome shape matches snapshot", async () => {
    const runner = createFixtureRunner<CMCommandResult>(SCHEMA_FIXTURES.cm.outcome);
    const client = createCMClient({ runner: runner as CMCommandRunner });
    const result = await client.outcome("success", ["rule-001", "rule-002"]);
    expect(result).toMatchSnapshot();
  });
});

// ============================================================================
// ru (Repo Updater) Schema Snapshot Tests
// ============================================================================

describe("ru Schema Snapshots", () => {
  test("version shape matches snapshot", async () => {
    const runner = createFixtureRunner<RuCommandResult>(SCHEMA_FIXTURES.ru.version);
    const client = createRuClient({ runner: runner as RuCommandRunner });
    const result = await client.version();
    expect(result).toMatchSnapshot();
  });

  test("status shape matches snapshot", async () => {
    const runner = createFixtureRunner<RuCommandResult>(SCHEMA_FIXTURES.ru.status);
    const client = createRuClient({ runner: runner as RuCommandRunner });
    const result = await client.status();
    expect(result).toMatchSnapshot();
  });

  test("list shape matches snapshot", async () => {
    const runner = createFixtureRunner<RuCommandResult>(SCHEMA_FIXTURES.ru.list);
    const client = createRuClient({ runner: runner as RuCommandRunner });
    const result = await client.list();
    expect(result).toMatchSnapshot();
  });

  test("sync shape matches snapshot", async () => {
    const runner = createFixtureRunner<RuCommandResult>(SCHEMA_FIXTURES.ru.sync);
    const client = createRuClient({ runner: runner as RuCommandRunner });
    const result = await client.sync("owner/flywheel_gateway");
    expect(result).toMatchSnapshot();
  });

  test("sweep phase1 shape matches snapshot", async () => {
    const runner = createFixtureRunner<RuCommandResult>(SCHEMA_FIXTURES.ru.sweepPhase1);
    const client = createRuClient({ runner: runner as RuCommandRunner });
    const result = await client.sweepPhase1("owner/flywheel_gateway");
    expect(result).toMatchSnapshot();
  });

  test("sweep phase2 shape matches snapshot", async () => {
    const runner = createFixtureRunner<RuCommandResult>(SCHEMA_FIXTURES.ru.sweepPhase2);
    const client = createRuClient({ runner: runner as RuCommandRunner });
    const result = await client.sweepPhase2("owner/flywheel_gateway");
    expect(result).toMatchSnapshot();
  });

  test("sweep phase3 shape matches snapshot", async () => {
    const runner = createFixtureRunner<RuCommandResult>(SCHEMA_FIXTURES.ru.sweepPhase3);
    const client = createRuClient({ runner: runner as RuCommandRunner });
    const result = await client.sweepPhase3("owner/flywheel_gateway", "/path/to/plan.json");
    expect(result).toMatchSnapshot();
  });
});
