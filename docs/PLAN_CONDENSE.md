# Flywheel Gateway: Platform Specification (Condensed)

> **SDK-First Multi-Agent Orchestration Platform**
> TypeScript/Bun Architecture with Complete Agent Flywheel Ecosystem Integration

---

## Preface: Understanding the Agent Flywheel

### The Problem: AI Agents Working in Isolation

AI coding agents (Claude Code, Copilot, Cursor, Codex) are powerful but work in isolation. They don't know what other agents are doing, what decisions were made in previous sessions, which files another agent is editing, what patterns have worked before, or whether their code will conflict with parallel work. This creates duplicate work, merge conflicts, lost knowledge, no coordination, and humans becoming message-passing middleware between agents.

### The Vision: The Agent Flywheel

The Agent Flywheel is a self-improving development cycle where AI coding agents work in parallel, coordinate via messaging, and compound their learnings over time. The cycle flows: PLAN (BV) → COORDINATE (Agent Mail) → EXECUTE (Gateway) → SCAN (UBS) → REMEMBER (CASS+CM) → repeat. Each revolution makes agents more effective because they build on accumulated intelligence rather than starting fresh.

### The Flywheel Tools

**Core Orchestration:**

1. **Flywheel Gateway** (this project): The orchestration backbone—spawns agents via multiple backends (SDK, ACP, Tmux), streams output in real-time via WebSocket, manages lifecycle (pause, resume, checkpoint, terminate), provides unified REST API, hosts web UI, manages BYOA accounts, and builds context packs.

2. **Agent Mail**: MCP-based messaging and coordination system. Agents send messages, reserve files (advisory locks preventing edit conflicts), manage threaded conversations, register under projects (working directory as identity), and respect contact policies.

3. **Beads (bd)**: Issue/task tracking designed for agents. A "bead" is a unit of work (bug, feature, task, chore). Beads have dependencies forming a DAG, status flows (draft → ready → in_progress → review → done), and metadata (priority, assignee, labels).

4. **BV (Bead Voyager)**: Graph-aware triage engine on top of Beads. Uses PageRank, betweenness centrality, and HITS algorithms to find critical-path items. Provides triage recommendations, blocking analysis, quick wins identification, and robot mode for programmatic consumption.

5. **UBS (Ultimate Bug Scanner)**: Code quality and security scanning. Catches issues before they compound via static analysis, style enforcement, complexity metrics, and security scanning. Can auto-create Beads from findings.

6. **CASS (Cross-Agent Session Search)**: Semantic search engine indexing past agent sessions. Enables "how did we solve X before?" queries with snippet extraction, filtering by date/agent/project/outcome, and privacy controls.

7. **CM (Cass-Memory)**: Procedural memory system extracting rules, patterns, and playbooks from CASS sessions. Generates "when doing X, always do Y" rules, detects anti-patterns, and creates step-by-step guides.

8. **CAAM (Credential/Account Automation Manager)**: BYOA subscription account management (Claude Max, GPT Pro, Gemini) with optional BYOK API key support. Provides profile vault, pool management, auto-rotation on rate limits, usage tracking, and health monitoring.

9. **SLB (Safety Layer/Boundary)**: Safety guardrails requiring human approval for dangerous operations. Implements two-person rule, operation classification (safe/risky/dangerous/forbidden), approval workflows, and audit trails.

10. **RU (Repo Updater)**: Production-grade Bash CLI (~17,700 LOC) for managing large repository collections. Provides multi-repo sync, AI code review orchestration, agent-sweep three-phase workflow, conflict detection, and preflight safety checks.

11. **DCG (Destructive Command Guard)**: High-performance Rust pre-execution hook (<1ms latency) blocking catastrophic commands. Uses modular pack system, context-aware analysis, severity tiers, and Claude Code integration.

**Developer Utilities:**
- **giil**: Downloads full-resolution images from cloud photo sharing services (iCloud, Dropbox, Google) for agent visual analysis
- **csctf**: Converts public AI chat share links to Markdown/HTML transcripts for knowledge capture

---

## North-Star Vision

Flywheel Gateway becomes a multi-agent command center: SDK-first direct integration, protocol-aware ACP support for IDEs, terminal-fallback Tmux support, web-first interface (desktop + mobile), and API-first REST + WebSocket for automation.

**Non-Negotiable Requirement**: Every agent operation must be possible via REST. No hidden features locked to specific drivers.

---

## Product Outcomes

### For Humans
- **One-page clarity**: In <10 seconds, see which agents are active/stalled/erroring, which contexts are producing output, where conflicts are forming, recent prompts, and overall flywheel health
- **Stripe-level UI polish**: Crisp, calm interface even while coordinating chaos
- **Mobile becomes genuinely useful**: Triage alerts, restart agents, broadcast prompts, resolve conflicts—not just viewing

### For Agents/Automation
- **Self-teaching OpenAPI**: Every endpoint has description, examples, error cases, when/why to use
- **Universal WebSocket feed**: Agent output, activity states, tool calls, notifications, file changes, conflicts, checkpoints—all in consistent event envelope with replay/resume

---

## The Agent Flywheel Philosophy

### Design Principles

1. **Agents as First-Class Citizens**: Every operation has REST API, OpenAPI specs include agent-specific hints, error messages are actionable by agents, system is observable and introspectable

2. **Coordination Over Control**: File reservations are advisory not mandatory, agents can message each other to resolve conflicts, system provides information while agents make decisions

3. **Memory as Infrastructure**: CASS makes sessions searchable, CM extracts generalizable knowledge, context packs deliver relevant memories at the right time, system gets smarter with every session

4. **Safety Through Visibility**: Agent activity is visible via Gateway UI, UBS catches issues early, SLB requires approval for dangerous operations, audit trails maintained for review

5. **Self-Management and Control**: No vendor lock-in (BYOA with optional BYOK), data stays in your environment, open protocols (MCP, ACP), portable across deployments

---

## Technology Stack

### Core Technologies
- **Runtime**: Bun 1.3+ (fast, native TypeScript, built-in SQLite, WebSocket)
- **Language**: TypeScript 5.9+ (strict mode)
- **HTTP Server**: Hono 4.11+ (ultrafast, Bun-native)
- **API**: tRPC 11+ (end-to-end type safety)
- **Database**: Drizzle ORM 0.45+ + bun:sqlite
- **WebSocket**: Bun Native WebSocket
- **Event Bus**: In-memory pub/sub with ring buffer history

### Frontend Technologies
- **Build Tool**: Vite 7.3+ (fast, no SSR complexity)
- **Framework**: React 19.2+ with Compiler stable
- **Routing**: TanStack Router 1.145+ (type-safe, file-based)
- **Server State**: TanStack Query 5.90+
- **Client State**: Zustand
- **Styling**: Tailwind CSS 4.1+
- **Animation**: Motion (Framer Motion)
- **Terminal**: xterm.js
- **Graphs**: React Flow (@xyflow/react)
- **Charts**: Recharts

### Agent SDKs
- Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)
- Codex SDK (`@openai/codex-sdk`)
- Google GenAI (`@google/genai`)

### Why Vite Over Next.js
No SEO needed (internal tool), no SSR needed (real-time WebSocket data), simpler mental model (no server components), faster dev experience (instant HMR), smaller bundle (no Next.js runtime), same features via TanStack Router.

---

## Architecture Overview

### High-Level Architecture

The architecture comprises: Web UI (Vite/React) → Bun HTTP Server (Hono + tRPC) with REST Router and WebSocket Hub → Agent Driver Layer (SDK, ACP, Tmux) → Supervisor Service managing Agent Mail MCP Server, CM Server, and BD Daemon → External Tools (UBS, CASS, CM, CAAM, SLB) and AI Agent SDKs.

### Design Principles
1. SDK-first execution with direct API calls
2. Protocol flexibility via Agent Driver abstraction
3. Flywheel-first feature design
4. Streaming-first WebSocket for real-time data
5. Unified ecosystem access from single UI
6. Type-safe end-to-end TypeScript
7. Progressive enhancement (UI enhances but doesn't replace CLI)

### Key Architectural Invariants
- No silent data loss
- Idempotency for automation
- All operations auditable with history and events
- API parity mandatory via Command Registry
- Critical events durable and replayable
- Everything streamable

### API Parity Guarantee: The Command Registry

Every operation is registered in a central registry that drives code generation. Each command definition includes: name, category, description, Zod input/output schemas, REST binding (method, path, path params), optional WebSocket binding (emitted events, subscribe topic), behavior metadata (idempotent, safety level, long-running), AI hints (when to use, common mistakes, prerequisites, follow-up commands), and handler function.

The registry enables automatic generation of REST routes, tRPC procedures, OpenAPI spec, TypeScript client, and WebSocket handlers. A parity gate CI check fails the build if any command lacks REST binding, AI hints, or violates safety rules.

---

## Supervisor & Daemon Management

Flywheel Gateway depends on external daemons (Agent Mail MCP server, CM server, bd daemon). The Supervisor Service manages their lifecycle with daemon specifications including command, port, health endpoint, restart policy, max restarts, and restart delay.

Daemon states: starting → running → stopping → stopped → failed. Health check loops ping endpoints. Auto-restart on failure with exponential backoff. WebSocket events notify of daemon status changes.

REST endpoints: GET/POST status, start, stop, restart for each daemon. Logs accessible via endpoint.

---

## Agent Driver Abstraction

### The Driver Interface

Unified interface supporting spawn, send, interrupt, getOutput, subscribe (AsyncIterable), and terminate operations. Each driver reports capabilities: structured events, tool calls, file operations, terminal attach, diff rendering.

### SDK Driver (Primary)
Direct API calls using agent SDKs. Provides structured events, tool call visibility, file operations. Best for programmatic control. Cannot attach visual terminal.

### ACP Driver (Structured Events)
Implements Agent Client Protocol for IDE-compatible structured events. Spawns via stdio JSON-RPC. Supports diff rendering types. Good for IDE integration scenarios.

### Tmux Driver (Fallback)
Visual terminal access via tmux sessions. Creates session, sends keystrokes. Text parsing only (no structured events). Supports terminal attach. Useful for power users wanting visual terminals.

### Driver Selection Strategy
Auto-select prefers SDK if supported, then ACP if adapter exists, then Tmux as fallback. Explicit selection also available.

---

## Agent Lifecycle Management

### Activity States
- `idle`: Waiting for input
- `thinking`: Processing, no output yet
- `working`: Actively producing output
- `tool_calling`: Executing a tool
- `waiting_input`: Waiting for user input
- `error`: Encountered an error
- `stalled`: No activity for threshold period

Activity status includes health score (0-100), last output timestamp, current tool call info, and time in current state.

### Checkpoints

Checkpoints allow rolling back to known-good state. Each checkpoint captures: conversation history, tool state, working directory, file snapshots (modified files since session start), optional context pack. Metadata includes creation trigger (manual, scheduled, before_risky_op, milestone), creator (user, auto, agent), verification status.

**Delta-Based Progressive Checkpointing**: Instead of full snapshots each time, store only what changed since last checkpoint—dramatically reducing storage (typically ~55% reduction) and restore times. Full checkpoints created every N checkpoints (default 5) or when no parent exists. Delta checkpoints store only new conversation turns, modified tool state keys, and git-style file diffs. Background compaction merges old delta chains into full checkpoints. Restore performance bounded by checkpoint interval.

**Auto-Checkpoint Triggers**: Before destructive operations (rm, delete, drop, reset patterns), periodic milestones (every 30 minutes), before large changes (modifying many files).

### Token & Context Window Tracking

Track per-agent token usage (prompt, completion, total, model, optional cost). Context window status includes max/used/remaining tokens, utilization percent, health status, predicted exhaustion time, and prepared summary for instant swap-in.

Context health statuses: healthy (<75%), warning (75-85%), critical (85-95%), emergency (>95%).

### Auto-Healing Context Window Management

Proactively manages context pressure through graduated interventions:

- **Warning threshold (75%)**: Proactively prepare summary for instant swap-in using fast model, preserving key decisions and file changes
- **Critical threshold (85%)**: Auto-compact by atomically replacing old turns with prepared summary, freeing tokens
- **Emergency threshold (95%)**: Force checkpoint, build context pack, spawn fresh agent with context pack, terminate old agent, emit seamless handover event

UI shows context utilization bar, "context refreshed" toast on compaction, subtle refresh icon (non-disruptive). Designed to be invisible when working well.

### Agent Rotation & Compaction Strategies

When context fills: summarize_and_continue, fresh_start with context pack, checkpoint_and_restart, or graceful_handoff. Triggers can be manual or automatic based on context utilization, conversation turns, or time elapsed.

### First-Class Session Handoff Protocol

Structured transfer of context, state, and resources between agents. Handoff request includes: from/to agent identities, task info (bead ID, completed/remaining work, priority), context transfer (relevant/modified files, key decisions, conversation summary, open questions), and resource transfer (reservations to transfer, checkpoint ID, context pack ID).

Handoff service validates request, builds context summary if needed, creates context pack for receiver, creates safety checkpoint, sends handoff message via Agent Mail, and emits WebSocket event. Acceptance transfers file reservations, loads context pack into receiving agent, notifies original agent, and emits event. Completion updates linked bead if present.

---

## REST API Layer

### Design Philosophy
Resource-oriented (agents, beads, reservations, messages), consistent response envelopes, idempotent where possible (PUT/DELETE), rich error responses with actionable hints, AI-agent friendly with comprehensive examples.

### API Conventions
- Content types: JSON
- Pagination: `?limit=50&cursor=cursor_01H...`
- Filtering: `?model=claude&status=working`
- Sorting: `?sort=-updated_at`

### Idempotency Framework
For any POST that mutates state, accept `Idempotency-Key: <uuid>` header. Server stores key + result for TTL window (24h default). Repeated calls with same key return cached result.

### Provisioning API (Queue-Driven)
Provisioning is first-class REST resource. State transitions: pending → approved → provisioned → verified → assigned. Preconditions enforced (email verified, manual approval when required, BYOA gate). Verification reports include disk IO, network latency, container health, monitoring agent, CAAM readiness.

### Error Model & Taxonomy

Structured error response with semantic code, message, optional details, request_id, actionable hint, and docs URL.

Error categories with HTTP mappings:
- Resource errors: `*_NOT_FOUND` (404), `*_ALREADY_EXISTS` (409)
- Validation: `INVALID_*`, `MISSING_*` (400)
- Auth: `UNAUTHORIZED` (401), `FORBIDDEN` (403)
- Quota: `QUOTA_EXCEEDED`, `RATE_LIMITED` (429)
- State: `*_IN_PROGRESS` (409), `*_NOT_READY` (503)
- Dependency: `*_UNAVAILABLE` (503)
- Internal: `INTERNAL_ERROR` (500)

Complete error code reference covers agents, accounts, provisioning, reservations, checkpoints, mail, beads, scanner, daemons, validation, safety, and internal errors.

### Jobs for Long-Running Operations

Operations like building context packs, running scans, exporting checkpoints return job ID immediately. Job has status (pending, running, completed, failed, cancelled), optional progress (0-100), timestamps, result, and error. REST endpoints for list, get, cancel, get result. WebSocket events for started, progress, completed, failed.

### OpenAPI & Developer Experience

Self-documenting API with Swagger UI at `/docs`. Every endpoint includes AI-agent hints: summary, when to use, common mistakes, related endpoints, example scenarios.

### Golden Path: API Sequence for AI Agents

Recommended sequence: check capabilities → get triage recommendations → claim work (update bead) → reserve files → build context pack → spawn agent → subscribe to WebSocket output → send task prompt → monitor for completion → on completion: checkpoint, release reservations, close bead, optionally terminate agent.

Error handling pattern: wrap API calls to handle recoverable errors. On QUOTA_EXCEEDED rotate account and retry, on RESERVATION_CONFLICT wait and retry or coordinate via mail, on AGENT_BUSY wait and retry.

Key principles: always check capabilities first, reserve before editing, use context packs, subscribe to WebSocket early, create checkpoints, clean up resources, handle errors gracefully.

---

## WebSocket Layer

### Connection Architecture

Topic router handles global topics (events, alerts, notifications, scanner, beads, mail, conflicts, metrics, pipeline, accounts) and scoped topics (agents:{id}, output:{agentId}, output:{agentId}:tools, jobs:{id}, supervisor, provisioning).

Event sources include: Agent SDK event streams, ACP JSON-RPC notifications, Tmux pipe-pane streaming, Agent Mail inbox polling, BV triage cache invalidation, UBS auto-scanner results, file system watchers, pipeline state changes, provisioning queue transitions, BYOA/CAAM status changes.

### Subscription Protocol

Client sends subscribe request with topics array and optional `since` cursor for resume. Server responds with confirmed topics, server time, and resume info if applicable.

### Event Envelope

Consistent structure: type, timestamp, sequence number, topic, and data payload. Sequence numbers are monotonic per topic for gap detection.

### Event Types

Agent events: spawned, state_changed, output.append, tool_call, tool_result, error, terminated
Beads events: created, updated, closed, claimed
Mail events: received, read, acknowledged
Reservation events: granted, released, conflict
Scanner events: started, finding, complete
System events: alert.created, approval.requested, approval.resolved

### Reconnection & Resume

Cursor-based resume: client sends last seen cursor or sequence number on reconnect, server replays missed events. If buffer overflow occurred, server sends stream.reset with snapshot of recent data.

Client maintains last sequence per topic, schedules reconnect with exponential backoff, resubscribes on connect with last seen sequences.

### Backpressure & Performance

Server-side per-agent ring buffer (default 10000 lines), per-client subscription limits. Client options: lines mode (safe) or raw mode (fast), throttle_ms for batching, max_lines_per_msg.

### Reliability & Acknowledgment Protocol

Critical events marked with `requires_ack: true` and ack_deadline_ms. Client must respond within deadline. If not acknowledged: log delivery failure, retry up to 3 times, fall back to alternative notification (email, webhook).

Clients detect gaps in sequence numbers and request replay of missing events.

### Scale-Out Architecture

For high availability with multiple gateway instances, use Redis adapter for pub/sub across servers. Each server broadcasts locally and publishes to Redis; all servers receive and broadcast locally. Sticky sessions route reconnecting clients to same server via connection ID encoding.

Scaling guidelines: Single server handles ~10,000 connections, ~50,000 events/sec, <10ms latency. Redis mode handles ~100,000+ connections, ~500,000 events/sec, <50ms latency. Start single-server; add Redis only when needed for >10K connections, zero-downtime deployments, or geographic distribution.

---

## Context Pack Building Engine

Context packs are pre-assembled prompts giving agents situational awareness, combining: triage data (from BV), memory (from CM), search results (from CASS), session context (from S2P).

### Token Budget Allocation

Configuration specifies total budget and per-component budgets (triage, memory, cass, s2p) with enabled flags, plus agent type and task description. Built pack includes rendered sections, token counts per section and total, and final rendered prompt.

### Context Builder Service

Builds pack by fetching triage, memory, and CASS data in parallel. Prioritizes within each section (e.g., recommendations > quick_wins > blockers for triage). Renders according to agent type (Claude, Codex, Gemini have different optimal formats).

### Context Pack Studio UI

Visual interface with budget allocation sliders per component (color-coded: amber for triage, purple for memory, blue for search, green for sessions), toggle switches for enabling/disabling components, total budget ring visualization, and live preview panel showing generated sections with token counts.

---

## Agent Mail Deep Integration

### REST API Endpoints

Health check, project management (ensure project exists), agent identity registration, inbox fetching, message sending/replying, mark read, acknowledge, full-text search, thread summary.

MCP wiring via `globalThis.agentMailCallTool` with configurable tool prefix, TTL, MCP command/args, client name/version.

### File Reservations API

Reserve paths (with exclusive flag and TTL), release reservations, renew TTL, list all reservations, get current conflicts.

### File Reservation Map Component

Real-time visualization showing reserved files grouped by path, holder agent badges with exclusive indicators, conflict warnings, animated entry/exit transitions, expiry countdowns.

---

## Conflict Detection & Resolution

### What Causes Conflicts
Overlapping file edits, competing git branches, incompatible changes to shared modules, race conditions in file reservations.

### Conflict Detection Service

Tracks recent file operations per agent. Detects conflicts when multiple agents write to same path. Calculates severity, suggests resolution based on context.

### Intelligent Conflict Resolution Assistant

AI-powered analysis suggests resolutions based on task context, agent progress, and historical patterns.

**Resolution Strategies:**
- `wait`: Agent can wait; holder almost done (estimated wait time provided)
- `split`: File can be partitioned into different sections
- `sequence`: Tasks have natural ordering; requeue
- `transfer`: Holder should yield; lower priority task
- `merge_tasks`: Tasks are complementary; combine
- `coordinate`: Agents should coordinate via mail
- `escalate`: Requires human decision

**Resolution Intelligence Service** analyzes:
1. Task priorities from beads (identify priority winner)
2. Progress estimates from checkpoints (completion percentage, time remaining, confidence)
3. Historical patterns from CASS (what worked before)
4. File structure for split potential (identify distinct sections)

Generates suggestions with confidence scores and rationale. Actions include notify_agent, set_reminder, transfer_reservation, send_coordination_message, create_bead, escalate_to_user. Ranks suggestions preferring high-confidence, non-escalation strategies.

**Auto-Resolution Rules** for low-risk conflicts: auto_wait_short (<5min, >80% confidence), auto_transfer_priority (>85% confidence), auto_coordinate (>70% confidence). Each rule specifies condition, max severity allowed.

---

## Beads & BV Integration

### REST API Endpoints

List/create/get/update beads, close bead, get ready work, get blocked work, full triage analysis, graph insights, add dependency, sync with git.

BV CLI configuration via `BV_PROJECT_ROOT` and `BV_TRIAGE_TTL_MS` (default 30s cache).

### Kanban Board Component

Drag-and-drop columns (Open, In Progress, Blocked, Review, Done) with bead cards. Drop updates bead status. Color-coded columns, visual drag feedback.

### Dependency Graph (Galaxy View)

React Flow visualization with node types: bead, bottleneck (high blocking count), keystone (critical path). Uses insights data to color and position nodes. Includes background grid, controls, mini-map with node coloring by type.

---

## CASS & Memory System Integration

### REST API Endpoints

Semantic search (CASS), get context for task, list memory rules, record outcome, get/update privacy settings.

### Semantic Search UI

Debounced search input with results showing session name, snippet, relative timestamp, relevance score. Results animate in with staggered delay. Empty state message when no matches.

---

## UBS Scanner Integration

### REST API Endpoints

Run scan, list findings, dismiss finding, create bead from finding, scan history.

### Scanner Dashboard

Overview showing last scan time, severity counts (critical, high, medium, low), run scan button. Severity cards with counts. Recent findings list with finding cards showing details, dismiss and create-bead actions.

---

## CAAM Account & Profile Management (BYOA + BYOK)

**Non-negotiable security invariant**: OAuth credentials never stored in Gateway's central database. All auth artifacts live inside each workspace's isolated environment, managed by CAAM. Gateway stores only non-sensitive metadata (presence, hashes, timestamps, health).

### Principles
1. BYOA first (subscription accounts are default path)
2. No credential custody (Gateway never sees login credentials)
3. Workspace-local auth artifacts (tokens remain in container/volume)
4. Minimum requirement: one verified provider to activate/assign
5. Recommended: 1× Claude Max + 1× GPT Pro
6. Provider parity (Claude, Codex, Gemini all supported)
7. Autonomous rotation via CAAM

### Account & Profile Data Model

AccountProfile includes: workspace ID, provider, name, auth mode (oauth_browser, device_code, api_key), status (unlinked, linked, verified, expired, cooldown, error), health score, expiry/cooldown timestamps, auth artifacts metadata (files present, hash, storage mode), labels.

AccountPool groups profiles by provider with rotation strategy (smart, round_robin, least_recent, random), cooldown defaults, max retries.

WorkspaceAuthState tracks BYOA status and verified providers per workspace.

### CAAM Integration Architecture

CAAM runs inside each workspace container. Gateway interacts via thin runner interface: listProfiles, getStatus, startLogin, completeLogin, activateProfile, runWithProfile, setCooldown.

### Provider Auth Flows (BYOA)

**Generic flow**: Gateway calls CAAM startLogin → UI displays device code or OAuth URL → User completes auth on their machine → CAAM detects new auth artifacts and marks verified → Gateway pulls metadata only.

**Codex (GPT Pro)**: Standard `codex login` (browser) or `codex login --device-auth` (headless). Auth in `~/.codex/auth.json`. CAAM enforces file mode via config.toml.

**Claude Code (Claude Max)**: `/login` in CLI. Credentials stored locally. CAAM detects actual auth artifacts and records hashes. API key mode via settings.json.

**Gemini CLI**: Settings in `~/.gemini/settings.json`. Auth modes: Google login, API key, or Vertex AI. `/auth` switches method.

**Auth Artifact Discovery**: CAAM discovers and normalizes artifacts at runtime, stores only metadata (hash + timestamps). Tracks only hashes and modified timestamps (never contents). Prefers most recently modified set if multiple exist.

**Login Modes**: Device code (returns verification URL + code), browser OAuth (returns login URL), slash command (Claude `/login`), API key/ADC (environment variables or config files), manual copy (fallback for offline linking).

**BYOA Verification**: Local, artifact-based, avoids network calls. Auth artifacts must exist and be readable, CAAM reports verified for at least one provider.

**Storage Modes**: Enforce file-based storage inside containers (not system keyring). CAAM switches to file mode if keyring detected.

### REST API Endpoints (BYOA-aware)

BYOA status, list profiles, start login (per provider), complete login, activate profile, cooldown profile, pool rotation.

### Rotation & Rate Limit Handling

On rate-limit signature detected: mark current profile in cooldown, select next healthiest profile from pool, replay command (when safe).

### Account Management UI

Provider cards showing verified profile count and cooldown status, one-click "Link Account" flows, health indicators, clear warnings when BYOA insufficient.

---

## SLB Safety Guardrails

### Operation Classification

Operations classified as: safe (auto-approved), risky (warning + confirmation), dangerous (human approval required), forbidden (blocked always).

### Two-Person Rule

Dangerous operations require explicit human approval. Request includes description, command, context, risk level. Approval workflow: request → review → approve/deny. Timeout auto-denies if no response.

### WebSocket Events

Approval requested, approved, denied, expired.

---

## RU (Repo Updater) Integration

### Fleet Management

Track multiple repositories with status (current, behind, ahead, diverged, dirty, conflict), last sync time, assigned agent.

### Agent-Sweep Orchestration

Three-phase workflow:
1. **Phase 1 (Deep Understanding)**: Agent reads AGENTS.md, README.md, git log
2. **Phase 2 (Plan Generation)**: Agent produces structured JSON plans
3. **Phase 3 (Validation & Execution)**: RU validates plans, runs preflight checks, executes git operations

### REST API Endpoints

List fleet repos, add/remove repos, sync repo, trigger sync all, get agent-sweep runs, trigger agent-sweep, approve phase 3.

---

## DCG (Destructive Command Guard) Integration

### Overview

Sub-millisecond pre-execution hook blocking catastrophic commands. Claude Code PreToolUse hook intercepts Bash commands.

### Pack System

Modular packs: git (reset --hard, force push), filesystem (rm -rf, chmod 777), database (DROP, TRUNCATE), containers (prune -af, system rm), kubernetes (delete namespace), cloud (terminate instances), terraform (destroy).

### Severity Tiers
- **Critical**: Always blocked (rm -rf /, git reset --hard)
- **High**: Allowlistable with justification
- **Medium**: Warning logged
- **Low**: Logged only

### Context-Aware Classification

Distinguishes executed code from data strings (reduces false positives dramatically). Classifications: executed, data, ambiguous.

### Allowlist Management

Rules can be allowlisted with: rule ID, pattern, added timestamp/by, optional reason, optional expiry, optional condition (e.g., CI=true).

### REST API Endpoints

Get/update config, list/enable/disable packs, list blocks, mark false positive, manage allowlist, get stats.

---

## Developer Utilities Integration

### Utility Management

Gateway provides auto-installation and configuration. Tracks: name, description, version, install command, check command, installed status.

**giil**: Download cloud photos for AI visual analysis. 4-tier capture strategy, supports iCloud/Dropbox/Google, image processing (compression, EXIF extraction, HEIC conversion).

**csctf**: Convert AI chat share links to Markdown/HTML. Multi-provider (ChatGPT, Gemini, Grok, Claude.ai), code-preserving, GitHub Pages publishing.

### REST API Endpoints

List utilities with install status, install utility, update utility, doctor check.

---

## Git Coordination

### REST API Endpoints

Repository status, list/create/delete branches, sync with remote, commit, push, pull, detect potential merge conflicts, stash/pop, get diff, get log.

### Branch Assignment Tracking

Track which agent is assigned to which branch with purpose description. Detect potential conflicts by comparing changed files across branches against main.

### Git Visualization

Branch viewer showing branches with current indicator, assigned agent, conflict warnings with file counts.

---

## History & Output System

### History Data Model

Entry includes: agent ID/type, timestamp, prompt, context pack ID, response summary, token counts, duration, outcome (success/failure/interrupted/timeout), error, tags, starred flag, replay count.

Output snapshot includes agent ID, timestamp, lines array, ANSI support flag, checksum.

### History REST Endpoints

List/get/search history, usage stats, replay prompt, star/unstar, export, prune old entries.

### Output Interaction Endpoints

Copy to clipboard, save to file, grep search, extract structured content (code blocks, JSON, file paths, URLs, errors, custom patterns), diff with another agent's output, create shareable link, detect file changes, AI-generated summary.

---

## Pipeline & Workflow Engine

### Pipeline Data Model

Pipeline includes: name, description, steps array, triggers (manual, schedule, webhook, bead_event), status, statistics (runs, successes, failures, avg duration).

Step includes: name, type (agent_task, condition, parallel, wait, approval), config, dependencies (step IDs), timeout, retry config, on_failure action.

### Step Types

- **agent_task**: Spawn agent with model/prompt/context pack, capture output, extract result
- **condition**: Evaluate expression, branch to then/else steps
- **parallel**: Execute multiple steps concurrently, configure fail-fast
- **wait**: Wait for duration, file change, or external event
- **approval**: Require human approval with prompt and options

### Pipeline REST Endpoints

List/create/get/update/delete pipelines, trigger run, get runs, get run details, cancel run, retry step, get step output.

---

## Metrics & Alert System

### Dashboard Metrics

**Agents**: Total, by status (idle, working, stalled, error), by model breakdown.

**Tokens**: Last 24h usage, trend, prompt vs completion breakdown.

**Performance**: Avg/p50/p95/p99 response times, success rate.

**Flywheel**: Beads open/closed (24h), conflicts detected/resolved, reservations active, messages exchanged (24h).

**System**: WebSocket connections, API latency, daemons healthy/total, memory/CPU usage.

### Alert Configuration

Alert includes: type, severity (info, warning, error, critical), title, message, source, timestamps, acknowledged status, available actions.

Alert types: agent_error, agent_stalled, conflict_detected, reservation_expired, daemon_failed, quota_warning/exceeded, approval_required, security_violation, system_health.

Alert rules specify: condition function, severity, title/message (can be dynamic), cooldown period, available actions.

Default rules: agent_stalled (no output 5min), quota_warning (>80% usage), daemon_failed.

### Agent Performance Analytics

**Metrics per agent**: Productivity (tasks completed/attempted, success rate, avg/median duration, LOC written, files modified), quality (error rate, rollback rate, conflict rate, UBS findings created/resolved, test pass rate), efficiency (tokens/cost per task, context utilization, idle/thinking time percentages), collaboration (messages, handoffs initiated/received, success rate, reservation conflicts), trends (improving/stable/declining).

**Model Comparison Report**: Per-model aggregated metrics (agent count, task count, success rate, duration, cost, tokens, quality score), best/worst use cases inferred from task tags, recommendations (model suggestions, cost optimization, quality improvement).

### Cost Analytics & Optimization

**Cost tracking**: Per-session costs with model breakdown, daily/weekly/monthly aggregations, per-agent cost attribution, token pricing per model.

**Budget management**: Budget creation with limits/alerts, usage forecasting based on trends, automatic notifications at thresholds.

**Optimization recommendations**: Identify cost-inefficient patterns, suggest model alternatives, detect token waste, compare actual vs optimal usage.

### Flywheel Velocity Dashboard

**Learning metrics**: Knowledge capture rate (sessions indexed, rules extracted), reuse rate (context pack components used from memory), conflict prevention (reservations before vs after), quality trend (UBS findings per session over time).

**Acceleration indicators**: Time to first useful output, iteration speed, handoff efficiency.

### Custom Dashboard Builder

Drag-and-drop grid layout with widget types: metric (single value with trend), chart (line/bar/area), table, alert list, agent grid, pipeline status.

Per-widget configuration: data source, query, visualization options, refresh interval.

### Comprehensive Notification System

**Multi-channel delivery**: In-app (WebSocket push), email, Slack, webhook.

**Notification types**: Agent events (started, completed, failed, stalled, needs approval), coordination (conflict detected/resolved, handoff requested/accepted), tasks (bead assigned/completed/blocked), costs (budget warning/exceeded), system (daemon failed, digests).

**Preferences**: Global enable/disable, quiet hours (with urgent override), per-category settings (enabled, channels, min priority), digest settings (daily/weekly, time of day), channel configuration (email address, Slack workspace/channel, webhook URL).

**Digest generation**: Compile period's notifications into summary, respect frequency preference, skip if no notifications.

---

## Web UI Layer

### Design System

**Colors**: Flywheel brand (blue tones), agent types (claude=amber, codex=green, gemini=blue), status (idle=slate, working=green, thinking=amber, error=red, stalled=purple), severity (low=blue, medium=amber, high=red, critical=dark red).

**CSS Custom Properties**: Surface colors (dark theme default), text hierarchy, semantic colors, agent identity colors, status indicators, spacing scale, animation timings, shadows.

**Tailwind Configuration**: Extended with custom colors referencing CSS variables, custom fonts (Inter var for sans, JetBrains Mono for mono), custom animations.

### Real-Time Agent Collaboration Graph

Force-directed graph visualization showing: agents as nodes (color-coded by type, status-indicated borders, breathing animation for working), edges for communication (animated particles for active message exchange, message count labels), file reservation nodes clustered near holders, conflict nodes between conflicting agents.

**View modes**: Agents only, files (with reservations), full (including conflicts and handoffs).

**Interactive features**: Pan/zoom, node selection showing detail panel, edge click showing messages, mini-map navigation.

**Layout algorithm**: D3 force simulation with link, charge, center, collision forces. Semantic clustering groups agents working on same feature.

### Performance Budgets

| Metric | Target |
|--------|--------|
| Agent list interaction | <100ms |
| Output stream scroll | 60fps |
| WebSocket message processing | <16ms |
| Initial load (desktop) | <2s FCP |
| Initial load (mobile) | <3s FCP |
| Time to Interactive | <3.5s |
| Bundle size (JS gzipped) | <200kb |

---

## Desktop vs Mobile UX Strategy

### Responsive Design

Breakpoints: sm=640px, md=768px, lg=1024px, xl=1280px, 2xl=1536px. Custom hooks for media query matching and responsive detection.

### Mobile Navigation

Bottom tab bar with icons: Home, Agents, Mail, Alerts (with badge), Settings. Fixed position with safe area padding.

### Mobile Gesture Support

Swipe left/right/up/down handlers, pull-to-refresh from top. Configurable minimum swipe distance and deviation tolerance.

### Mobile-Optimized Components

Agent cards with large touch targets (minimum 44px), tap feedback via scale animation, quick action buttons (send, interrupt, more menu).

---

## Security & Audit

### Audit Log Schema

Entry includes: correlation ID, timestamp, identity (user/API key/agent), client IP, user agent, request (method, path, params, redacted body), response (status code, response time, error), context (resource type/ID, action, tags).

Audit actions cover: agent operations, authorization, policy/role changes, checkpoints, accounts, safety events, file operations, git operations.

### Audit Service

Sanitizes sensitive fields (apiKey, password, token, secret, authorization) before logging. Writes to local database, emits for real-time monitoring, forwards to analytics backend (ClickHouse) for long-term storage.

### Audit REST Endpoints

Query logs with filtering (user, action, resource, time range), get entry details, export for compliance, retention policy management.

---

## Testing Strategy

### Test Pyramid

- **Unit tests**: Zod schemas, utility functions, state transitions (Bun test)
- **Integration tests**: API endpoints with real database, WebSocket message flow, driver contracts (Bun test)
- **Contract tests**: OpenAPI spec validation, type generation verification (Bun test + custom)
- **E2E tests**: Critical user flows, mobile/desktop paths (Playwright)
- **Load tests**: WebSocket connection limits, API throughput, output streaming performance (k6)

### Test Coverage Targets

Core services: 80%+, API routes: 90%+, UI components: 70%+, Critical paths (checkpoints, rotation, handoffs): 95%+.

---

## Risk Register & Mitigations

| Risk | Probability | Impact | Mitigations |
|------|-------------|--------|-------------|
| Rate limit storms | Medium | Medium | Account rotation, backoff, quota tracking |
| Network interruption | Medium | Medium | WebSocket reconnection, cursor-based resume, offline queue |
| Daemon failure | Low | High | Supervisor auto-restart, health checks, alerts |
| Data loss | Low | Critical | Delta checkpoints, Git coordination, SQLite WAL |
| Security breach | Low | Critical | BYOA token isolation, API key encryption, audit logging, safety guardrails |
| Coordination visibility | Medium | Medium | Real-Time Collaboration Graph |
| Performance degradation | Medium | Medium | Performance budgets, Web Workers, virtualization |
| Provider outage | Low | High | Multi-provider support, graceful degradation, queuing |
| Cost overruns | Medium | High | Cost Analytics with budgets, forecasting, optimization |
| Notification fatigue | Medium | Low | Per-category preferences, quiet hours, smart routing |
| Agent performance blind spots | Medium | Medium | Agent Performance Analytics with model comparison |
| Flywheel visibility gaps | Low | Medium | Flywheel Velocity Dashboard |

---

## Implementation Phases

### Phase 1: Foundation
- Project scaffolding (monorepo, packages)
- Command Registry + codegen with parity gate
- Shared error taxonomy + AI hints
- Database schema (Drizzle)
- Structured logging + correlation IDs
- SDK Agent Driver
- Agent lifecycle states
- WebSocket with durable ring buffers + ack/replay
- Basic REST API (spawn, terminate, list)
- Output streaming
- Web UI shell with mock-data mode
- DCG integration (pre-execution hook, block events, basic dashboard)
- Developer utilities auto-install

**Deliverable**: Spawn Claude agent, send prompts, view durable streaming output with DCG protection

### Phase 2: Core Features
- ACP Agent Driver
- Agent Mail integration
- File reservation system + UI
- Conflict detection baseline
- Delta checkpoint/restore system
- Context pack builder with token budgeting
- Auto-Healing Context Window Management
- Job orchestration
- History tracking
- Idempotency middleware
- Account management (CAAM) with BYOA gating + rotation

**Deliverable**: Multiple coordinated agents with reservations, context packs, auto-healing, delta checkpoints, BYOA-gated execution

### Phase 3: Flywheel Integration
- Beads/BV integration
- CASS search integration
- CM memory integration
- UBS scanner integration (auto-bead creation)
- Intelligent Conflict Resolution Assistant
- First-Class Session Handoff Protocol
- Real-Time Agent Collaboration Graph
- Safety guardrails (SLB)
- Git coordination
- RU integration (fleet management, agent-sweep)
- DCG advanced features (allowlist UI, false positive feedback, pack configuration)

**Deliverable**: Complete flywheel loop with AI-assisted conflict resolution, seamless handoffs, real-time collaboration visibility, fleet-wide orchestration

### Phase 4: Production Ready
- Metrics and alerts (OpenTelemetry + dashboards)
- Agent Performance Analytics
- Cost Analytics & Optimization
- Flywheel Velocity Dashboard
- Custom Dashboard Builder
- Comprehensive Notification System
- Audit trail hardening
- Pipeline engine
- Mobile optimization
- Performance optimization (WS backpressure, output virtualization)
- Comprehensive testing
- Documentation

**Deliverable**: Production-ready deployment with full observability, advanced analytics, intelligent notifications, performance targets met

---

## File Structure

```
flywheel_gateway/
├── apps/
│   ├── gateway/                 # Backend Hono server
│   │   ├── src/
│   │   │   ├── routes/          # API route handlers
│   │   │   ├── services/        # Business logic
│   │   │   ├── middleware/      # Hono middleware
│   │   │   ├── db/              # Drizzle schema & migrations
│   │   │   ├── ws/              # WebSocket handlers
│   │   │   ├── openapi/         # OpenAPI spec generation
│   │   │   └── index.ts         # Entry point
│   │   └── tests/
│   │
│   └── web/                     # Frontend React app
│       ├── src/
│       │   ├── components/      # UI components
│       │   ├── hooks/           # React hooks
│       │   ├── lib/             # Utilities
│       │   ├── pages/           # Route pages
│       │   └── stores/          # Zustand stores
│       └── tests/
│
├── packages/
│   ├── shared/                  # Shared types, utils, schemas
│   ├── agent-drivers/           # SDK, ACP, Tmux drivers
│   └── flywheel-clients/        # Agent Mail, BV, CASS, Scanner clients
│
├── reference/                   # Reference implementations from NTM
├── tests/                       # E2E, contract, load tests
└── docs/                        # Documentation
```

---

## Technical Specifications

### Database Schema

Tables: agents, checkpoints, accounts, history, alerts, auditLogs, dcgBlocks, dcgAllowlist, fleetRepos, agentSweeps.

Key fields per table documented with types (text, integer, real, blob) and constraints.

### API Error Codes

Complete reference of error codes with HTTP status mappings, covering all domains (agents, accounts, provisioning, reservations, checkpoints, mail, beads, scanner, daemons, validation, safety, DCG, fleet, utilities).

---

## API Parity Matrix

Complete mapping of all operations to REST endpoints, WebSocket topics, and tRPC procedures covering:

- Agent Operations (list, spawn, get, terminate, send, interrupt, output, status, checkpoint, restore, rotate, context window)
- Agent Mail Operations (project, agent registration, messages, inbox, search, reservations, conflicts)
- Beads Operations (CRUD, ready/blocked, triage, insights, dependencies, sync)
- Scanner Operations (run, findings, dismiss, create-bead, history)
- Memory Operations (search, context, rules, outcome, privacy)
- Account Operations (BYOA status, profiles, login flow, pools, rotation)
- Provisioning Operations (requests, transitions, verify, assign)
- Handoff Operations (initiate, accept, reject, complete, pending, history)
- Collaboration Graph Operations (full graph, views, stats, history)
- Context Health Operations (status, health events)
- Agent Performance Analytics (performance, model comparison, trends, recommendations)
- Cost Analytics (costs, budgets, forecasts, recommendations)
- Notification Operations (list, read, action, preferences)

---

*This condensed specification captures the complete architectural vision and detailed design of Flywheel Gateway without code samples. For implementation reference, consult the full PLAN.md document.*
