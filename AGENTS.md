# Flywheel Gateway - Agent Guidelines

## RULE 1 – ABSOLUTE (DO NOT EVER VIOLATE THIS)

You may NOT delete any file or directory unless I explicitly give the exact command **in this session**.

- This includes files you just created (tests, tmp files, scripts, etc.).
- You do not get to decide that something is "safe" to remove.
- If you think something should be removed, stop and ask. You must receive clear written approval **before** any deletion command is even proposed.

Treat "never delete files without permission" as a hard invariant.

---

## RULE 2 – PUBLIC/PRIVATE SEPARATION

This is a **PUBLIC open source repository**. Never add content about:

- Pricing, tiers, plans, billing, revenue, MRR/ARR
- Hosting business operations (fleet management, workspace quotas, automation ops)
- Server providers, procurement, capacity planning
- Customer segments, competitive analysis, go-to-market

**All business content belongs in `private_business/`** (a separate private git repo).

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

## Issue Tracking with bd (beads)

All issue tracking goes through **bd**. No other TODO systems.

Key invariants:

- `.beads/` is authoritative state and **must always be committed** with code changes.
- Do not edit `.beads/*.jsonl` directly; only via `bd`.

### Basics

Check ready work:

```bash
bd ready --json
```

Create issues:

```bash
bd create "Issue title" -t bug|feature|task -p 0-4 --json
bd create "Issue title" -p 1 --deps discovered-from:bd-123 --json
```

Update:

```bash
bd update bd-42 --status in_progress --json
bd update bd-42 --priority 1 --json
```

Complete:

```bash
bd close bd-42 --reason "Completed" --json
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

1. `bd ready` to find unblocked work.
2. Claim: `bd update <id> --status in_progress`.
3. Implement + test.
4. If you discover new work, create a new bead with `discovered-from:<parent-id>`.
5. Close when done.
6. Commit `.beads/` in the same commit as code changes.

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
   bd sync
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
