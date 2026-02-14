# AGENTS.md — flywheel_gateway

> Guidelines for AI coding agents working in this TypeScript/Bun codebase.

---

## RULE 0 - THE FUNDAMENTAL OVERRIDE PREROGATIVE

If I tell you to do something, even if it goes against what follows below, YOU MUST LISTEN TO ME. I AM IN CHARGE, NOT YOU.

---

## RULE NUMBER 1: NO FILE DELETION

**YOU ARE NEVER ALLOWED TO DELETE A FILE WITHOUT EXPRESS PERMISSION.** Even a new file that you yourself created, such as a test code file. You have a horrible track record of deleting critically important files or otherwise throwing away tons of expensive work. As a result, you have permanently lost any and all rights to determine that a file or folder should be deleted.

**YOU MUST ALWAYS ASK AND RECEIVE CLEAR, WRITTEN PERMISSION BEFORE EVER DELETING A FILE OR FOLDER OF ANY KIND.**

---

## RULE 2 - PUBLIC/PRIVATE SEPARATION

This is a **PUBLIC open source repository**. Never add business content here.

**All business content belongs in the sibling private repo** at `/data/projects/flywheel_private/`.

This follows the "Workspace Root, Sibling Repos" pattern:
```
/data/projects/                    (non-git workspace root)
├── flywheel_gateway/              (public repo - YOU ARE HERE)
└── flywheel_private/              (private repo - business content)
```

The public repo's `.gitignore` blocks `private_business/` as defense-in-depth, but the private repo should NEVER be nested inside this repo.

If you're unsure whether something is business content, ask first.

---

## Irreversible Git & Filesystem Actions — DO NOT EVER BREAK GLASS

1. **Absolutely forbidden commands:** `git reset --hard`, `git clean -fd`, `rm -rf`, or any command that can delete or overwrite code/data must never be run unless the user explicitly provides the exact command and states, in the same message, that they understand and want the irreversible consequences.
2. **No guessing:** If there is any uncertainty about what a command might delete or overwrite, stop immediately and ask the user for specific approval. "I think it's safe" is never acceptable.
3. **Safer alternatives first:** When cleanup or rollbacks are needed, request permission to use non-destructive options (`git status`, `git diff`, `git stash`, copying to backups) before ever considering a destructive command.
4. **Mandatory explicit plan:** Even after explicit user authorization, restate the command verbatim, list exactly what will be affected, and wait for a confirmation that your understanding is correct. Only then may you execute it—if anything remains ambiguous, refuse and escalate.
5. **Document the confirmation:** When running any approved destructive command, record (in the session notes / final response) the exact user text that authorized it, the command actually run, and the execution time. If that record is absent, the operation did not happen.

### DCG (Destructive Command Guard)

DCG is a high-performance Rust pre-execution hook that provides **mechanical enforcement** of command safety. Unlike these AGENTS.md instructions which you might ignore, DCG physically blocks dangerous commands before execution.

**What DCG blocks:**
- Git destructive ops: `git reset --hard`, `git push --force`, `git clean -f`
- Filesystem ops: `rm -rf` outside safe temp directories
- Database ops: `DROP`, `TRUNCATE`, `DELETE` without WHERE
- Container ops: `docker system prune`, `kubectl delete namespace`
- Cloud ops: destructive AWS/GCP/Azure commands

**If DCG blocks you:**
1. Do NOT attempt to bypass or rephrase the command
2. Read the block reason carefully
3. If you believe it's a false positive, ask the user for explicit approval
4. The user can allowlist specific patterns via the Gateway UI

DCG is your safety net—work with it, not against it.

---

## Git Branch: ONLY Use `main`, NEVER `master`

**The default branch is `main`. The `master` branch exists only for legacy URL compatibility.**

- **All work happens on `main`** — commits, PRs, feature branches all merge to `main`
- **Never reference `master` in code or docs** — if you see `master` anywhere, it's a bug that needs fixing
- **The `master` branch must stay synchronized with `main`** — after pushing to `main`, also push to `master`:
  ```bash
  git push origin main:master
  ```

**If you see `master` referenced anywhere:**
1. Update it to `main`
2. Ensure `master` is synchronized: `git push origin main:master`

---

## Toolchain: TypeScript & Bun

We only use **Bun** in this project, NEVER any other package manager or runtime.

- **Runtime:** Bun 1.3+ (package manager, bundler, test runner — now part of Anthropic)
- **Language:** TypeScript 5.9+ (strict mode enabled; 7.0 Go port coming)
- **Linting/Formatting:** Biome 2.0+ (linting, formatting, and type inference)
- **Module system:** ESM (`"type": "module"`)
- **Target:** ES2022

### Key Dependencies

| Package | Purpose |
|---------|---------|
| `hono` (4.11+) | HTTP framework (ultrafast, Bun-native) |
| `drizzle-orm` (0.40+) | TypeScript-native ORM |
| `bun:sqlite` | Native SQLite (fast, zero-config) |
| `pino` | Structured logging |
| `@modelcontextprotocol/sdk` | MCP client/server integration |
| `@opentelemetry/*` | Distributed tracing (OTLP export) |
| `react` (19.2+) | UI framework (with React Compiler) |
| `@tanstack/react-router` (1.145+) | Type-safe routing |
| `@tanstack/react-query` (5.90+) | Server state management |
| `zustand` | Client state |
| `tailwindcss` (4.0+) | Styling (CSS-based config) |
| `framer-motion` | Animation |
| `vite` (7.3+) | Frontend build tool |
| `zod` (4.3+) | Schema validation |
| `@asteasolutions/zod-to-openapi` | OpenAPI generation from Zod |
| `ulid` | Unique ID generation |
| `playwright` | E2E testing |

### Development Commands

```bash
# Development
bun dev              # Run all apps
bun dev:gateway      # Backend only
bun dev:web          # Frontend only

# Testing
bun run test         # Run all tests
bun run test -- --watch  # Watch mode
bun test:e2e         # Playwright E2E tests
bun test:contract    # Contract tests

# Linting/Formatting
bun lint             # Check with Biome
bun lint:fix         # Auto-fix
bun format           # Format code

# Type checking
bun typecheck        # tsc --noEmit

# Database
bun db:generate      # Generate migrations
bun db:migrate       # Run migrations
bun db:studio        # Drizzle Studio
```

---

## Code Editing Discipline

### No Script-Based Changes

**NEVER** run a script that processes/changes code files in this repo. Brittle regex-based transformations create far more problems than they solve.

- **Always make code changes manually**, even when there are many instances
- For many simple changes: use parallel subagents
- For subtle/complex changes: do them methodically yourself

### No File Proliferation

If you want to change something or add a feature, **revise existing code files in place**.

**NEVER** create variations like:
- `mainV2.ts`
- `main_improved.ts`
- `main_enhanced.ts`

New files are reserved for **genuinely new functionality** that makes zero sense to include in any existing file. The bar for creating new files is **incredibly high**.

---

## Backwards Compatibility

We do not care about backwards compatibility—we're in early development with no users. We want to do things the **RIGHT** way with **NO TECH DEBT**.

- Never create "compatibility shims"
- Never create wrapper functions for deprecated APIs
- Just fix the code directly

---

## Compiler Checks (CRITICAL)

**After any substantive code changes, you MUST verify no errors were introduced:**

```bash
# Type checking (workspace-wide)
bun typecheck

# Linting
bun lint

# Formatting
bun format

# Run all tests
bun run test
```

If you see errors, **carefully understand and resolve each issue**. Read sufficient context to fix them the RIGHT way.

---

## Testing

### Testing Policy

Every service and utility includes colocated unit tests alongside the implementation. Tests must cover:
- Happy path
- Edge cases (empty input, max values, boundary conditions)
- Error conditions

### Unit Tests

```bash
# Run all tests across the workspace
bun run test

# Run with output
bun run test -- --verbose

# Run tests for a specific app/package
bun test apps/gateway
bun test apps/web
bun test packages/shared
bun test packages/agent-drivers
bun test packages/flywheel-clients
bun test packages/test-utils
```

### Test Categories

| Area | Focus |
|------|-------|
| `apps/gateway/src/__tests__/` | Service unit tests, route handlers, middleware |
| `apps/web/src/__tests__/` | Component tests, hook tests, store tests |
| `tests/integration/` | Cross-service integration tests with real database |
| `tests/contract/` | API response validation against OpenAPI spec |
| `tests/e2e/` | Playwright browser tests for critical user paths |
| `tests/load/` | k6 load tests for API and WebSocket |

### Test Coverage Requirements

- **Unit tests**: 80% coverage on services and utilities
- **Integration tests**: Cover all API endpoints
- **E2E tests**: Cover critical user paths

Run coverage: `bun run test -- --coverage`

---

## Logging & Console Output

- Use structured logging (`pino` is the project standard)
- No random `console.log` in library code; if needed, make them debug-only and clean them up
- Log structured context: IDs, session names, agent types, etc.
- If a logging pattern exists in the codebase, follow it; do not invent a different pattern

---

## Third-Party Library Usage

If you aren't 100% sure how to use a third-party library, **SEARCH ONLINE** to find the latest documentation and current best practices.

---

## flywheel_gateway — This Project

**This is the project you're working on.** Flywheel Gateway is a TypeScript/Bun monorepo that provides a web-based command center for managing AI coding agents.

### What It Does

Orchestrates multiple AI coding agent backends (SDK, ACP, Tmux) through a unified web interface with real-time monitoring, cost analytics, fleet management, and multi-agent coordination via MCP Agent Mail.

### Architecture

```
Browser ─── Vite (React 19) ─── TanStack Router ─┐
                                                   │
                                          WebSocket + REST
                                                   │
                                    Hono HTTP Framework (Bun)
                                                   │
                              ┌────────────────────┼────────────────────┐
                              │                    │                    │
                     Agent Drivers          Service Layer          Drizzle ORM
                     (SDK/ACP/Tmux)    (Cost, Budget, Forecast)   (bun:sqlite)
                              │                    │                    │
                     MCP Agent Mail        OpenTelemetry          Migrations
                     (coordination)         (tracing)
```

### Workspace Structure

```
flywheel_gateway/
├── package.json                           # Workspace root (Bun workspaces)
├── tsconfig.json                          # Root TypeScript config
├── biome.json                             # Biome linting/formatting
├── bunfig.toml                            # Bun configuration
├── apps/
│   ├── gateway/                           # Backend: Hono + Drizzle + bun:sqlite
│   └── web/                               # Frontend: React 19 + Vite + TanStack
├── packages/
│   ├── shared/                            # Shared types, schemas, utilities
│   ├── agent-drivers/                     # Agent execution backends (SDK/ACP/Tmux)
│   ├── flywheel-clients/                  # Client libraries
│   └── test-utils/                        # Shared test helpers
├── tests/
│   ├── contract/                          # API contract tests
│   ├── e2e/                               # Playwright E2E tests
│   ├── integration/                       # Cross-service integration tests
│   └── load/                              # k6 load tests
├── reference/
│   └── ntm/                               # Reference implementations from NTM project
├── docs/                                  # Project documentation
└── scripts/                               # Build/dev scripts
```

### Agent Driver Architecture

Flywheel Gateway supports multiple agent execution backends via the **Agent Driver** abstraction:

**SDK Driver (Primary)**
- Uses `@anthropic-ai/claude-agent-sdk` directly
- Structured events: `tool_call`, `tool_result`, `text_delta`
- No terminal overhead
- Best for web-native workflows

**ACP Driver (Emerging Standard)**
- JSON-RPC 2.0 over stdio to ACP-compatible agents
- Works with Claude Code, Codex, Gemini via adapters
- IDE integration compatibility
- Future-proof as standard matures

**Tmux Driver (Power User Fallback)**
- For users who *want* visual terminals
- Uses `node-pty` or tmux IPC
- Can "attach" for visual debugging
- Backward compat for terminal workflows

When implementing features, always work through the `AgentDriver` interface, never directly with a specific backend.

### Recent Feature Areas

**Cost Analytics** (`apps/gateway/src/services/` + `apps/web/src/components/analytics/`):
- `cost-tracker.service.ts` — Token usage tracking, rate cards
- `budget.service.ts` — Budget creation, alerts, thresholds
- `cost-forecast.service.ts` — 30-day forecasting, scenarios
- `cost-optimization.service.ts` — AI-powered recommendations
- Frontend: `CostDashboard.tsx`, `BudgetGauge.tsx`, `CostTrendChart.tsx`, `CostBreakdownChart.tsx`, `CostForecastChart.tsx`, `OptimizationRecommendations.tsx`
- Routes: `/cost-analytics` (frontend), `/cost-analytics/*` (API)

**Notification System** (`apps/web/`):
- `NotificationBell.tsx` — Topbar notification indicator
- `NotificationPanel.tsx` — Slide-out notification list
- Integration with WebSocket for real-time updates

**OpenAPI Generation**:
- `apps/gateway/src/api/generate-openapi.ts` — Generation logic (Zod to OpenAPI 3.1)
- `apps/gateway/src/routes/openapi.ts` — Serving endpoints
- Swagger UI: `/docs`, ReDoc: `/redoc`

### Code Patterns and Conventions

**Functional components with explicit props:**

```typescript
// apps/web/src/components/AgentCard.tsx
interface AgentCardProps {
  agent: Agent;
  onSelect?: (id: string) => void;
  isSelected?: boolean;
}

export function AgentCard({ agent, onSelect, isSelected = false }: AgentCardProps) {
  return (
    <div className={`card ${isSelected ? 'card--selected' : ''}`}>
      <h3>{agent.name}</h3>
      <StatusPill tone={agent.status === 'running' ? 'positive' : 'neutral'}>
        {agent.status}
      </StatusPill>
      {onSelect && (
        <button onClick={() => onSelect(agent.id)}>Select</button>
      )}
    </div>
  );
}
```

**Custom hooks for data fetching:**

```typescript
// apps/web/src/hooks/useAgents.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

export function useAgents(options?: { status?: string }) {
  return useQuery({
    queryKey: ['agents', options],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (options?.status) params.set('status', options.status);
      const response = await fetch(`/api/agents?${params}`);
      if (!response.ok) throw new Error('Failed to fetch agents');
      return response.json();
    },
  });
}

export function useRestartAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (agentId: string) => {
      const response = await fetch(`/api/agents/${agentId}/restart`, { method: 'POST' });
      if (!response.ok) throw new Error('Failed to restart agent');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
  });
}
```

**Services are stateless classes with dependency injection:**

```typescript
// apps/gateway/src/services/agent.service.ts
export class AgentService {
  constructor(
    private db: Database,
    private drivers: DriverRegistry,
    private metrics: MetricsService
  ) {}

  async create(input: CreateAgentInput): Promise<Agent> {
    const agent = await this.db.insert(agents).values({
      id: ulid(),
      ...input,
      createdAt: new Date(),
    }).returning();

    this.metrics.increment('agent.created');
    return agent[0];
  }
}
```

**Thin route handlers that delegate to services:**

```typescript
// apps/gateway/src/routes/agents.ts
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { CreateAgentSchema } from '../models/agent';

export const agentsRoutes = new Hono()
  .get('/', async (c) => {
    const agents = await c.get('services').agent.list();
    return c.json({ agents });
  })
  .post('/', zValidator('json', CreateAgentSchema), async (c) => {
    const input = c.req.valid('json');
    const agent = await c.get('services').agent.create(input);
    return c.json(agent, 201);
  })
  .post('/:id/restart', async (c) => {
    const id = c.req.param('id');
    await c.get('services').agent.restart(id);
    return c.json({ success: true });
  });
```

**Consistent error responses:**

```typescript
// apps/gateway/src/utils/errors.ts
export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number = 400
  ) {
    super(message);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, 'NOT_FOUND', 404);
  }
}

// Usage in service
if (!agent) {
  throw new NotFoundError('Agent', id);
}
```

### Common Tasks

**Adding a New API Endpoint:**
1. Define Zod schema in `apps/gateway/src/models/`
2. Add service method in `apps/gateway/src/services/`
3. Add route handler in `apps/gateway/src/routes/`
4. Register route in `apps/gateway/src/routes/index.ts`
5. Add tests in `apps/gateway/src/__tests__/`
6. Update OpenAPI spec if needed

**Adding a New Page:**
1. Create page component in `apps/web/src/pages/`
2. Add route in `apps/web/src/router.tsx`
3. Add navigation link in `apps/web/src/components/layout/Sidebar.tsx`
4. Create hooks if needed in `apps/web/src/hooks/`
5. Add E2E test in `tests/e2e/`

**Adding Database Migration:**
```bash
# 1. Modify schema
vim apps/gateway/src/db/schema.ts

# 2. Generate migration
bun db:generate

# 3. Review migration in apps/gateway/src/db/migrations/

# 4. Apply migration
bun db:migrate

# 5. Commit both schema and migration files
```

**Running Quality Checks:**
```bash
bun typecheck        # Type checking
bun lint             # Linting
bun lint:fix         # Auto-fix lint issues
bun run test         # All tests
bun test:e2e         # E2E tests
bun test:contract    # Contract tests
```

### Reference Architecture

See `/reference/ntm/` for reference implementations from the NTM project that inform Flywheel Gateway's design:

- `agentmail/` — MCP client patterns (protocol is language-agnostic)
- `bv/` — BV integration patterns
- `robot/` — JSON schema patterns for structured API responses
- `pipeline/` — Pipeline execution model
- `context/` — Context pack building algorithms

When implementing features, consult these references for patterns and data structures, but implement in idiomatic TypeScript.

### Documentation

The project maintains documentation in the `/docs` directory:

| File | Description |
|------|-------------|
| `getting-started.md` | Setup guide, prerequisites, first steps |
| `architecture.md` | System architecture overview with diagrams |
| `api-guide.md` | REST API patterns, endpoints, WebSocket usage |

Additional documentation:
- `AGENTS.md` (this file) — Agent guidelines and conventions
- `README.md` — Project overview and quick start
- `/docs/openapi.json` — OpenAPI 3.1 specification (generated)

Interactive API documentation is available at runtime:
- Swagger UI: `/docs`
- ReDoc: `/redoc`

---

## MCP Agent Mail — Multi-Agent Coordination

A mail-like layer that lets coding agents coordinate asynchronously via MCP tools and resources. Provides identities, inbox/outbox, searchable threads, and advisory file reservations with human-auditable artifacts in Git.

Agent Mail is already available as an MCP server; do not treat it as a CLI you must shell out to. MCP Agent Mail *should* be available to you as an MCP server; if it's not, then flag to the user.

### Why It's Useful

- **Prevents conflicts:** Explicit file reservations (leases) for files/globs
- **Token-efficient:** Messages stored in per-project archive, not in context
- **Quick reads:** `resource://inbox/...`, `resource://thread/...`

### Same Repository Workflow

1. **Register identity:**
   ```
   ensure_project(project_key=<abs-path>)
   register_agent(project_key, program, model)
   ```

2. **Reserve files before editing:**
   ```
   file_reservation_paths(project_key, agent_name, ["src/**"], ttl_seconds=3600, exclusive=true)
   ```

3. **Communicate with threads:**
   ```
   send_message(..., thread_id="FEAT-123")
   fetch_inbox(project_key, agent_name)
   acknowledge_message(project_key, agent_name, message_id)
   ```

4. **Quick reads:**
   ```
   resource://inbox/{Agent}?project=<abs-path>&limit=20
   resource://thread/{id}?project=<abs-path>&include_bodies=true
   ```

### Multiple Repos in One Product

- Option A: Same `project_key` for all; use specific reservations (`frontend/**`, `backend/**`).
- Option B: Different projects linked via `macro_contact_handshake` or `request_contact` / `respond_contact`. Use a shared `thread_id` (e.g., ticket key) for cross-repo threads.

### Macros vs Granular Tools

- **Prefer macros for speed:** `macro_start_session`, `macro_prepare_thread`, `macro_file_reservation_cycle`, `macro_contact_handshake`
- **Use granular tools for control:** `register_agent`, `file_reservation_paths`, `send_message`, `fetch_inbox`, `acknowledge_message`

### Common Pitfalls

- `"from_agent not registered"`: Always `register_agent` in the correct `project_key` first
- `"FILE_RESERVATION_CONFLICT"`: Adjust patterns, wait for expiry, or use non-exclusive reservation
- **Auth errors:** If JWT+JWKS enabled, include bearer token with matching `kid`

---

## Beads (br) — Dependency-Aware Issue Tracking

Beads provides a lightweight, dependency-aware issue database and CLI (`br` - beads_rust) for selecting "ready work," setting priorities, and tracking status. It complements MCP Agent Mail's messaging and file reservations.

**Important:** `br` is non-invasive—it NEVER runs git commands automatically. You must manually commit changes after `br sync --flush-only`.

### Conventions

- **Single source of truth:** Beads for task status/priority/dependencies; Agent Mail for conversation and audit
- **Shared identifiers:** Use Beads issue ID (e.g., `br-123`) as Mail `thread_id` and prefix subjects with `[br-123]`
- **Reservations:** When starting a task, call `file_reservation_paths()` with the issue ID in `reason`

### Typical Agent Flow

1. **Pick ready work (Beads):**
   ```bash
   br ready --json  # Choose highest priority, no blockers
   ```

2. **Reserve edit surface (Mail):**
   ```
   file_reservation_paths(project_key, agent_name, ["src/**"], ttl_seconds=3600, exclusive=true, reason="br-123")
   ```

3. **Announce start (Mail):**
   ```
   send_message(..., thread_id="br-123", subject="[br-123] Start: <title>", ack_required=true)
   ```

4. **Work and update:** Reply in-thread with progress

5. **Complete and release:**
   ```bash
   br close 123 --reason "Completed"
   br sync --flush-only  # Export to JSONL (no git operations)
   ```
   ```
   release_file_reservations(project_key, agent_name, paths=["src/**"])
   ```
   Final Mail reply: `[br-123] Completed` with summary

### Mapping Cheat Sheet

| Concept | Value |
|---------|-------|
| Mail `thread_id` | `br-###` |
| Mail subject | `[br-###] ...` |
| File reservation `reason` | `br-###` |
| Commit messages | Include `br-###` for traceability |

---

## bv — Graph-Aware Triage Engine

bv is a graph-aware triage engine for Beads projects (`.beads/beads.jsonl`). It computes PageRank, betweenness, critical path, cycles, HITS, eigenvector, and k-core metrics deterministically.

**Scope boundary:** bv handles *what to work on* (triage, priority, planning). For agent-to-agent coordination (messaging, work claiming, file reservations), use MCP Agent Mail.

**CRITICAL: Use ONLY `--robot-*` flags. Bare `bv` launches an interactive TUI that blocks your session.**

### The Workflow: Start With Triage

**`bv --robot-triage` is your single entry point.** It returns:
- `quick_ref`: at-a-glance counts + top 3 picks
- `recommendations`: ranked actionable items with scores, reasons, unblock info
- `quick_wins`: low-effort high-impact items
- `blockers_to_clear`: items that unblock the most downstream work
- `project_health`: status/type/priority distributions, graph metrics
- `commands`: copy-paste shell commands for next steps

```bash
bv --robot-triage        # THE MEGA-COMMAND: start here
bv --robot-next          # Minimal: just the single top pick + claim command
```

### Command Reference

**Planning:**
| Command | Returns |
|---------|---------|
| `--robot-plan` | Parallel execution tracks with `unblocks` lists |
| `--robot-priority` | Priority misalignment detection with confidence |

**Graph Analysis:**
| Command | Returns |
|---------|---------|
| `--robot-insights` | Full metrics: PageRank, betweenness, HITS, eigenvector, critical path, cycles, k-core, articulation points, slack |
| `--robot-label-health` | Per-label health: `health_level`, `velocity_score`, `staleness`, `blocked_count` |
| `--robot-label-flow` | Cross-label dependency: `flow_matrix`, `dependencies`, `bottleneck_labels` |
| `--robot-label-attention [--attention-limit=N]` | Attention-ranked labels |

**History & Change Tracking:**
| Command | Returns |
|---------|---------|
| `--robot-history` | Bead-to-commit correlations |
| `--robot-diff --diff-since <ref>` | Changes since ref: new/closed/modified issues, cycles |

**Other:**
| Command | Returns |
|---------|---------|
| `--robot-burndown <sprint>` | Sprint burndown, scope changes, at-risk items |
| `--robot-forecast <id\|all>` | ETA predictions with dependency-aware scheduling |
| `--robot-alerts` | Stale issues, blocking cascades, priority mismatches |
| `--robot-suggest` | Hygiene: duplicates, missing deps, label suggestions |
| `--robot-graph [--graph-format=json\|dot\|mermaid]` | Dependency graph export |
| `--export-graph <file.html>` | Interactive HTML visualization |

### Scoping & Filtering

```bash
bv --robot-plan --label backend              # Scope to label's subgraph
bv --robot-insights --as-of HEAD~30          # Historical point-in-time
bv --recipe actionable --robot-plan          # Pre-filter: ready to work
bv --recipe high-impact --robot-triage       # Pre-filter: top PageRank
bv --robot-triage --robot-triage-by-track    # Group by parallel work streams
bv --robot-triage --robot-triage-by-label    # Group by domain
```

### Understanding Robot Output

**All robot JSON includes:**
- `data_hash` — Fingerprint of source beads.jsonl
- `status` — Per-metric state: `computed|approx|timeout|skipped` + elapsed ms
- `as_of` / `as_of_commit` — Present when using `--as-of`

**Two-phase analysis:**
- **Phase 1 (instant):** degree, topo sort, density
- **Phase 2 (async, 500ms timeout):** PageRank, betweenness, HITS, eigenvector, cycles

### jq Quick Reference

```bash
bv --robot-triage | jq '.quick_ref'                        # At-a-glance summary
bv --robot-triage | jq '.recommendations[0]'               # Top recommendation
bv --robot-plan | jq '.plan.summary.highest_impact'        # Best unblock target
bv --robot-insights | jq '.status'                         # Check metric readiness
bv --robot-insights | jq '.Cycles'                         # Circular deps (must fix!)
```

---

## UBS — Ultimate Bug Scanner

**Golden Rule:** `ubs <changed-files>` before every commit. Exit 0 = safe. Exit >0 = fix & re-run.

### Commands

```bash
ubs src/file.ts                              # Specific files (< 1s) — USE THIS
ubs $(git diff --name-only --cached)         # Staged files — before commit
ubs --only=typescript apps/                  # Language filter (3-5x faster)
ubs --ci --fail-on-warning .                 # CI mode — before PR
ubs .                                        # Whole project (ignores node_modules/, dist/)
```

### Output Format

```
Warning  Category (N errors)
    file.ts:42:5 – Issue description
    Suggested fix
Exit code: 1
```

Parse: `file:line:col` -> location | Suggested fix -> how to fix | Exit 0/1 -> pass/fail

### Fix Workflow

1. Read finding -> category + fix suggestion
2. Navigate `file:line:col` -> view context
3. Verify real issue (not false positive)
4. Fix root cause (not symptom)
5. Re-run `ubs <file>` -> exit 0
6. Commit

### Bug Severity

- **Critical (always fix):** Memory safety, use-after-free, data races, SQL injection
- **Important (production):** Unwrap panics, resource leaks, overflow checks
- **Contextual (judgment):** TODO/FIXME, console.log debugging

---

## RU (Repo Updater) — Fleet Management

RU is a production-grade Bash CLI for managing large collections of GitHub repositories with AI-assisted review and agent automation.

### Key Commands

```bash
ru sync                     # Clone missing + pull updates for all repos
ru sync --parallel 4        # Parallel sync (4 workers)
ru status                   # Show repo status across fleet
ru review --plan            # AI-assisted PR/issue review (via ntm)
ru agent-sweep              # Three-phase automated maintenance
```

### Agent-Sweep Workflow

- Phase 1: Agent reads AGENTS.md, README.md, git log (300s)
- Phase 2: Agent produces commit/release plans in JSON (600s)
- Phase 3: RU validates and executes plans deterministically (300s)

### Integration with Gateway

- Gateway displays fleet status dashboard
- Gateway spawns agents for ru review/agent-sweep sessions
- Gateway routes agent-sweep plans through SLB approval workflow
- Gateway archives results to CASS for learning

---

## cass — Cross-Agent Search

`cass` indexes prior agent conversations (Claude Code, Codex, Cursor, Gemini, ChatGPT, etc.) so we can reuse solved problems.

Rules:
- Never run bare `cass` (TUI). Always use `--robot` or `--json`.

Examples:

```bash
cass health
cass search "authentication error" --robot --limit 5
cass view /path/to/session.jsonl -n 42 --json
cass expand /path/to/session.jsonl -n 42 -C 3 --json
```

Tips:
- Use `--fields minimal` for lean output.
- Filter by agent with `--agent`.
- Use `--days N` to limit to recent history.

stdout is data-only, stderr is diagnostics; exit code 0 means success.

Treat cass as a way to avoid re-solving problems other agents already handled.

---

## Memory System: cass-memory

The Cass Memory System (cm) is a tool for giving agents an effective memory based on the ability to quickly search across previous coding agent sessions.

### Quick Start

```bash
# 1. Check status and see recommendations
cm onboard status

# 2. Get sessions to analyze (filtered by gaps in your playbook)
cm onboard sample --fill-gaps

# 3. Read a session with rich context
cm onboard read /path/to/session.jsonl --template

# 4. Add extracted rules
cm playbook add "Your rule content" --category "debugging"

# 5. Mark session as processed
cm onboard mark-done /path/to/session.jsonl
```

Before starting complex tasks, retrieve relevant context:

```bash
cm context "<task description>" --json
```

This returns:
- **relevantBullets**: Rules that may help with your task
- **antiPatterns**: Pitfalls to avoid
- **historySnippets**: Past sessions that solved similar problems
- **suggestedCassQueries**: Searches for deeper investigation

### Protocol

1. **START**: Run `cm context "<task>" --json` before non-trivial work
2. **WORK**: Reference rule IDs when following them
3. **FEEDBACK**: Leave inline comments when rules help/hurt
4. **END**: Just finish your work. Learning happens automatically.

---

## Developer Utilities

These utilities enhance AI agent workflows and should be available in all agent environments.

### giil — Get Image from Internet Link

Zero-setup CLI for downloading full-resolution images from cloud photo services.

**Use case:** Debugging UI issues remotely—paste an iCloud/Dropbox/Google Photos link, run one command, analyze the screenshot.

```bash
giil "https://share.icloud.com/photos/xxx"           # Download image
giil "https://share.icloud.com/photos/xxx" --json    # Get metadata + path
giil "https://share.icloud.com/photos/xxx" --base64  # Base64 for API submission
```

**Supported platforms:** iCloud, Dropbox, Google Photos, Google Drive

**4-tier capture strategy:** Download button -> CDN interception -> element screenshot -> viewport (always succeeds)

### csctf — Chat Shared Conversation to File

Single-binary CLI for converting public AI chat share links into clean Markdown and HTML transcripts.

**Use case:** Archiving valuable AI conversations for knowledge management and CASS indexing.

```bash
csctf "https://chatgpt.com/share/xxx"                # Convert to .md + .html
csctf "https://chatgpt.com/share/xxx" --md-only      # Markdown only
csctf "https://chatgpt.com/share/xxx" --publish-to-gh-pages  # Publish to GitHub Pages
```

**Supported providers:** ChatGPT, Gemini, Grok, Claude.ai

**Features:**
- Code-preserving export with language-tagged fences
- Deterministic, collision-proof filenames
- Optional GitHub Pages publishing for team sharing

---

## ast-grep vs ripgrep

**Use `ast-grep` when structure matters.** It parses code and matches AST nodes, ignoring comments/strings, and can **safely rewrite** code.

- Refactors/codemods: rename APIs, change import forms
- Policy checks: enforce patterns across a repo
- Editor/automation: LSP mode, `--json` output

**Use `ripgrep` when text is enough.** Fastest way to grep literals/regex.

- Recon: find strings, TODOs, log lines, config values
- Pre-filter: narrow candidate files before ast-grep

### Rule of Thumb

- Need correctness or **applying changes** -> `ast-grep`
- Need raw speed or **hunting text** -> `rg`
- Often combine: `rg` to shortlist files, then `ast-grep` to match/modify

### TypeScript Examples

```bash
# Find structured code (ignores comments)
ast-grep run -l TypeScript -p 'import $X from "$P"'

# Find all useQuery calls
ast-grep run -l TypeScript -p 'useQuery($$$ARGS)'

# Quick textual hunt
rg -n 'console\.log\(' -t ts

# Combine speed + precision
rg -l -t ts 'useQuery\(' | xargs ast-grep run -l TypeScript -p 'useQuery($A)' --json
```

---

## Morph Warp Grep — AI-Powered Code Search

**Use `mcp__morph-mcp__warp_grep` for exploratory "how does X work?" questions.** An AI agent expands your query, greps the codebase, reads relevant files, and returns precise line ranges with full context.

**Use `ripgrep` for targeted searches.** When you know exactly what you're looking for.

**Use `ast-grep` for structural patterns.** When you need AST precision for matching/rewriting.

### When to Use What

| Scenario | Tool | Why |
|----------|------|-----|
| "How does agent spawning work?" | `warp_grep` | Exploratory; don't know where to start |
| "Where is the cost tracking logic?" | `warp_grep` | Need to understand architecture |
| "Find all uses of `useQuery`" | `ripgrep` | Targeted literal search |
| "Find files with `console.log`" | `ripgrep` | Simple pattern |
| "Replace all `var` with `let`" | `ast-grep` | Structural refactor |

### warp_grep Usage

```
mcp__morph-mcp__warp_grep(
  repoPath: "/dp/flywheel_gateway",
  query: "How does the agent driver abstraction work?"
)
```

Returns structured results with file paths, line ranges, and extracted code snippets.

### Anti-Patterns

- **Don't** use `warp_grep` to find a specific function name -> use `ripgrep`
- **Don't** use `ripgrep` to understand "how does X work" -> wastes time with manual reads
- **Don't** use `ripgrep` for codemods -> risks collateral edits

<!-- bv-agent-instructions-v1 -->

---

## Beads Workflow Integration

This project uses [beads_rust](https://github.com/Dicklesworthstone/beads_rust) (`br`) for issue tracking. Issues are stored in `.beads/` and tracked in git.

**Important:** `br` is non-invasive—it NEVER executes git commands. After `br sync --flush-only`, you must manually run `git add .beads/ && git commit`.

### Essential Commands

```bash
# View issues (launches TUI - avoid in automated sessions)
bv

# CLI commands for agents (use these instead)
br ready              # Show issues ready to work (no blockers)
br list --status=open # All open issues
br show <id>          # Full issue details with dependencies
br create --title="..." --type=task --priority=2
br update <id> --status=in_progress
br close <id> --reason "Completed"
br close <id1> <id2>  # Close multiple issues at once
br sync --flush-only  # Export to JSONL (does NOT run git)
```

### Workflow Pattern

1. **Start**: Run `br ready` to find actionable work
2. **Claim**: Use `br update <id> --status=in_progress`
3. **Work**: Implement the task
4. **Complete**: Use `br close <id>`
5. **Sync**: Run `br sync --flush-only` then manually commit

### Key Concepts

- **Dependencies**: Issues can block other issues. `br ready` shows only unblocked work.
- **Priority**: P0=critical, P1=high, P2=medium, P3=low, P4=backlog (use numbers, not words)
- **Types**: task, bug, feature, epic, question, docs
- **Blocking**: `br dep add <issue> <depends-on>` to add dependencies

### Session Protocol

**Before ending any session, run this checklist:**

```bash
git status              # Check what changed
git add <files>         # Stage code changes
br sync --flush-only    # Export beads to JSONL
git add .beads/         # Stage beads changes
git commit -m "..."     # Commit everything together
git push                # Push to remote
```

### Best Practices

- Check `br ready` at session start to find available work
- Update status as you work (in_progress -> closed)
- Create new issues with `br create` when you discover tasks
- Use descriptive titles and set appropriate priority/type
- Always `br sync --flush-only && git add .beads/` before ending session

<!-- end-bv-agent-instructions -->

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Sync beads** - `br sync --flush-only` to export to JSONL
5. **Hand off** - Provide context for next session

---

Note for Codex/GPT-5.2:

You constantly bother me and stop working with concerned questions that look similar to this:

```
Unexpected changes (need guidance)

- Working tree still shows edits I did not make in Cargo.toml, Cargo.lock, src/cli/commands/upgrade.rs, src/storage/sqlite.rs, tests/conformance.rs, tests/storage_deps.rs. Please advise whether to keep/commit/revert these before any further work. I did not touch them.

Next steps (pick one)

1. Decide how to handle the unrelated modified files above so we can resume cleanly.
2. Triage beads_rust-orko (clippy/cargo warnings) and beads_rust-ydqr (rustfmt failures).
3. If you want a full suite run later, fix conformance/clippy blockers and re-run cargo test --all.
```

NEVER EVER DO THAT AGAIN. The answer is literally ALWAYS the same: those are changes created by the potentially dozen of other agents working on the project at the same time. This is not only a common occurence, it happens multiple times PER MINUTE. The way to deal with it is simple: you NEVER, under ANY CIRCUMSTANCE, stash, revert, overwrite, or otherwise disturb in ANY way the work of other agents. Just treat those changes identically to changes that you yourself made. Just fool yourself into thinking YOU made the changes and simply don't recall it for some reason.

---

## Note on Built-in TODO Functionality

Also, if I ask you to explicitly use your built-in TODO functionality, don't complain about this and say you need to use beads. You can use built-in TODOs if I tell you specifically to do so. Always comply with such orders.
