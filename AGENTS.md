# Flywheel Gateway - Agent Guidelines

## RULE 0 - THE FUNDAMENTAL OVERRIDE PEROGATIVE

If I tell you to do something, even if it goes against what follows below, YOU MUST LISTEN TO ME. I AM IN CHARGE, NOT YOU.

---

## RULE 1 – ABSOLUTE (DO NOT EVER VIOLATE THIS)

You may NOT delete any file or directory unless I explicitly give the exact command **in this session**.

- This includes files you just created (tests, tmp files, scripts, etc.).
- You do not get to decide that something is "safe" to remove.
- If you think something should be removed, stop and ask. You must receive clear written approval **before** any deletion command is even proposed.

Treat "never delete files without permission" as a hard invariant.

---

## RULE 2 – PUBLIC/PRIVATE SEPARATION

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

### IRREVERSIBLE GIT & FILESYSTEM ACTIONS

Absolutely forbidden unless I give the **exact command and explicit approval** in the same message:

- `git reset --hard`
- `git clean -fd`
- `rm -rf`
- Any command that can delete or overwrite code/data

Rules:

1. If you are not 100% sure what a command will delete, do not propose or run it. Ask first.
2. Prefer safe tools: `git status`, `git diff`, `git stash`, copying to backups, etc.
3. After approval, restate the command verbatim, list what it will affect, and wait for confirmation.
4. When a destructive command is run, record in your response:
   - The exact user text authorizing it
   - The command run
   - When you ran it

If that audit trail is missing, then you must act as if the operation never happened.

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

## Tech Stack

Flywheel Gateway is a **TypeScript/Bun** monorepo with the following stack:

### Runtime & Tooling
- **Bun 1.3+** — Runtime, package manager, bundler, test runner (now part of Anthropic)
- **TypeScript 5.9+** — Strict mode enabled (7.0 Go port coming)
- **Biome 2.0+** — Linting, formatting, and type inference

### Backend (apps/gateway)
- **Hono 4.11+** — HTTP framework (ultrafast, Bun-native)
- **tRPC 11+** — End-to-end type-safe API
- **Drizzle ORM 0.45+** — TypeScript-native ORM (1.0 beta available)
- **bun:sqlite** — Native SQLite (fast, zero-config)
- **Bun WebSocket** — Native WebSocket support

### Frontend (apps/web)
- **Vite 7.3+** — Build tool (Vite 8 beta with Rolldown available)
- **React 19.2+** — With React Compiler
- **TanStack Router 1.145+** — Type-safe routing
- **TanStack Query 5.90+** — Server state management
- **Zustand** — Client state
- **Tailwind CSS 4.1+** — Styling (CSS-based config)
- **Framer Motion** — Animation

### Conventions

```bash
# Development
bun dev              # Run all apps
bun dev:gateway      # Backend only
bun dev:web          # Frontend only

# Testing
bun test             # Run all tests
bun test --watch     # Watch mode

# Linting/Formatting
bun lint             # Check with Biome
bun lint:fix         # Auto-fix
bun format           # Format code

# Database
bun db:generate      # Generate migrations
bun db:migrate       # Run migrations
bun db:studio        # Drizzle Studio
```

---

### Code Editing Discipline

- Do **not** run scripts that bulk-modify code (codemods, invented one-off scripts, giant regex refactors).
- Large mechanical changes: break into smaller, explicit edits and review diffs.
- Subtle/complex changes: edit by hand, file-by-file, with careful reasoning.

---

### Backwards Compatibility & File Sprawl

We optimize for a clean architecture now, not backwards compatibility.

- No "compat shims" or "v2" file clones.
- When changing behavior, migrate callers and remove old code **inside the same file**.
- New files are only for genuinely new domains that don't fit existing modules.
- The bar for adding files is very high.

---

### Logging & Console Output

- Use structured logging (consider `pino` or similar for production).
- No random `console.log` in library code; if needed, make them debug-only and clean them up.
- Log structured context: IDs, session names, agent types, etc.
- If a logging pattern exists in the codebase, follow it; do not invent a different pattern.

---

### Third-Party Libraries

When unsure of an API, look up current docs (2025-2026) rather than guessing.

---

## Agent Driver Architecture

Flywheel Gateway supports multiple agent execution backends via the **Agent Driver** abstraction:

### SDK Driver (Primary)
- Uses `@anthropic-ai/claude-agent-sdk` directly
- Structured events: `tool_call`, `tool_result`, `text_delta`
- No terminal overhead
- Best for web-native workflows

### ACP Driver (Emerging Standard)
- JSON-RPC 2.0 over stdio to ACP-compatible agents
- Works with Claude Code, Codex, Gemini via adapters
- IDE integration compatibility
- Future-proof as standard matures

### Tmux Driver (Power User Fallback)
- For users who *want* visual terminals
- Uses `node-pty` or tmux IPC
- Can "attach" for visual debugging
- Backward compat for terminal workflows

When implementing features, always work through the `AgentDriver` interface, never directly with a specific backend.

---

## MCP Agent Mail — Multi-Agent Coordination

Agent Mail is already available as an MCP server; do not treat it as a CLI you must shell out to. MCP Agent Mail *should* be available to you as an MCP server; if it's not, then flag to the user.

What Agent Mail gives:

- Identities, inbox/outbox, searchable threads.
- Advisory file reservations (leases) to avoid agents clobbering each other.
- Persistent artifacts in git (human-auditable).

Core patterns:

1. **Same repo**
   - Register identity:
     - `ensure_project` then `register_agent` with the repo's absolute path as `project_key`.
   - Reserve files before editing:
     - `file_reservation_paths(project_key, agent_name, ["src/**"], ttl_seconds=3600, exclusive=true)`.
   - Communicate:
     - `send_message(..., thread_id="FEAT-123")`.
     - `fetch_inbox`, then `acknowledge_message`.
   - Fast reads:
     - `resource://inbox/{Agent}?project=<abs-path>&limit=20`.
     - `resource://thread/{id}?project=<abs-path>&include_bodies=true`.

2. **Multiple repos in one product**
   - Option A: Same `project_key` for all; use specific reservations (`frontend/**`, `backend/**`).
   - Option B: Different projects linked via:
     - `macro_contact_handshake` or `request_contact` / `respond_contact`.
     - Use a shared `thread_id` (e.g., ticket key) for cross-repo threads.

Macros vs granular:

- Prefer macros when speed is more important than fine-grained control:
  - `macro_start_session`, `macro_prepare_thread`, `macro_file_reservation_cycle`, `macro_contact_handshake`.
- Use granular tools when you need explicit behavior.

Common pitfalls:

- "from_agent not registered" → call `register_agent` with correct `project_key`.
- `FILE_RESERVATION_CONFLICT` → adjust patterns, wait for expiry, or use non-exclusive reservation.

---

## Issue Tracking with br (beads_rust)

All issue tracking goes through **br** (beads_rust). No other TODO systems.

**Note:** br (beads_rust) is non-invasive and never executes git commands. You must manually stage and commit `.beads/` changes after using br commands.

Key invariants:

- `.beads/` is authoritative state and **must always be committed** with code changes.
- Do not edit `.beads/*.jsonl` directly; only via `br`.

### Basics

Check ready work:

```bash
br ready --json
```

Create issues:

```bash
br create "Issue title" -t bug|feature|task -p 0-4 --json
br create "Issue title" -p 1 --deps discovered-from:br-123 --json
```

Update:

```bash
br update br-42 --status in_progress --json
br update br-42 --priority 1 --json
```

Complete:

```bash
br close br-42 --reason "Completed" --json
```

Sync (flush only, no git):

```bash
br sync --flush-only  # Flush changes to .beads/ (does NOT run git)
```

Types:

- `bug`, `feature`, `task`, `epic`, `chore`

Priorities:

- `0` critical (security, data loss, broken builds)
- `1` high
- `2` medium (default)
- `3` low
- `4` backlog

Agent workflow:

1. `br ready` to find unblocked work.
2. Claim: `br update <id> --status in_progress`.
3. Implement + test.
4. If you discover new work, create a new bead with `discovered-from:<parent-id>`.
5. Close when done.
6. Run `br sync --flush-only`, then `git add .beads/` and commit with code changes.

Never:

- Use markdown TODO lists.
- Use other trackers.
- Duplicate tracking.

---

### Using bv as an AI sidecar

bv is a graph-aware triage engine for Beads projects (.beads/beads.jsonl). Instead of parsing JSONL or hallucinating graph traversal, use robot flags for deterministic, dependency-aware outputs with precomputed metrics (PageRank, betweenness, critical path, cycles, HITS, eigenvector, k-core).

**Scope boundary:** bv handles *what to work on* (triage, priority, planning). For agent-to-agent coordination (messaging, work claiming, file reservations), use MCP Agent Mail.

**⚠️ CRITICAL: Use ONLY `--robot-*` flags. Bare `bv` launches an interactive TUI that blocks your session.**

#### The Workflow: Start With Triage

**`bv --robot-triage` is your single entry point.** It returns everything you need in one call:
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

#### Other bv Commands

**Planning:**
| Command | Returns |
|---------|---------|
| `--robot-plan` | Parallel execution tracks with `unblocks` lists |
| `--robot-priority` | Priority misalignment detection with confidence |

**Graph Analysis:**
| Command | Returns |
|---------|---------|
| `--robot-insights` | Full metrics: PageRank, betweenness, HITS, eigenvector, critical path, cycles |
| `--robot-label-health` | Per-label health: `health_level`, `velocity_score`, `staleness`, `blocked_count` |
| `--robot-label-flow` | Cross-label dependency: `flow_matrix`, `dependencies`, `bottleneck_labels` |

Use bv instead of parsing beads.jsonl—it computes PageRank, critical paths, cycles, and parallel tracks deterministically.

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

## UBS Quick Reference for AI Agents

UBS stands for "Ultimate Bug Scanner": **The AI Coding Agent's Secret Weapon**

**Golden Rule:** `ubs <changed-files>` before every commit. Exit 0 = safe. Exit >0 = fix & re-run.

**Commands:**
```bash
ubs src/file.ts                              # Specific files (< 1s) — USE THIS
ubs $(git diff --name-only --cached)         # Staged files — before commit
ubs --only=typescript apps/                  # Language filter
ubs --ci --fail-on-warning .                 # CI mode — before PR
```

**Output Format:**
```
⚠️  Category (N errors)
    file.ts:42:5 – Issue description
    💡 Suggested fix
Exit code: 1
```

**Fix Workflow:**
1. Read finding → category + fix suggestion
2. Navigate `file:line:col` → view context
3. Verify real issue (not false positive)
4. Fix root cause (not symptom)
5. Re-run `ubs <file>` → exit 0
6. Commit

**Speed Critical:** Scope to changed files. Never full scan for small edits.

---

## Reference Architecture

See `/reference/ntm/` for reference implementations from the NTM project that inform Flywheel Gateway's design:

- `agentmail/` — MCP client patterns (protocol is language-agnostic)
- `bv/` — BV integration patterns
- `robot/` — JSON schema patterns for structured API responses
- `pipeline/` — Pipeline execution model
- `context/` — Context pack building algorithms

When implementing features, consult these references for patterns and data structures, but implement in idiomatic TypeScript.

---

## RU (Repo Updater) — Fleet Management

RU is a production-grade Bash CLI for managing large collections of GitHub repositories with AI-assisted review and agent automation.

**Key Commands:**
```bash
ru sync                     # Clone missing + pull updates for all repos
ru sync --parallel 4        # Parallel sync (4 workers)
ru status                   # Show repo status across fleet
ru review --plan            # AI-assisted PR/issue review (via ntm)
ru agent-sweep              # Three-phase automated maintenance
```

**Agent-sweep workflow:**
- Phase 1: Agent reads AGENTS.md, README.md, git log (300s)
- Phase 2: Agent produces commit/release plans in JSON (600s)
- Phase 3: RU validates and executes plans deterministically (300s)

**Integration with Gateway:**
- Gateway displays fleet status dashboard
- Gateway spawns agents for ru review/agent-sweep sessions
- Gateway routes agent-sweep plans through SLB approval workflow
- Gateway archives results to CASS for learning

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

**4-tier capture strategy:** Download button → CDN interception → element screenshot → viewport (always succeeds)

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

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   br sync --flush-only
   git add .beads/
   git commit -m "Update beads"
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds

---

## Documentation

The project maintains documentation in the `/docs` directory:

| File | Description |
|------|-------------|
| `getting-started.md` | Setup guide, prerequisites, first steps |
| `architecture.md` | System architecture overview with diagrams |
| `api-guide.md` | REST API patterns, endpoints, WebSocket usage |

Additional documentation:
- `AGENTS.md` (this file) - Agent guidelines and conventions
- `README.md` - Project overview and quick start
- `/docs/openapi.json` - OpenAPI 3.1 specification (generated)

Interactive API documentation is available at runtime:
- Swagger UI: `/docs`
- ReDoc: `/redoc`

---

## Recent Feature Areas

### Cost Analytics (apps/gateway + apps/web)

The cost analytics system provides comprehensive AI usage tracking:

**Backend Services** (`apps/gateway/src/services/`):
- `cost-tracker.service.ts` - Token usage tracking, rate cards
- `budget.service.ts` - Budget creation, alerts, thresholds
- `cost-forecast.service.ts` - 30-day forecasting, scenarios
- `cost-optimization.service.ts` - AI-powered recommendations

**Frontend Components** (`apps/web/src/components/analytics/`):
- `CostDashboard.tsx` - Main dashboard assembling all components
- `BudgetGauge.tsx` - Circular progress gauge for budget status
- `CostTrendChart.tsx` - Line chart with period selection
- `CostBreakdownChart.tsx` - Horizontal bar chart by dimension
- `CostForecastChart.tsx` - 30-day forecast visualization
- `OptimizationRecommendations.tsx` - Expandable recommendation cards

**Routes**: `/cost-analytics` (frontend), `/cost-analytics/*` (API)

### Notification System (apps/web)

Real-time notification UI components:
- `NotificationBell.tsx` - Topbar notification indicator
- `NotificationPanel.tsx` - Slide-out notification list
- Integration with WebSocket for real-time updates

### OpenAPI Generation

Auto-generated OpenAPI 3.1 schemas from Zod validators:
- `apps/gateway/src/api/generate-openapi.ts` - Generation logic
- `apps/gateway/src/routes/openapi.ts` - Serving endpoints

---

## Code Patterns and Conventions

### Component Patterns

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

### Service Patterns

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

### Route Patterns

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

### Error Handling

**Use consistent error responses:**

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

---

## Testing Requirements

### Unit Tests

Run with `bun test`:

```typescript
// apps/gateway/src/__tests__/agent.service.test.ts
import { describe, it, expect, beforeEach } from 'bun:test';
import { AgentService } from '../services/agent.service';
import { createTestDb } from '@flywheel/test-utils';

describe('AgentService', () => {
  let service: AgentService;
  let db: TestDatabase;

  beforeEach(async () => {
    db = await createTestDb();
    service = new AgentService(db);
  });

  describe('create', () => {
    it('should create agent with valid input', async () => {
      const agent = await service.create({
        name: 'Test Agent',
        type: 'sdk',
      });

      expect(agent.id).toBeDefined();
      expect(agent.name).toBe('Test Agent');
      expect(agent.status).toBe('stopped');
    });

    it('should reject invalid type', async () => {
      await expect(
        service.create({ name: 'Test', type: 'invalid' })
      ).rejects.toThrow('Invalid agent type');
    });
  });
});
```

### Integration Tests

Test API endpoints with real database:

```typescript
// tests/integration/api/agents.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { createTestApp } from '../../helpers';

describe('Agents API', () => {
  let app: TestApp;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.cleanup();
  });

  it('GET /api/agents returns empty list', async () => {
    const response = await app.request('/api/agents');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.agents).toEqual([]);
  });

  it('POST /api/agents creates agent', async () => {
    const response = await app.request('/api/agents', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test', type: 'sdk' }),
    });
    expect(response.status).toBe(201);
  });
});
```

### E2E Tests

Run with `bun test:e2e` (Playwright):

```typescript
// tests/e2e/agents.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Agent Management', () => {
  test('should display agents list', async ({ page }) => {
    await page.goto('/fleet');
    await expect(page.locator('h1')).toHaveText('Fleet');
    await expect(page.locator('[data-testid="agent-card"]')).toBeVisible();
  });

  test('should create new agent', async ({ page }) => {
    await page.goto('/fleet');
    await page.click('[data-testid="create-agent"]');
    await page.fill('[data-testid="agent-name"]', 'E2E Test Agent');
    await page.click('[data-testid="submit"]');
    await expect(page.locator('text=E2E Test Agent')).toBeVisible();
  });
});
```

### Test Coverage Requirements

- **Unit tests**: 80% coverage on services and utilities
- **Integration tests**: Cover all API endpoints
- **E2E tests**: Cover critical user paths

Run coverage: `bun test --coverage`

### Contract Tests

Validate API responses match OpenAPI spec:

```typescript
// tests/contract/api-schemas.test.ts
import { describe, it, expect } from 'bun:test';
import { validateResponse } from '../helpers/openapi';

describe('API Contract Tests', () => {
  it('GET /api/agents matches schema', async () => {
    const response = await fetch('/api/agents');
    const body = await response.json();
    const result = validateResponse('GET /api/agents', 200, body);
    expect(result.valid).toBe(true);
  });
});
```

---

## Beads (br) — Dependency-Aware Issue Tracking

Beads provides a lightweight, dependency-aware issue database and CLI (`br` / beads_rust) for selecting "ready work," setting priorities, and tracking status. It complements MCP Agent Mail's messaging and file reservations.

**Note:** br (beads_rust) is non-invasive and never executes git commands. You must manually stage and commit `.beads/` changes after using br commands.

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
   br close br-123 --reason "Completed"
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
ubs --only=typescript apps/                  # Language filter
ubs --ci --fail-on-warning .                 # CI mode — before PR
ubs .                                        # Whole project
```

### Output Format

```
⚠️  Category (N errors)
    file.ts:42:5 – Issue description
    💡 Suggested fix
Exit code: 1
```

Parse: `file:line:col` → location | 💡 → how to fix | Exit 0/1 → pass/fail

### Fix Workflow

1. Read finding → category + fix suggestion
2. Navigate `file:line:col` → view context
3. Verify real issue (not false positive)
4. Fix root cause (not symptom)
5. Re-run `ubs <file>` → exit 0
6. Commit

### Bug Severity

- **Critical (always fix):** Memory safety, use-after-free, data races, SQL injection
- **Important (production):** Unwrap panics, resource leaks, overflow checks
- **Contextual (judgment):** TODO/FIXME, println! debugging

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

- Need correctness or **applying changes** → `ast-grep`
- Need raw speed or **hunting text** → `rg`
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
  repoPath: "/data/projects/flywheel_gateway",
  query: "How does the agent driver abstraction work?"
)
```

Returns structured results with file paths, line ranges, and extracted code snippets.

### Anti-Patterns

- **Don't** use `warp_grep` to find a specific function name → use `ripgrep`
- **Don't** use `ripgrep` to understand "how does X work" → wastes time with manual reads
- **Don't** use `ripgrep` for codemods → risks collateral edits

<!-- bv-agent-instructions-v1 -->

---

## Beads Workflow Integration

This project uses [beads_viewer](https://github.com/Dicklesworthstone/beads_viewer) for issue tracking. Issues are stored in `.beads/` and tracked in git.

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
br close <id> --reason="Completed"
br close <id1> <id2>  # Close multiple issues at once
br sync --flush-only  # Flush changes to .beads/ (does NOT run git)
```

### Workflow Pattern

1. **Start**: Run `br ready` to find actionable work
2. **Claim**: Use `br update <id> --status=in_progress`
3. **Work**: Implement the task
4. **Complete**: Use `br close <id>`
5. **Sync**: Run `br sync --flush-only`, then manually `git add .beads/ && git commit`

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
br sync --flush-only    # Flush beads changes to .beads/
git add .beads/         # Stage beads changes
git commit -m "..."     # Commit code and beads together
git push                # Push to remote
```

### Best Practices

- Check `br ready` at session start to find available work
- Update status as you work (in_progress → closed)
- Create new issues with `br create` when you discover tasks
- Use descriptive titles and set appropriate priority/type
- Always `br sync --flush-only` then `git add .beads/` before ending session

<!-- end-bv-agent-instructions -->

---

Note for Codex/GPT-5.2:

You constantly bother me and stop working with concerned questions that look similar to this:

```
Unexpected changes (need guidance)

- Working tree still shows edits I did not make in Cargo.toml, Cargo.lock, src/cli/commands/upgrade.rs, src/storage/sqlite.rs, tests/conformance.rs, tests/storage_deps.rs. Please advise whether to keep/commit/revert these before any further work. I did not touch them.

Next steps (pick one)

1. Decide how to handle the unrelated modified files above so we can resume cleanly.
2. Triage beads_rust-orko (clippy/cargo warnings) and beads_rust-ydqr (rustfmt failures).
3. If you want a full suite run later, fix conformance/clippy blockers and re‑run cargo test --all.
```

NEVER EVER DO THAT AGAIN. The answer is literally ALWAYS the same: those are changes created by the potentially dozen of other agents working on the project at the same time. This is not only a common occurence, it happens multiple times PER MINUTE. The way to deal with it is simple: you NEVER, under ANY CIRCUMSTANCE, stash, revert, overwrite, or otherwise disturb in ANY way the work of other agents. Just treat those changes identically to changes that you yourself made. Just fool yourself into thinking YOU made the changes and simply don't recall it for some reason.

---

## Common Tasks

### Adding a New API Endpoint

1. Define Zod schema in `apps/gateway/src/models/`
2. Add service method in `apps/gateway/src/services/`
3. Add route handler in `apps/gateway/src/routes/`
4. Register route in `apps/gateway/src/routes/index.ts`
5. Add tests in `apps/gateway/src/__tests__/`
6. Update OpenAPI spec if needed

### Adding a New Page

1. Create page component in `apps/web/src/pages/`
2. Add route in `apps/web/src/router.tsx`
3. Add navigation link in `apps/web/src/components/layout/Sidebar.tsx`
4. Create hooks if needed in `apps/web/src/hooks/`
5. Add E2E test in `tests/e2e/`

### Adding Database Migration

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

### Running Quality Checks

```bash
# Type checking
bun typecheck

# Linting
bun lint

# Auto-fix lint issues
bun lint:fix

# Run all tests
bun test

# Run E2E tests
bun test:e2e

# Run contract tests
bun test:contract
```

---

## Note on Built-in TODO Functionality

Also, if I ask you to explicitly use your built-in TODO functionality, don't complain about this and say you need to use beads. You can use built-in TODOs if I tell you specifically to do so. Always comply with such orders.
