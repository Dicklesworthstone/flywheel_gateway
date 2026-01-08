# Flywheel Gateway: Complete Platform Specification

> **A Comprehensive Plan for Building an SDK-First Multi-Agent Orchestration Platform**
>
> *TypeScript/Bun Architecture with Complete Agent Flywheel Ecosystem Integration*
> *Agent Mail, BV, UBS, CASS, CM, CAAM, SLB*

---

## Preface: Understanding the Agent Flywheel

This section provides essential background for anyone reading this plan. Skip this if you're already familiar with the Agent Flywheel ecosystem.

### The Problem: AI Agents Working in Isolation

The AI coding agent revolution is here. Tools like Claude Code, GitHub Copilot, Cursor, and Codex can write code, run tests, and even debug complex issues. But there's a fundamental problem:

**AI agents work in isolation.**

When you run Claude Code on a project, it operates alone. It doesn't know:
- What other agents are working on the same codebase
- What decisions were made in previous sessions
- Which files another agent is currently editing
- What patterns have worked (or failed) in similar past tasks
- Whether the code it's about to write will conflict with parallel work

This isolation creates waste:
- **Duplicate work** — Two agents solve the same problem differently
- **Merge conflicts** — Agents edit the same files simultaneously
- **Lost knowledge** — Insights from one session don't carry to the next
- **No coordination** — Agents can't delegate, escalate, or collaborate
- **Human bottleneck** — You become the message-passing middleware between agents

### The Vision: The Agent Flywheel

The **Agent Flywheel** is a self-improving development cycle where AI coding agents work in parallel, coordinate via messaging, and compound their learnings over time.

```
                    ┌─────────────────────────────────────────┐
                    │         THE AGENT FLYWHEEL              │
                    │      (Self-Reinforcing Cycle)           │
                    └─────────────────────────────────────────┘

                              ┌──────────┐
                              │   PLAN   │
                              │   (BV)   │
                              └────┬─────┘
                                   │
            What work is ready?    │    Graph analysis reveals
            What's blocked?        │    optimal task ordering
            What's the critical    │
            path?                  ▼
                              ┌──────────┐
         ┌────────────────────│COORDINATE│────────────────────┐
         │                    │(Ag Mail) │                    │
         │                    └────┬─────┘                    │
         │                         │                          │
         │  Agents claim work,     │   Reserve files,         │
         │  message each other,    │   resolve conflicts,     │
         │  share discoveries      │   handoff context        │
         │                         ▼                          │
         │                    ┌──────────┐                    │
         │                    │ EXECUTE  │                    │
         │                    │(Gateway) │                    │
         │                    └────┬─────┘                    │
         │                         │                          │
         │  Spawn agents,          │   SDK-first execution,   │
         │  stream output,         │   real-time monitoring,  │
         │  manage lifecycle       │   checkpoints            │
         │                         ▼                          │
         │                    ┌──────────┐                    │
         │                    │   SCAN   │                    │
         │                    │  (UBS)   │                    │
         │                    └────┬─────┘                    │
         │                         │                          │
         │  Quality gates,         │   Catch issues before    │
         │  security checks,       │   they compound          │
         │  anti-pattern detection │                          │
         │                         ▼                          │
         │                    ┌──────────┐                    │
         └───────────────────▶│ REMEMBER │◀───────────────────┘
                              │(CASS+CM) │
                              └────┬─────┘
                                   │
            Index sessions,        │    Extract rules,
            semantic search,       │    build playbooks,
            find prior solutions   │    improve prompts
                                   │
                                   ▼
                           ┌───────────────┐
                           │ NEXT CYCLE    │
                           │ IS BETTER     │
                           └───────────────┘

    Each revolution of the flywheel:
    • Agents have more context (from CASS/CM)
    • Work is better prioritized (from BV)
    • Conflicts are prevented (from Agent Mail)
    • Quality is maintained (from UBS)
    • Execution is faster (from Gateway optimizations)
```

The flywheel is **self-reinforcing**: each cycle generates knowledge that makes the next cycle faster and higher quality. Over time, the agents become more effective because they're building on accumulated intelligence rather than starting fresh each time.

### The Flywheel Tools

The Agent Flywheel is implemented through interconnected tools organized into core orchestration components and developer utilities. Understanding each tool is essential to understanding this plan.

#### 1. Flywheel Gateway (This Project)

**What it is:** The orchestration backbone—a web platform that spawns, monitors, and coordinates AI coding agents.

**Key responsibilities:**
- Spawn agents via multiple backends (SDK, ACP protocol, Tmux terminals)
- Stream agent output in real-time via WebSocket
- Manage agent lifecycle (pause, resume, checkpoint, terminate)
- Provide unified REST API for all flywheel tools
- Host the web UI for human visibility and control
- Manage BYOA accounts and rotate API keys when used (BYOK)
- Build "context packs" that give agents situational awareness

**Why it matters:** Without Gateway, agents are invisible black boxes. With Gateway, you have a command center showing what every agent is doing, with the ability to intervene when needed.

#### 2. Agent Mail

**What it is:** A messaging and coordination system for AI agents, implemented as an MCP (Model Context Protocol) server.

**Key responsibilities:**
- **Messaging:** Agents send messages to each other (project updates, questions, handoffs)
- **File Reservations:** Advisory locks that prevent edit conflicts ("I'm working on auth.ts")
- **Thread Management:** Conversations are threaded for context preservation
- **Project Identity:** Agents register under projects (working directory as identity)
- **Contact Policies:** Control which agents can message which others

**Key concepts:**
```
┌─────────────────────────────────────────────────────────────────┐
│                     AGENT MAIL ARCHITECTURE                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  PROJECT: /data/projects/my-app                                 │
│  ├── Agent: GreenCastle (claude-code, opus-4.5)                │
│  │   ├── Inbox: 3 unread messages                              │
│  │   ├── Reservations: src/api/*.ts (exclusive, 2hr TTL)       │
│  │   └── Status: Working on API refactor                       │
│  │                                                              │
│  ├── Agent: BlueLake (codex-cli, gpt-5)                        │
│  │   ├── Inbox: 1 unread message                               │
│  │   ├── Reservations: tests/*.test.ts (exclusive, 1hr TTL)    │
│  │   └── Status: Writing test coverage                         │
│  │                                                              │
│  └── Agent: RedStone (claude-code, sonnet-4)                   │
│      ├── Inbox: 0 unread messages                              │
│      ├── Reservations: none                                     │
│      └── Status: Idle, awaiting work                           │
│                                                                 │
│  THREADS:                                                       │
│  ├── TKT-123: "API Authentication Refactor"                    │
│  │   └── 12 messages, 3 participants                           │
│  └── TKT-124: "Fix login redirect bug"                         │
│      └── 5 messages, 2 participants                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Why it matters:** Without Agent Mail, agents step on each other's toes. With Agent Mail, they coordinate like a team—claiming work, signaling progress, and handing off context cleanly.

#### 3. bd (Beads)

**What it is:** An issue/task tracking system designed for AI-agent workflows. Think "GitHub Issues but optimized for agents."

**Key concepts:**
- **Bead:** A unit of work (bug, feature, task, chore)
- **Dependencies:** Beads can depend on other beads (forms a DAG)
- **Status:** draft → ready → in_progress → review → done
- **Metadata:** Priority, assignee (can be agent name), labels, time estimates

**Why "beads"?** The metaphor is a string of beads—work items threaded together by dependencies, forming a necklace of progress.

```
┌─────────────────────────────────────────────────────────────────┐
│                      BEADS DEPENDENCY GRAPH                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│    ┌─────────┐                                                  │
│    │ BEADS-1 │ "Set up database schema"                        │
│    │  DONE   │                                                  │
│    └────┬────┘                                                  │
│         │                                                       │
│    ┌────┴────┐                                                  │
│    ▼         ▼                                                  │
│ ┌─────────┐ ┌─────────┐                                        │
│ │ BEADS-2 │ │ BEADS-3 │                                        │
│ │  DONE   │ │IN_PROG  │ "Implement user model"                 │
│ │         │ │BlueLake │                                        │
│ └────┬────┘ └────┬────┘                                        │
│      │           │                                              │
│      └─────┬─────┘                                              │
│            ▼                                                    │
│      ┌─────────┐                                                │
│      │ BEADS-4 │ "Add authentication endpoints"                │
│      │  READY  │ ← GreenCastle can start this                  │
│      └────┬────┘                                                │
│           │                                                     │
│           ▼                                                     │
│      ┌─────────┐                                                │
│      │ BEADS-5 │ "Integration tests for auth"                  │
│      │ BLOCKED │ ← Waiting on BEADS-4                          │
│      └─────────┘                                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Why it matters:** Without structured task tracking, agents don't know what to work on. With Beads, they can query for ready work, understand dependencies, and update status as they progress.

#### 4. BV (Beads Visualization / Bead Voyager)

**What it is:** A graph-aware triage and analysis engine that sits on top of Beads. It provides intelligent recommendations about what to work on next.

**Key capabilities:**
- **Graph Analysis:** PageRank, betweenness centrality, HITS algorithm to find critical-path items
- **Triage Recommendations:** "Here are the 5 most impactful beads to work on now"
- **Blocking Analysis:** "These 3 beads are blocking the most other work"
- **Quick Wins:** "These beads are small and unblock multiple items"
- **Robot Mode:** JSON output for programmatic consumption by agents

**Example BV triage output:**
```json
{
  "recommendations": [
    {
      "bead_id": "BEADS-4",
      "title": "Add authentication endpoints",
      "score": 0.92,
      "reasons": [
        "Unblocks 3 downstream beads",
        "High PageRank (critical path)",
        "Estimated 2-4 hours (reasonable scope)"
      ]
    }
  ],
  "quick_wins": [
    {
      "bead_id": "BEADS-7",
      "title": "Fix typo in error messages",
      "score": 0.78,
      "reasons": ["15 minutes", "No dependencies", "Improves UX"]
    }
  ],
  "blockers_to_clear": [
    {
      "bead_id": "BEADS-3",
      "blocking_count": 4,
      "assignee": "BlueLake",
      "status": "in_progress"
    }
  ]
}
```

**Why it matters:** Without BV, agents pick work randomly or by recency. With BV, they work on what matters most—maximizing throughput through the dependency graph.

#### 5. UBS (Ultimate Bug Scanner)

**What it is:** A code quality and security scanning tool that catches issues before they compound.

**Key capabilities:**
- **Static Analysis:** Detect common bugs, anti-patterns, security vulnerabilities
- **Style Enforcement:** Ensure consistency across agent-written code
- **Complexity Metrics:** Flag overly complex functions
- **Security Scanning:** OWASP top 10, credential leaks, injection risks
- **Integration:** Can auto-create Beads from findings

**Scan categories:**
| Category | Examples |
|----------|----------|
| **Security** | SQL injection, XSS, hardcoded secrets, insecure crypto |
| **Quality** | Dead code, unused variables, unreachable branches |
| **Complexity** | Functions > 50 lines, cyclomatic complexity > 10 |
| **Style** | Inconsistent naming, missing error handling |
| **Performance** | N+1 queries, unbounded loops, memory leaks |

**Why it matters:** Agents write code fast, but they can introduce subtle bugs. UBS catches these before they accumulate into technical debt. It's the quality gate in the flywheel.

#### 6. CASS (Cross-Agent Session Search)

**What it is:** A semantic search engine that indexes past agent sessions, making historical knowledge discoverable.

**Key capabilities:**
- **Session Indexing:** Every agent conversation is indexed
- **Semantic Search:** "How did we handle OAuth last time?" → relevant sessions
- **Snippet Extraction:** Pull specific relevant portions, not entire sessions
- **Filtering:** By date, agent, project, tags, outcome (success/failure)
- **Privacy Controls:** Redact sensitive content before indexing

**Example query:**
```
Query: "rate limiting implementation"

Results:
1. Session 2024-12-15 (GreenCastle, my-api)
   "Implemented token bucket rate limiter in middleware..."
   Relevance: 0.94

2. Session 2024-11-28 (BlueLake, auth-service)
   "Added sliding window rate limit with Redis backend..."
   Relevance: 0.87

3. Session 2024-10-02 (RedStone, gateway)
   "Considered rate limiting approaches, chose leaky bucket..."
   Relevance: 0.71
```

**Why it matters:** Without CASS, agents reinvent solutions. With CASS, they can search "how did we solve X before?" and build on prior work.

#### 7. CM (Cass-Memory)

**What it is:** A procedural memory system that extracts rules, patterns, and playbooks from CASS sessions.

**Key capabilities:**
- **Rule Extraction:** "When doing X, always do Y" patterns from successful sessions
- **Anti-Pattern Detection:** "This approach failed 3 times, avoid it"
- **Playbook Generation:** Step-by-step guides derived from successful sessions
- **Context Retrieval:** "For this task, here are relevant memories"
- **Privacy-Respecting:** Generalizes without exposing sensitive specifics

**Example memories:**
```yaml
# Extracted from 47 sessions involving database migrations
- rule: "Always create a backup before running migrations"
  confidence: 0.95
  source_sessions: 47

- rule: "Test migrations on a copy of production data"
  confidence: 0.89
  source_sessions: 32

- anti_pattern: "Don't run migrations during peak traffic"
  failures: 3
  description: "Caused 2 outages when tried during business hours"
```

**Why it matters:** CASS gives you search; CM gives you wisdom. It's the difference between "here are past sessions" and "here's what we learned from them."

#### 8. CAAM (Credential/Account Automation Manager)

**What it is:** A system for managing **BYOA subscription accounts** (Claude Max, GPT Pro, Gemini) with optional BYOK (API key) support.

**Key capabilities:**
- **Profile Vault:** Tenant‑local OAuth artifacts managed by CAAM (never centralized)
- **Pool Management:** Multiple profiles per provider for rotation
- **Auto‑Rotation:** When an account hits a limit, switch to the next profile
- **Usage Tracking:** Track rate limits and cooldowns by profile
- **Health Monitoring:** Detect expired tokens, rate limits, and auth failures

**Example pool (profiles, not API keys):**
```
┌─────────────────────────────────────────────────────────────────┐
│                   CLAUDE MAX PROFILE POOL                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Profile: work@corp    │ Cooldown: 12m         │ Status: ACTIVE │
│  Profile: alice@gmail  │ Cooldown: 0m          │ Status: READY  │
│  Profile: bob@gmail    │ Cooldown: 43m         │ Status: COOLDOWN│
│                                                                 │
│  Current: work@corp (active)                                    │
│  Next: alice@gmail (auto‑rotate on rate limit)                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Why it matters:** Agents consume API tokens fast. Without CAAM, you hit rate limits and stall. With CAAM, you have automatic failover across multiple keys and providers.

#### 9. SLB (Safety Layer/Boundary)

**What it is:** Safety guardrails that prevent dangerous operations and enforce human oversight for risky actions.

**Key capabilities:**
- **Two-Person Rule:** Dangerous operations require human approval
- **Operation Classification:** Safe, risky, dangerous, forbidden
- **Approval Workflows:** Request → Review → Approve/Deny
- **Audit Trail:** Every approval decision is logged
- **Timeout Handling:** Auto-deny if no response within window

**Example dangerous operations:**
| Operation | Risk Level | Requires |
|-----------|------------|----------|
| `rm -rf /` | FORBIDDEN | Blocked always |
| `git push --force main` | DANGEROUS | Human approval |
| `DROP TABLE users` | DANGEROUS | Human approval |
| `git reset --hard` | RISKY | Warning + confirmation |
| `npm install` | SAFE | Auto-approved |

**Why it matters:** Autonomous agents are powerful but can make catastrophic mistakes. SLB ensures humans stay in the loop for irreversible actions.

#### 10. RU (Repo Updater)

**What it is:** A production-grade Bash CLI (~17,700 LOC) for managing large collections of GitHub repositories with AI-assisted review and agent automation capabilities.

**Key capabilities:**
- **Multi-repo sync:** Clone & pull 100+ repos with parallel processing (`-j N`)
- **AI code review:** Orchestrates Claude Code sessions via ntm for PR/issue review
- **Agent-sweep:** Three-phase automated workflow per repository (analyze → plan → execute)
- **Conflict detection:** Identifies diverged, dirty, and conflicted repos with actionable resolution
- **Preflight safety:** Blocks unsafe states (detached HEAD, merge in progress, secrets detected)

**Agent-sweep workflow:**
```
Phase 1: Deep Understanding (300s)
    ↓ Agent reads AGENTS.md, README.md, git log
Phase 2: Plan Generation (600s)
    ↓ Agent produces commit/release plans in structured JSON
Phase 3: Validation & Execution (300s)
    ↓ RU validates plans, runs preflight checks, executes git operations
```

**Why it matters:** Managing dozens of repositories manually is tedious and error-prone. RU automates sync, enables AI-driven maintenance across entire repository fleets, and integrates with ntm for session orchestration.

#### 11. DCG (Destructive Command Guard)

**What it is:** A high-performance Rust pre-execution hook (<1ms latency) for Claude Code that blocks catastrophic commands before they run.

**Key capabilities:**
- **Modular pack system:** git, filesystem, database, containers, kubernetes, cloud, terraform
- **Context-aware:** Distinguishes executed code from data strings (dramatically reduces false positives)
- **Severity tiers:** Critical (always block), High (allowlistable), Medium (warn), Low (log)
- **Claude Code integration:** PreToolUse hook that intercepts Bash commands

**Example blocked operations:**
| Command | Pack | Severity |
|---------|------|----------|
| `git reset --hard` | core.git | Critical |
| `rm -rf ./` | core.filesystem | Critical |
| `docker system prune -af` | containers.docker | High |
| `DROP DATABASE production` | database.postgresql | Critical |
| `kubectl delete namespace prod` | kubernetes.kubectl | Critical |

**Why it matters:** DCG is the mechanical enforcement layer that protects against honest mistakes. Unlike AGENTS.md instructions which agents might ignore, DCG physically prevents destructive commands from executing. It replaces simpler Python-based approaches with sub-millisecond Rust performance.

#### Developer Utilities

These tools enhance AI agent workflows and should be auto-installed in agent environments:

#### giil (Get Image from Internet Link)

**What it is:** A zero-setup CLI that downloads full-resolution images from cloud photo sharing services.

**Key capabilities:**
- **4-tier capture strategy:** Download button → CDN interception → element screenshot → viewport
- **Supported platforms:** iCloud, Dropbox, Google Photos, Google Drive
- **Image processing:** MozJPEG compression, EXIF datetime extraction, HEIC conversion
- **Remote-friendly:** Perfect for SSH sessions where agents need to analyze screenshots

**Why it matters:** When debugging UI issues remotely, agents need to see screenshots. giil bridges the gap—paste an iCloud link, run one command, agent immediately analyzes the image.

#### csctf (Chat Shared Conversation to File)

**What it is:** A single-binary CLI for converting public AI chat share links into clean Markdown and HTML transcripts.

**Key capabilities:**
- **Multi-provider:** ChatGPT, Gemini, Grok, Claude.ai
- **Code-preserving:** Fenced blocks with language detection
- **GitHub Pages:** One-command publish to static microsite
- **Deterministic:** Collision-proof filenames, atomic writes

**Why it matters:** AI conversations contain valuable problem-solving context. csctf captures this knowledge as searchable, archivable documents that can feed back into CASS for future retrieval.

### How the Tools Work Together

The flywheel tools form a cohesive system where each tool amplifies the others:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     FLYWHEEL TOOL INTERACTIONS                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│                         ┌─────────────────┐                                 │
│                         │     GATEWAY     │                                 │
│                         │  (Orchestrator) │                                 │
│                         └────────┬────────┘                                 │
│                                  │                                          │
│           ┌──────────────────────┼──────────────────────┐                  │
│           │                      │                      │                   │
│           ▼                      ▼                      ▼                   │
│    ┌─────────────┐       ┌─────────────┐       ┌─────────────┐            │
│    │ AGENT MAIL  │◀─────▶│    BEADS    │◀─────▶│     BV      │            │
│    │ Coordination│       │   Tracking  │       │   Triage    │            │
│    └──────┬──────┘       └──────┬──────┘       └─────────────┘            │
│           │                     │                                          │
│           │  File reservations  │  Create beads                            │
│           │  map to beads       │  from scan findings                      │
│           │                     │                                          │
│           ▼                     ▼                                          │
│    ┌─────────────┐       ┌─────────────┐                                   │
│    │    CASS     │──────▶│     CM      │                                   │
│    │   Search    │       │   Memory    │                                   │
│    └──────┬──────┘       └──────┬──────┘                                   │
│           │                     │                                          │
│           │  Sessions feed      │  Rules inform                            │
│           │  memory extraction  │  context packs                           │
│           │                     │                                          │
│           └──────────┬──────────┘                                          │
│                      │                                                      │
│                      ▼                                                      │
│    ┌─────────────┐       ┌─────────────┐       ┌─────────────┐            │
│    │     UBS     │       │    CAAM     │       │     SLB     │            │
│    │   Scanner   │       │    Keys     │       │   Safety    │            │
│    └─────────────┘       └─────────────┘       └─────────────┘            │
│           │                     │                      │                   │
│           │                     │                      │                   │
│           └─────────────────────┴──────────────────────┘                   │
│                                 │                                          │
│                    All tools unified under Gateway API                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

Data flows:
─────────────────────────────────────────────────────────────────────────────
1. BV analyzes Beads → recommends work → Agent claims via Agent Mail
2. Agent starts work → Gateway spawns execution → reserves files via Agent Mail
3. Agent completes → UBS scans output → creates new Beads for findings
4. Session indexed by CASS → CM extracts rules → improves future context packs
5. All operations use CAAM for account profiles (BYOA) and API keys when needed (BYOK) → SLB for safety checks
6. Gateway provides unified API for everything → Web UI visualizes it all
```

### The Flywheel in Action: An Example

Let's walk through a concrete example of how the flywheel operates:

**Scenario:** A team wants to add user authentication to their app. They have three AI agents available.

```
HOUR 0: Setup
─────────────────────────────────────────────────────────────────
Human creates beads:
  BEADS-1: "Design auth schema" (ready)
  BEADS-2: "Implement user model" (depends on BEADS-1)
  BEADS-3: "Add login endpoint" (depends on BEADS-2)
  BEADS-4: "Add registration endpoint" (depends on BEADS-2)
  BEADS-5: "Write auth tests" (depends on BEADS-3, BEADS-4)

BV triage recommends: "Start with BEADS-1, it unblocks everything"

HOUR 1: First Agent Starts
─────────────────────────────────────────────────────────────────
GreenCastle (Claude Opus 4.5):
  1. Queries BV → gets BEADS-1 as top recommendation
  2. Claims BEADS-1 via Agent Mail
  3. Reserves db/schema.sql via Agent Mail
  4. Gateway spawns agent with context pack:
     - Task: BEADS-1 description
     - Memory: "Always use UUID for user IDs" (from CM)
     - Similar session: "Auth schema from project-X" (from CASS)
  5. Completes work, marks BEADS-1 done
  6. UBS scans changes → no issues found

HOUR 2: Parallel Execution Begins
─────────────────────────────────────────────────────────────────
BV updates: "BEADS-2 is now ready and high priority"

BlueLake (Codex):
  1. Queries BV → gets BEADS-2
  2. Claims BEADS-2, reserves src/models/user.ts
  3. Works on user model implementation

GreenCastle (now idle):
  1. Queries BV → no ready work yet (BEADS-3,4 depend on BEADS-2)
  2. Messages BlueLake: "Let me know when BEADS-2 is done"
  3. Waits or works on unrelated beads

HOUR 3: Dependencies Resolve
─────────────────────────────────────────────────────────────────
BlueLake completes BEADS-2
  → BV immediately updates: BEADS-3 and BEADS-4 are now ready
  → Agent Mail notifies GreenCastle

GreenCastle and RedStone (new agent):
  1. GreenCastle claims BEADS-3 (login), reserves src/api/login.ts
  2. RedStone claims BEADS-4 (registration), reserves src/api/register.ts
  3. Both work in parallel—no conflicts because files are reserved

HOUR 4: Quality Gate
─────────────────────────────────────────────────────────────────
GreenCastle completes BEADS-3
RedStone completes BEADS-4

UBS scans both:
  - GreenCastle's code: ✅ Clean
  - RedStone's code: ⚠️ "SQL injection risk in email validation"
    → Auto-creates BEADS-6: "Fix SQL injection in registration"
    → BEADS-5 now also depends on BEADS-6

HOUR 5: Remediation and Completion
─────────────────────────────────────────────────────────────────
RedStone fixes BEADS-6 (quick win, 10 minutes)
UBS re-scans: ✅ Clean

BV: "BEADS-5 (auth tests) is now ready"

BlueLake claims BEADS-5, writes comprehensive tests
All tests pass → Feature complete!

HOUR 6: Knowledge Capture
─────────────────────────────────────────────────────────────────
CASS indexes all 5 sessions from this sprint

CM extracts new rules:
  - "Use parameterized queries for email validation"
  - "Include rate limiting on registration endpoints"
  - "Auth schemas should include created_at/updated_at"

Next time any agent works on authentication:
  → These rules appear in their context pack
  → They don't repeat the SQL injection mistake
  → The flywheel has improved
```

### The Philosophy: Why This Approach?

Several philosophical principles guide the Agent Flywheel design:

#### 1. Agents as First-Class Citizens

Traditional tooling treats AI as an afterthought—"maybe we'll add an API later." The flywheel treats agents as **primary users**:
- Every operation has a REST API
- OpenAPI specs include agent-specific hints
- Error messages are designed to be actionable by agents
- The system is observable and introspectable

#### 2. Coordination Over Control

Rather than trying to "control" agents with rigid rules, we focus on **coordination**:
- File reservations are advisory, not mandatory
- Agents can message each other to resolve conflicts
- The system provides information; agents make decisions

#### 3. Memory as Infrastructure

Knowledge shouldn't be trapped in individual sessions:
- CASS makes all sessions searchable
- CM extracts generalizable knowledge
- Context packs deliver relevant memories at the right time
- The system gets smarter with every session

#### 4. Safety Through Visibility

Rather than trying to prevent all mistakes (impossible), we focus on:
- Making agent activity visible (Gateway UI)
- Catching issues early (UBS scanning)
- Requiring approval for dangerous operations (SLB)
- Maintaining audit trails for review

#### 5. Self-Hosting and Control

The flywheel is designed to run on your infrastructure:
- No vendor lock-in; BYOA (Bring Your Own Account) with optional BYOK (API keys)
- All data stays on your servers
- Open protocols (MCP, ACP) for interoperability
- Can run on cheap bare-metal (any VPS or dedicated server provider)

### How to Read This Document

This plan document (PLAN.md) covers the **technical architecture** of Flywheel Gateway.

**PLAN.md structure:**
- §1-2: Vision, outcomes, philosophy
- §3-4: Technology stack and architecture overview
- §5-7: Core systems (supervisor, drivers, lifecycle)
- §8-9: API and WebSocket layers
- §10-21: Feature-by-feature specifications (each flywheel tool)
- §22-23: UI/UX design
- §24-26: Security, testing, risks
- §27-30: Implementation phases and file structure
- Appendix: API reference tables

**Key terminology:**
| Term | Meaning |
|------|---------|
| **Agent** | An AI coding assistant (Claude, Codex, Gemini, etc.) |
| **Session** | A single conversation/task execution with an agent |
| **Bead** | A unit of work (task, bug, feature) |
| **Context Pack** | Pre-assembled prompt with triage, memory, search results |
| **Driver** | Backend for agent execution (SDK, ACP, Tmux) |

---

## North-Star Vision

Flywheel Gateway becomes a **multi-agent command center that lives everywhere**:

- **SDK-first** — Direct integration with Claude Agent SDK, Codex SDK, Gemini SDK
- **Protocol-aware** — Native ACP (Agent Client Protocol) support for IDE integration
- **Terminal-fallback** — Tmux support for power users who want visual terminals
- **Web-first** (desktop + mobile) for visibility, orchestration, and "at-a-glance" control
- **API-first** (REST + WebSocket) so humans *and agents* can automate anything

### Non-Negotiable Requirement

> **Every agent operation must be possible via REST.**
> No "hidden features" locked to a specific driver. No drift. No "you can only do that with SDK mode."

---

## Executive Summary

This document outlines a comprehensive plan to build Flywheel Gateway as a full-featured web platform for multi-agent orchestration. Flywheel Gateway is the **orchestration backbone** of the Agent Flywheel—a self-improving development cycle where AI coding agents work in parallel, coordinate via messaging, and compound their learnings over time.

The architecture introduces:

1. **Agent Driver Abstraction** — SDK, ACP, and Tmux backends behind a unified interface
2. **Command Registry & Parity Gate** — Single source of truth for REST, WebSocket, tRPC, and OpenAPI (with AI hints)
3. **REST API Layer** — A performant, well-documented HTTP API across **all flywheel tools**
4. **WebSocket Layer** — Real-time streaming with durable buffering, ack/replay, and cursor-based resume
5. **Job Orchestration** — First-class handling for long-running operations with progress events
6. **Web UI Layer** — A world-class Vite 7.3 / React 19.2 interface with Stripe-level polish, providing unified access to the entire flywheel ecosystem
7. **Supervisor System** — Lifecycle management for flywheel daemons
8. **Context Pack Engine** — Token-budgeted prompt assembly from triage, memory, search, and session data
9. **Checkpoint & Restore** — Agent state management and disaster recovery
10. **Conflict Detection** — Real-time file conflict detection and resolution between agents
11. **Structured Logging & Audit** — Correlation IDs, redaction, and audit trails for all mutations

The design prioritizes:
- **SDK-first execution** — Direct API calls for programmatic control
- **Protocol flexibility** — Agent Driver abstraction supports multiple backends
- **Flywheel acceleration** — Every feature designed to make the virtuous cycle spin faster
- **Full ecosystem integration** — Agent Mail, BV, UBS, CASS, CM, CAAM, SLB unified under one UI
- **Real-time reliability** — Durable, replayable event streams with ack for critical events
- **API parity** — Registry-driven OpenAPI with enforced AI hints and examples
- **Auditability by default** — Structured logs and correlated audit trails across all mutations
- **Visual excellence** — Desktop and mobile-optimized UX with separate interaction paradigms

---

## Table of Contents

1. [Product Outcomes](#1-product-outcomes)
2. [The Agent Flywheel Philosophy](#2-the-agent-flywheel-philosophy)
3. [Technology Stack](#3-technology-stack)
4. [Architecture Overview](#4-architecture-overview)
5. [Supervisor & Daemon Management](#5-supervisor--daemon-management)
6. [Agent Driver Abstraction](#6-agent-driver-abstraction)
7. [Agent Lifecycle Management](#7-agent-lifecycle-management)
8. [REST API Layer](#8-rest-api-layer)
9. [WebSocket Layer](#9-websocket-layer)
10. [Context Pack Building Engine](#10-context-pack-building-engine)
11. [Agent Mail Deep Integration](#11-agent-mail-deep-integration)
12. [Conflict Detection & Resolution](#12-conflict-detection--resolution)
13. [Beads & BV Integration](#13-beads--bv-integration)
14. [CASS & Memory System Integration](#14-cass--memory-system-integration)
15. [UBS Scanner Integration](#15-ubs-scanner-integration)
16. [CAAM Account & Profile Management (BYOA + BYOK)](#16-caam-account--profile-management-byoa--byok)
17. [SLB Safety Guardrails](#17-slb-safety-guardrails)
    - [17.5 RU Integration](#175-ru-repo-updater-integration)
    - [17.6 DCG Integration](#176-dcg-destructive-command-guard-integration)
    - [17.7 Developer Utilities Integration](#177-developer-utilities-integration)
18. [Git Coordination](#18-git-coordination)
19. [History & Output System](#19-history--output-system)
20. [Pipeline & Workflow Engine](#20-pipeline--workflow-engine)
21. [Metrics & Alert System](#21-metrics--alert-system)
22. [Web UI Layer](#22-web-ui-layer)
23. [Desktop vs Mobile UX Strategy](#23-desktop-vs-mobile-ux-strategy)
24. [Security & Audit](#24-security--audit)
25. [Testing Strategy](#25-testing-strategy)
26. [Risk Register & Mitigations](#26-risk-register--mitigations)
27. [Implementation Phases](#27-implementation-phases)
28. [File Structure](#28-file-structure)
29. [Technical Specifications](#29-technical-specifications)
30. [Reference Architecture](#30-reference-architecture)
- [Appendix A: Complete API Parity Matrix](#appendix-a-complete-api-parity-matrix)

---

## 1. Product Outcomes

### 1.1 Outcomes for Humans

1. **One-page clarity:**
   In < 10 seconds, you can answer:
   - Which agents are active / stalled / erroring?
   - Which execution contexts are producing output now?
   - Where are conflicts forming?
   - Which prompts were recently sent?
   - What's the overall health of the flywheel?

2. **"Stripe-level" UI polish and confidence:**
   The UI should feel inevitable, crisp, and *calm*—even while coordinating chaos.

3. **Mobile becomes genuinely useful (not "just a viewer"):**
   - Triage alerts, restart agents, broadcast prompts, view recent output, resolve conflicts
   - Do all that safely (access controls + approvals)

### 1.2 Outcomes for Agents / Automation

1. **OpenAPI that teaches itself**
   - Every endpoint has: clear description, realistic examples, error cases, when/why to use it
   - Agents should be able to "just read the spec" and act correctly

2. **WebSocket stream as a universal feed**
   - Agent output, activity states, tool calls/results
   - Notifications, file changes + conflicts, checkpoints + history
   - All in a consistent event envelope with replay/resume

---

## 2. The Agent Flywheel Philosophy

### 2.1 What Is The Agent Flywheel?

The Agent Flywheel is a **self-improving development cycle** where:

```
┌─────────────────────────────────────────────────────────────────┐
│                    THE AGENT FLYWHEEL                           │
│                                                                 │
│         ┌─────────┐                                            │
│         │  PLAN   │◄────────────────────────────────┐          │
│         │  (BV)   │                                 │          │
│         └────┬────┘                                 │          │
│              │                                      │          │
│              ▼                                      │          │
│         ┌─────────┐                                 │          │
│         │COORDINATE                                 │          │
│         │(Agent   │                                 │          │
│         │ Mail)   │                                 │          │
│         └────┬────┘                                 │          │
│              │                                      │          │
│              ▼                                      │          │
│         ┌─────────┐         ┌─────────┐            │          │
│         │ EXECUTE │────────▶│  SCAN   │            │          │
│         │(Flywheel│         │  (UBS)  │            │          │
│         │ Gateway)│         └────┬────┘            │          │
│         └─────────┘              │                 │          │
│                                  ▼                 │          │
│                             ┌─────────┐            │          │
│                             │REMEMBER │────────────┘          │
│                             │(CASS+CM)│                       │
│                             └─────────┘                       │
│                                                                 │
│  Each cycle is better than the last because:                   │
│  • Memory improves (CM gets smarter)                           │
│  • Sessions are searchable (find past solutions)               │
│  • Agents coordinate (no duplicated work)                      │
│  • Quality gates enforce standards (UBS)                       │
│  • Context is preserved (Agent Mail + CM)                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 The Flywheel Tools

#### Core Orchestration Tools

| # | Tool | Purpose | Integration Priority |
|---|------|---------|---------------------|
| 1 | **Flywheel Gateway** | Agent orchestration & execution | Core (this project) |
| 2 | **Agent Mail** | Agent messaging & file coordination | Critical |
| 3 | **BV** | Task management & graph analysis | Critical |
| 4 | **UBS** | Code quality scanning | High |
| 5 | **CASS** | Session history search & indexing | High |
| 6 | **CM** | Procedural memory for agents | High |
| 7 | **CAAM** | BYOA/BYOK account profile rotation | Medium |
| 8 | **SLB** | Safety guardrails (two-person rule) | Medium |
| 9 | **RU** | Multi-repo sync & AI agent-sweep automation | High |
| 10 | **DCG** | Pre-execution hook blocking catastrophic commands | Critical |

#### Developer Utilities

These tools enhance AI agent workflows and should be auto-installed in agent environments:

| Tool | Purpose | Auto-Install |
|------|---------|--------------|
| **giil** | Download cloud photos (iCloud, Dropbox, Google) for AI visual analysis | Yes |
| **csctf** | Convert AI chat share links to Markdown/HTML transcripts | Yes |

### 2.3 How The Web UI Accelerates The Flywheel

The web UI transforms each phase:

| Phase | CLI Experience | Web UI Experience |
|-------|----------------|-------------------|
| **PLAN** | `bv` TUI, `bd ready` | Visual Kanban, dependency graph, drag-drop prioritization |
| **COORDINATE** | `am` commands, inbox polling | Real-time chat, file reservation map, @mentions |
| **EXECUTE** | SDK/tmux spawning | Visual agent grid, live output, one-click spawn |
| **SCAN** | `ubs .` output | Dashboard with severity charts, inline annotations |
| **REMEMBER** | `cm context`, `cass search` | Semantic search UI, memory timeline, rule browser |

### 2.4 Design Principle: Flywheel-First

Every feature should answer: **"Does this make the flywheel spin faster?"**

- ✅ Real-time file reservation map → Prevents conflicts, faster coordination
- ✅ Visual dependency graph → Better prioritization, faster planning
- ✅ Inline UBS annotations → Faster bug fixing, better quality
- ✅ Memory search UI → Faster context retrieval, better first attempts
- ❌ Pretty animations with no function → Slower page loads, distraction

---

## 3. Technology Stack

### 3.1 Core Technologies

| Layer | Technology | Rationale |
|-------|------------|-----------|
| **Runtime** | Bun 1.3+ | Fast, native TypeScript, built-in SQLite, WebSocket |
| **Language** | TypeScript 5.9+ (strict) | Type safety, same language as agent SDKs |
| **HTTP Server** | Hono 4.11+ | Ultrafast, Bun-native, middleware ecosystem |
| **API** | tRPC 11+ | End-to-end type safety, works with TanStack Query |
| **Database** | Drizzle ORM 0.45+ + bun:sqlite | TypeScript-native, fast, zero-config |
| **WebSocket** | Bun Native WebSocket | Built-in, performant |
| **Event Bus** | In-memory pub/sub | Custom, ring buffer history |

### 3.2 Frontend Technologies

| Layer | Technology | Rationale |
|-------|------------|-----------|
| **Build Tool** | Vite 7.3+ | Fast, simple, no SSR complexity (Vite 8 beta with Rolldown available) |
| **Framework** | React 19.2+ | Latest features, Compiler stable |
| **Routing** | TanStack Router 1.145+ | Type-safe, file-based |
| **Server State** | TanStack Query 5.90+ | Caching, streaming, optimistic updates |
| **Client State** | Zustand | Simple, efficient |
| **Styling** | Tailwind CSS 4.1+ | Utility-first, CSS-based config |
| **Animation** | Motion (Framer Motion) | Smooth, declarative |
| **Terminal** | xterm.js | Full terminal emulation |
| **Graphs** | React Flow (@xyflow/react) | Dependency visualization |
| **Charts** | Recharts | Dashboard visualizations |

### 3.3 Agent SDKs

| SDK | Package | Purpose |
|-----|---------|---------|
| **Claude Agent SDK** | `@anthropic-ai/claude-agent-sdk` | Primary agent backend |
| **Codex SDK** | `@openai/codex-sdk` | OpenAI Codex integration |
| **Google GenAI** | `@google/genai` | Gemini integration |

### 3.4 Why Vite Over Next.js

For a dashboard/control panel application:

1. **No SEO needed** — This is an internal tool, not a content site
2. **No SSR needed** — Real-time data via WebSocket, not server rendering
3. **Simpler mental model** — No server components, no hydration complexity
4. **Faster dev experience** — Vite's HMR is instant
5. **Smaller bundle** — No Next.js runtime overhead
6. **Same features** — TanStack Router gives us file-based routing

---

## 4. Architecture Overview

### 4.1 High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                        FLYWHEEL GATEWAY                                           │
│                 (Agent Flywheel Command Center)                                   │
├──────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │                      WEB UI (Vite 7.3 + React 19.2)                        │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐         │ │
│  │  │Dashboard │ │ Agents   │ │  Beads   │ │  Memory  │ │ Scanner  │         │ │
│  │  │  Deck    │ │   Deck   │ │   Deck   │ │   Deck   │ │   Deck   │         │ │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘         │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐         │ │
│  │  │ Comms    │ │ Safety   │ │ Accounts │ │ Pipeline │ │  Mobile  │         │ │
│  │  │   Deck   │ │   Deck   │ │   Deck   │ │   Deck   │ │   Deck   │         │ │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘         │ │
│  │                                                                            │ │
│  │  ┌──────────────────────────────────────────────────────────────────────┐ │ │
│  │  │           TanStack Query + WebSocket Provider + Zustand              │ │ │
│  │  └──────────────────────────────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
│                              │                    │                              │
│                         HTTP/tRPC            WebSocket                           │
│                              │                    │                              │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │                    BUN HTTP SERVER (Hono + tRPC)                            │ │
│  │  ┌────────────────────────────┐  ┌────────────────────────────────────┐    │ │
│  │  │       REST/tRPC ROUTER     │  │        WEBSOCKET HUB               │    │ │
│  │  │                            │  │                                    │    │ │
│  │  │  /api/v1/agents            │  │  Topics:                           │    │ │
│  │  │  /api/v1/beads             │  │  • agents:{id}                     │    │ │
│  │  │  /api/v1/mail              │  │  • output:{agentId}                │    │ │
│  │  │  /api/v1/reservations      │  │  • alerts                          │    │ │
│  │  │  /api/v1/cass              │  │  • notifications                   │    │ │
│  │  │  /api/v1/memory            │  │  • scanner                         │    │ │
│  │  │  /api/v1/scanner           │  │  • beads                           │    │ │
│  │  │  /api/v1/accounts          │  │  • mail                            │    │ │
│  │  │  /api/v1/pipelines         │  │  • conflicts                       │    │ │
│  │  │  /api/v1/safety            │  │  • pipeline                        │    │ │
│  │  │  /api/v1/supervisor        │  │  • supervisor                      │    │ │
│  │  └────────────────────────────┘  └────────────────────────────────────┘    │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
│                                       │                                          │
│  ┌────────────────────────────────────┴───────────────────────────────────────┐ │
│  │                           AGENT DRIVER LAYER                               │ │
│  │  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐                   │ │
│  │  │  SDK Driver   │  │  ACP Driver   │  │  Tmux Driver  │                   │ │
│  │  │  (Primary)    │  │  (Structured) │  │  (Fallback)   │                   │ │
│  │  └───────────────┘  └───────────────┘  └───────────────┘                   │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
│                                       │                                          │
│  ┌────────────────────────────────────┴───────────────────────────────────────┐ │
│  │                          SUPERVISOR SERVICE                                │ │
│  │  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐                   │ │
│  │  │  Agent Mail   │  │   CM Server   │  │   BD Daemon   │                   │ │
│  │  │  MCP Server   │  │   (Memory)    │  │   (Beads)     │                   │ │
│  │  └───────────────┘  └───────────────┘  └───────────────┘                   │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
│                                       │                                          │
│                    ┌──────────────────┼──────────────────┐                       │
│                    │                  │                  │                       │
│  ┌─────────────────▼───┐  ┌──────────▼──────────┐  ┌────▼────────────────────┐  │
│  │  AI AGENT SDKs      │  │   AGENT MAIL MCP    │  │   EXTERNAL TOOLS        │  │
│  │  • Claude SDK       │  │   (localhost:8765)  │  │  • UBS (scanner)        │  │
│  │  • Codex SDK        │  └─────────────────────┘  │  • CASS (search)        │  │
│  │  • Gemini SDK       │                           │  • CM (memory)          │  │
│  └─────────────────────┘   ┌─────────────────────┐ │  • CAAM (accounts)      │  │
│                            │  TMUX (Optional)    │ │  • SLB (safety)         │  │
│                            │  Sessions/Panes     │ └─────────────────────────┘  │
│                            └─────────────────────┘                               │
│                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Design Principles

1. **SDK-first execution** — Direct API calls, no terminal overhead
2. **Protocol flexibility** — Agent Driver abstraction supports multiple backends
3. **Flywheel-first** — Every feature accelerates the virtuous cycle
4. **Streaming-first** — WebSocket for all real-time data; REST for commands/queries
5. **Unified ecosystem** — All flywheel tools accessible from single UI
6. **Type-safe end-to-end** — TypeScript from database to UI
7. **Progressive enhancement** — Web UI enhances but doesn't replace CLI workflows

### 4.3 Key Architectural Invariants

- **No silent data loss** — All operations preserve data integrity
- **Idempotency** for automation: repeated calls shouldn't spam agents
- **All operations are auditable**: every API mutation creates a history entry and emits an event
- **API parity is mandatory**: all capabilities originate in the Command Registry and pass the parity gate
- **Critical events are durable and replayable**: ack/replay for approvals, conflicts, and other high-stakes topics
- **Everything is streamable**: if it matters, it emits events and/or is queryable

### 4.4 API Parity Guarantee: The Command Registry

A central design principle ensures that **all operations are defined once and exposed consistently** across REST, WebSocket, and tRPC interfaces. This prevents API drift and guarantees that any capability available through one interface is available through all.

#### The Command Registry Pattern

Every operation in Flywheel Gateway is registered in a central registry that drives code generation:

```typescript
// packages/shared/src/commands/registry.ts

interface CommandDefinition<TInput, TOutput> {
  // Identity
  name: string;                    // e.g., 'agents.spawn'
  category: CommandCategory;       // 'agents' | 'mail' | 'beads' | 'scanner' | etc.
  description: string;

  // Schemas (Zod)
  inputSchema: z.ZodType<TInput>;
  outputSchema: z.ZodType<TOutput>;

  // REST binding
  rest: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path: string;                  // e.g., '/agents'
    pathParams?: string[];         // e.g., ['id'] for '/agents/{id}'
  };

  // WebSocket binding (optional)
  ws?: {
    emitsEvents: string[];         // Events this command triggers
    subscribeTopic?: string;       // Topic for streaming results
  };

  // Behavior metadata
  idempotent: boolean;
  safetyLevel: 'safe' | 'requires_confirmation' | 'dangerous';
  longRunning: boolean;            // Returns job ID instead of result

  // Documentation for AI agents
  aiHints: {
    whenToUse: string;
    commonMistakes: string[];
    prerequisites: string[];       // Commands to call first
    followUp: string[];            // Commands typically called after
  };

  // Handler
  handler: (ctx: Context, input: TInput) => Promise<TOutput>;
}

// Example registration
export const spawnAgent = defineCommand({
  name: 'agents.spawn',
  category: 'agents',
  description: 'Spawn a new AI coding agent',

  inputSchema: z.object({
    model: z.enum(['claude', 'codex', 'gemini']),
    workingDir: z.string(),
    driver: z.enum(['sdk', 'acp', 'tmux']).optional(),
    contextPack: z.string().optional(),
  }),

  outputSchema: z.object({
    id: z.string(),
    model: z.string(),
    status: z.enum(['starting', 'running']),
    driver: z.string(),
  }),

  rest: {
    method: 'POST',
    path: '/agents',
  },

  ws: {
    emitsEvents: ['agent.spawned', 'agent.state_changed'],
    subscribeTopic: 'agents:{id}',
  },

  idempotent: false,
  safetyLevel: 'safe',
  longRunning: false,

  aiHints: {
    whenToUse: 'When you need to start a new coding agent to work on a task',
    commonMistakes: [
      'Not specifying workingDir (defaults to cwd)',
      'Spawning multiple agents on same file without coordination',
    ],
    prerequisites: [],
    followUp: ['agents.send', 'reservations.create'],
  },

  handler: async (ctx, input) => {
    return ctx.agentService.spawn(input);
  },
});
```

#### Code Generation from Registry

The registry enables automatic generation of:

1. **REST Routes** — Hono routes with Zod validation
2. **tRPC Procedures** — Type-safe procedures with inference
3. **OpenAPI Spec** — Complete spec with examples and AI hints
4. **TypeScript Client** — Fully typed API client
5. **WebSocket Handlers** — Event subscription setup

```typescript
// apps/gateway/src/routes/generated.ts (auto-generated)

import { commands } from '@flywheel/shared/commands';
import { Hono } from 'hono';

export const generatedRoutes = new Hono();

for (const cmd of commands) {
  const { method, path } = cmd.rest;

  generatedRoutes[method.toLowerCase()](path, async (c) => {
    const input = await c.req.json();
    const validated = cmd.inputSchema.parse(input);
    const result = await cmd.handler(c, validated);
    return c.json({ data: result, request_id: c.get('requestId') });
  });
}
```

#### Parity Gate: CI Enforcement

The build fails if parity is violated:

```typescript
// scripts/parity-check.ts

import { commands, CommandDefinition } from '@flywheel/shared/commands';

const violations: string[] = [];

for (const cmd of commands) {
  // Every command must have REST binding
  if (!cmd.rest) {
    violations.push(`${cmd.name}: Missing REST binding`);
  }

  // Every command must have AI hints
  if (!cmd.aiHints?.whenToUse) {
    violations.push(`${cmd.name}: Missing AI hints`);
  }

  // Destructive commands must not be 'safe'
  if (cmd.rest?.method === 'DELETE' && cmd.safetyLevel === 'safe') {
    violations.push(`${cmd.name}: DELETE should not be marked 'safe'`);
  }

  // Long-running commands must specify job handling
  if (cmd.longRunning && !cmd.outputSchema.shape.jobId) {
    violations.push(`${cmd.name}: Long-running command must return jobId`);
  }
}

if (violations.length > 0) {
  console.error('❌ Parity violations detected:');
  violations.forEach(v => console.error(`  - ${v}`));
  process.exit(1);
}

console.log('✅ All commands pass parity checks');
```

This pattern ensures that **new features automatically get full API coverage** — if a developer adds a command to the registry, it's immediately available via REST, WebSocket, and tRPC.

---

## 5. Supervisor & Daemon Management

### 5.1 The Problem

Flywheel Gateway depends on external daemons (Agent Mail MCP server, CM server, bd daemon). These need lifecycle management.

### 5.2 Supervisor Service

```typescript
// apps/gateway/src/services/supervisor.service.ts

interface DaemonSpec {
  name: string;
  command: string[];
  port?: number;
  healthEndpoint?: string;
  restartPolicy: 'always' | 'on-failure' | 'never';
  maxRestarts: number;
  restartDelayMs: number;
}

const DEFAULT_SPECS: DaemonSpec[] = [
  {
    name: 'agent-mail',
    command: ['mcp-agent-mail', 'serve'],
    port: 8765,
    healthEndpoint: '/health',
    restartPolicy: 'always',
    maxRestarts: 5,
    restartDelayMs: 1000,
  },
  {
    name: 'cm-server',
    command: ['cm', 'serve'],
    port: 8766,
    healthEndpoint: '/health',
    restartPolicy: 'always',
    maxRestarts: 5,
    restartDelayMs: 1000,
  },
  {
    name: 'bd-daemon',
    command: ['bd', 'daemon'],
    restartPolicy: 'on-failure',
    maxRestarts: 3,
    restartDelayMs: 2000,
  },
];

interface DaemonState {
  name: string;
  status: 'starting' | 'running' | 'stopping' | 'stopped' | 'failed';
  pid?: number;
  port?: number;
  startedAt?: Date;
  restartCount: number;
  lastHealthCheck?: Date;
  lastError?: string;
}

export class SupervisorService {
  private daemons = new Map<string, DaemonState>();
  private processes = new Map<string, Subprocess>();

  async startAll(): Promise<void> {
    for (const spec of DEFAULT_SPECS) {
      await this.startDaemon(spec);
    }
  }

  async startDaemon(spec: DaemonSpec): Promise<void> {
    const proc = Bun.spawn(spec.command, {
      stdout: 'pipe',
      stderr: 'pipe',
      onExit: (proc, exitCode) => this.handleExit(spec, exitCode),
    });

    this.processes.set(spec.name, proc);
    this.daemons.set(spec.name, {
      name: spec.name,
      status: 'starting',
      pid: proc.pid,
      port: spec.port,
      startedAt: new Date(),
      restartCount: 0,
    });

    // Start health check loop
    if (spec.healthEndpoint) {
      this.startHealthCheck(spec);
    }
  }

  async stopDaemon(name: string): Promise<void> {
    const proc = this.processes.get(name);
    if (proc) {
      proc.kill();
      this.daemons.set(name, { ...this.daemons.get(name)!, status: 'stopped' });
    }
  }

  async getStatus(): Promise<DaemonState[]> {
    return Array.from(this.daemons.values());
  }

  private async handleExit(spec: DaemonSpec, exitCode: number | null): Promise<void> {
    const state = this.daemons.get(spec.name)!;

    if (spec.restartPolicy === 'always' ||
        (spec.restartPolicy === 'on-failure' && exitCode !== 0)) {
      if (state.restartCount < spec.maxRestarts) {
        state.restartCount++;
        state.status = 'starting';
        await Bun.sleep(spec.restartDelayMs);
        await this.startDaemon(spec);
      } else {
        state.status = 'failed';
        state.lastError = `Max restarts (${spec.maxRestarts}) exceeded`;
        this.emitEvent('daemon.failed', state);
      }
    } else {
      state.status = 'stopped';
    }
  }

  private startHealthCheck(spec: DaemonSpec): void {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`http://localhost:${spec.port}${spec.healthEndpoint}`);
        const state = this.daemons.get(spec.name)!;
        if (res.ok && state.status === 'starting') {
          state.status = 'running';
          this.emitEvent('daemon.started', state);
        }
        state.lastHealthCheck = new Date();
      } catch {
        // Health check failed - daemon may be starting or crashed
      }
    }, 5000);
  }

  private emitEvent(type: string, data: DaemonState): void {
    // Emit to WebSocket hub
    eventBus.emit({ type, data });
  }
}
```

### 5.3 REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/supervisor/status` | All daemon statuses |
| `POST` | `/supervisor/{name}/start` | Start daemon |
| `POST` | `/supervisor/{name}/stop` | Stop daemon |
| `POST` | `/supervisor/{name}/restart` | Restart daemon |
| `GET` | `/supervisor/{name}/logs` | Daemon logs |

### 5.4 WebSocket Events

```typescript
interface SupervisorEvent {
  type: 'daemon.started' | 'daemon.stopped' | 'daemon.failed' | 'daemon.health_changed';
  data: {
    name: string;
    status: DaemonState['status'];
    pid?: number;
    error?: string;
  };
}
```

---

## 6. Agent Driver Abstraction

### 6.1 The Driver Interface

The Agent Driver abstraction allows Flywheel Gateway to support multiple execution backends:

```typescript
// packages/agent-drivers/src/types.ts

interface AgentDriver {
  readonly type: 'sdk' | 'acp' | 'tmux';

  spawn(config: AgentConfig): Promise<Agent>;
  send(agentId: string, message: string): Promise<void>;
  interrupt(agentId: string): Promise<void>;
  getOutput(agentId: string, since?: Date): Promise<OutputLine[]>;
  subscribe(agentId: string): AsyncIterable<AgentEvent>;
  terminate(agentId: string): Promise<void>;

  // Driver-specific capabilities
  getCapabilities(): DriverCapabilities;
}

interface AgentConfig {
  model: 'claude' | 'codex' | 'gemini';
  workingDir: string;
  systemPrompt?: string;
  tools?: ToolConfig[];
  agentMailIdentity?: string;
}

interface Agent {
  id: string;
  driver: AgentDriver['type'];
  config: AgentConfig;
  status: 'spawning' | 'idle' | 'working' | 'error' | 'terminated';
  createdAt: Date;
  lastActivity: Date;
}

interface AgentEvent {
  type: 'output' | 'tool_call' | 'tool_result' | 'state_change' | 'error';
  timestamp: Date;
  agentId: string;
  data: unknown;
}

interface DriverCapabilities {
  supportsStructuredEvents: boolean;
  supportsToolCalls: boolean;
  supportsFileOperations: boolean;
  supportsTerminalAttach: boolean;
  supportsDiffRendering: boolean;
}
```

### 6.2 SDK Driver (Primary)

The SDK Driver uses agent SDKs directly for programmatic control:

```typescript
// packages/agent-drivers/src/sdk/driver.ts

import { ClaudeClient } from '@anthropic-ai/claude-agent-sdk';

export class SDKDriver implements AgentDriver {
  readonly type = 'sdk' as const;

  private claudeClient: ClaudeClient;
  private agents = new Map<string, SDKAgent>();

  async spawn(config: AgentConfig): Promise<Agent> {
    const client = this.getClientForModel(config.model);

    const session = await client.createSession({
      workingDirectory: config.workingDir,
      systemPrompt: config.systemPrompt,
    });

    const agent: Agent = {
      id: session.id,
      driver: 'sdk',
      config,
      status: 'idle',
      createdAt: new Date(),
      lastActivity: new Date(),
    };

    this.agents.set(agent.id, { agent, session });
    return agent;
  }

  async send(agentId: string, message: string): Promise<void> {
    const { session } = this.agents.get(agentId)!;
    await session.sendMessage(message);
  }

  async *subscribe(agentId: string): AsyncIterable<AgentEvent> {
    const { session } = this.agents.get(agentId)!;

    for await (const event of session.events()) {
      yield this.mapSDKEvent(agentId, event);
    }
  }

  getCapabilities(): DriverCapabilities {
    return {
      supportsStructuredEvents: true,
      supportsToolCalls: true,
      supportsFileOperations: true,
      supportsTerminalAttach: false,
      supportsDiffRendering: false,
    };
  }

  private mapSDKEvent(agentId: string, event: SDKEvent): AgentEvent {
    return {
      type: this.mapEventType(event.type),
      timestamp: new Date(),
      agentId,
      data: event.data,
    };
  }
}
```

### 6.3 ACP Driver (Structured Events)

The ACP Driver implements the Agent Client Protocol for IDE-compatible structured events:

```typescript
// packages/agent-drivers/src/acp/driver.ts

import { spawn } from 'bun';

export class ACPDriver implements AgentDriver {
  readonly type = 'acp' as const;

  private processes = new Map<string, ACPProcess>();

  async spawn(config: AgentConfig): Promise<Agent> {
    // Spawn ACP-compatible agent via stdio
    const proc = spawn({
      cmd: this.getACPCommand(config.model),
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      cwd: config.workingDir,
    });

    const agent: Agent = {
      id: crypto.randomUUID(),
      driver: 'acp',
      config,
      status: 'idle',
      createdAt: new Date(),
      lastActivity: new Date(),
    };

    this.processes.set(agent.id, { agent, proc, rpc: new JSONRPCClient(proc) });
    return agent;
  }

  async send(agentId: string, message: string): Promise<void> {
    const { rpc } = this.processes.get(agentId)!;
    await rpc.call('agent/send', { message });
  }

  getCapabilities(): DriverCapabilities {
    return {
      supportsStructuredEvents: true,
      supportsToolCalls: true,
      supportsFileOperations: true,
      supportsTerminalAttach: false,
      supportsDiffRendering: true,  // ACP has diff rendering types
    };
  }
}
```

### 6.4 Tmux Driver (Fallback)

The Tmux Driver supports users who want visual terminal access:

```typescript
// packages/agent-drivers/src/tmux/driver.ts

export class TmuxDriver implements AgentDriver {
  readonly type = 'tmux' as const;

  async spawn(config: AgentConfig): Promise<Agent> {
    const sessionName = `flywheel-${Date.now()}`;

    // Create tmux session
    await $`tmux new-session -d -s ${sessionName} -c ${config.workingDir}`;

    // Start the appropriate CLI in the pane
    const cmd = this.getCLICommand(config.model);
    await $`tmux send-keys -t ${sessionName} ${cmd} Enter`;

    const agent: Agent = {
      id: sessionName,
      driver: 'tmux',
      config,
      status: 'idle',
      createdAt: new Date(),
      lastActivity: new Date(),
    };

    return agent;
  }

  getCapabilities(): DriverCapabilities {
    return {
      supportsStructuredEvents: false,  // Text parsing only
      supportsToolCalls: false,
      supportsFileOperations: false,
      supportsTerminalAttach: true,     // Can attach visual terminal
      supportsDiffRendering: false,
    };
  }
}
```

### 6.5 Driver Selection Strategy

```typescript
// packages/agent-drivers/src/index.ts

export function selectDriver(
  preference: 'sdk' | 'acp' | 'tmux' | 'auto',
  config: AgentConfig
): AgentDriver {
  if (preference === 'auto') {
    // SDK is preferred for programmatic control
    if (hasSDKSupport(config.model)) return new SDKDriver();
    // ACP for structured events without full SDK
    if (hasACPAdapter(config.model)) return new ACPDriver();
    // Tmux as fallback
    return new TmuxDriver();
  }

  switch (preference) {
    case 'sdk': return new SDKDriver();
    case 'acp': return new ACPDriver();
    case 'tmux': return new TmuxDriver();
  }
}
```

---

## 7. Agent Lifecycle Management

### 7.1 Activity States

```typescript
type ActivityState =
  | 'idle'           // Waiting for input
  | 'thinking'       // Processing, no output yet
  | 'working'        // Actively producing output
  | 'tool_calling'   // Executing a tool
  | 'waiting_input'  // Waiting for user input
  | 'error'          // Encountered an error
  | 'stalled';       // No activity for threshold period

interface ActivityStatus {
  agentId: string;
  state: ActivityState;
  since: Date;
  duration: number;  // ms in current state
  lastOutput?: Date;
  lastToolCall?: {
    name: string;
    startedAt: Date;
  };
  healthScore: number;  // 0-100
}
```

### 7.2 Activity Detection (SDK Driver)

For SDK-based agents, activity detection is straightforward via events:

```typescript
class SDKActivityDetector {
  detectState(events: AgentEvent[]): ActivityState {
    const recent = events.slice(-10);

    if (recent.some(e => e.type === 'error')) {
      return 'error';
    }

    if (recent.some(e => e.type === 'tool_call' && !e.completed)) {
      return 'tool_calling';
    }

    const lastOutput = recent.findLast(e => e.type === 'output');
    if (lastOutput && Date.now() - lastOutput.timestamp.getTime() < 5000) {
      return 'working';
    }

    const lastActivity = recent[recent.length - 1];
    if (lastActivity && Date.now() - lastActivity.timestamp.getTime() > 5 * 60 * 1000) {
      return 'stalled';
    }

    return 'idle';
  }
}
```

### 7.3 Checkpoints

Agents can go off-track. Checkpoints allow rolling back to a known-good state.

```typescript
interface Checkpoint {
  id: string;
  agentId: string;
  name?: string;
  createdAt: Date;
  createdBy: 'user' | 'auto' | 'agent';
  trigger: 'manual' | 'scheduled' | 'before_risky_op' | 'milestone';

  // Captured state
  conversationHistory: Message[];
  toolState: Record<string, unknown>;
  workingDirectory: string;
  fileSnapshot: FileSnapshot[];  // Modified files since session start
  contextPack?: ContextPack;

  // Metadata
  description?: string;
  tags: string[];
  size: number;  // bytes
  verified: boolean;
  verifiedAt?: Date;

  // Delta chain metadata (for progressive checkpointing)
  checkpointType: 'full' | 'delta';
  parentId?: string;           // For delta checkpoints
  deltaDepth?: number;         // How many deltas to traverse
  fullCheckpointId?: string;   // Nearest full checkpoint in chain
}

interface FileSnapshot {
  path: string;
  content: string;
  hash: string;
  mtime: Date;
}
```

#### 7.3.1 Delta-Based Progressive Checkpointing

Instead of full snapshots for each checkpoint, store only what changed since the last checkpoint—dramatically reducing storage costs and restore times.

**The Problem with Full Checkpoints:**

For a 2-hour agent session with 50 modified files, each checkpoint could be 10-50MB. With auto-checkpoints every 30 minutes, that's 4+ checkpoints = 200MB per session. Across many agents and sessions, storage explodes.

**Delta Checkpoint Model:**

```typescript
// packages/shared/src/types/checkpoint.ts

interface DeltaCheckpoint extends Checkpoint {
  checkpointType: 'delta';
  parentId: string;              // Required for deltas

  // Only what changed since parent
  delta: {
    newConversationTurns: Message[];           // Only new turns
    modifiedToolState: Record<string, unknown>; // Only changed keys
    fileDeltas: FileDelta[];                   // Git-style diffs
  };

  // Chain metadata for fast restore
  chain: {
    depth: number;              // How many checkpoints in chain
    fullCheckpointId: string;   // Nearest full checkpoint
    totalSize: number;          // Sum of chain sizes
  };
}

interface FileDelta {
  path: string;
  type: 'created' | 'modified' | 'deleted';
  diff?: string;                // Unified diff for modifications
  content?: string;             // Full content for created files
  previousHash?: string;        // For verification
}

interface FullCheckpoint extends Checkpoint {
  checkpointType: 'full';
  // Contains complete state (no deltas)
}
```

**Compaction Strategy:**

```typescript
// apps/gateway/src/services/checkpoint.service.ts

export class CheckpointService {
  private readonly FULL_CHECKPOINT_INTERVAL = 5; // Every 5th is full

  async createCheckpoint(agentId: string, trigger: string): Promise<Checkpoint> {
    const lastCheckpoint = await this.getLastCheckpoint(agentId);
    const deltaDepth = lastCheckpoint?.deltaDepth ?? 0;

    // Create full checkpoint every N checkpoints, or if no parent
    if (!lastCheckpoint || deltaDepth >= this.FULL_CHECKPOINT_INTERVAL - 1) {
      return this.createFullCheckpoint(agentId, trigger);
    }

    return this.createDeltaCheckpoint(agentId, lastCheckpoint, trigger);
  }

  private async createDeltaCheckpoint(
    agentId: string,
    parent: Checkpoint,
    trigger: string
  ): Promise<DeltaCheckpoint> {
    const currentState = await this.captureCurrentState(agentId);
    const parentState = await this.loadCheckpointState(parent.id);

    // Compute deltas
    const newTurns = currentState.conversationHistory.slice(
      parentState.conversationHistory.length
    );
    const fileDeltas = await this.computeFileDeltas(
      parentState.fileSnapshot,
      currentState.fileSnapshot
    );
    const toolStateDelta = this.computeObjectDelta(
      parentState.toolState,
      currentState.toolState
    );

    return {
      id: crypto.randomUUID(),
      agentId,
      checkpointType: 'delta',
      parentId: parent.id,
      createdAt: new Date(),
      createdBy: 'auto',
      trigger,
      delta: {
        newConversationTurns: newTurns,
        modifiedToolState: toolStateDelta,
        fileDeltas,
      },
      chain: {
        depth: (parent.deltaDepth ?? 0) + 1,
        fullCheckpointId: parent.fullCheckpointId ?? parent.id,
        totalSize: await this.computeChainSize(parent.id),
      },
      // Metadata
      size: this.computeDeltaSize(newTurns, fileDeltas, toolStateDelta),
      verified: false,
      tags: [],
    };
  }

  async restoreCheckpoint(checkpointId: string): Promise<AgentState> {
    const checkpoint = await this.loadCheckpoint(checkpointId);

    if (checkpoint.checkpointType === 'full') {
      return this.restoreFullCheckpoint(checkpoint);
    }

    // Reconstruct by loading full + applying deltas
    const chain = await this.loadCheckpointChain(checkpointId);
    let state = await this.restoreFullCheckpoint(chain[0] as FullCheckpoint);

    for (let i = 1; i < chain.length; i++) {
      state = this.applyDelta(state, chain[i] as DeltaCheckpoint);
    }

    return state;
  }

  // Background compaction: merge old delta chains into full checkpoints
  async compactOldChains(agentId: string): Promise<void> {
    const checkpoints = await this.listCheckpoints(agentId);
    const oldChains = this.findCompactableChains(checkpoints);

    for (const chain of oldChains) {
      const merged = await this.mergeChainToFull(chain);
      await this.replaceChainWithFull(chain, merged);
    }
  }
}
```

**Storage Comparison:**

| Strategy | Single Checkpoint | 4 Checkpoints/Session | Notes |
|----------|-------------------|----------------------|-------|
| Full | 25MB | 100MB | Complete state each time |
| Delta | 5MB (full) + 3×2MB (delta) = 11MB | ~55% reduction | Only changes stored |

**Restore Performance:**

| Scenario | Full Checkpoints | Delta Chain |
|----------|-----------------|-------------|
| Latest checkpoint | Load 25MB | Load 11MB, apply 3 patches |
| Typical restore | ~500ms | ~350ms |
| Worst case (deep chain) | Same | Bounded by FULL_CHECKPOINT_INTERVAL |

### 7.4 Auto-Checkpoint Triggers

```typescript
const AUTO_CHECKPOINT_TRIGGERS = [
  {
    name: 'before_destructive_tool',
    pattern: /rm|delete|drop|truncate|reset/i,
    description: 'Before potentially destructive operations',
  },
  {
    name: 'milestone',
    interval: 30 * 60 * 1000,  // Every 30 minutes
    description: 'Periodic milestone checkpoints',
  },
  {
    name: 'before_large_change',
    fileCountThreshold: 10,
    description: 'Before modifying many files',
  },
];
```

### 7.5 Token & Context Window Tracking

```typescript
interface TokenUsage {
  agentId: string;
  timestamp: Date;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  model: string;
  cost?: number;  // Optional cost estimate
}

interface ContextWindow {
  agentId: string;
  maxTokens: number;
  usedTokens: number;
  remainingTokens: number;
  utilizationPercent: number;
  healthStatus: ContextHealthStatus;
  predictedExhaustionAt?: Date;  // Based on current consumption rate
  preparedSummary?: string;      // Pre-computed for instant swap-in
}

type ContextHealthStatus =
  | 'healthy'    // < 75% utilization
  | 'warning'    // 75-85% - proactive summarization started
  | 'critical'   // 85-95% - auto-compaction in progress
  | 'emergency'; // > 95% - force checkpoint + rotate
```

### 7.6 Auto-Healing Context Window Management

Context window exhaustion is the #1 reliability killer for long-running agents. Rather than reacting after problems occur, the Auto-Healing system **proactively** manages context pressure through graduated interventions.

#### 7.6.1 Health Thresholds & Actions

```typescript
// apps/gateway/src/services/context-health.service.ts

interface ContextHealthConfig {
  warningThreshold: 0.75;     // 75% → start preparing summary
  criticalThreshold: 0.85;    // 85% → auto-compact
  emergencyThreshold: 0.95;   // 95% → force checkpoint + rotate

  // Predictive settings
  enablePrediction: boolean;
  predictionWindowMs: number; // Look-ahead window for exhaustion prediction
  consumptionSampleSize: number; // Turns to sample for rate estimation
}

export class ContextHealthService {
  private summaryCache = new Map<string, PreparedSummary>();

  async monitorAgent(agentId: string): Promise<void> {
    const context = await this.getContextWindow(agentId);
    const health = this.assessHealth(context);

    switch (health.status) {
      case 'healthy':
        // No action needed, but start predictive monitoring
        this.updatePrediction(agentId, context);
        break;

      case 'warning':
        // Proactively prepare summary for instant swap-in
        await this.prepareSummary(agentId);
        this.emitEvent('context.warning', { agentId, utilization: context.utilizationPercent });
        break;

      case 'critical':
        // Auto-compact: replace old turns with prepared summary
        await this.autoCompact(agentId);
        this.emitEvent('context.compacted', { agentId, freedTokens: health.freedTokens });
        break;

      case 'emergency':
        // Force checkpoint and rotate to fresh agent
        await this.emergencyRotate(agentId);
        this.emitEvent('context.emergency_rotated', { agentId });
        break;
    }
  }

  private async prepareSummary(agentId: string): Promise<void> {
    if (this.summaryCache.has(agentId)) return;

    const history = await this.getConversationHistory(agentId);
    const oldTurns = history.slice(0, -10); // Keep last 10 turns intact

    // Use a fast model to summarize older turns
    const summary = await this.summarizeService.summarize(oldTurns, {
      maxTokens: 500,
      preserveKeyDecisions: true,
      preserveFileChanges: true,
    });

    this.summaryCache.set(agentId, {
      summary,
      turnsReplaced: oldTurns.length,
      preparedAt: new Date(),
    });
  }

  private async autoCompact(agentId: string): Promise<CompactionResult> {
    const prepared = this.summaryCache.get(agentId);
    if (!prepared) {
      await this.prepareSummary(agentId);
    }

    // Atomically swap old turns for summary
    const result = await this.agentService.replaceHistoryWithSummary(
      agentId,
      prepared.summary,
      prepared.turnsReplaced
    );

    this.summaryCache.delete(agentId);
    return result;
  }

  private async emergencyRotate(agentId: string): Promise<void> {
    // 1. Checkpoint current state
    const checkpoint = await this.checkpointService.create(agentId, {
      trigger: 'emergency_rotation',
      includeFileState: true,
    });

    // 2. Build context pack from checkpoint
    const contextPack = await this.contextService.buildFromCheckpoint(checkpoint);

    // 3. Spawn fresh agent with context pack
    const newAgent = await this.agentService.spawn({
      ...await this.agentService.getConfig(agentId),
      contextPack: contextPack.id,
    });

    // 4. Terminate old agent
    await this.agentService.terminate(agentId, 'context_exhaustion');

    // 5. Notify clients of seamless handover
    this.emitEvent('agent.rotated', {
      oldAgentId: agentId,
      newAgentId: newAgent.id,
      checkpointId: checkpoint.id,
      reason: 'context_exhaustion',
    });
  }
}
```

#### 7.6.2 User Experience

The auto-healing system is designed to be **invisible when working well**:

| Scenario | Without Auto-Healing | With Auto-Healing |
|----------|---------------------|-------------------|
| Long task | "Agent crashed: context exceeded" | Agent continues seamlessly |
| Complex refactor | Agent forgets early decisions | Key decisions preserved in summary |
| Multi-hour session | Manual checkpoint + restart | Automatic context refresh |

**UI Indicators:**
- Context utilization bar shows current health status
- "Context refreshed" toast when auto-compaction occurs
- Agent card shows small refresh icon (not disruptive)

#### 7.6.3 WebSocket Events

```typescript
interface ContextHealthEvent {
  type:
    | 'context.healthy'
    | 'context.warning'
    | 'context.compacted'
    | 'context.emergency_rotated';
  data: {
    agentId: string;
    utilization: number;
    healthStatus: ContextHealthStatus;
    action?: string;
    freedTokens?: number;
    newAgentId?: string;
  };
}
```

### 7.7 Agent Rotation & Compaction Strategies

When context windows fill up, agents need rotation:

```typescript
type RotationStrategy =
  | 'summarize_and_continue'  // Summarize history, continue same agent
  | 'fresh_start'             // New agent with context pack
  | 'checkpoint_and_restart'  // Checkpoint, terminate, new agent
  | 'graceful_handoff';       // New agent picks up from summary

interface RotationConfig {
  strategy: RotationStrategy;
  trigger: 'manual' | 'auto';
  threshold?: {
    contextUtilization?: number;  // e.g., 0.9 = 90%
    conversationTurns?: number;
    timeElapsed?: number;  // ms
  };
  preserveContext: boolean;
}
```

### 7.8 First-Class Session Handoff Protocol

When multiple agents work on a project, they often need to hand off work to each other. This requires more than just messaging—it requires a structured transfer of context, state, and resources.

**The Problem Without Structured Handoffs:**
1. Agent A finishes part 1 and updates a bead
2. Human notices
3. Human spawns Agent B
4. Human crafts a prompt explaining the context (often incomplete)

**With the Handoff Protocol:**
1. Agent A initiates handoff: "Hey BlueLake, I've completed the API schema. Your turn for frontend integration."
2. BlueLake automatically receives: task context, relevant conversation history, modified files, and continuation prompt
3. Work continues seamlessly

#### 7.8.1 Handoff Data Model

```typescript
// packages/shared/src/types/handoff.ts

interface HandoffRequest {
  id: string;
  from: AgentIdentity;
  to: AgentIdentity | 'any';  // 'any' for pool-based assignment

  // What's being handed off
  task: {
    beadId?: string;
    description: string;
    completedWork: string;      // Summary of what was done
    remainingWork: string;      // What the receiver should do
    priority: number;
  };

  // Context transfer
  context: {
    relevantFiles: string[];           // Files the receiver should read
    modifiedFiles: string[];           // Files that were changed
    keyDecisions: string[];            // Important choices made
    conversationSummary: string;       // Condensed history
    openQuestions: string[];           // Unresolved issues
  };

  // Resource transfer
  resources: {
    reservationsToTransfer: string[];  // File reservations to pass
    checkpointId?: string;             // Checkpoint for fallback
    contextPackId?: string;            // Pre-built context pack
  };

  // Handoff metadata
  status: 'pending' | 'accepted' | 'rejected' | 'completed' | 'expired';
  createdAt: Date;
  expiresAt: Date;
  acceptedAt?: Date;
  completedAt?: Date;
  rejectionReason?: string;
}

interface HandoffAcceptance {
  handoffId: string;
  agentId: string;
  acknowledgedContext: boolean;
  modifiedRemainingWork?: string;  // Agent can clarify/modify
}
```

#### 7.8.2 Handoff Service

```typescript
// apps/gateway/src/services/handoff.service.ts

export class HandoffService {
  constructor(
    private agentService: AgentService,
    private mailService: AgentMailService,
    private reservationService: FileReservationService,
    private contextService: ContextService,
    private checkpointService: CheckpointService,
    private beadService: BeadService,
  ) {}

  async initiateHandoff(request: HandoffRequest): Promise<HandoffResult> {
    // 1. Validate the request
    await this.validateHandoff(request);

    // 2. Build context summary if not provided
    if (!request.context.conversationSummary) {
      request.context.conversationSummary = await this.summarizeForHandoff(
        request.from.id
      );
    }

    // 3. Build context pack for receiver
    const contextPack = await this.contextService.buildForHandoff(request);
    request.resources.contextPackId = contextPack.id;

    // 4. Create checkpoint for safety
    const checkpoint = await this.checkpointService.create(request.from.id, {
      trigger: 'handoff_initiated',
      description: `Handoff to ${request.to === 'any' ? 'pool' : request.to.name}`,
    });
    request.resources.checkpointId = checkpoint.id;

    // 5. Send handoff message via Agent Mail
    await this.mailService.send({
      from: request.from.name,
      to: request.to === 'any' ? ['pool'] : [request.to.name],
      subject: `Handoff: ${request.task.description}`,
      body_md: this.formatHandoffMessage(request),
      importance: 'high',
      ack_required: true,
      metadata: { type: 'handoff', handoffId: request.id },
    });

    // 6. Emit WebSocket event
    this.emitEvent('handoff.initiated', { request });

    return { handoffId: request.id, status: 'pending', contextPackId: contextPack.id };
  }

  async acceptHandoff(
    handoffId: string,
    acceptingAgentId: string,
    acceptance: HandoffAcceptance
  ): Promise<void> {
    const handoff = await this.getHandoff(handoffId);

    // 1. Transfer file reservations
    for (const pattern of handoff.resources.reservationsToTransfer) {
      await this.reservationService.transfer(
        pattern,
        handoff.from.id,
        acceptingAgentId
      );
    }

    // 2. Load context pack into receiving agent
    const contextPack = await this.contextService.get(handoff.resources.contextPackId);
    await this.agentService.injectContext(acceptingAgentId, contextPack);

    // 3. Update handoff status
    handoff.status = 'accepted';
    handoff.acceptedAt = new Date();
    await this.saveHandoff(handoff);

    // 4. Notify original agent
    await this.mailService.send({
      from: 'system',
      to: [handoff.from.name],
      subject: `Handoff accepted by ${acceptance.agentId}`,
      body_md: `Your handoff was accepted. ${acceptance.modifiedRemainingWork || ''}`,
    });

    // 5. Emit event
    this.emitEvent('handoff.accepted', { handoff, acceptingAgent: acceptingAgentId });
  }

  async completeHandoff(handoffId: string): Promise<void> {
    const handoff = await this.getHandoff(handoffId);
    handoff.status = 'completed';
    handoff.completedAt = new Date();
    await this.saveHandoff(handoff);

    // Update linked bead if present
    if (handoff.task.beadId) {
      await this.beadService.updateProgress(handoff.task.beadId, {
        handoffCompleted: true,
        completedBy: handoff.to,
      });
    }

    this.emitEvent('handoff.completed', { handoff });
  }

  private formatHandoffMessage(request: HandoffRequest): string {
    return `
## Handoff Request

**From:** ${request.from.name}
**Task:** ${request.task.description}

### Completed Work
${request.task.completedWork}

### Remaining Work
${request.task.remainingWork}

### Key Decisions Made
${request.context.keyDecisions.map(d => `- ${d}`).join('\n')}

### Modified Files
${request.context.modifiedFiles.map(f => `- \`${f}\``).join('\n')}

### Open Questions
${request.context.openQuestions.map(q => `- ${q}`).join('\n')}

---
*Context pack ID: ${request.resources.contextPackId}*
*Checkpoint ID: ${request.resources.checkpointId}*
`;
  }
}
```

#### 7.8.3 WebSocket Events

```typescript
interface HandoffEvent {
  type:
    | 'handoff.initiated'
    | 'handoff.accepted'
    | 'handoff.rejected'
    | 'handoff.completed'
    | 'handoff.expired';
  data: {
    handoff: HandoffRequest;
    acceptingAgent?: string;
    rejectionReason?: string;
  };
}
```

#### 7.8.4 Handoff REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/handoffs` | Initiate handoff |
| `GET` | `/handoffs/{id}` | Get handoff details |
| `POST` | `/handoffs/{id}/accept` | Accept handoff |
| `POST` | `/handoffs/{id}/reject` | Reject handoff |
| `POST` | `/handoffs/{id}/complete` | Mark handoff complete |
| `GET` | `/agents/{id}/handoffs/pending` | Pending handoffs for agent |
| `GET` | `/handoffs/history` | Handoff history |

#### 7.8.5 UI Integration

The Handoff Protocol integrates with the Agent Collaboration Graph (see §22.4) to show:
- Active handoffs as animated edges between agents
- Pending handoffs with accept/reject actions
- Handoff history in agent detail panels
- Transfer of file reservations visualized in real-time

### 7.9 Checkpoint REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/agents/{id}/checkpoints` | List checkpoints |
| `POST` | `/agents/{id}/checkpoints` | Create checkpoint |
| `GET` | `/agents/{id}/checkpoints/{cpId}` | Get checkpoint details |
| `DELETE` | `/agents/{id}/checkpoints/{cpId}` | Delete checkpoint |
| `POST` | `/agents/{id}/checkpoints/{cpId}/restore` | Restore to checkpoint |
| `POST` | `/agents/{id}/checkpoints/{cpId}/verify` | Verify integrity |
| `POST` | `/agents/{id}/checkpoints/{cpId}/export` | Export as archive |
| `POST` | `/agents/{id}/checkpoints/import` | Import archive |
| `POST` | `/agents/{id}/rollback` | Quick rollback to last checkpoint |

### 7.10 Token & Rotation REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/agents/{id}/tokens` | Token usage for agent |
| `GET` | `/agents/{id}/context-window` | Context window status |
| `GET` | `/tokens/summary` | Overall token usage |
| `GET` | `/tokens/by-model` | Usage by model |
| `POST` | `/agents/{id}/rotate` | Trigger rotation |
| `POST` | `/agents/{id}/compact` | Compact context |
| `GET` | `/agents/{id}/rotation-status` | Rotation recommendation |

---

## 8. REST API Layer

### 8.1 API Design Philosophy

The REST API follows these principles:

1. **Resource-oriented** — Agents, beads, reservations, messages as resources
2. **Consistent responses** — All responses follow a standard envelope
3. **Idempotent where possible** — PUT/DELETE operations are idempotent
4. **Rich error responses** — Error codes, messages, and actionable hints
5. **AI-agent friendly** — Comprehensive examples for LLM consumption

### 8.2 Base URL Structure

```
Production:  https://api.flywheel.local/v1
Development: http://localhost:8080/api/v1
```

### 8.3 API Conventions

**Content types:**
- Requests: `application/json`
- Responses: `application/json`

**Pagination:**
```
?limit=50&cursor=cursor_01H...
```

**Filtering:**
```
?model=claude&status=working
```

**Sorting:**
```
?sort=-updated_at
```

### 8.4 Idempotency Framework

Agents may retry requests. Without idempotency, this could spawn duplicate agents, send duplicate prompts, or create duplicate checkpoints.

**Idempotency Header:**
For any POST that mutates state, accept:
- `Idempotency-Key: <uuid>` header
- Server stores key + result for a TTL window

```typescript
// apps/gateway/src/middleware/idempotency.ts

const idempotencyStore = new Map<string, StoredResult>();

interface StoredResult {
  response: unknown;
  statusCode: number;
  createdAt: Date;
  expiresAt: Date;
}

export async function idempotencyMiddleware(c: Context, next: Next) {
  const idempotencyKey = c.req.header('Idempotency-Key');

  if (!idempotencyKey) {
    return next();
  }

  // Check for existing result
  const existing = idempotencyStore.get(idempotencyKey);
  if (existing && existing.expiresAt > new Date()) {
    return c.json(existing.response, existing.statusCode);
  }

  // Execute and store
  await next();

  const response = await c.res.json();
  idempotencyStore.set(idempotencyKey, {
    response,
    statusCode: c.res.status,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h TTL
  });
}
```

### 8.4.1 Provisioning API (Queue‑Driven)

Provisioning is a first‑class REST resource. All state changes flow through the queue API.

**Create request:**
```http
POST /provisioning/requests
Idempotency-Key: <uuid>
```

```json
{
  "workspace_id": "workspace-abc123",
  "capacity_profile_id": "profile-standard",
  "provider_id": "provider-a",
  "region": "eu-central",
  "email_verified_at": "2026-01-08T00:00:00Z",
  "onboarding_mode": "manual"
}
```

**Response:**
```json
{
  "data": {
    "id": "prov_01HXYZ",
    "state": "pending",
    "created_at": "2026-01-08T00:00:00Z"
  }
}
```

**Transition request (explicit from/to):**
```http
POST /provisioning/requests/{id}/transition
```
```json
{
  "from": "approved",
  "to": "provisioned",
  "reason": "manual_approval_complete"
}
```

**Allowed transitions:**
- `pending → approved`
- `approved → provisioned`
- `provisioned → verified`
- `verified → assigned`
- Any state → `failed` (with reason)
- `pending/approved` → `expired`
- `failed` → `pending` (retry)

**Preconditions:**
- `pending → approved` requires `email_verified_at`.
- `pending → approved` requires manual approval when `onboarding_mode=manual`.

**Verification report:**
```http
POST /provisioning/requests/{id}/verify
```
```json
{
  "checks": {
    "disk_io": "pass",
    "network_latency_ms": 18,
    "container_health": "pass",
    "monitoring_agent": "pass",
    "caam_ready": "pass"
  },
  "notes": "Initial verification complete"
}
```

**Assignment (BYOA gated):**
```http
POST /provisioning/requests/{id}/assign
```
```json
{
  "requires_byoa": true,
  "min_providers": 1
}
```

If BYOA is not verified, the API returns `BYOA_REQUIRED`.

### 8.5 Error Model & Taxonomy

All errors follow a consistent structure with semantic error codes and HTTP status mappings:

```typescript
interface ApiError {
  error: {
    code: ErrorCode;                    // Semantic error code
    message: string;                    // Human-readable description
    details?: Record<string, unknown>;  // Additional context
    request_id: string;                 // For support/debugging
    hint?: string;                      // Suggested fix for AI agents
    docs_url?: string;                  // Link to relevant documentation
  };
}
```

#### Error Code Taxonomy

Errors are organized into categories with consistent HTTP status mappings:

| Category | Code Pattern | HTTP Status | Description |
|----------|--------------|-------------|-------------|
| **Resource** | `*_NOT_FOUND` | 404 | Resource doesn't exist |
| **Resource** | `*_ALREADY_EXISTS` | 409 | Resource already exists |
| **Validation** | `INVALID_*` | 400 | Request validation failed |
| **Validation** | `MISSING_*` | 400 | Required field missing |
| **Auth** | `UNAUTHORIZED` | 401 | Not authenticated |
| **Auth** | `FORBIDDEN` | 403 | Not authorized for action |
| **Quota** | `QUOTA_EXCEEDED` | 429 | Rate/usage limit hit |
| **Quota** | `RATE_LIMITED` | 429 | Too many requests |
| **State** | `*_IN_PROGRESS` | 409 | Conflicting operation |
| **State** | `*_NOT_READY` | 503 | Resource not ready |
| **Dependency** | `*_UNAVAILABLE` | 503 | Dependency down |
| **Internal** | `INTERNAL_ERROR` | 500 | Unexpected server error |

#### Complete Error Code Reference

```typescript
// packages/shared/src/errors/codes.ts

export const ErrorCodes = {
  // Agent errors
  AGENT_NOT_FOUND: { status: 404, message: 'Agent not found' },
  AGENT_ALREADY_EXISTS: { status: 409, message: 'Agent with this ID already exists' },
  AGENT_NOT_READY: { status: 503, message: 'Agent is still starting' },
  AGENT_TERMINATED: { status: 410, message: 'Agent has been terminated' },
  AGENT_BUSY: { status: 409, message: 'Agent is processing another request' },

  // Account/quota errors
  QUOTA_EXCEEDED: { status: 429, message: 'API quota exceeded for account' },
  RATE_LIMITED: { status: 429, message: 'Too many requests, slow down' },
  NO_HEALTHY_ACCOUNTS: { status: 503, message: 'No healthy accounts in pool' },
  ACCOUNT_DISABLED: { status: 403, message: 'Account is disabled' },
  BYOA_REQUIRED: { status: 412, message: 'Link at least one account before assignment' },
  EMAIL_NOT_VERIFIED: { status: 412, message: 'Verify email before provisioning' },

  // Provisioning errors
  PROVISIONING_NOT_FOUND: { status: 404, message: 'Provisioning request not found' },
  PROVISIONING_INVALID_TRANSITION: { status: 409, message: 'Invalid provisioning state transition' },
  PROVISIONING_NOT_VERIFIED: { status: 412, message: 'Provisioning not verified' },
  PROVISIONING_ASSIGN_BLOCKED: { status: 409, message: 'Assignment blocked by policy' },

  // Reservation errors
  RESERVATION_CONFLICT: { status: 409, message: 'File already reserved by another agent' },
  RESERVATION_EXPIRED: { status: 410, message: 'Reservation has expired' },
  RESERVATION_NOT_FOUND: { status: 404, message: 'Reservation not found' },

  // Checkpoint errors
  CHECKPOINT_NOT_FOUND: { status: 404, message: 'Checkpoint not found' },
  CHECKPOINT_CORRUPTED: { status: 422, message: 'Checkpoint data is corrupted' },
  RESTORE_IN_PROGRESS: { status: 409, message: 'Restore already in progress' },

  // Mail errors
  RECIPIENT_NOT_FOUND: { status: 404, message: 'Mail recipient not found' },
  CONTACT_NOT_APPROVED: { status: 403, message: 'Contact not approved' },
  MESSAGE_NOT_FOUND: { status: 404, message: 'Message not found' },

  // Beads errors
  BEAD_NOT_FOUND: { status: 404, message: 'Bead not found' },
  BEAD_ALREADY_CLOSED: { status: 409, message: 'Bead is already closed' },
  CIRCULAR_DEPENDENCY: { status: 422, message: 'Would create circular dependency' },

  // Scanner errors
  SCAN_IN_PROGRESS: { status: 409, message: 'Scan already running' },
  SCANNER_UNAVAILABLE: { status: 503, message: 'Scanner service unavailable' },

  // Daemon errors
  DAEMON_NOT_RUNNING: { status: 503, message: 'Required daemon not running' },
  DAEMON_START_FAILED: { status: 500, message: 'Failed to start daemon' },

  // Validation errors
  INVALID_REQUEST: { status: 400, message: 'Request validation failed' },
  INVALID_MODEL: { status: 400, message: 'Unknown model type' },
  INVALID_DRIVER: { status: 400, message: 'Unknown driver type' },
  MISSING_REQUIRED_FIELD: { status: 400, message: 'Required field missing' },

  // Safety errors
  APPROVAL_REQUIRED: { status: 403, message: 'Action requires approval' },
  SAFETY_VIOLATION: { status: 403, message: 'Action blocked by safety rules' },

  // Internal errors
  INTERNAL_ERROR: { status: 500, message: 'Internal server error' },
  NOT_IMPLEMENTED: { status: 501, message: 'Feature not implemented' },
} as const;

export type ErrorCode = keyof typeof ErrorCodes;
```

#### Error Response Examples

```json
// 404 - Resource not found
{
  "error": {
    "code": "AGENT_NOT_FOUND",
    "message": "Agent not found",
    "details": { "agent_id": "agent_abc123" },
    "request_id": "req_xyz789",
    "hint": "The agent may have been terminated. List active agents with GET /agents"
  }
}

// 429 - Quota exceeded
{
  "error": {
    "code": "QUOTA_EXCEEDED",
    "message": "API quota exceeded for account",
    "details": {
      "account": "claude-main",
      "limit": 1000000,
      "used": 1000000,
      "resets_at": "2026-01-08T00:00:00Z"
    },
    "request_id": "req_xyz789",
    "hint": "Switch to a different account with POST /accounts/pools/{id}/rotate"
  }
}

// 409 - Conflict
{
  "error": {
    "code": "RESERVATION_CONFLICT",
    "message": "File already reserved by another agent",
    "details": {
      "path": "src/api/users.ts",
      "holder": "BlueLake",
      "expires_at": "2026-01-07T15:30:00Z"
    },
    "request_id": "req_xyz789",
    "hint": "Wait for reservation to expire or coordinate with BlueLake via Agent Mail"
  }
}
```

### 8.6 Success Response Envelope

```typescript
interface ApiResponse<T> {
  data: T;
  request_id: string;
  timestamp: string;        // RFC3339 UTC
  _agent_hints?: {          // For AI agent consumers
    summary: string;
    suggested_actions: Action[];
    warnings: string[];
  };
}
```

### 8.7 Jobs for Long-Running Operations

Some operations take time (building context packs, running scans, exporting checkpoints). These return a job ID immediately, with status polling.

```typescript
interface Job {
  id: string;
  type: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress?: number;  // 0-100
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  result?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
}
```

**Jobs REST Endpoints:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/jobs` | List jobs |
| `GET` | `/jobs/{id}` | Get job status |
| `DELETE` | `/jobs/{id}` | Cancel job |
| `GET` | `/jobs/{id}/result` | Get job result |

**Jobs WebSocket Events:**

```typescript
interface JobEvent {
  type: 'job.started' | 'job.progress' | 'job.completed' | 'job.failed';
  data: {
    jobId: string;
    status: Job['status'];
    progress?: number;
    result?: unknown;
    error?: string;
  };
}
```

### 8.8 OpenAPI & Developer Experience

The API is self-documenting for both humans and AI agents.

```typescript
// apps/gateway/src/openapi/generator.ts

import { generateOpenApi } from '@hono/zod-openapi';

export const openApiSpec = generateOpenApi(app, {
  openapi: '3.1.0',
  info: {
    title: 'Flywheel Gateway API',
    version: '1.0.0',
    description: 'Multi-agent orchestration platform API',
  },
  servers: [
    { url: 'http://localhost:8080/api/v1', description: 'Development' },
  ],
});
```

**AI-Agent Hints:**

Every endpoint includes hints for AI consumers:

```typescript
interface EndpointHints {
  summary: string;              // What this does
  whenToUse: string;           // When an agent should call this
  commonMistakes: string[];    // What to avoid
  relatedEndpoints: string[];  // What to call next
  exampleScenarios: string[];  // Real use cases
}
```

**Swagger UI:** Available at `/docs` with interactive testing, request/response examples, authentication helper, and WebSocket documentation.

### 8.9 Core Endpoint Categories

#### System (`/api/v1/...`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/version` | Version info |
| `GET` | `/capabilities` | Available features |
| `GET` | `/doctor` | Tool health check |

#### Agents (`/api/v1/agents`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/agents` | List all agents |
| `POST` | `/agents` | Spawn new agent |
| `GET` | `/agents/{id}` | Get agent details |
| `DELETE` | `/agents/{id}` | Terminate agent |
| `POST` | `/agents/{id}/send` | Send prompt |
| `POST` | `/agents/{id}/interrupt` | Interrupt agent |
| `GET` | `/agents/{id}/output` | Get output |
| `GET` | `/agents/{id}/status` | Get status |
| `POST` | `/agents/{id}/checkpoint` | Create checkpoint |

### 8.10 Golden Path: API Sequence for AI Agents

This section demonstrates the **ideal API call sequence** for an AI agent orchestrating work. Agents consuming the OpenAPI spec should follow this pattern for reliable operation.

#### Scenario: Spawn Agent, Coordinate, Execute Task

```typescript
// Step 1: Check system health and capabilities
const capabilities = await fetch('/api/v1/capabilities').then(r => r.json());
// → Verify required features are available

// Step 2: Check for ready work (if using Beads)
const triage = await fetch('/api/v1/beads/triage').then(r => r.json());
// → Get prioritized recommendations: triage.data.recommendations

// Step 3: Claim work to prevent conflicts
const bead = await fetch('/api/v1/beads/beads-123', {
  method: 'PATCH',
  body: JSON.stringify({ status: 'in_progress', assignee: 'GreenCastle' }),
}).then(r => r.json());

// Step 4: Reserve files before starting work
const reservation = await fetch('/api/v1/reservations', {
  method: 'POST',
  body: JSON.stringify({
    paths: ['src/api/users.ts', 'src/api/users.test.ts'],
    agent: 'GreenCastle',
    exclusive: true,
    ttl_seconds: 3600,
  }),
}).then(r => r.json());

// Check for conflicts
if (reservation.data.conflicts.length > 0) {
  // Coordinate via Agent Mail or wait
  console.log('Conflict with:', reservation.data.conflicts[0].holder);
}

// Step 5: Build context pack for the task
const contextPack = await fetch('/api/v1/context/build', {
  method: 'POST',
  body: JSON.stringify({
    taskDescription: bead.data.title,
    components: {
      triage: { budget: 2000, enabled: true },
      memory: { budget: 3000, enabled: true },
      cass: { budget: 2000, enabled: true },
    },
  }),
}).then(r => r.json());

// Step 6: Spawn the agent
const agent = await fetch('/api/v1/agents', {
  method: 'POST',
  body: JSON.stringify({
    model: 'claude',
    workingDir: '/path/to/project',
    contextPack: contextPack.data.id,
  }),
}).then(r => r.json());

// Step 7: Subscribe to output via WebSocket
const ws = new WebSocket('/api/v1/ws');
ws.send(JSON.stringify({
  op: 'subscribe',
  topics: [`output:${agent.data.id}`, `agents:${agent.data.id}`],
}));

// Step 8: Send the task prompt
await fetch(`/api/v1/agents/${agent.data.id}/send`, {
  method: 'POST',
  body: JSON.stringify({
    prompt: `Complete this task: ${bead.data.title}\n\n${bead.data.description}`,
  }),
});

// Step 9: Monitor for completion (via WebSocket events)
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === 'agent.state_changed' && msg.data.state === 'idle') {
    // Agent finished
    handleCompletion();
  }
};

// Step 10: On completion, create checkpoint and release resources
async function handleCompletion() {
  // Create checkpoint before cleanup
  await fetch(`/api/v1/agents/${agent.data.id}/checkpoint`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'task_complete' }),
  });

  // Release file reservations
  await fetch('/api/v1/reservations', {
    method: 'DELETE',
    body: JSON.stringify({ agent: 'GreenCastle' }),
  });

  // Close the bead
  await fetch('/api/v1/beads/beads-123/close', { method: 'POST' });

  // Terminate agent (or keep for next task)
  await fetch(`/api/v1/agents/${agent.data.id}`, { method: 'DELETE' });
}
```

#### Error Handling Pattern

```typescript
async function safeApiCall<T>(
  url: string,
  options?: RequestInit
): Promise<{ data?: T; error?: ApiError }> {
  const response = await fetch(url, options);

  if (!response.ok) {
    const error = await response.json();

    // Handle specific recoverable errors
    switch (error.error.code) {
      case 'QUOTA_EXCEEDED':
        // Rotate to different account and retry
        await fetch('/api/v1/accounts/pools/default/rotate', { method: 'POST' });
        return safeApiCall(url, options);

      case 'RESERVATION_CONFLICT':
        // Wait and retry, or coordinate via mail
        await sleep(30000);
        return safeApiCall(url, options);

      case 'AGENT_BUSY':
        // Wait for agent to finish current operation
        await sleep(5000);
        return safeApiCall(url, options);

      default:
        return { error: error.error };
    }
  }

  return { data: (await response.json()).data };
}
```

#### Key Principles for Agent Consumers

1. **Always check capabilities first** — Don't assume features exist
2. **Reserve before editing** — Prevent file conflicts
3. **Use context packs** — Give agents situational awareness
4. **Subscribe to WebSocket early** — Don't miss events
5. **Create checkpoints** — Enable recovery on failure
6. **Clean up resources** — Release reservations, close beads
7. **Handle errors gracefully** — Many errors are recoverable

---

## 9. WebSocket Layer

### 9.1 Connection Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    WebSocket Connection Manager                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    TOPIC ROUTER                              │   │
│  │                                                              │   │
│  │  Global Topics:              Agent Topics:                   │   │
│  │  • events                    • agents:{id}                   │   │
│  │  • alerts                    • output:{agentId}              │   │
│  │  • notifications             • output:{agentId}:tools        │   │
│  │  • scanner                                                   │   │
│  │  • beads                     Jobs Topics:                    │   │
│  │  • mail                      • jobs:{id}                     │   │
│  │  • conflicts                                                 │   │
│  │  • metrics                   System Topics:                  │   │
│  │  • pipeline                  • supervisor                    │   │
│  │  • accounts                  • provisioning                  │   │
│  │                                                              │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    EVENT SOURCES                             │   │
│  │                                                              │   │
│  │  • Agent SDK event streams (structured)                      │   │
│  │  • ACP JSON-RPC notifications                                │   │
│  │  • Tmux pipe-pane streaming (text)                          │   │
│  │  • Agent Mail inbox polling                                  │   │
│  │  • BV triage cache invalidation                             │   │
│  │  • UBS auto-scanner results                                  │   │
│  │  • File system watchers                                      │   │
│  │  • Pipeline state changes                                    │   │
│  │  • Provisioning queue transitions                            │   │
│  │  • BYOA/CAAM status changes                                  │   │
│  │                                                              │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 9.2 Connection Endpoint

```
WebSocket URL: wss://api.flywheel.local/v1/ws
              ws://localhost:8080/api/v1/ws (development)

Query Parameters:
  - api_key: Authentication token
```

### 9.3 Subscription Protocol

Client sends:
```json
{
  "op": "subscribe",
  "topics": [
    "events",
    "agents:abc123",
    "output:abc123",
    "notifications",
    "accounts",
    "provisioning"
  ],
  "since": "cursor_01H..."
}
```

Server responds:
```json
{
  "op": "subscribed",
  "topics": ["events", "agents:abc123", "output:abc123", "notifications"],
  "server_time": "2026-01-07T00:00:00Z"
}
```

### 9.4 Event Envelope

```json
{
  "type": "agent.output.append",
  "ts": "2026-01-07T00:00:00.123Z",
  "seq": 184224,
  "topic": "output:abc123",
  "data": {
    "agentId": "abc123",
    "model": "claude",
    "driver": "sdk",
    "chunk": "Analyzing the authentication module...\n",
    "event_type": "text_delta",
    "agent_mail_name": "GreenCastle"
  }
}
```

### 9.5 Event Types

#### Agent Events
- `agent.spawned`
- `agent.state_changed` — idle ↔ working
- `agent.output.append` — New output
- `agent.tool_call` — Tool invocation (SDK/ACP)
- `agent.tool_result` — Tool result
- `agent.error`
- `agent.terminated`

#### Beads Events
- `bead.created`
- `bead.updated`
- `bead.closed`
- `bead.claimed`

#### Mail Events
- `mail.received`
- `mail.read`
- `mail.acknowledged`

#### Reservation Events
- `reservation.granted`
- `reservation.released`
- `reservation.conflict`

#### Scanner Events
- `scanner.started`
- `scanner.finding`
- `scanner.complete`

#### System Events
- `alert.created`
- `approval.requested`
- `approval.resolved`

### 9.6 Reconnection & Resume

Network interruptions happen. Clients need to automatically reconnect and resume without missing events.

**Cursor-Based Resume:**

```typescript
// Client sends on reconnect
{
  "op": "subscribe",
  "topics": ["agents:abc123", "output:abc123"],
  "since": {
    "cursor": "cursor_01H...",
    // OR
    "seq": 185000
  }
}

// Server responds
{
  "op": "subscribed",
  "resumedFrom": "cursor_01H...",
  "missedEvents": 42,  // How many events were buffered
  "bufferOverflow": false  // If true, some events were lost
}
```

**Snapshot-on-Connect (when buffer overflow):**

```typescript
// Server sends
{
  "type": "stream.reset",
  "topic": "output:abc123",
  "data": {
    "reason": "cursor_expired",
    "snapshot": {
      "lines": ["...last 200 lines..."],
      "currentSeq": 186000
    }
  }
}
```

**Client Implementation:**

```typescript
// apps/web/src/lib/ws.ts

export class ReconnectingWebSocket {
  private ws: WebSocket | null = null;
  private lastSeq = new Map<string, number>();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;

  connect() {
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.resubscribe();
    };

    this.ws.onclose = () => {
      this.scheduleReconnect();
    };

    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.seq) {
        this.lastSeq.set(msg.topic, msg.seq);
      }
      this.emit('message', msg);
    };
  }

  private resubscribe() {
    for (const [topic, seq] of this.lastSeq) {
      this.send({
        op: 'subscribe',
        topics: [topic],
        since: { seq },
      });
    }
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emit('maxReconnectAttemptsReached');
      return;
    }

    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;

    setTimeout(() => this.connect(), delay);
  }
}
```

### 9.7 Backpressure & Performance

For high-throughput agents, output can exceed what a browser can render.

**Server-side:**
- Per-agent ring buffer (configurable, default 10000 lines)
- Per-client subscription limits

**Client options:**
```json
{
  "op": "subscribe",
  "topics": ["output:abc123"],
  "options": {
    "mode": "lines",       // "lines" (safe) or "raw" (fast)
    "throttle_ms": 100,    // Batch updates
    "max_lines_per_msg": 50
  }
}
```

### 9.8 Reliability & Acknowledgment Protocol

For mission-critical events (approvals, conflicts, errors), the WebSocket layer provides guaranteed delivery with acknowledgments.

#### Sequence Numbers & Resume

Every event has a monotonically increasing sequence number per topic:

```typescript
interface ReliableEvent {
  seq: number;           // Monotonic per topic
  ts: string;            // ISO-8601 timestamp
  topic: string;
  type: string;
  data: unknown;
  requires_ack?: boolean; // Client must acknowledge
}
```

**Resume from last seen:**

```json
{
  "op": "subscribe",
  "topics": ["alerts", "approvals"],
  "since": { "alerts": 1234, "approvals": 567 }
}
```

The server replays any events with `seq > since[topic]` before streaming live events.

#### Acknowledgment Protocol

Critical events (marked with `requires_ack: true`) must be acknowledged:

```typescript
// Server sends critical event
{
  "seq": 1235,
  "topic": "approvals",
  "type": "approval.requested",
  "requires_ack": true,
  "ack_deadline_ms": 30000,
  "data": {
    "approval_id": "apr_123",
    "action": "git push --force",
    "risk_level": "dangerous"
  }
}

// Client must respond within deadline
{
  "op": "ack",
  "topic": "approvals",
  "seq": 1235
}
```

If not acknowledged within deadline, the server:
1. Logs a delivery failure
2. Retries delivery up to 3 times
3. Falls back to alternative notification (email, webhook)

#### Missed Message Detection

Clients detect gaps in sequence numbers:

```typescript
class ReliableWebSocket {
  private lastSeq = new Map<string, number>();

  handleMessage(event: ReliableEvent) {
    const lastSeen = this.lastSeq.get(event.topic) ?? 0;

    if (event.seq > lastSeen + 1) {
      // Gap detected - request replay
      this.ws.send(JSON.stringify({
        op: 'replay',
        topic: event.topic,
        from_seq: lastSeen + 1,
        to_seq: event.seq - 1,
      }));
    }

    this.lastSeq.set(event.topic, event.seq);
    this.processEvent(event);
  }
}
```

### 9.9 Scale-Out Architecture

For high-availability deployments with multiple gateway instances, WebSocket connections are distributed across servers with shared state.

#### Redis Adapter Pattern

```typescript
// apps/gateway/src/ws/redis-adapter.ts

import { Redis } from 'ioredis';

interface ScaleOutConfig {
  mode: 'single' | 'redis' | 'cluster';
  redis?: {
    url: string;
    keyPrefix: string;
  };
}

export class RedisWebSocketAdapter {
  private pub: Redis;
  private sub: Redis;

  constructor(private config: ScaleOutConfig) {
    if (config.mode === 'redis') {
      this.pub = new Redis(config.redis!.url);
      this.sub = new Redis(config.redis!.url);
      this.setupSubscriptions();
    }
  }

  // Broadcast to all servers
  async broadcast(topic: string, event: WebSocketEvent): Promise<void> {
    if (this.config.mode === 'single') {
      // Direct broadcast to local connections
      this.localHub.broadcast(topic, event);
    } else {
      // Publish to Redis, all servers receive and broadcast locally
      await this.pub.publish(
        `${this.config.redis!.keyPrefix}:${topic}`,
        JSON.stringify(event)
      );
    }
  }

  private setupSubscriptions() {
    this.sub.psubscribe(`${this.config.redis!.keyPrefix}:*`);

    this.sub.on('pmessage', (pattern, channel, message) => {
      const topic = channel.replace(`${this.config.redis!.keyPrefix}:`, '');
      const event = JSON.parse(message);
      this.localHub.broadcast(topic, event);
    });
  }
}
```

#### Sticky Sessions

For WebSocket connections, use sticky sessions to route reconnecting clients to the same server:

```typescript
// Connection ID encodes server affinity
interface ConnectionId {
  serverId: string;    // e.g., 'gateway-1'
  connectionId: string; // UUID
  createdAt: number;
}

// Load balancer uses X-Server-Id header for routing
function generateConnectionId(serverId: string): string {
  return Buffer.from(JSON.stringify({
    serverId,
    connectionId: crypto.randomUUID(),
    createdAt: Date.now(),
  })).toString('base64url');
}
```

#### Horizontal Scaling Topology

```
┌─────────────────────────────────────────────────────────────────────┐
│                       LOAD BALANCER                                  │
│                  (Sticky sessions by connection ID)                  │
└───────────────────────────┬─────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│  Gateway 1    │   │  Gateway 2    │   │  Gateway 3    │
│  (WebSocket)  │   │  (WebSocket)  │   │  (WebSocket)  │
└───────┬───────┘   └───────┬───────┘   └───────┬───────┘
        │                   │                   │
        └───────────────────┼───────────────────┘
                            │
                    ┌───────▼───────┐
                    │    Redis      │
                    │  (Pub/Sub)    │
                    └───────────────┘
                            │
                    ┌───────▼───────┐
                    │   SQLite /    │
                    │   Postgres    │
                    └───────────────┘
```

**Scaling Guidelines:**

| Metric | Single Server | Redis Mode | Notes |
|--------|---------------|------------|-------|
| Connections | ~10,000 | ~100,000+ | Per gateway instance |
| Events/sec | ~50,000 | ~500,000 | Aggregate across cluster |
| Latency | <10ms | <50ms | Pub/sub adds overhead |
| Complexity | Low | Medium | Redis operational burden |

**Recommendation:** Start with single-server mode. Add Redis only when:
- You need >10,000 concurrent WebSocket connections
- You require zero-downtime deployments
- You need geographic distribution

---

## 10. Context Pack Building Engine

### 10.1 The "Brain" of the Flywheel

Context packs are pre-assembled prompts that give agents situational awareness. They combine:
- **Triage data** (from BV) — What work is ready, blocked, recommended
- **Memory** (from CM) — Relevant rules, anti-patterns, past solutions
- **Search results** (from CASS) — Similar past sessions
- **Session context** (from S2P) — Recent conversation history

### 10.2 Token Budget Allocation

```typescript
// packages/shared/src/types/context.ts

interface ContextPackConfig {
  totalBudget: number;  // Total tokens available
  components: {
    triage: { budget: number; enabled: boolean };
    memory: { budget: number; enabled: boolean };
    cass: { budget: number; enabled: boolean };
    s2p: { budget: number; enabled: boolean };
  };
  agentType: 'claude' | 'codex' | 'gemini';
  taskDescription: string;
}

interface ContextPack {
  id: string;
  createdAt: Date;
  config: ContextPackConfig;
  sections: {
    triage?: string;
    memory?: string;
    cass?: string;
    s2p?: string;
  };
  tokenCounts: {
    triage: number;
    memory: number;
    cass: number;
    s2p: number;
    total: number;
  };
  renderedPrompt: string;
}
```

### 10.3 Context Builder Service

```typescript
// apps/gateway/src/services/context.service.ts

export class ContextService {
  constructor(
    private bvClient: BVClient,
    private cmClient: CMClient,
    private cassClient: CASSClient,
  ) {}

  async buildPack(config: ContextPackConfig): Promise<ContextPack> {
    const [triage, memory, cass] = await Promise.all([
      config.components.triage.enabled
        ? this.buildTriageSection(config)
        : null,
      config.components.memory.enabled
        ? this.buildMemorySection(config)
        : null,
      config.components.cass.enabled
        ? this.buildCassSection(config)
        : null,
    ]);

    // Render according to agent type
    const renderedPrompt = this.renderForAgent(
      config.agentType,
      { triage, memory, cass }
    );

    return {
      id: crypto.randomUUID(),
      createdAt: new Date(),
      config,
      sections: { triage, memory, cass },
      tokenCounts: this.countTokens({ triage, memory, cass }),
      renderedPrompt,
    };
  }

  private async buildTriageSection(config: ContextPackConfig): Promise<string> {
    const triage = await this.bvClient.getTriage();

    // Prioritize: recommendations > quick_wins > blockers
    const sections = [
      this.formatRecommendations(triage.recommendations, config.components.triage.budget * 0.5),
      this.formatQuickWins(triage.quick_wins, config.components.triage.budget * 0.3),
      this.formatBlockers(triage.blockers_to_clear, config.components.triage.budget * 0.2),
    ];

    return sections.filter(Boolean).join('\n\n');
  }

  private renderForAgent(
    agentType: 'claude' | 'codex' | 'gemini',
    sections: Record<string, string | null>
  ): string {
    // Different agents have different optimal prompt formats
    switch (agentType) {
      case 'claude':
        return this.renderClaudeFormat(sections);
      case 'codex':
        return this.renderCodexFormat(sections);
      case 'gemini':
        return this.renderGeminiFormat(sections);
    }
  }
}
```

### 10.4 REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/context/build` | Build context pack |
| `GET` | `/context/{id}` | Get built pack |
| `GET` | `/context/preview` | Preview without persisting |
| `GET` | `/context/stats` | Usage statistics |
| `DELETE` | `/context/cache` | Clear cache |

### 10.5 Context Pack Studio UI

```tsx
// apps/web/src/components/context/ContextPackStudio.tsx

export function ContextPackStudio() {
  const [config, setConfig] = useState<ContextPackConfig>({
    totalBudget: 8000,
    components: {
      triage: { budget: 2000, enabled: true },
      memory: { budget: 3000, enabled: true },
      cass: { budget: 2000, enabled: true },
      s2p: { budget: 1000, enabled: true },
    },
    agentType: 'claude',
    taskDescription: '',
  });

  const { data: preview, refetch } = useQuery({
    queryKey: ['context-preview', config],
    queryFn: () => api.previewContextPack(config),
    enabled: false,
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Budget Allocation Panel */}
      <div className="bg-slate-900 rounded-xl p-6 border border-slate-800">
        <h3 className="text-lg font-semibold text-white mb-6">Token Budget</h3>

        <div className="space-y-6">
          <BudgetSlider
            label="Triage (BV)"
            value={config.components.triage.budget}
            onChange={(v) => updateBudget('triage', v)}
            max={5000}
            enabled={config.components.triage.enabled}
            onToggle={(e) => toggleComponent('triage', e)}
            color="amber"
            icon={<LayoutDashboardIcon />}
          />
          <BudgetSlider
            label="Memory (CM)"
            value={config.components.memory.budget}
            onChange={(v) => updateBudget('memory', v)}
            max={5000}
            enabled={config.components.memory.enabled}
            onToggle={(e) => toggleComponent('memory', e)}
            color="purple"
            icon={<BrainIcon />}
          />
          <BudgetSlider
            label="Search (CASS)"
            value={config.components.cass.budget}
            onChange={(v) => updateBudget('cass', v)}
            max={5000}
            enabled={config.components.cass.enabled}
            onToggle={(e) => toggleComponent('cass', e)}
            color="blue"
            icon={<SearchIcon />}
          />
          <BudgetSlider
            label="Sessions (S2P)"
            value={config.components.s2p.budget}
            onChange={(v) => updateBudget('s2p', v)}
            max={3000}
            enabled={config.components.s2p.enabled}
            onToggle={(e) => toggleComponent('s2p', e)}
            color="green"
            icon={<MessageSquareIcon />}
          />
        </div>

        {/* Total Budget Ring */}
        <div className="mt-6 pt-4 border-t border-slate-700 flex items-center justify-between">
          <div>
            <span className="text-slate-400 text-sm">Total Budget</span>
            <p className="text-2xl font-bold text-white">
              {totalUsed.toLocaleString()} / {config.totalBudget.toLocaleString()}
            </p>
          </div>
          <TokenBudgetRing used={totalUsed} total={config.totalBudget} />
        </div>
      </div>

      {/* Preview Panel */}
      <div className="bg-slate-900 rounded-xl p-6 border border-slate-800">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Preview</h3>
          <Button onClick={() => refetch()} size="sm">
            <RefreshCwIcon className="w-4 h-4 mr-2" />
            Generate
          </Button>
        </div>

        {preview && (
          <div className="space-y-4 max-h-[500px] overflow-auto">
            {preview.sections.triage && (
              <PreviewSection
                title="Triage"
                content={preview.sections.triage}
                tokens={preview.tokenCounts.triage}
                color="amber"
              />
            )}
            {preview.sections.memory && (
              <PreviewSection
                title="Memory"
                content={preview.sections.memory}
                tokens={preview.tokenCounts.memory}
                color="purple"
              />
            )}
            {preview.sections.cass && (
              <PreviewSection
                title="Search"
                content={preview.sections.cass}
                tokens={preview.tokenCounts.cass}
                color="blue"
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

---

## 11. Agent Mail Deep Integration

### 11.1 REST API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/mail/health` | MCP server health |
| `POST` | `/mail/projects` | Ensure project exists |
| `POST` | `/mail/agents` | Register agent identity |
| `GET` | `/mail/inbox` | Fetch agent inbox |
| `POST` | `/mail/messages` | Send message |
| `POST` | `/mail/messages/{id}/reply` | Reply to message |
| `POST` | `/mail/messages/{id}/read` | Mark as read |
| `POST` | `/mail/messages/{id}/ack` | Acknowledge message |
| `GET` | `/mail/search` | Full-text search |
| `GET` | `/mail/threads/{id}/summary` | Thread summary |

### 11.2 File Reservations API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/reservations` | Reserve paths |
| `DELETE` | `/reservations` | Release reservations |
| `POST` | `/reservations/{id}/renew` | Extend TTL |
| `GET` | `/reservations` | List all reservations |
| `GET` | `/reservations/conflicts` | Current conflicts |

### 11.3 File Reservation Map Component

```tsx
// apps/web/src/components/reservations/FileReservationMap.tsx

import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { FileIcon, LockIcon, AlertTriangleIcon } from 'lucide-react';

interface FileReservation {
  id: number;
  path_pattern: string;
  agent_name: string;
  exclusive: boolean;
  reason: string;
  created_at: string;
  expires_at: string;
  has_conflict: boolean;
}

export function FileReservationMap({ projectKey }: { projectKey: string }) {
  const { data: reservations } = useQuery({
    queryKey: ['reservations', projectKey],
    queryFn: () => api.getReservations(projectKey),
    refetchInterval: 5000,
  });

  const fileGroups = groupByPath(reservations ?? []);

  return (
    <div className="bg-slate-900 rounded-xl p-6 border border-slate-800">
      <div className="flex items-center gap-2 mb-6">
        <LockIcon className="w-5 h-5 text-amber-400" />
        <h3 className="text-lg font-semibold text-white">File Reservations</h3>
      </div>

      <div className="space-y-2">
        <AnimatePresence mode="popLayout">
          {Object.entries(fileGroups).map(([path, holders]) => (
            <motion.div
              key={path}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className={`p-3 rounded-lg border ${
                holders.some(h => h.has_conflict)
                  ? 'bg-red-900/20 border-red-500/50'
                  : holders.some(h => h.exclusive)
                  ? 'bg-amber-900/20 border-amber-500/50'
                  : 'bg-slate-800/50 border-slate-700'
              }`}
            >
              <div className="flex items-center gap-3">
                <FileIcon className="w-4 h-4 text-slate-400" />
                <code className="text-sm text-slate-300 flex-1 font-mono">
                  {path}
                </code>
                {holders.some(h => h.has_conflict) && (
                  <AlertTriangleIcon className="w-4 h-4 text-red-400" />
                )}
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                {holders.map(holder => (
                  <AgentBadge
                    key={holder.id}
                    name={holder.agent_name}
                    exclusive={holder.exclusive}
                    expiresAt={holder.expires_at}
                  />
                ))}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
```

---

## 12. Conflict Detection & Resolution

### 12.1 What Causes Conflicts

When multiple agents work on the same codebase:
- Overlapping file edits
- Competing git branches
- Incompatible changes to shared modules
- Race conditions in file reservations

### 12.2 Conflict Detection Service

```typescript
// apps/gateway/src/services/conflict.service.ts

interface FileConflict {
  path: string;
  agents: Array<{
    agentId: string;
    agentName: string;
    operation: 'read' | 'write' | 'delete';
    timestamp: Date;
  }>;
  severity: 'low' | 'medium' | 'high';
  suggestedResolution?: string;
}

export class ConflictService {
  private fileWatcher: FSWatcher;
  private recentOperations = new Map<string, FileOperation[]>();

  async detectConflicts(): Promise<FileConflict[]> {
    const conflicts: FileConflict[] = [];

    for (const [path, operations] of this.recentOperations) {
      const writers = operations.filter(op => op.operation !== 'read');
      if (writers.length > 1) {
        conflicts.push({
          path,
          agents: writers.map(op => ({
            agentId: op.agentId,
            agentName: op.agentName,
            operation: op.operation,
            timestamp: op.timestamp,
          })),
          severity: this.calculateSeverity(writers),
          suggestedResolution: this.suggestResolution(path, writers),
        });
      }
    }

    return conflicts;
  }

  async resolveConflict(
    conflictId: string,
    resolution: 'keep_first' | 'keep_last' | 'merge' | 'manual'
  ): Promise<void> {
    // Implementation
  }
}
```

### 12.3 REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/conflicts` | List active conflicts |
| `GET` | `/conflicts/{id}` | Get conflict details |
| `POST` | `/conflicts/{id}/resolve` | Resolve conflict |

### 12.4 WebSocket Events

```typescript
interface ConflictEvent {
  type: 'conflict.detected' | 'conflict.resolved' | 'conflict.escalated';
  data: FileConflict;
}
```

### 12.5 Conflict Heatmap Component

```tsx
// apps/web/src/components/conflicts/ConflictHeatmap.tsx

export function ConflictHeatmap() {
  const { data: conflicts } = useConflicts();

  // Build matrix: files (y) × agents (x)
  const { files, agents, matrix } = useMemo(
    () => buildConflictMatrix(conflicts ?? []),
    [conflicts]
  );

  return (
    <div className="bg-slate-900 rounded-xl p-6 border border-slate-800">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">Conflict Map</h3>
        <Badge variant={conflicts?.length ? 'destructive' : 'secondary'}>
          {conflicts?.length ?? 0} conflicts
        </Badge>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr>
              <th className="text-left text-xs text-slate-500 pb-2">File</th>
              {agents.map(agent => (
                <th key={agent} className="text-center text-xs text-slate-500 pb-2 px-2">
                  <AgentAvatar name={agent} size="sm" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {files.map(file => (
              <tr key={file} className="hover:bg-slate-800/50">
                <td className="text-xs text-slate-300 font-mono py-1 pr-4 truncate max-w-48">
                  {file}
                </td>
                {agents.map(agent => {
                  const cell = matrix[file]?.[agent];
                  return (
                    <td key={agent} className="text-center px-2 py-1">
                      {cell && (
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          className={`w-6 h-6 rounded cursor-pointer ${
                            cell.severity === 'high'
                              ? 'bg-red-500 animate-pulse'
                              : cell.severity === 'medium'
                              ? 'bg-amber-500'
                              : 'bg-blue-500'
                          }`}
                          title={`${agent}: ${cell.operation}`}
                          onClick={() => openConflictDetail(file, agent)}
                        />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

### 12.6 Intelligent Conflict Resolution Assistant

When conflicts occur, simply reporting "conflict with BlueLake" isn't enough—users need actionable guidance. The Intelligent Conflict Resolution Assistant uses AI-powered analysis to suggest resolutions based on task context, agent progress, and historical patterns.

#### 12.6.1 Resolution Strategy Types

```typescript
// packages/shared/src/types/conflict-resolution.ts

type ConflictStrategy =
  | 'wait'              // Agent can wait; holder almost done
  | 'split'             // File can be partitioned (different functions/sections)
  | 'sequence'          // Tasks have natural ordering; requeue
  | 'transfer'          // Holder should yield; lower priority task
  | 'merge_tasks'       // Tasks are complementary; combine
  | 'coordinate'        // Agents should coordinate via mail
  | 'escalate';         // Requires human decision

interface ConflictResolutionSuggestion {
  conflict: FileConflict;
  suggestions: Array<{
    strategy: ConflictStrategy;
    confidence: number;           // 0-1, how confident the system is
    rationale: string;            // Human-readable explanation
    estimatedWaitTime?: number;   // For 'wait' strategy (ms)
    actions: ConflictAction[];    // Actionable steps
    requiresUserApproval: boolean;
  }>;
  analyzedAt: Date;
  dataSourcesUsed: string[];      // What informed the suggestion
}

interface ConflictAction {
  type:
    | 'notify_agent'
    | 'set_reminder'
    | 'transfer_reservation'
    | 'send_coordination_message'
    | 'create_bead'
    | 'escalate_to_user';
  params: Record<string, unknown>;
  description: string;
}
```

#### 12.6.2 Resolution Intelligence Service

```typescript
// apps/gateway/src/services/conflict-resolution.service.ts

export class ConflictResolutionService {
  constructor(
    private conflictService: ConflictService,
    private beadService: BeadService,
    private checkpointService: CheckpointService,
    private cassService: CASSService,
    private agentService: AgentService,
  ) {}

  async analyzeConflict(conflict: FileConflict): Promise<ConflictResolutionSuggestion> {
    const dataSourcesUsed: string[] = [];

    // 1. Analyze task priorities from beads
    const taskAnalysis = await this.analyzeTaskPriorities(conflict);
    dataSourcesUsed.push('bead_priorities');

    // 2. Estimate progress from checkpoints
    const progressEstimates = await this.estimateProgress(conflict);
    dataSourcesUsed.push('checkpoint_progress');

    // 3. Check historical patterns from CASS
    const historicalPatterns = await this.getHistoricalResolutions(conflict.path);
    if (historicalPatterns.length > 0) {
      dataSourcesUsed.push('cass_history');
    }

    // 4. Analyze file structure for split potential
    const splitAnalysis = await this.analyzeSplitPotential(conflict.path);
    dataSourcesUsed.push('file_structure');

    // 5. Generate suggestions
    const suggestions = await this.generateSuggestions(
      conflict,
      taskAnalysis,
      progressEstimates,
      historicalPatterns,
      splitAnalysis
    );

    return {
      conflict,
      suggestions: this.rankSuggestions(suggestions),
      analyzedAt: new Date(),
      dataSourcesUsed,
    };
  }

  private async analyzeTaskPriorities(conflict: FileConflict): Promise<TaskAnalysis> {
    const agentTasks = await Promise.all(
      conflict.agents.map(async (agent) => {
        const beads = await this.beadService.getActiveForAgent(agent.agentId);
        return {
          agentId: agent.agentId,
          agentName: agent.agentName,
          activeBead: beads[0],
          priority: beads[0]?.priority ?? 3,
          taskDescription: beads[0]?.title ?? 'Unknown task',
        };
      })
    );

    return {
      agentTasks,
      priorityWinner: agentTasks.reduce((a, b) =>
        a.priority < b.priority ? a : b
      ),
    };
  }

  private async estimateProgress(conflict: FileConflict): Promise<ProgressEstimate[]> {
    return Promise.all(
      conflict.agents.map(async (agent) => {
        const checkpoints = await this.checkpointService.list(agent.agentId);
        const latestCheckpoint = checkpoints[0];
        const agentStatus = await this.agentService.getStatus(agent.agentId);

        // Estimate completion based on checkpoint frequency and agent activity
        const estimatedCompletion = this.estimateCompletion(
          checkpoints,
          agentStatus
        );

        return {
          agentId: agent.agentId,
          agentName: agent.agentName,
          estimatedProgressPercent: estimatedCompletion.percent,
          estimatedTimeRemaining: estimatedCompletion.timeRemainingMs,
          confidence: estimatedCompletion.confidence,
        };
      })
    );
  }

  private async generateSuggestions(
    conflict: FileConflict,
    taskAnalysis: TaskAnalysis,
    progressEstimates: ProgressEstimate[],
    historicalPatterns: HistoricalResolution[],
    splitAnalysis: SplitAnalysis
  ): Promise<Array<ConflictResolutionSuggestion['suggestions'][0]>> {
    const suggestions: Array<ConflictResolutionSuggestion['suggestions'][0]> = [];

    // Strategy 1: WAIT - if one agent is almost done
    const nearlyDone = progressEstimates.find(
      p => p.estimatedProgressPercent > 80 && p.estimatedTimeRemaining < 5 * 60 * 1000
    );
    if (nearlyDone) {
      const other = conflict.agents.find(a => a.agentId !== nearlyDone.agentId);
      suggestions.push({
        strategy: 'wait',
        confidence: Math.min(0.9, nearlyDone.confidence),
        rationale: `${nearlyDone.agentName} is ${nearlyDone.estimatedProgressPercent}% done with ${conflict.path}. ` +
                   `Estimated ${Math.round(nearlyDone.estimatedTimeRemaining / 60000)} minutes remaining.`,
        estimatedWaitTime: nearlyDone.estimatedTimeRemaining,
        actions: [
          {
            type: 'notify_agent',
            params: { agentId: other?.agentId, message: `Waiting for ${nearlyDone.agentName} (~${Math.round(nearlyDone.estimatedTimeRemaining / 60000)} min)` },
            description: `Notify ${other?.agentName} to wait`,
          },
          {
            type: 'set_reminder',
            params: { delay: nearlyDone.estimatedTimeRemaining, action: 'retry_reservation' },
            description: 'Set reminder to retry reservation',
          },
        ],
        requiresUserApproval: false,
      });
    }

    // Strategy 2: TRANSFER - if priority mismatch
    if (taskAnalysis.priorityWinner) {
      const loser = taskAnalysis.agentTasks.find(
        t => t.agentId !== taskAnalysis.priorityWinner.agentId
      );
      if (loser && taskAnalysis.priorityWinner.priority < loser.priority) {
        suggestions.push({
          strategy: 'transfer',
          confidence: 0.75,
          rationale: `${taskAnalysis.priorityWinner.agentName}'s task (P${taskAnalysis.priorityWinner.priority}: "${taskAnalysis.priorityWinner.taskDescription}") ` +
                     `has higher priority than ${loser.agentName}'s task (P${loser.priority}: "${loser.taskDescription}").`,
          actions: [
            {
              type: 'transfer_reservation',
              params: { from: loser.agentId, to: taskAnalysis.priorityWinner.agentId, path: conflict.path },
              description: `Transfer reservation from ${loser.agentName} to ${taskAnalysis.priorityWinner.agentName}`,
            },
            {
              type: 'send_coordination_message',
              params: { to: loser.agentId, subject: 'Reservation transferred due to priority' },
              description: `Notify ${loser.agentName} of transfer`,
            },
          ],
          requiresUserApproval: false,
        });
      }
    }

    // Strategy 3: SPLIT - if file is splittable
    if (splitAnalysis.canSplit && splitAnalysis.sections.length >= 2) {
      suggestions.push({
        strategy: 'split',
        confidence: splitAnalysis.confidence,
        rationale: `The file ${conflict.path} contains ${splitAnalysis.sections.length} distinct sections ` +
                   `that can be worked on independently: ${splitAnalysis.sections.map(s => s.name).join(', ')}.`,
        actions: splitAnalysis.sections.map((section, i) => ({
          type: 'send_coordination_message' as const,
          params: {
            to: conflict.agents[i % conflict.agents.length].agentId,
            subject: `Work on ${section.name} section only`,
            body: `Please limit your changes to lines ${section.startLine}-${section.endLine}`,
          },
          description: `Assign ${section.name} to ${conflict.agents[i % conflict.agents.length].agentName}`,
        })),
        requiresUserApproval: true,
      });
    }

    // Strategy 4: COORDINATE - if tasks are related
    const taskOverlap = this.detectTaskOverlap(taskAnalysis);
    if (taskOverlap > 0.5) {
      suggestions.push({
        strategy: 'coordinate',
        confidence: 0.7,
        rationale: `Both agents are working on related tasks with ${Math.round(taskOverlap * 100)}% overlap. ` +
                   `They should coordinate via Agent Mail to align their approaches.`,
        actions: [
          {
            type: 'send_coordination_message',
            params: {
              to: conflict.agents.map(a => a.agentId),
              subject: `Coordination needed on ${conflict.path}`,
              body: 'Your tasks overlap. Please discuss approach via Agent Mail before proceeding.',
            },
            description: 'Send coordination request to both agents',
          },
        ],
        requiresUserApproval: false,
      });
    }

    // Strategy 5: ESCALATE - fallback
    if (suggestions.length === 0 || suggestions.every(s => s.confidence < 0.5)) {
      suggestions.push({
        strategy: 'escalate',
        confidence: 1.0,
        rationale: 'Unable to determine safe automated resolution. Human review recommended.',
        actions: [
          {
            type: 'escalate_to_user',
            params: { conflict, analysisDetails: { taskAnalysis, progressEstimates } },
            description: 'Request human decision',
          },
        ],
        requiresUserApproval: true,
      });
    }

    return suggestions;
  }

  private rankSuggestions(
    suggestions: Array<ConflictResolutionSuggestion['suggestions'][0]>
  ): Array<ConflictResolutionSuggestion['suggestions'][0]> {
    return suggestions.sort((a, b) => {
      // Prefer high-confidence, non-escalation strategies
      if (a.strategy === 'escalate' && b.strategy !== 'escalate') return 1;
      if (b.strategy === 'escalate' && a.strategy !== 'escalate') return -1;
      return b.confidence - a.confidence;
    });
  }
}
```

#### 12.6.3 Conflict Resolution UI Component

```tsx
// apps/web/src/components/conflicts/ConflictResolutionPanel.tsx

export function ConflictResolutionPanel({ conflictId }: { conflictId: string }) {
  const { data: analysis } = useConflictAnalysis(conflictId);
  const applySuggestion = useApplySuggestion();

  if (!analysis) return <LoadingSpinner />;

  const topSuggestion = analysis.suggestions[0];

  return (
    <div className="bg-slate-900 rounded-xl p-6 border border-slate-800">
      <div className="flex items-center gap-3 mb-4">
        <AlertTriangleIcon className="w-5 h-5 text-amber-500" />
        <h3 className="text-lg font-semibold text-white">Conflict Resolution</h3>
      </div>

      {/* Top Suggestion */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="p-4 bg-blue-900/20 border border-blue-500/30 rounded-lg mb-4"
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-blue-400 uppercase">
            Suggested: {topSuggestion.strategy}
          </span>
          <Badge variant="secondary">
            {Math.round(topSuggestion.confidence * 100)}% confidence
          </Badge>
        </div>

        <p className="text-sm text-slate-300 mb-4">
          {topSuggestion.rationale}
        </p>

        {topSuggestion.estimatedWaitTime && (
          <p className="text-xs text-slate-400 mb-4">
            Estimated wait: {Math.round(topSuggestion.estimatedWaitTime / 60000)} minutes
          </p>
        )}

        <div className="flex gap-2">
          <Button
            onClick={() => applySuggestion.mutate({
              conflictId,
              suggestion: topSuggestion,
            })}
            disabled={topSuggestion.requiresUserApproval && !userConfirmed}
          >
            {topSuggestion.requiresUserApproval ? 'Approve & Apply' : 'Apply Suggestion'}
          </Button>
          <Button variant="ghost" onClick={() => setShowAlternatives(true)}>
            View Alternatives
          </Button>
        </div>
      </motion.div>

      {/* Data Sources */}
      <div className="text-xs text-slate-500 mt-4">
        Analysis based on: {analysis.dataSourcesUsed.join(', ')}
      </div>
    </div>
  );
}
```

#### 12.6.4 Auto-Resolution Rules

For low-risk conflicts, the system can apply suggestions automatically:

```typescript
interface AutoResolutionRule {
  name: string;
  enabled: boolean;
  condition: (suggestion: ConflictResolutionSuggestion['suggestions'][0]) => boolean;
  maxSeverity: 'low' | 'medium';
}

const DEFAULT_AUTO_RESOLUTION_RULES: AutoResolutionRule[] = [
  {
    name: 'auto_wait_short',
    enabled: true,
    condition: (s) =>
      s.strategy === 'wait' &&
      s.confidence >= 0.8 &&
      (s.estimatedWaitTime ?? Infinity) < 5 * 60 * 1000, // < 5 min
    maxSeverity: 'medium',
  },
  {
    name: 'auto_transfer_priority',
    enabled: true,
    condition: (s) =>
      s.strategy === 'transfer' &&
      s.confidence >= 0.85,
    maxSeverity: 'low',
  },
  {
    name: 'auto_coordinate',
    enabled: true,
    condition: (s) =>
      s.strategy === 'coordinate' &&
      s.confidence >= 0.7,
    maxSeverity: 'medium',
  },
];
```

---

## 13. Beads & BV Integration

### 13.1 REST API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/beads` | List all beads |
| `POST` | `/beads` | Create bead |
| `GET` | `/beads/{id}` | Get bead details |
| `PATCH` | `/beads/{id}` | Update bead |
| `POST` | `/beads/{id}/close` | Close bead |
| `GET` | `/beads/ready` | Get ready work |
| `GET` | `/beads/blocked` | Get blocked work |
| `GET` | `/beads/triage` | Full triage analysis (BV) |
| `GET` | `/beads/insights` | Graph insights |
| `POST` | `/beads/{id}/deps` | Add dependency |
| `POST` | `/beads/sync` | Sync with git |

### 13.2 Kanban Board Component

```tsx
// apps/web/src/components/beads/KanbanBoard.tsx

import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { motion } from 'framer-motion';

const COLUMNS = [
  { id: 'open', title: 'Open', color: 'slate' },
  { id: 'in_progress', title: 'In Progress', color: 'blue' },
  { id: 'blocked', title: 'Blocked', color: 'red' },
  { id: 'review', title: 'Review', color: 'amber' },
  { id: 'closed', title: 'Done', color: 'green' },
];

export function KanbanBoard() {
  const { data: beads } = useBeads();
  const updateBead = useUpdateBead();

  const handleDragEnd = (result: DropResult) => {
    if (!result.destination) return;
    const beadId = result.draggableId;
    const newStatus = result.destination.droppableId;
    updateBead.mutate({ id: beadId, status: newStatus });
  };

  const groupedBeads = groupByStatus(beads ?? []);

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {COLUMNS.map(column => (
          <Droppable key={column.id} droppableId={column.id}>
            {(provided, snapshot) => (
              <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                className={`flex-shrink-0 w-80 bg-slate-900/50 rounded-xl p-4 border ${
                  snapshot.isDraggingOver ? 'border-blue-500' : 'border-slate-800'
                }`}
              >
                <ColumnHeader column={column} count={groupedBeads[column.id]?.length ?? 0} />
                <div className="space-y-3 mt-4 min-h-[200px]">
                  {groupedBeads[column.id]?.map((bead, index) => (
                    <Draggable key={bead.id} draggableId={bead.id} index={index}>
                      {(provided, snapshot) => (
                        <BeadCard
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          {...provided.dragHandleProps}
                          bead={bead}
                          isDragging={snapshot.isDragging}
                        />
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              </div>
            )}
          </Droppable>
        ))}
      </div>
    </DragDropContext>
  );
}
```

### 13.3 Dependency Graph (Galaxy View)

```tsx
// apps/web/src/components/beads/DependencyGraph.tsx

import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
} from '@xyflow/react';

const nodeTypes = {
  bead: BeadNode,
  bottleneck: BottleneckNode,
  keystone: KeystoneNode,
};

export function DependencyGraph() {
  const { data: insights } = useInsights();
  const { data: beads } = useBeads();

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  useEffect(() => {
    if (!beads || !insights) return;
    const { nodes: layoutNodes, edges: layoutEdges } = buildGalaxyLayout(beads, insights);

    const coloredNodes = layoutNodes.map(node => ({
      ...node,
      type: getNodeType(node.id, insights),
      style: getNodeStyle(node.id, insights),
    }));

    setNodes(coloredNodes);
    setEdges(layoutEdges);
  }, [beads, insights]);

  return (
    <div className="h-[600px] bg-slate-950 rounded-xl border border-slate-800">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
      >
        <Background color="#334155" gap={16} />
        <Controls className="bg-slate-800 border-slate-700" />
        <MiniMap
          nodeColor={node => {
            if (node.type === 'bottleneck') return '#ef4444';
            if (node.type === 'keystone') return '#f59e0b';
            return '#64748b';
          }}
        />
      </ReactFlow>
    </div>
  );
}
```

---

## 14. CASS & Memory System Integration

### 14.1 REST API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/cass/search` | Semantic search |
| `POST` | `/memory/context` | Get context for task |
| `GET` | `/memory/rules` | List memory rules |
| `POST` | `/memory/outcome` | Record outcome |
| `GET` | `/memory/privacy` | Privacy settings |
| `PUT` | `/memory/privacy` | Update privacy settings |

### 14.2 Semantic Search UI Component

```tsx
// apps/web/src/components/memory/SemanticSearch.tsx

import { useState } from 'react';
import { useDebounce } from '@/hooks/useDebounce';
import { SearchIcon, ClockIcon, FileTextIcon } from 'lucide-react';

export function SemanticSearch() {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 300);

  const { data: results, isLoading } = useQuery({
    queryKey: ['cass-search', debouncedQuery],
    queryFn: () => api.cassSearch(debouncedQuery),
    enabled: debouncedQuery.length > 2,
  });

  return (
    <div className="space-y-4">
      <div className="relative">
        <SearchIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search past sessions, code, conversations..."
          className="w-full pl-12 pr-4 py-3 bg-slate-900 border border-slate-700 rounded-xl
                     text-white placeholder-slate-500 focus:border-blue-500 focus:ring-1
                     focus:ring-blue-500 transition-all"
        />
      </div>

      {isLoading ? (
        <SearchSkeleton />
      ) : results?.length > 0 ? (
        <div className="space-y-3">
          {results.map((result, i) => (
            <motion.div
              key={result.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="bg-slate-900 rounded-lg p-4 border border-slate-800"
            >
              <div className="flex items-start gap-3">
                <FileTextIcon className="w-5 h-5 text-slate-400 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-medium text-white truncate">
                    {result.session_name}
                  </h4>
                  <p className="text-xs text-slate-400 mt-1 line-clamp-2">
                    {result.snippet}
                  </p>
                  <div className="flex items-center gap-2 mt-2 text-xs text-slate-500">
                    <ClockIcon className="w-3 h-3" />
                    {formatRelativeTime(result.timestamp)}
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      ) : query.length > 2 ? (
        <EmptyState message="No matching sessions found" />
      ) : null}
    </div>
  );
}
```

---

## 15. UBS Scanner Integration

### 15.1 REST API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/scanner/run` | Run UBS scan |
| `GET` | `/scanner/findings` | List findings |
| `POST` | `/scanner/findings/{id}/dismiss` | Dismiss finding |
| `POST` | `/scanner/findings/{id}/create-bead` | Create bead from finding |
| `GET` | `/scanner/history` | Scan history |

### 15.2 Scanner Dashboard Component

```tsx
// apps/web/src/components/scanner/ScannerDashboard.tsx

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

export function ScannerDashboard() {
  const { data: status } = useScannerStatus();
  const { data: findings } = useScannerFindings();
  const runScan = useRunScan();

  const severityCounts = {
    critical: findings?.filter(f => f.severity === 'critical').length ?? 0,
    high: findings?.filter(f => f.severity === 'high').length ?? 0,
    medium: findings?.filter(f => f.severity === 'medium').length ?? 0,
    low: findings?.filter(f => f.severity === 'low').length ?? 0,
  };

  return (
    <div className="space-y-6">
      <div className="bg-slate-900 rounded-xl p-6 border border-slate-800">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white">Code Health</h2>
            <p className="text-sm text-slate-400 mt-1">
              Last scan: {status?.last_scan ? formatRelativeTime(status.last_scan) : 'Never'}
            </p>
          </div>
          <Button onClick={() => runScan.mutate()}>
            <RefreshCwIcon className="w-4 h-4 mr-2" />
            Scan Now
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SeverityCard severity="critical" count={severityCounts.critical} />
        <SeverityCard severity="high" count={severityCounts.high} />
        <SeverityCard severity="medium" count={severityCounts.medium} />
        <SeverityCard severity="low" count={severityCounts.low} />
      </div>

      <div className="bg-slate-900 rounded-xl p-6 border border-slate-800">
        <h3 className="text-lg font-semibold text-white mb-4">Recent Findings</h3>
        <div className="space-y-3">
          {findings?.slice(0, 10).map(finding => (
            <FindingCard key={finding.id} finding={finding} />
          ))}
        </div>
      </div>
    </div>
  );
}
```

---

## 16. CAAM Account & Profile Management (BYOA + BYOK)

CAAM (Coding Agent Account Manager) is the **account/profile orchestration layer** for Flywheel Gateway. It is designed for **BYOA (Bring Your Own Account)** subscription logins by default, with optional **BYOK (API key)** support for advanced automation use cases.

**Non‑negotiable security invariant:** OAuth credentials are never stored in Gateway’s central database. All auth artifacts live inside each workspace’s isolated environment, managed by CAAM. Gateway only stores **non‑sensitive metadata** (presence, hashes, timestamps, health).

### 16.1 Principles

1. **BYOA first** — subscription accounts (Claude Max, GPT Pro, Gemini) are the default path.
2. **No credential custody** — Gateway never sees Google/Anthropic/OpenAI logins or passwords.
3. **Tenant‑local auth artifacts** — tokens remain inside the workspace container/volume.
4. **Minimum requirement** — at least one verified provider to activate/assign; recommended: 1× Claude Max + 1× GPT Pro.
5. **Provider parity** — Claude, Codex, and Gemini are all supported.
6. **Autonomous rotation** — cooldown + rotation is automated via CAAM.

### 16.2 Account & Profile Data Model

```typescript
// packages/shared/src/types/accounts.ts

type ProviderId = 'claude' | 'codex' | 'gemini';
type AuthMode = 'oauth_browser' | 'device_code' | 'api_key';

interface AccountProfile {
  id: string;
  workspaceId: string;
  provider: ProviderId;
  name: string;               // Profile label (e.g., "work", "alice@gmail.com")
  authMode: AuthMode;

  // Status & health (no secrets)
  status: 'unlinked' | 'linked' | 'verified' | 'expired' | 'cooldown' | 'error';
  statusMessage?: string;
  lastVerifiedAt?: Date;
  expiresAt?: Date;           // If known from token metadata
  cooldownUntil?: Date;
  lastUsedAt?: Date;
  healthScore?: number;       // 0..100

  // Auth artifacts (metadata only)
  artifacts: {
    authFilesPresent: boolean;
    authFileHash?: string;    // hash of auth artifact for change detection
    storageMode?: 'file' | 'keyring' | 'unknown';
  };

  labels?: string[];
  createdAt: Date;
  updatedAt: Date;
}

interface AccountPool {
  id: string;
  workspaceId: string;
  provider: ProviderId;
  profileIds: string[];
  rotationStrategy: 'smart' | 'round_robin' | 'least_recent' | 'random';
  cooldownMinutesDefault: number;
  maxRetries: number;
}

interface TenantAuthState {
  workspaceId: string;
  byoaStatus: 'unlinked' | 'pending' | 'verified' | 'failed';
  verifiedProviders: ProviderId[];
  lastCheckedAt?: Date;
}
```

### 16.3 CAAM Integration Architecture

CAAM runs **inside each workspace container**. Gateway interacts with it via a thin runner interface:

```typescript
// apps/gateway/src/caam/runner.ts

interface LoginChallenge {
  provider: ProviderId;
  mode: 'device_code' | 'oauth_url' | 'local_browser' | 'manual_copy';
  code?: string;              // For device code
  verificationUrl?: string;   // For device code
  loginUrl?: string;          // For browser OAuth
  instructions?: string;      // Human-readable fallback
  expiresInSeconds?: number;
}

interface CaamRunner {
  listProfiles(workspaceId: string): Promise<AccountProfile[]>;
  getStatus(workspaceId: string, provider?: ProviderId): Promise<TenantAuthState>;
  startLogin(workspaceId: string, provider: ProviderId, mode?: AuthMode): Promise<LoginChallenge>;
  completeLogin(workspaceId: string, provider: ProviderId): Promise<{ status: 'linked' | 'failed' }>;
  activateProfile(workspaceId: string, profileId: string): Promise<void>;
  runWithProfile(workspaceId: string, profileId: string, command: string[]): Promise<ExecResult>;
  setCooldown(workspaceId: string, profileId: string, minutes: number, reason?: string): Promise<void>;
}
```

**Notes:**
- CAAM is the source of truth for auth artifacts.
- Gateway records only metadata (status, hashes, timestamps).
- Rotation happens at runtime by selecting the healthiest profile.
- Runner implementation should wrap the `caam` CLI from `/data/projects/coding_agent_account_manager` and keep auth paths aligned with `caam paths` output.
- CAAM enforces Codex file-based storage by writing `cli_auth_credentials_store = "file"` in `config.toml` within the profile's `CODEX_HOME`.

### 16.4 Provider Auth Flows (BYOA)

**Generic BYOA linking flow:**
1. Gateway calls CAAM `startLogin` for the workspace/provider.
2. UI displays device code or OAuth URL to the user.
3. User completes auth on their own machine.
4. CAAM detects new auth artifacts locally and marks profile `verified`.
5. Gateway pulls metadata only (status, hashes, timestamps).

**Codex (GPT Pro)**
- Standard login: `codex login` (local browser flow).
- Device code login: `codex login --device-auth` (headless-friendly).
- Auth cache stored in `~/.codex/auth.json`; CAAM enforces file mode by writing `cli_auth_credentials_store = "file"` in `config.toml`.
- CAAM uses `CODEX_HOME` to isolate profiles per agent.

**Claude Code (Claude Max)**
- Login is initiated in CLI via `/login`.
- Credentials are stored locally by the CLI; file locations can change between releases.
- CAAM detects the **actual** auth artifacts and records hashes.
- API key mode is supported via `~/.claude/settings.json` with `apiKeyHelper`.

**Gemini CLI**
- Settings live in `~/.gemini/settings.json` or project `.gemini/settings.json`.
- Auth modes: Google login, API key, or Vertex AI; `/auth` switches the method.
- Headless containers use API key or Vertex AI (browserless).

**BYOK reference (pi-mono):**
- API key mode uses environment variables like `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`.
- Gateway should map workspace secrets into these env vars when BYOK is enabled.

#### 16.4.1 Auth Artifact Discovery & Normalization

CAAM does **not** hardcode auth file paths as the source of truth. It discovers and normalizes artifacts at runtime and stores **metadata only** (hash + timestamps) in Gateway.

| Provider | Typical Auth Artifacts (Tenant‑local) | Isolation Anchor | Notes |
|----------|----------------------------------------|------------------|-------|
| **Codex** | `~/.codex/auth.json` (or `$CODEX_HOME/auth.json`) | `HOME`, `CODEX_HOME` | CAAM enforces `cli_auth_credentials_store = "file"` in `config.toml`. |
| **Claude** | `~/.claude.json`, `~/.config/claude-code/auth.json`, `~/.claude/settings.json` | `HOME`, `XDG_CONFIG_HOME` | API key mode uses `settings.json` (apiKeyHelper). |
| **Gemini** | `~/.gemini/settings.json` (or project `.gemini/settings.json`), `~/.gemini/.env` | `HOME`, `XDG_CONFIG_HOME` | OAuth or API key mode; settings location is stable. |

**Normalization rules:**
- Track only hashes + modified timestamps (never contents).
- If multiple artifacts exist, prefer the most recently modified set.
- Any auth artifact change invalidates prior health score until re‑verified.

#### 16.4.2 Login Modes (Provider‑Aware)

**Device Code (Codex):**
- CAAM starts device auth and returns a verification URL + code.
- UI shows code, button to open URL, and progress indicator.

**Browser OAuth (Codex default, Gemini):**
- CAAM emits a login URL detected from CLI output.
- User opens URL on their own machine and completes login.

**Slash Command (Claude Code):**
- User runs `/login` in the CLI; CAAM waits for new auth artifacts.

**API Key / ADC (Gemini, Claude):**
- Gemini: set `GEMINI_API_KEY` (or `.gemini/.env`) or use Vertex ADC.
- Claude: apiKeyHelper in `~/.claude/settings.json` (no OAuth artifacts).

**Manual Copy (Codex fallback):**
- User logs in on their own machine.
- Copy `~/.codex/auth.json` into the workspace via a secure upload path.
- CAAM records the hash and marks the profile verified (no cookies stored centrally).

Example response:

```json
{
  "provider": "codex",
  "mode": "device_code",
  "code": "B7QZ-4NJD",
  "verificationUrl": "https://example.com/activate",
  "expiresInSeconds": 900
}
```

#### 16.4.3 BYOA Verification Rules

Verification is **local, artifact‑based**, and avoids network calls by default:

1. Auth artifacts exist and are readable inside the workspace container.
2. CAAM reports `status=verified` for at least one provider.
3. Optional (configurable): passive expiry parsing from token metadata.
4. Optional (configurable): active validation via minimal CLI call (off by default).

#### 16.4.4 Auth Storage Modes & Keyring Policy

Some CLIs can store credentials in a system keyring. This is **not** suitable for workspace‑isolated automation.

**Policy:**
- Enforce file‑based storage inside workspace containers.
- For Codex CLI, set `cli_auth_credentials_store = "file"` in `~/.codex/config.toml` (or `$CODEX_HOME`).
- If keyring storage is detected, CAAM switches to file mode (provider‑specific).
- Gateway stores `storageMode` metadata for visibility.
- API key modes can be valid with optional-only artifacts (e.g., `.claude/settings.json`, `.gemini/.env`).

#### 16.4.5 Account Multiplicity Guidance

Minimum: **1 provider verified**.  
Recommended for steady throughput: **1× Claude Max + 1× GPT Pro**.  
Scale‑up guidance: add additional accounts per provider as concurrency grows (rotation handles rate limits automatically).

### 16.5 REST API Endpoints (BYOA‑aware)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/accounts/byoa-status` | Tenant BYOA readiness (verified providers, status) |
| `GET` | `/accounts/profiles` | List CAAM profiles (metadata only) |
| `POST` | `/accounts/providers/{provider}/login/start` | Start OAuth or device‑code flow |
| `POST` | `/accounts/providers/{provider}/login/complete` | Confirm login completion |
| `POST` | `/accounts/profiles/{id}/activate` | Activate profile for next agent run |
| `POST` | `/accounts/profiles/{id}/cooldown` | Cooldown profile (rate‑limit hit) |
| `POST` | `/accounts/pools/{id}/rotate` | Force rotation to next profile |

### 16.6 Rotation & Rate Limit Handling

Rotation is driven by CAAM health scores and cooldown timers. When a rate‑limit signature is detected in agent output, the system:

1. Marks the current profile in cooldown.
2. Selects the next healthiest profile from the pool.
3. Replays the command (when safe).

```typescript
// apps/gateway/src/caam/rotation.ts

async function handleRateLimit(ctx: RotationContext): Promise<void> {
  await caam.setCooldown(ctx.workspaceId, ctx.profileId, ctx.cooldownMinutes, 'rate_limit');
  const next = await caam.selectNext(ctx.workspaceId, ctx.provider);
  await caam.activateProfile(ctx.workspaceId, next.id);
}
```

### 16.7 Account Management UI

The UI prioritizes **BYOA readiness**:
- Provider cards show number of verified profiles + cooldown status
- One‑click “Link Account” flows (device code or OAuth URL)
- Health indicators and recommended profile for each provider
- Clear warnings when BYOA is insufficient for assignment

### 16.8 BYOA UX Flow (Detailed)

**Onboarding sequence:**
1. User signs up and verifies email.
2. Provisioning request is created (queue).
3. Manual onboarding approval when `onboarding_mode=manual`.
4. Tenant container is provisioned + verified.
5. UI forces **Link Accounts** step (BYOA gate).
6. At least one provider verified → workspace assigned.

**Link Account flow (device code):**
- User selects provider → UI shows verification URL + device code.
- User opens URL on their own machine, enters code, approves.
- UI polls status until CAAM marks profile verified.

**Link Account flow (OAuth URL):**
- UI displays login URL captured from CLI output.
- User opens URL on their own machine, completes login.
- CAAM detects new auth artifacts → profile verified.

**Failure modes:**
- Expired code → UI offers “Restart login”.
- Rate‑limit hit → CAAM cooldown + next profile selection.
- Artifact drift → CAAM marks profile `unlinked`, UI prompts relink.

**UI state model:**

```
NEEDS_ACCOUNTS → LINKING → VERIFIED
      ↘──────── ERROR ─────↗
```

**Provider card content:**
- Status badge: `UNLINKED | LINKING | VERIFIED | COOLDOWN | EXPIRED`
- Primary action: `Link Account`, `Relink`, or `Rotate`
- Secondary actions: `Copy code`, `Open URL`, `Troubleshoot`
- Health hints: “Last verified 2h ago”, “Cooldown 43m remaining”

**Copy & UX details:**
- Device code is shown with a **copy** button and a countdown timer.
- OAuth URL is shown with a **one‑click open** button (opens in new tab).
- “I completed login” button triggers an immediate CAAM recheck.

**UX guardrails:**
- No dismissing the BYOA gate until minimum provider count is met.
- Warning banner recommends adding **Claude Max + GPT Pro** for stability.

---

## 17. SLB Safety Guardrails

SLB (Safety Limits & Bounds) provides configurable safety guardrails for agent operations.

### 17.1 Safety Configuration

```typescript
// packages/shared/src/types/safety.ts

interface SafetyConfig {
  // File System
  fileSystem: {
    allowedPaths: string[];          // Glob patterns for allowed paths
    deniedPaths: string[];           // Glob patterns for denied paths (higher priority)
    maxFileSize: number;             // Max file size for read/write (bytes)
    maxFilesPerOperation: number;    // Max files in bulk operations
    allowDelete: boolean;            // Allow file deletion
    requireDeleteConfirmation: boolean;
  };

  // Git Operations
  git: {
    allowPush: boolean;
    allowForcePush: boolean;
    allowRebase: boolean;
    protectedBranches: string[];     // Branches that can't be modified
    requireReviewForProtected: boolean;
  };

  // Network
  network: {
    allowedHosts: string[];          // Allowed external hosts
    deniedHosts: string[];           // Blocked hosts
    maxRequestsPerMinute: number;
    allowExternalAPIs: boolean;
  };

  // Execution
  execution: {
    allowShellCommands: boolean;
    blockedCommands: string[];       // e.g., 'rm -rf', 'sudo'
    maxExecutionTime: number;        // Per command (ms)
    requireApprovalFor: string[];    // Commands requiring user approval
  };

  // Resource Limits
  resources: {
    maxTokensPerRequest: number;
    maxTokensPerSession: number;
    maxConcurrentAgents: number;
    maxSessionDuration: number;      // ms
  };

  // Content
  content: {
    enableContentFiltering: boolean;
    blockPatterns: string[];         // Regex patterns to block
    redactPatterns: string[];        // Patterns to redact from logs
  };
}

interface SafetyViolation {
  id: string;
  timestamp: Date;
  agentId: string;
  category: 'filesystem' | 'git' | 'network' | 'execution' | 'resource' | 'content';
  severity: 'low' | 'medium' | 'high' | 'critical';
  rule: string;
  description: string;
  attemptedAction: string;
  blocked: boolean;
  requiresReview: boolean;
}
```

### 17.2 Safety Service

```typescript
// apps/gateway/src/services/safety.service.ts

export class SafetyService {
  private config: SafetyConfig;
  private violations: SafetyViolation[] = [];

  async validateFileOperation(
    operation: 'read' | 'write' | 'delete',
    path: string,
    agentId: string
  ): Promise<{ allowed: boolean; reason?: string }> {
    // Check denied paths first (higher priority)
    for (const pattern of this.config.fileSystem.deniedPaths) {
      if (minimatch(path, pattern)) {
        this.recordViolation({
          agentId,
          category: 'filesystem',
          severity: 'high',
          rule: 'denied_path',
          description: `Path matches denied pattern: ${pattern}`,
          attemptedAction: `${operation} ${path}`,
          blocked: true,
        });
        return { allowed: false, reason: `Path is in denied list: ${pattern}` };
      }
    }

    // Check if in allowed paths
    const inAllowed = this.config.fileSystem.allowedPaths.some(
      pattern => minimatch(path, pattern)
    );
    if (!inAllowed) {
      return { allowed: false, reason: 'Path not in allowed list' };
    }

    // Check delete permission
    if (operation === 'delete' && !this.config.fileSystem.allowDelete) {
      this.recordViolation({
        agentId,
        category: 'filesystem',
        severity: 'medium',
        rule: 'delete_disabled',
        description: 'File deletion is disabled',
        attemptedAction: `delete ${path}`,
        blocked: true,
      });
      return { allowed: false, reason: 'File deletion is disabled' };
    }

    return { allowed: true };
  }

  async validateCommand(
    command: string,
    agentId: string
  ): Promise<{ allowed: boolean; requiresApproval: boolean; reason?: string }> {
    if (!this.config.execution.allowShellCommands) {
      return { allowed: false, requiresApproval: false, reason: 'Shell commands disabled' };
    }

    // Check blocked commands
    for (const blocked of this.config.execution.blockedCommands) {
      if (command.includes(blocked)) {
        this.recordViolation({
          agentId,
          category: 'execution',
          severity: 'critical',
          rule: 'blocked_command',
          description: `Command contains blocked pattern: ${blocked}`,
          attemptedAction: command,
          blocked: true,
        });
        return { allowed: false, requiresApproval: false, reason: `Blocked command: ${blocked}` };
      }
    }

    // Check if requires approval
    const requiresApproval = this.config.execution.requireApprovalFor.some(
      pattern => command.includes(pattern)
    );

    return { allowed: true, requiresApproval };
  }

  async getViolations(filters?: {
    agentId?: string;
    category?: string;
    severity?: string;
    since?: Date;
  }): Promise<SafetyViolation[]> {
    let result = this.violations;

    if (filters?.agentId) {
      result = result.filter(v => v.agentId === filters.agentId);
    }
    if (filters?.category) {
      result = result.filter(v => v.category === filters.category);
    }
    if (filters?.severity) {
      result = result.filter(v => v.severity === filters.severity);
    }
    if (filters?.since) {
      result = result.filter(v => v.timestamp >= filters.since);
    }

    return result;
  }
}
```

### 17.3 REST API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/safety/config` | Get current safety config |
| `PUT` | `/safety/config` | Update safety config |
| `GET` | `/safety/violations` | List violations |
| `POST` | `/safety/violations/{id}/review` | Mark violation as reviewed |
| `POST` | `/safety/validate/path` | Validate a file path |
| `POST` | `/safety/validate/command` | Validate a command |
| `GET` | `/safety/report` | Generate safety report |

### 17.4 Approval Queue UI

```tsx
// apps/web/src/components/safety/ApprovalQueue.tsx

export function ApprovalQueue() {
  const { data: pending } = usePendingApprovals();
  const approve = useApproveAction();
  const deny = useDenyAction();

  return (
    <div className="bg-slate-900 rounded-xl border border-slate-800">
      <div className="p-4 border-b border-slate-800 flex items-center gap-3">
        <ShieldAlertIcon className="w-5 h-5 text-amber-500" />
        <h3 className="text-lg font-semibold text-white">Pending Approvals</h3>
        {pending?.length > 0 && (
          <Badge variant="warning">{pending.length}</Badge>
        )}
      </div>

      {pending?.length === 0 ? (
        <div className="p-8 text-center text-slate-500">
          No pending approvals
        </div>
      ) : (
        <div className="divide-y divide-slate-800">
          {pending?.map(item => (
            <div key={item.id} className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <AgentAvatar type={item.agentType} size="sm" />
                    <span className="font-medium text-white">{item.agentName}</span>
                    <Badge variant="secondary" size="sm">{item.category}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-slate-300">{item.description}</p>
                  <pre className="mt-2 p-2 bg-slate-800 rounded text-xs font-mono text-slate-400 overflow-x-auto">
                    {item.attemptedAction}
                  </pre>
                </div>
                <div className="flex gap-2 ml-4">
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => deny.mutate(item.id)}
                  >
                    Deny
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => approve.mutate(item.id)}
                  >
                    Approve
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

---

## 17.5 RU (Repo Updater) Integration

RU provides multi-repository management, AI-assisted code review, and automated agent-sweep capabilities. Gateway integrates with RU to orchestrate work across entire repository fleets.

### 17.5.1 Integration Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     RU ↔ GATEWAY INTEGRATION                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  RU (Bash CLI, ~17,700 LOC)                                                 │
│  ├── ru sync          →  Gateway monitors sync status via WebSocket         │
│  ├── ru review        →  Gateway spawns Claude Code sessions (via ntm)      │
│  ├── ru agent-sweep   →  Gateway orchestrates multi-repo agent workflows    │
│  └── ru status        →  Gateway displays fleet health dashboard            │
│                                                                             │
│  GATEWAY RESPONSIBILITIES:                                                  │
│  ├── Spawn agents for ru review/agent-sweep sessions                        │
│  ├── Track session progress via Agent Mail coordination                     │
│  ├── Display fleet status in web UI                                         │
│  ├── Route agent-sweep plans through approval workflow (SLB integration)    │
│  └── Archive agent-sweep results to CASS for learning                       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 17.5.2 Fleet Management Data Model

```typescript
// packages/shared/src/types/fleet.ts

interface Repository {
  id: string;
  name: string;                    // e.g., "mcp_agent_mail"
  owner: string;                   // e.g., "Dicklesworthstone"
  path: string;                    // Local path: /data/projects/mcp_agent_mail
  branch: string;                  // Current branch
  status: RepoStatus;
  lastSyncAt?: Date;
  lastAgentSweepAt?: Date;
  assignedAgent?: string;          // Agent Mail identity
}

type RepoStatus =
  | 'current'                      // Up to date with remote
  | 'behind'                       // Remote has new commits
  | 'ahead'                        // Local has unpushed commits
  | 'diverged'                     // Both local and remote have new commits
  | 'dirty'                        // Uncommitted changes
  | 'conflict'                     // Merge conflict detected
  | 'syncing'                      // Sync in progress
  | 'sweeping';                    // Agent-sweep in progress

interface AgentSweepRun {
  id: string;
  repositoryId: string;
  status: 'pending' | 'phase1' | 'phase2' | 'phase3' | 'completed' | 'failed';
  phase1Result?: {                 // Deep understanding
    analysisComplete: boolean;
    issuesIdentified: number;
    duration: number;
  };
  phase2Result?: {                 // Plan generation
    commitsPlanned: number;
    releasePlanned: boolean;
    planJson: string;
  };
  phase3Result?: {                 // Execution
    commitsCreated: number;
    releaseCreated?: string;
    pushStatus: 'success' | 'failed' | 'skipped';
  };
  startedAt: Date;
  completedAt?: Date;
  agentId?: string;
  error?: string;
}
```

### 17.5.3 REST API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/fleet/repos` | List all tracked repositories |
| `GET` | `/fleet/repos/{id}` | Get repository details |
| `POST` | `/fleet/sync` | Trigger fleet-wide sync |
| `POST` | `/fleet/repos/{id}/sync` | Sync single repository |
| `GET` | `/fleet/status` | Fleet health summary |
| `POST` | `/fleet/agent-sweep` | Start agent-sweep across repos |
| `GET` | `/fleet/agent-sweep/{id}` | Get agent-sweep run status |
| `POST` | `/fleet/agent-sweep/{id}/approve` | Approve phase 3 execution |
| `GET` | `/fleet/agent-sweep/history` | List past agent-sweep runs |

### 17.5.4 WebSocket Events

```typescript
interface FleetEvent {
  type:
    | 'repo.sync_started'
    | 'repo.sync_completed'
    | 'repo.status_changed'
    | 'sweep.started'
    | 'sweep.phase_changed'
    | 'sweep.completed'
    | 'sweep.approval_required';
  data: {
    repositoryId: string;
    status?: RepoStatus;
    sweepId?: string;
    phase?: number;
  };
}
```

---

## 17.6 DCG (Destructive Command Guard) Integration

DCG is a critical safety layer that mechanically enforces command safety at the execution boundary. Gateway integrates DCG to provide visibility into blocked commands and manage allowlisting.

### 17.6.1 Integration Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     DCG ↔ GATEWAY INTEGRATION                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  DCG (Rust binary, <1ms latency)                                            │
│  ├── PreToolUse Hook  →  Intercepts Bash commands before execution          │
│  ├── Pack System      →  Modular pattern groups (git, db, k8s, cloud)       │
│  ├── Context Analysis →  Distinguishes code from data strings               │
│  └── Severity Tiers   →  Critical/High/Medium/Low classification            │
│                                                                             │
│  GATEWAY RESPONSIBILITIES:                                                  │
│  ├── Display DCG blocks in agent output stream (annotated)                  │
│  ├── Aggregate block statistics per agent/model/pack                        │
│  ├── Manage per-project/per-agent allowlists via UI                         │
│  ├── Route High-severity blocks to approval queue (SLB integration)         │
│  └── Feed block patterns to CM for learning (false positive reduction)      │
│                                                                             │
│  DCG → SLB INTEGRATION:                                                     │
│  ├── Critical blocks  →  Always denied, logged to audit trail               │
│  ├── High blocks      →  Can be allowlisted by rule ID via Gateway UI       │
│  ├── Medium blocks    →  Warnings displayed, execution allowed              │
│  └── Low blocks       →  Logged only, useful for pattern learning           │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 17.6.2 Block Event Data Model

```typescript
// packages/shared/src/types/dcg.ts

interface DCGBlockEvent {
  id: string;
  timestamp: Date;
  agentId: string;
  command: string;                 // The blocked command
  pack: string;                    // e.g., "core.git", "database.postgresql"
  pattern: string;                 // The pattern that matched
  ruleId: string;                  // Unique rule identifier for allowlisting
  severity: 'critical' | 'high' | 'medium' | 'low';
  reason: string;                  // Human-readable explanation
  contextClassification: 'executed' | 'data' | 'ambiguous';
  falsePositive?: boolean;         // User feedback
  allowlisted?: boolean;           // If this rule was later allowlisted
}

interface DCGConfig {
  enabledPacks: string[];          // e.g., ["core.git", "database.postgresql"]
  disabledPacks: string[];
  allowlist: DCGAllowlistEntry[];
  blockHistory: DCGBlockEvent[];
}

interface DCGAllowlistEntry {
  ruleId: string;
  pattern: string;
  addedAt: Date;
  addedBy: string;                 // User or agent who added
  reason: string;
  expiresAt?: Date;                // Optional expiration
  condition?: string;              // e.g., "CI=true"
}

interface DCGStats {
  totalBlocks: number;
  blocksByPack: Record<string, number>;
  blocksBySeverity: Record<string, number>;
  falsePositiveRate: number;
  topBlockedCommands: Array<{ command: string; count: number }>;
}
```

### 17.6.3 REST API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/dcg/config` | Get DCG configuration |
| `PUT` | `/dcg/config` | Update DCG configuration |
| `GET` | `/dcg/packs` | List available packs |
| `POST` | `/dcg/packs/{pack}/enable` | Enable a pack |
| `POST` | `/dcg/packs/{pack}/disable` | Disable a pack |
| `GET` | `/dcg/blocks` | List block history |
| `POST` | `/dcg/blocks/{id}/false-positive` | Mark as false positive |
| `GET` | `/dcg/allowlist` | List allowlist entries |
| `POST` | `/dcg/allowlist` | Add allowlist entry |
| `DELETE` | `/dcg/allowlist/{ruleId}` | Remove allowlist entry |
| `GET` | `/dcg/stats` | Get block statistics |

### 17.6.4 WebSocket Events

```typescript
interface DCGEvent {
  type: 'dcg.block' | 'dcg.warn' | 'dcg.allowlist_added' | 'dcg.false_positive';
  data: DCGBlockEvent | DCGAllowlistEntry;
}
```

### 17.6.5 DCG Dashboard Component

```tsx
// apps/web/src/components/safety/DCGDashboard.tsx

export function DCGDashboard() {
  const { data: stats } = useDCGStats();
  const { data: recentBlocks } = useDCGBlocks({ limit: 20 });
  const markFalsePositive = useMarkFalsePositive();
  const addAllowlist = useAddAllowlist();

  return (
    <div className="space-y-6">
      {/* Stats Overview */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          title="Total Blocks"
          value={stats?.totalBlocks}
          icon={<ShieldIcon />}
        />
        <StatCard
          title="False Positive Rate"
          value={`${(stats?.falsePositiveRate * 100).toFixed(1)}%`}
          trend={stats?.falsePositiveRate < 0.05 ? 'good' : 'warning'}
        />
        <StatCard
          title="Packs Enabled"
          value={stats?.enabledPacks?.length}
        />
        <StatCard
          title="Allowlist Rules"
          value={stats?.allowlistCount}
        />
      </div>

      {/* Blocks by Pack */}
      <div className="bg-slate-900 rounded-xl p-6 border border-slate-800">
        <h3 className="text-lg font-semibold text-white mb-4">Blocks by Pack</h3>
        <BarChart data={Object.entries(stats?.blocksByPack || {})} />
      </div>

      {/* Recent Blocks */}
      <div className="bg-slate-900 rounded-xl border border-slate-800">
        <div className="p-4 border-b border-slate-800">
          <h3 className="text-lg font-semibold text-white">Recent Blocks</h3>
        </div>
        <div className="divide-y divide-slate-800">
          {recentBlocks?.map(block => (
            <div key={block.id} className="p-4 flex items-start justify-between">
              <div>
                <code className="text-sm text-red-400 bg-slate-800 px-2 py-1 rounded">
                  {block.command}
                </code>
                <p className="text-sm text-slate-400 mt-1">{block.reason}</p>
                <div className="flex items-center gap-2 mt-2">
                  <Badge variant={severityVariant(block.severity)}>
                    {block.severity}
                  </Badge>
                  <span className="text-xs text-slate-500">{block.pack}</span>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => markFalsePositive.mutate(block.id)}
                >
                  False Positive
                </Button>
                {block.severity !== 'critical' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => addAllowlist.mutate({ ruleId: block.ruleId })}
                  >
                    Allowlist
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

---

## 17.7 Developer Utilities Integration

Gateway provides auto-installation and configuration for developer utilities that enhance AI agent workflows.

### 17.7.1 Utility Management

```typescript
// packages/shared/src/types/utilities.ts

interface DeveloperUtility {
  name: string;                    // e.g., "giil", "csctf"
  description: string;
  version: string;
  installCommand: string;          // One-liner install
  checkCommand: string;            // Command to verify installation
  installed: boolean;
  installedVersion?: string;
  lastCheckedAt?: Date;
}

const UTILITIES: DeveloperUtility[] = [
  {
    name: 'giil',
    description: 'Download cloud photos for AI visual analysis',
    version: '3.1.0',
    installCommand: 'curl -fsSL https://raw.githubusercontent.com/Dicklesworthstone/giil/main/install.sh | bash',
    checkCommand: 'giil --version',
  },
  {
    name: 'csctf',
    description: 'Convert AI chat share links to Markdown/HTML',
    version: '0.4.5',
    installCommand: 'curl -fsSL https://raw.githubusercontent.com/Dicklesworthstone/chat_shared_conversation_to_file/main/install.sh | bash',
    checkCommand: 'csctf --version',
  },
];
```

### 17.7.2 REST API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/utilities` | List all utilities with install status |
| `POST` | `/utilities/{name}/install` | Install a utility |
| `POST` | `/utilities/{name}/update` | Update a utility |
| `GET` | `/utilities/doctor` | Check all utilities health |

### 17.7.3 giil Integration

giil enables agents to analyze screenshots shared via cloud links:

```typescript
// Gateway can invoke giil for agents
interface GiilRequest {
  url: string;                     // iCloud/Dropbox/Google share URL
  outputDir?: string;
  format?: 'file' | 'json' | 'base64';
}

interface GiilResponse {
  success: boolean;
  path?: string;
  width?: number;
  height?: number;
  captureMethod?: 'download' | 'cdn' | 'element' | 'viewport';
  error?: string;
}
```

### 17.7.4 csctf Integration

csctf enables archiving AI conversations for knowledge management:

```typescript
// Gateway can invoke csctf for conversation archival
interface CsctfRequest {
  url: string;                     // ChatGPT/Gemini/Grok/Claude share URL
  outputDir?: string;
  formats?: ('md' | 'html')[];
  publishToGhPages?: boolean;
}

interface CsctfResponse {
  success: boolean;
  markdownPath?: string;
  htmlPath?: string;
  title?: string;
  messageCount?: number;
  error?: string;
}
```

---

## 18. Git Coordination

Git coordination ensures multiple agents can work on the same repository without conflicts.

### 18.1 REST API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/git/status` | Repository git status |
| `GET` | `/git/branches` | List branches with agent assignments |
| `POST` | `/git/branches` | Create branch |
| `DELETE` | `/git/branches/{name}` | Delete branch |
| `POST` | `/git/sync` | Sync with remote |
| `POST` | `/git/commit` | Create commit |
| `POST` | `/git/push` | Push to remote |
| `POST` | `/git/pull` | Pull from remote |
| `GET` | `/git/conflicts` | Detect potential merge conflicts |
| `POST` | `/git/stash` | Stash changes |
| `POST` | `/git/stash/pop` | Pop stash |
| `GET` | `/git/diff` | Get current diff |
| `GET` | `/git/log` | Get commit log |

### 18.2 Branch Assignment Tracking

```typescript
// apps/gateway/src/services/git.service.ts

interface BranchAssignment {
  branch: string;
  agentId: string;
  agentName: string;
  assignedAt: Date;
  purpose?: string;
}

export class GitService {
  private assignments = new Map<string, BranchAssignment>();

  async assignBranch(
    branch: string,
    agentId: string,
    purpose?: string
  ): Promise<void> {
    const existing = this.assignments.get(branch);
    if (existing && existing.agentId !== agentId) {
      throw new Error(
        `Branch ${branch} is already assigned to agent ${existing.agentName}`
      );
    }

    this.assignments.set(branch, {
      branch,
      agentId,
      agentName: await this.getAgentName(agentId),
      assignedAt: new Date(),
      purpose,
    });
  }

  async detectPotentialConflicts(): Promise<ConflictPrediction[]> {
    const predictions: ConflictPrediction[] = [];
    const branches = await this.listBranches();

    for (const branch of branches) {
      if (branch.name === 'main' || branch.name === 'master') continue;

      const mergeBase = await this.getMergeBase(branch.name, 'main');
      const branchChanges = await this.getChangedFiles(mergeBase, branch.name);
      const mainChanges = await this.getChangedFiles(mergeBase, 'main');

      const overlapping = branchChanges.filter(f => mainChanges.includes(f));
      if (overlapping.length > 0) {
        predictions.push({
          branch: branch.name,
          targetBranch: 'main',
          conflictingFiles: overlapping,
          probability: this.calculateConflictProbability(overlapping),
          assignedAgent: this.assignments.get(branch.name),
        });
      }
    }

    return predictions;
  }

  async createCommit(
    message: string,
    options?: { author?: string; allowEmpty?: boolean }
  ): Promise<string> {
    const args = ['commit', '-m', message];
    if (options?.allowEmpty) args.push('--allow-empty');
    if (options?.author) args.push('--author', options.author);

    const result = await this.exec(args);
    return this.parseCommitHash(result.stdout);
  }
}
```

### 18.3 Git Visualization Component

```tsx
// apps/web/src/components/git/GitBranchViewer.tsx

export function GitBranchViewer() {
  const { data: branches } = useGitBranches();
  const { data: conflicts } = useConflictPredictions();

  return (
    <div className="bg-slate-900 rounded-xl border border-slate-800 p-6">
      <h3 className="text-lg font-semibold text-white mb-4">Branch Activity</h3>

      <div className="space-y-3">
        {branches?.map(branch => {
          const conflict = conflicts?.find(c => c.branch === branch.name);
          const assignment = branch.assignment;

          return (
            <div
              key={branch.name}
              className={`p-3 rounded-lg border ${
                conflict
                  ? 'border-amber-500/50 bg-amber-500/10'
                  : 'border-slate-700 bg-slate-800/50'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <GitBranchIcon className="w-4 h-4 text-slate-400" />
                  <span className="font-mono text-sm text-white">
                    {branch.name}
                  </span>
                  {branch.current && (
                    <Badge variant="secondary" size="sm">current</Badge>
                  )}
                </div>

                {assignment && (
                  <div className="flex items-center gap-2">
                    <AgentAvatar type={assignment.agentType} size="sm" />
                    <span className="text-sm text-slate-400">
                      {assignment.agentName}
                    </span>
                  </div>
                )}
              </div>

              {conflict && (
                <div className="mt-2 text-sm text-amber-400 flex items-center gap-2">
                  <AlertTriangleIcon className="w-4 h-4" />
                  Potential conflicts in {conflict.conflictingFiles.length} files
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

---

## 19. History & Output System

The History & Output System provides comprehensive tracking of agent activity, prompt history, and rich output interaction.

### 19.1 History Data Model

```typescript
// packages/shared/src/types/history.ts

interface HistoryEntry {
  id: string;
  agentId: string;
  agentType: 'claude' | 'codex' | 'gemini';
  timestamp: Date;

  // Input
  prompt: string;
  contextPackId?: string;

  // Output
  responseSummary: string;
  responseTokens: number;
  promptTokens: number;
  duration: number;  // ms

  // Outcome
  outcome: 'success' | 'failure' | 'interrupted' | 'timeout';
  error?: string;

  // Metadata
  tags: string[];
  starred: boolean;
  replayCount: number;
}

interface OutputSnapshot {
  agentId: string;
  timestamp: Date;
  lines: string[];
  ansiSupported: boolean;
  checksum: string;
}
```

### 19.2 History REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/history` | List history entries |
| `GET` | `/history/{id}` | Get entry details |
| `GET` | `/history/search` | Search history |
| `GET` | `/history/stats` | Usage statistics |
| `POST` | `/history/{id}/replay` | Replay prompt to agent |
| `POST` | `/history/{id}/star` | Star/unstar entry |
| `POST` | `/history/export` | Export history |
| `DELETE` | `/history/prune` | Prune old entries |

### 19.3 Output Interaction Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/agents/{id}/output/copy` | Copy to clipboard |
| `POST` | `/agents/{id}/output/save` | Save to file |
| `POST` | `/agents/{id}/output/grep` | Search output |
| `POST` | `/agents/{id}/output/extract` | Extract structured content |
| `GET` | `/agents/{id}/output/diff/{otherId}` | Diff with another agent |
| `POST` | `/agents/{id}/output/share` | Create shareable link |
| `GET` | `/agents/{id}/output/changes` | Detect file changes |
| `GET` | `/agents/{id}/output/summary` | AI-generated summary |

### 19.4 Output Extraction

```typescript
// apps/gateway/src/services/output.service.ts

interface ExtractionRequest {
  agentId: string;
  type: 'code_blocks' | 'json' | 'file_paths' | 'urls' | 'errors' | 'custom';
  customPattern?: string;
  language?: string;
}

interface ExtractionResult {
  matches: Array<{
    content: string;
    lineStart: number;
    lineEnd: number;
    metadata?: Record<string, unknown>;
  }>;
  totalMatches: number;
}

export class OutputService {
  async extract(request: ExtractionRequest): Promise<ExtractionResult> {
    const output = await this.getAgentOutput(request.agentId);
    const lines = output.split('\n');

    switch (request.type) {
      case 'code_blocks':
        return this.extractCodeBlocks(lines, request.language);
      case 'json':
        return this.extractJson(lines);
      case 'file_paths':
        return this.extractFilePaths(lines);
      case 'urls':
        return this.extractUrls(lines);
      case 'errors':
        return this.extractErrors(lines);
      case 'custom':
        return this.extractCustom(lines, request.customPattern!);
    }
  }

  private extractCodeBlocks(
    lines: string[],
    language?: string
  ): ExtractionResult {
    const matches: ExtractionResult['matches'] = [];
    let inBlock = false;
    let blockStart = 0;
    let blockContent: string[] = [];
    let blockLang = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('```') && !inBlock) {
        inBlock = true;
        blockStart = i;
        blockLang = line.slice(3).trim();
        blockContent = [];
      } else if (line === '```' && inBlock) {
        if (!language || blockLang === language) {
          matches.push({
            content: blockContent.join('\n'),
            lineStart: blockStart,
            lineEnd: i,
            metadata: { language: blockLang },
          });
        }
        inBlock = false;
      } else if (inBlock) {
        blockContent.push(line);
      }
    }

    return { matches, totalMatches: matches.length };
  }
}
```

### 19.5 History Browser Component

```tsx
// apps/web/src/components/history/HistoryBrowser.tsx

export function HistoryBrowser() {
  const [filters, setFilters] = useState<HistoryFilters>({});
  const { data: history, isLoading } = useHistory(filters);
  const replay = useReplayPrompt();

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="bg-slate-900 rounded-xl p-4 border border-slate-800">
        <div className="flex flex-wrap gap-4">
          <Select
            value={filters.agentType}
            onChange={(v) => setFilters(f => ({ ...f, agentType: v }))}
            options={[
              { value: '', label: 'All Agents' },
              { value: 'claude', label: 'Claude' },
              { value: 'codex', label: 'Codex' },
              { value: 'gemini', label: 'Gemini' },
            ]}
          />
          <Select
            value={filters.outcome}
            onChange={(v) => setFilters(f => ({ ...f, outcome: v }))}
            options={[
              { value: '', label: 'All Outcomes' },
              { value: 'success', label: 'Success' },
              { value: 'failure', label: 'Failure' },
              { value: 'interrupted', label: 'Interrupted' },
            ]}
          />
          <Input
            type="search"
            placeholder="Search prompts..."
            value={filters.query}
            onChange={(e) => setFilters(f => ({ ...f, query: e.target.value }))}
          />
          <Toggle
            label="Starred only"
            checked={filters.starred}
            onChange={(v) => setFilters(f => ({ ...f, starred: v }))}
          />
        </div>
      </div>

      {/* Timeline */}
      <div className="space-y-4">
        {history?.map((entry, index) => (
          <motion.div
            key={entry.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            className="bg-slate-900 rounded-xl p-4 border border-slate-800"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <AgentAvatar type={entry.agentType} />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-white">
                      {entry.agentType}
                    </span>
                    <OutcomeBadge outcome={entry.outcome} />
                  </div>
                  <span className="text-sm text-slate-400">
                    {formatRelativeTime(entry.timestamp)}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => toggleStar(entry.id)}
                >
                  {entry.starred ? (
                    <StarFilledIcon className="w-4 h-4 text-amber-400" />
                  ) : (
                    <StarIcon className="w-4 h-4" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => replay.mutate(entry.id)}
                >
                  <PlayIcon className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <p className="mt-3 text-sm text-slate-300 line-clamp-2">
              {entry.prompt}
            </p>

            <div className="mt-3 flex items-center gap-4 text-xs text-slate-500">
              <span>{entry.promptTokens + entry.responseTokens} tokens</span>
              <span>{entry.duration}ms</span>
              {entry.replayCount > 0 && (
                <span>Replayed {entry.replayCount}x</span>
              )}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
```

---

## 20. Pipeline & Workflow Engine

The Pipeline Engine enables multi-step, multi-agent workflows with conditional logic and parallel execution.

### 20.1 Pipeline Data Model

```typescript
// packages/shared/src/types/pipeline.ts

interface Pipeline {
  id: string;
  name: string;
  description?: string;
  version: number;

  // Pipeline definition
  steps: PipelineStep[];
  variables: Record<string, PipelineVariable>;
  triggers?: PipelineTrigger[];

  // Metadata
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  tags: string[];
}

type PipelineStep =
  | AgentStep
  | ParallelStep
  | ConditionalStep
  | LoopStep
  | WaitStep
  | ApprovalStep;

interface AgentStep {
  type: 'agent';
  id: string;
  name: string;
  agentConfig: {
    model: 'claude' | 'codex' | 'gemini';
    driver?: 'sdk' | 'acp' | 'tmux';
    prompt: string;  // Can include ${variable} references
    contextPackConfig?: ContextPackConfig;
  };
  timeout?: number;
  retries?: number;
  onSuccess?: string;  // Step ID to jump to
  onFailure?: string;  // Step ID to jump to
}

interface ParallelStep {
  type: 'parallel';
  id: string;
  name: string;
  branches: PipelineStep[][];
  joinMode: 'all' | 'any' | 'first';  // Wait for all, any, or first
}

interface ConditionalStep {
  type: 'conditional';
  id: string;
  name: string;
  condition: string;  // JavaScript expression
  ifTrue: PipelineStep[];
  ifFalse?: PipelineStep[];
}

interface LoopStep {
  type: 'loop';
  id: string;
  name: string;
  items: string;  // Variable name or expression
  body: PipelineStep[];
  maxIterations?: number;
}

interface WaitStep {
  type: 'wait';
  id: string;
  name: string;
  duration?: number;
  until?: string;  // Expression that must become true
  timeout?: number;
}

interface ApprovalStep {
  type: 'approval';
  id: string;
  name: string;
  message: string;
  approvers?: string[];
  timeout?: number;
  autoApprove?: boolean;  // For testing
}

interface PipelineRun {
  id: string;
  pipelineId: string;
  pipelineVersion: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt?: Date;
  completedAt?: Date;
  currentStepId?: string;
  variables: Record<string, unknown>;
  stepResults: Record<string, StepResult>;
  error?: string;
}

interface StepResult {
  stepId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startedAt?: Date;
  completedAt?: Date;
  output?: unknown;
  error?: string;
  agentId?: string;  // For agent steps
}
```

### 20.2 Pipeline REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/pipelines` | List pipelines |
| `POST` | `/pipelines` | Create pipeline |
| `GET` | `/pipelines/{id}` | Get pipeline |
| `PUT` | `/pipelines/{id}` | Update pipeline |
| `DELETE` | `/pipelines/{id}` | Delete pipeline |
| `POST` | `/pipelines/{id}/run` | Start pipeline run |
| `GET` | `/pipelines/{id}/runs` | List runs |
| `GET` | `/pipelines/runs/{runId}` | Get run status |
| `POST` | `/pipelines/runs/{runId}/cancel` | Cancel run |
| `POST` | `/pipelines/runs/{runId}/approve/{stepId}` | Approve step |
| `GET` | `/pipelines/runs/{runId}/logs` | Get run logs |

### 20.3 Pipeline Executor

```typescript
// apps/gateway/src/services/pipeline.service.ts

export class PipelineService {
  async executeRun(run: PipelineRun): Promise<void> {
    const pipeline = await this.getPipeline(run.pipelineId);

    for (const step of pipeline.steps) {
      if (run.status === 'cancelled') break;

      try {
        await this.executeStep(run, step);
      } catch (error) {
        run.status = 'failed';
        run.error = error.message;
        await this.updateRun(run);
        throw error;
      }
    }

    run.status = 'completed';
    run.completedAt = new Date();
    await this.updateRun(run);
  }

  private async executeStep(run: PipelineRun, step: PipelineStep): Promise<void> {
    const result: StepResult = {
      stepId: step.id,
      status: 'running',
      startedAt: new Date(),
    };
    run.stepResults[step.id] = result;
    run.currentStepId = step.id;
    await this.updateRun(run);

    try {
      switch (step.type) {
        case 'agent':
          await this.executeAgentStep(run, step, result);
          break;
        case 'parallel':
          await this.executeParallelStep(run, step, result);
          break;
        case 'conditional':
          await this.executeConditionalStep(run, step, result);
          break;
        case 'loop':
          await this.executeLoopStep(run, step, result);
          break;
        case 'wait':
          await this.executeWaitStep(run, step, result);
          break;
        case 'approval':
          await this.executeApprovalStep(run, step, result);
          break;
      }
      result.status = 'completed';
      result.completedAt = new Date();
    } catch (error) {
      result.status = 'failed';
      result.error = error.message;
      result.completedAt = new Date();
      throw error;
    }

    await this.updateRun(run);
  }

  private async executeParallelStep(
    run: PipelineRun,
    step: ParallelStep,
    result: StepResult
  ): Promise<void> {
    const branchPromises = step.branches.map(async (branch, index) => {
      for (const branchStep of branch) {
        await this.executeStep(run, branchStep);
      }
      return index;
    });

    switch (step.joinMode) {
      case 'all':
        await Promise.all(branchPromises);
        break;
      case 'any':
        await Promise.any(branchPromises);
        break;
      case 'first':
        await Promise.race(branchPromises);
        break;
    }
  }
}
```

### 20.4 Pipeline Designer Component

```tsx
// apps/web/src/components/pipelines/PipelineDesigner.tsx

export function PipelineDesigner() {
  const [pipeline, setPipeline] = useState<Pipeline>(createEmptyPipeline());
  const [selectedStep, setSelectedStep] = useState<string | null>(null);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full">
      {/* Step Palette */}
      <div className="bg-slate-900 rounded-xl border border-slate-800 p-4">
        <h3 className="text-lg font-semibold text-white mb-4">Steps</h3>
        <div className="space-y-2">
          {STEP_TYPES.map(type => (
            <DraggableStep key={type.id} type={type} />
          ))}
        </div>
      </div>

      {/* Canvas */}
      <div className="lg:col-span-2 bg-slate-900 rounded-xl border border-slate-800 p-4">
        <div className="h-full min-h-[500px]">
          <PipelineCanvas
            steps={pipeline.steps}
            onStepsChange={(steps) => setPipeline(p => ({ ...p, steps }))}
            selectedStep={selectedStep}
            onSelectStep={setSelectedStep}
          />
        </div>
      </div>

      {/* Step Properties */}
      {selectedStep && (
        <StepPropertiesPanel
          step={findStep(pipeline.steps, selectedStep)}
          onChange={(updated) => updateStep(pipeline, selectedStep, updated)}
          onClose={() => setSelectedStep(null)}
        />
      )}
    </div>
  );
}

function PipelineCanvas({
  steps,
  onStepsChange,
  selectedStep,
  onSelectStep,
}: PipelineCanvasProps) {
  return (
    <div className="relative h-full">
      {steps.map((step, index) => (
        <motion.div
          key={step.id}
          layout
          className={`p-4 mb-2 rounded-lg cursor-pointer ${
            selectedStep === step.id
              ? 'ring-2 ring-blue-500 bg-slate-800'
              : 'bg-slate-800/50 hover:bg-slate-800'
          }`}
          onClick={() => onSelectStep(step.id)}
        >
          <div className="flex items-center gap-3">
            <StepIcon type={step.type} />
            <div>
              <span className="font-medium text-white">{step.name}</span>
              <span className="text-sm text-slate-400 ml-2">{step.type}</span>
            </div>
          </div>
        </motion.div>
      ))}

      <DropZone
        onDrop={(type) => {
          const newStep = createStep(type);
          onStepsChange([...steps, newStep]);
        }}
      />
    </div>
  );
}
```

---

## 21. Metrics & Alert System

Comprehensive monitoring with configurable alerts for proactive issue detection. Prometheus remains the **authoritative** source for real-time alerting and SLOs; ClickHouse is used for long-term analytics and historical aggregation (audit, usage, and event logs).

### 21.1 Metrics Data Model

```typescript
// packages/shared/src/types/metrics.ts

interface MetricSnapshot {
  timestamp: Date;

  // Agent metrics
  agents: {
    total: number;
    byStatus: Record<string, number>;
    byType: Record<string, number>;
  };

  // Token usage
  tokens: {
    last24h: number;
    last7d: number;
    last30d: number;
    byModel: Record<string, number>;
    trend: 'up' | 'down' | 'stable';
    trendPercent: number;
  };

  // Performance
  performance: {
    avgResponseMs: number;
    p50ResponseMs: number;
    p95ResponseMs: number;
    p99ResponseMs: number;
    successRate: number;
  };

  // Flywheel metrics
  flywheel: {
    beadsOpen: number;
    beadsClosed24h: number;
    conflictsDetected: number;
    conflictsResolved: number;
    reservationsActive: number;
    messagesExchanged24h: number;
  };

  // System metrics
  system: {
    wsConnections: number;
    apiLatencyMs: number;
    daemonsHealthy: number;
    daemonsTotal: number;
    memoryUsageMb: number;
    cpuPercent: number;
  };
}
```

### 21.2 Alert Configuration

```typescript
// packages/shared/src/types/alerts.ts

type AlertSeverity = 'info' | 'warning' | 'error' | 'critical';

interface Alert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  message: string;
  source: string;
  createdAt: Date;
  expiresAt?: Date;
  acknowledged: boolean;
  acknowledgedAt?: Date;
  acknowledgedBy?: string;
  actions?: AlertAction[];
  metadata?: Record<string, unknown>;
}

type AlertType =
  | 'agent_error'
  | 'agent_stalled'
  | 'conflict_detected'
  | 'reservation_expired'
  | 'daemon_failed'
  | 'quota_warning'
  | 'quota_exceeded'
  | 'approval_required'
  | 'security_violation'
  | 'system_health';

interface AlertRule {
  name: string;
  enabled: boolean;
  condition: (context: AlertContext) => boolean;
  severity: AlertSeverity;
  title: string | ((context: AlertContext) => string);
  message: string | ((context: AlertContext) => string);
  cooldown?: number;  // Minimum time between alerts
  actions?: AlertAction[];
}

const DEFAULT_ALERT_RULES: AlertRule[] = [
  {
    name: 'agent_stalled',
    enabled: true,
    condition: (ctx) => {
      const lastActivity = ctx.agent?.lastActivityAt;
      return lastActivity && Date.now() - lastActivity.getTime() > 5 * 60 * 1000;
    },
    severity: 'warning',
    title: 'Agent Stalled',
    message: (ctx) => `Agent ${ctx.agent?.name} hasn't produced output in 5 minutes`,
    cooldown: 10 * 60 * 1000,
    actions: [
      { label: 'Interrupt', action: 'interrupt_agent' },
      { label: 'View Output', action: 'view_agent_output' },
    ],
  },
  {
    name: 'quota_warning',
    enabled: true,
    condition: (ctx) => {
      const usage = ctx.account?.quotaUsed ?? 0;
      const limit = ctx.account?.quotaLimit ?? Infinity;
      return usage / limit > 0.8;
    },
    severity: 'warning',
    title: 'Quota Warning',
    message: (ctx) => `Account ${ctx.account?.name} is at ${Math.round((ctx.account!.quotaUsed / ctx.account!.quotaLimit!) * 100)}% quota`,
    actions: [
      { label: 'Rotate Account', action: 'rotate_account' },
    ],
  },
  {
    name: 'daemon_failed',
    enabled: true,
    condition: (ctx) => ctx.daemon?.status === 'failed',
    severity: 'critical',
    title: 'Daemon Failed',
    message: (ctx) => `Daemon ${ctx.daemon?.name} has failed: ${ctx.daemon?.lastError}`,
    actions: [
      { label: 'Restart', action: 'restart_daemon' },
      { label: 'View Logs', action: 'view_daemon_logs' },
    ],
  },
];
```

### 21.3 Metrics & Alerts REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/metrics` | Current metrics snapshot |
| `GET` | `/metrics/history` | Historical metrics |
| `GET` | `/metrics/compare` | Compare time periods |
| `POST` | `/metrics/snapshot` | Create named snapshot |
| `GET` | `/metrics/snapshots` | List snapshots |
| `POST` | `/metrics/export` | Export metrics data |
| `GET` | `/alerts` | List active alerts |
| `GET` | `/alerts/history` | Alert history |
| `POST` | `/alerts/{id}/acknowledge` | Acknowledge alert |
| `POST` | `/alerts/{id}/dismiss` | Dismiss alert |
| `POST` | `/alerts/{id}/action` | Execute alert action |
| `GET` | `/alerts/rules` | List alert rules |
| `PUT` | `/alerts/rules` | Update alert rules |

### 21.4 Metrics Dashboard Component

```tsx
// apps/web/src/components/analytics/MetricsDashboard.tsx

export function MetricsDashboard() {
  const { data: metrics } = useMetrics();
  const { data: history } = useMetricsHistory({ days: 30 });

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Total Tokens (24h)"
          value={formatNumber(metrics?.tokens.last24h)}
          trend={metrics?.tokens.trend}
          trendPercent={metrics?.tokens.trendPercent}
          icon={<CoinsIcon />}
        />
        <MetricCard
          label="Agents Active"
          value={metrics?.agents.total}
          icon={<UsersIcon />}
        />
        <MetricCard
          label="Beads Closed"
          value={metrics?.flywheel.beadsClosed24h}
          icon={<CheckCircleIcon />}
        />
        <MetricCard
          label="Avg Response"
          value={`${metrics?.performance.avgResponseMs}ms`}
          icon={<ClockIcon />}
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Token Usage Chart */}
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-800">
          <h3 className="text-lg font-semibold text-white mb-4">Token Usage</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history?.tokenUsage}>
                <defs>
                  <linearGradient id="tokenGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="date" stroke="#64748b" />
                <YAxis stroke="#64748b" />
                <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155' }} />
                <Area
                  type="monotone"
                  dataKey="tokens"
                  stroke="#3b82f6"
                  fill="url(#tokenGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Response Time Chart */}
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-800">
          <h3 className="text-lg font-semibold text-white mb-4">Response Time</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history?.responseTimes}>
                <XAxis dataKey="date" stroke="#64748b" />
                <YAxis stroke="#64748b" />
                <Tooltip />
                <Line type="monotone" dataKey="p50" stroke="#22c55e" name="P50" />
                <Line type="monotone" dataKey="p95" stroke="#f59e0b" name="P95" />
                <Line type="monotone" dataKey="p99" stroke="#ef4444" name="P99" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Active Alerts */}
      <AlertsPanel />
    </div>
  );
}

function AlertsPanel() {
  const { data: alerts } = useAlerts();
  const acknowledge = useAcknowledgeAlert();

  const activeAlerts = alerts?.filter(a => !a.acknowledged) ?? [];

  if (activeAlerts.length === 0) {
    return null;
  }

  return (
    <div className="bg-slate-900 rounded-xl border border-slate-800">
      <div className="p-4 border-b border-slate-800 flex items-center gap-3">
        <BellIcon className="w-5 h-5 text-amber-500" />
        <h3 className="text-lg font-semibold text-white">Active Alerts</h3>
        <Badge variant="warning">{activeAlerts.length}</Badge>
      </div>

      <div className="divide-y divide-slate-800">
        {activeAlerts.map(alert => (
          <div key={alert.id} className="p-4 flex items-start justify-between">
            <div className="flex items-start gap-3">
              <AlertSeverityIcon severity={alert.severity} />
              <div>
                <h4 className="font-medium text-white">{alert.title}</h4>
                <p className="text-sm text-slate-400 mt-1">{alert.message}</p>
                <span className="text-xs text-slate-500 mt-2 block">
                  {formatRelativeTime(alert.createdAt)}
                </span>
              </div>
            </div>

            <div className="flex gap-2">
              {alert.actions?.map(action => (
                <Button
                  key={action.action}
                  variant="ghost"
                  size="sm"
                  onClick={() => executeAction(alert.id, action)}
                >
                  {action.label}
                </Button>
              ))}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => acknowledge.mutate(alert.id)}
              >
                <CheckIcon className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

### 21.5 Agent Performance Analytics

Beyond basic metrics, the Agent Performance Analytics system provides deep insights into individual agent effectiveness, model comparisons, and productivity patterns.

#### 21.5.1 Performance Data Model

```typescript
// packages/shared/src/types/analytics.ts

interface AgentPerformanceMetrics {
  agentId: string;
  agentName: string;
  model: string;
  period: { start: Date; end: Date };

  // Productivity metrics
  productivity: {
    tasksCompleted: number;
    tasksAttempted: number;
    successRate: number;           // 0-1
    avgTaskDurationMs: number;
    medianTaskDurationMs: number;
    linesOfCodeWritten: number;
    filesModified: number;
  };

  // Quality metrics
  quality: {
    errorRate: number;              // Errors per task
    rollbackRate: number;           // Checkpoints restored per task
    conflictRate: number;           // Conflicts caused per task
    ubsFindingsCreated: number;     // Issues introduced
    ubsFindingsResolved: number;    // Issues fixed
    testPassRate: number;           // When running tests
  };

  // Efficiency metrics
  efficiency: {
    tokensPerTask: number;
    costPerTask: number;
    contextUtilization: number;     // Avg context window usage
    idleTimePercent: number;        // Time spent waiting
    thinkingTimePercent: number;    // Time in "thinking" state
  };

  // Collaboration metrics
  collaboration: {
    messagesExchanged: number;
    handoffsInitiated: number;
    handoffsReceived: number;
    handoffSuccessRate: number;
    reservationConflicts: number;
  };

  // Trends
  trends: {
    productivityTrend: 'improving' | 'stable' | 'declining';
    qualityTrend: 'improving' | 'stable' | 'declining';
    efficiencyTrend: 'improving' | 'stable' | 'declining';
  };
}

interface ModelComparisonReport {
  period: { start: Date; end: Date };
  models: Array<{
    model: string;
    provider: string;
    agentCount: number;
    taskCount: number;

    // Aggregated metrics
    avgSuccessRate: number;
    avgTaskDurationMs: number;
    avgCostPerTask: number;
    avgTokensPerTask: number;
    avgQualityScore: number;       // Composite 0-100

    // Best use cases (inferred from task tags)
    bestFor: string[];
    worstFor: string[];
  }>;

  // Recommendations
  recommendations: Array<{
    type: 'model_suggestion' | 'cost_optimization' | 'quality_improvement';
    description: string;
    confidence: number;
    potentialSavings?: number;
  }>;
}
```

#### 21.5.2 Agent Analytics Service

```typescript
// apps/gateway/src/services/agent-analytics.service.ts

export class AgentAnalyticsService {
  constructor(
    private db: Database,
    private metricsService: MetricsService,
    private checkpointService: CheckpointService,
  ) {}

  async getAgentPerformance(
    agentId: string,
    period: { start: Date; end: Date }
  ): Promise<AgentPerformanceMetrics> {
    // Aggregate from multiple sources
    const [tasks, checkpoints, conflicts, messages, tokens] = await Promise.all([
      this.getTaskHistory(agentId, period),
      this.checkpointService.listByAgent(agentId, period),
      this.getConflictHistory(agentId, period),
      this.getMessageHistory(agentId, period),
      this.getTokenUsage(agentId, period),
    ]);

    const productivity = this.computeProductivity(tasks);
    const quality = this.computeQuality(tasks, checkpoints, conflicts);
    const efficiency = this.computeEfficiency(tasks, tokens);
    const collaboration = this.computeCollaboration(messages, conflicts);
    const trends = await this.computeTrends(agentId, period);

    return {
      agentId,
      agentName: await this.getAgentName(agentId),
      model: await this.getAgentModel(agentId),
      period,
      productivity,
      quality,
      efficiency,
      collaboration,
      trends,
    };
  }

  async compareModels(period: { start: Date; end: Date }): Promise<ModelComparisonReport> {
    const agentsByModel = await this.groupAgentsByModel(period);
    const models: ModelComparisonReport['models'] = [];

    for (const [model, agents] of Object.entries(agentsByModel)) {
      const performances = await Promise.all(
        agents.map(a => this.getAgentPerformance(a.id, period))
      );

      models.push({
        model,
        provider: this.getProvider(model),
        agentCount: agents.length,
        taskCount: performances.reduce((sum, p) => sum + p.productivity.tasksCompleted, 0),
        avgSuccessRate: this.average(performances.map(p => p.productivity.successRate)),
        avgTaskDurationMs: this.average(performances.map(p => p.productivity.avgTaskDurationMs)),
        avgCostPerTask: this.average(performances.map(p => p.efficiency.costPerTask)),
        avgTokensPerTask: this.average(performances.map(p => p.efficiency.tokensPerTask)),
        avgQualityScore: this.computeQualityScore(performances),
        bestFor: this.inferBestUseCases(performances),
        worstFor: this.inferWorstUseCases(performances),
      });
    }

    return {
      period,
      models: models.sort((a, b) => b.avgQualityScore - a.avgQualityScore),
      recommendations: this.generateRecommendations(models),
    };
  }

  private generateRecommendations(models: ModelComparisonReport['models']): ModelComparisonReport['recommendations'] {
    const recommendations: ModelComparisonReport['recommendations'] = [];

    // Find cost optimization opportunities
    const sortedByCost = [...models].sort((a, b) => a.avgCostPerTask - b.avgCostPerTask);
    const cheapest = sortedByCost[0];
    const mostExpensive = sortedByCost[sortedByCost.length - 1];

    if (cheapest && mostExpensive && mostExpensive.avgCostPerTask > cheapest.avgCostPerTask * 1.5) {
      if (cheapest.avgSuccessRate >= mostExpensive.avgSuccessRate * 0.95) {
        recommendations.push({
          type: 'cost_optimization',
          description: `Consider using ${cheapest.model} instead of ${mostExpensive.model} for similar tasks. ` +
                       `${cheapest.model} is ${Math.round((1 - cheapest.avgCostPerTask / mostExpensive.avgCostPerTask) * 100)}% cheaper ` +
                       `with comparable success rate.`,
          confidence: 0.85,
          potentialSavings: (mostExpensive.avgCostPerTask - cheapest.avgCostPerTask) * mostExpensive.taskCount,
        });
      }
    }

    return recommendations;
  }
}
```

#### 21.5.3 Agent Performance Dashboard Component

```tsx
// apps/web/src/components/analytics/AgentPerformanceDashboard.tsx

import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer } from 'recharts';

export function AgentPerformanceDashboard() {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('30d');

  const { data: agents } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.listAgents(),
  });

  const { data: performance } = useQuery({
    queryKey: ['agent-performance', selectedAgent, period],
    queryFn: () => api.getAgentPerformance(selectedAgent!, period),
    enabled: !!selectedAgent,
  });

  const { data: comparison } = useQuery({
    queryKey: ['model-comparison', period],
    queryFn: () => api.compareModels(period),
  });

  return (
    <div className="space-y-6">
      {/* Period Selector and Agent Picker */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-white">Agent Performance Analytics</h2>
        <div className="flex gap-4">
          <Select value={period} onValueChange={setPeriod}>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="90d">Last 90 days</SelectItem>
          </Select>
        </div>
      </div>

      {/* Model Comparison Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {comparison?.models.slice(0, 3).map((model, i) => (
          <div
            key={model.model}
            className={cn(
              "bg-slate-900 rounded-xl p-6 border",
              i === 0 ? "border-amber-500/50" : "border-slate-800"
            )}
          >
            {i === 0 && (
              <Badge className="mb-2 bg-amber-500/20 text-amber-400">Top Performer</Badge>
            )}
            <h3 className="text-lg font-semibold text-white">{model.model}</h3>
            <p className="text-sm text-slate-400">{model.provider}</p>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-slate-500">Success Rate</p>
                <p className="text-xl font-bold text-white">{(model.avgSuccessRate * 100).toFixed(1)}%</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Avg Cost/Task</p>
                <p className="text-xl font-bold text-white">${model.avgCostPerTask.toFixed(3)}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Individual Agent Performance Radar */}
      {performance && (
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-800">
          <h3 className="text-lg font-semibold text-white mb-4">Performance Profile</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={[
                { metric: 'Success Rate', value: performance.productivity.successRate * 100 },
                { metric: 'Quality', value: (1 - performance.quality.errorRate) * 100 },
                { metric: 'Efficiency', value: (1 - performance.efficiency.idleTimePercent) * 100 },
                { metric: 'Collaboration', value: performance.collaboration.handoffSuccessRate * 100 },
              ]}>
                <PolarGrid stroke="#334155" />
                <PolarAngleAxis dataKey="metric" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                <Radar dataKey="value" stroke="#0ea5e9" fill="#0ea5e9" fillOpacity={0.3} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* AI Recommendations */}
      {comparison?.recommendations && comparison.recommendations.length > 0 && (
        <div className="bg-gradient-to-r from-blue-900/30 to-purple-900/30 rounded-xl p-6 border border-blue-500/30">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <LightbulbIcon className="w-5 h-5 text-amber-400" />
            AI Recommendations
          </h3>
          <div className="space-y-3">
            {comparison.recommendations.map((rec, i) => (
              <div key={i} className="flex items-start gap-3">
                <p className="text-white">{rec.description}</p>
                {rec.potentialSavings && (
                  <p className="text-sm text-green-400">Save ${rec.potentialSavings.toFixed(2)}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

### 21.6 Cost Analytics & Optimization

Detailed cost tracking with forecasting and optimization recommendations.

#### 21.6.1 Cost Data Model

```typescript
// packages/shared/src/types/cost-analytics.ts

interface CostSnapshot {
  period: { start: Date; end: Date };
  granularity: 'hour' | 'day' | 'week' | 'month';
  totalCost: number;
  currency: 'USD';

  // Breakdown by dimension
  byModel: Record<string, { tokens: number; cost: number; percentOfTotal: number }>;
  byAgent: Record<string, { agentName: string; tokens: number; cost: number; tasksCompleted: number; costPerTask: number }>;
  byTaskType: Record<string, { count: number; avgCost: number; totalCost: number }>;

  // Budget tracking
  budget?: {
    limit: number;
    used: number;
    remaining: number;
    percentUsed: number;
    projectedOverage?: number;
  };
}

interface CostForecast {
  period: { start: Date; end: Date };
  projectedCost: number;
  confidenceInterval: { low: number; high: number };
  confidence: number;

  factors: Array<{ name: string; impact: number; description: string }>;

  optimizations: Array<{
    description: string;
    estimatedSavings: number;
    effort: 'low' | 'medium' | 'high';
    implementation: string;
  }>;
}
```

#### 21.6.2 Cost Analytics Service

```typescript
// apps/gateway/src/services/cost-analytics.service.ts

export class CostAnalyticsService {
  constructor(
    private db: Database,
    private tokenService: TokenService,
    private alertService: AlertService,
  ) {}

  async getCostSnapshot(
    period: { start: Date; end: Date },
    granularity: 'hour' | 'day' | 'week' | 'month' = 'day'
  ): Promise<CostSnapshot> {
    const tokenUsage = await this.tokenService.getUsage(period);
    const costs = this.calculateCosts(tokenUsage);

    return {
      period,
      granularity,
      totalCost: costs.total,
      currency: 'USD',
      byModel: this.aggregateByModel(costs),
      byAgent: await this.aggregateByAgent(costs, period),
      byTaskType: await this.aggregateByTaskType(costs, period),
      budget: await this.getBudgetStatus(),
    };
  }

  async forecast(days: number = 30): Promise<CostForecast> {
    const historical = await this.getHistoricalCosts(90);
    const trend = this.computeTrend(historical);
    const projectedCost = this.project(trend, days);

    return {
      period: { start: new Date(), end: new Date(Date.now() + days * 24 * 60 * 60 * 1000) },
      projectedCost,
      confidenceInterval: { low: projectedCost * 0.8, high: projectedCost * 1.2 },
      confidence: 0.85,
      factors: await this.analyzeCostFactors(),
      optimizations: await this.generateOptimizations(),
    };
  }

  private async generateOptimizations(): Promise<CostForecast['optimizations']> {
    const optimizations: CostForecast['optimizations'] = [];
    const snapshot = await this.getCostSnapshot({
      start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      end: new Date(),
    });

    // Check for model optimization opportunities
    const expensiveModels = Object.entries(snapshot.byModel)
      .filter(([_, data]) => data.percentOfTotal > 0.3);

    for (const [model, data] of expensiveModels) {
      const cheaper = this.findCheaperAlternative(model);
      if (cheaper) {
        optimizations.push({
          description: `Switch ${model} to ${cheaper.model} for routine tasks`,
          estimatedSavings: data.cost * (1 - cheaper.costRatio),
          effort: 'low',
          implementation: `Update agent config to use ${cheaper.model}`,
        });
      }
    }

    return optimizations.sort((a, b) => b.estimatedSavings - a.estimatedSavings);
  }
}
```

#### 21.6.3 Cost Dashboard Component

```tsx
// apps/web/src/components/analytics/CostDashboard.tsx

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

export function CostDashboard() {
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('30d');
  const { data: costs } = useCostSnapshot(period);
  const { data: forecast } = useCostForecast(30);

  return (
    <div className="space-y-6">
      {/* Budget Overview */}
      {costs?.budget && (
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-800">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">Budget Status</h3>
            <span className={cn(
              "text-sm font-medium px-2 py-1 rounded",
              costs.budget.percentUsed > 0.9 ? "bg-red-500/20 text-red-400" :
              costs.budget.percentUsed > 0.7 ? "bg-amber-500/20 text-amber-400" :
              "bg-green-500/20 text-green-400"
            )}>
              {Math.round(costs.budget.percentUsed * 100)}% used
            </span>
          </div>
          <div className="relative h-4 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-green-500 via-amber-500 to-red-500"
              style={{ width: `${Math.min(100, costs.budget.percentUsed * 100)}%` }}
            />
          </div>
          <div className="flex justify-between mt-2 text-sm text-slate-400">
            <span>${costs.budget.used.toFixed(2)} used</span>
            <span>${costs.budget.remaining.toFixed(2)} remaining</span>
          </div>
        </div>
      )}

      {/* Cost Breakdown & Forecast */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-800">
          <h3 className="text-lg font-semibold text-white mb-4">Cost by Model</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={Object.entries(costs?.byModel ?? {}).map(([model, data]) => ({
                    name: model, value: data.cost,
                  }))}
                  dataKey="value"
                  cx="50%" cy="50%"
                  innerRadius={60} outerRadius={80}
                >
                  {Object.keys(costs?.byModel ?? {}).map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: number) => `$${value.toFixed(2)}`} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-slate-900 rounded-xl p-6 border border-slate-800">
          <h3 className="text-lg font-semibold text-white mb-4">30-Day Forecast</h3>
          <div className="text-center py-4">
            <p className="text-4xl font-bold text-white">${forecast?.projectedCost.toFixed(2)}</p>
            <p className="text-sm text-slate-400 mt-1">Projected spend</p>
          </div>
        </div>
      </div>

      {/* Optimization Recommendations */}
      {forecast?.optimizations && forecast.optimizations.length > 0 && (
        <div className="bg-slate-900 rounded-xl p-6 border border-slate-800">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <PiggyBankIcon className="w-5 h-5 text-green-400" />
            Cost Optimization Opportunities
          </h3>
          <div className="space-y-4">
            {forecast.optimizations.map((opt, i) => (
              <div key={i} className="flex items-start gap-4 p-4 bg-slate-800/50 rounded-lg">
                <div className="flex-1">
                  <p className="font-medium text-white">{opt.description}</p>
                  <p className="text-sm text-slate-400 mt-1">{opt.implementation}</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-green-400">-${opt.estimatedSavings.toFixed(2)}</p>
                  <Badge variant={opt.effort === 'low' ? 'success' : opt.effort === 'medium' ? 'warning' : 'error'}>
                    {opt.effort} effort
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

### 21.7 Flywheel Velocity Dashboard

Measures the "spin rate" of the Agent Flywheel—how effectively the system is compounding improvements.

#### 21.7.1 Velocity Metrics

```typescript
// packages/shared/src/types/flywheel-velocity.ts

interface FlywheelVelocity {
  period: { start: Date; end: Date };
  velocityScore: number;           // 0-100
  velocityTrend: 'accelerating' | 'stable' | 'decelerating';

  stages: {
    plan: { beadsCreated: number; beadsTriaged: number; avgTriageQuality: number; bottlenecks: number };
    coordinate: { messagesExchanged: number; avgResponseTime: number; conflictsDetected: number; conflictsResolved: number };
    execute: { agentHours: number; tasksCompleted: number; successRate: number; checkpointsCreated: number };
    scan: { scansCompleted: number; findingsDetected: number; findingsResolved: number; avgTimeToResolution: number };
    remember: { sessionsIndexed: number; searchesPerformed: number; searchHitRate: number; memoriesApplied: number };
  };

  learning: {
    improvementRate: number;      // How much faster each cycle
    knowledgeReuse: number;       // % of tasks using prior knowledge
    errorReduction: number;       // % fewer errors vs baseline
  };
}
```

#### 21.7.2 Flywheel Velocity Dashboard Component

```tsx
// apps/web/src/components/analytics/FlywheelVelocityDashboard.tsx

export function FlywheelVelocityDashboard() {
  const { data: velocity } = useFlywheelVelocity();

  return (
    <div className="space-y-6">
      {/* Main Velocity Gauge */}
      <div className="bg-slate-900 rounded-xl p-8 border border-slate-800">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-white">Flywheel Velocity</h2>
            <p className="text-slate-400 mt-1">How effectively your agent ecosystem is compounding</p>
          </div>
          <div className="text-right">
            <div className="text-5xl font-bold text-white">{velocity?.velocityScore}</div>
            <div className={cn(
              "flex items-center gap-1 justify-end mt-1",
              velocity?.velocityTrend === 'accelerating' && "text-green-400",
              velocity?.velocityTrend === 'stable' && "text-slate-400",
              velocity?.velocityTrend === 'decelerating' && "text-red-400",
            )}>
              {velocity?.velocityTrend === 'accelerating' && <TrendingUpIcon className="w-4 h-4" />}
              <span className="text-sm capitalize">{velocity?.velocityTrend}</span>
            </div>
          </div>
        </div>

        {/* Velocity Gauge */}
        <div className="mt-6 h-4 bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-red-500 via-amber-500 to-green-500"
            style={{ width: `${velocity?.velocityScore}%` }}
          />
        </div>
      </div>

      {/* Stage Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {['plan', 'coordinate', 'execute', 'scan', 'remember'].map(stage => (
          <div key={stage} className="bg-slate-900 rounded-xl p-4 border border-slate-800">
            <h4 className="text-sm font-medium text-slate-400 uppercase tracking-wide">{stage}</h4>
            <div className="mt-2 space-y-1 text-sm">
              {stage === 'execute' && (
                <>
                  <p className="text-white">{velocity?.stages.execute.tasksCompleted} tasks</p>
                  <p className="text-slate-400">{(velocity?.stages.execute.successRate ?? 0) * 100}% success</p>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Learning Rate */}
      <div className="bg-gradient-to-r from-purple-900/30 to-blue-900/30 rounded-xl p-6 border border-purple-500/30">
        <h3 className="text-lg font-semibold text-white mb-4">Learning & Improvement</h3>
        <div className="grid grid-cols-3 gap-6 text-center">
          <div>
            <p className="text-3xl font-bold text-white">+{((velocity?.learning.improvementRate ?? 0) * 100).toFixed(1)}%</p>
            <p className="text-sm text-slate-400">Improvement Rate</p>
          </div>
          <div>
            <p className="text-3xl font-bold text-white">{((velocity?.learning.knowledgeReuse ?? 0) * 100).toFixed(0)}%</p>
            <p className="text-sm text-slate-400">Knowledge Reuse</p>
          </div>
          <div>
            <p className="text-3xl font-bold text-white">-{((velocity?.learning.errorReduction ?? 0) * 100).toFixed(0)}%</p>
            <p className="text-sm text-slate-400">Error Reduction</p>
          </div>
        </div>
      </div>
    </div>
  );
}
```

### 21.8 Custom Dashboard Builder

Allow users to create personalized dashboards with drag-and-drop widgets.

#### 21.8.1 Dashboard Configuration Model

```typescript
// packages/shared/src/types/custom-dashboard.ts

interface CustomDashboard {
  id: string;
  name: string;
  ownerId: string;
  visibility: 'private' | 'team' | 'public';
  layout: { columns: number; rowHeight: number };
  widgets: DashboardWidget[];
  autoRefresh: boolean;
  refreshIntervalMs: number;
  createdAt: Date;
  updatedAt: Date;
}

interface DashboardWidget {
  id: string;
  type: 'metric_card' | 'line_chart' | 'bar_chart' | 'pie_chart' | 'gauge' | 'table' | 'agent_list' | 'activity_feed';
  title: string;
  position: { x: number; y: number; w: number; h: number };
  config: WidgetConfig;
  dataSource: { type: 'metrics' | 'agents' | 'beads' | 'velocity' | 'costs'; query?: Record<string, unknown> };
}

interface WidgetConfig {
  metric?: string;
  format?: 'number' | 'currency' | 'percent' | 'duration';
  thresholds?: { warning: number; critical: number };
  showTrend?: boolean;
  xAxis?: string;
  yAxis?: string | string[];
  colors?: string[];
}
```

#### 21.8.2 Dashboard Builder Component

```tsx
// apps/web/src/components/analytics/DashboardBuilder.tsx

import GridLayout from 'react-grid-layout';

export function DashboardBuilder({ dashboardId }: { dashboardId?: string }) {
  const [dashboard, setDashboard] = useState<CustomDashboard | null>(null);
  const [isEditing, setIsEditing] = useState(!dashboardId);
  const saveDashboard = useSaveDashboard();

  const widgetPalette = [
    { type: 'metric_card', label: 'Metric Card', icon: <HashIcon />, defaultSize: { w: 3, h: 2 } },
    { type: 'line_chart', label: 'Line Chart', icon: <LineChartIcon />, defaultSize: { w: 6, h: 4 } },
    { type: 'bar_chart', label: 'Bar Chart', icon: <BarChartIcon />, defaultSize: { w: 6, h: 4 } },
    { type: 'pie_chart', label: 'Pie Chart', icon: <PieChartIcon />, defaultSize: { w: 4, h: 4 } },
    { type: 'table', label: 'Table', icon: <TableIcon />, defaultSize: { w: 6, h: 4 } },
  ];

  const addWidget = (type: string) => {
    const config = widgetPalette.find(w => w.type === type);
    const newWidget: DashboardWidget = {
      id: crypto.randomUUID(),
      type: type as DashboardWidget['type'],
      title: `New ${config?.label}`,
      position: { x: 0, y: Infinity, ...config?.defaultSize },
      config: {},
      dataSource: { type: 'metrics' },
    };
    setDashboard(d => d ? { ...d, widgets: [...d.widgets, newWidget] } : null);
  };

  return (
    <div className="flex h-full">
      <div className="flex-1 p-6 overflow-auto">
        <div className="flex items-center justify-between mb-6">
          <input
            className="text-2xl font-bold bg-transparent border-none text-white"
            value={dashboard?.name ?? ''}
            onChange={(e) => setDashboard(d => d ? { ...d, name: e.target.value } : null)}
            placeholder="Dashboard Name"
          />
          <Button onClick={() => saveDashboard.mutate(dashboard!)}>
            <SaveIcon className="w-4 h-4 mr-2" /> Save
          </Button>
        </div>

        <GridLayout
          layout={dashboard?.widgets.map(w => ({ i: w.id, ...w.position })) ?? []}
          cols={12}
          rowHeight={60}
          isDraggable={isEditing}
          isResizable={isEditing}
        >
          {dashboard?.widgets.map(widget => (
            <div key={widget.id} className="bg-slate-900 rounded-xl border border-slate-800">
              <WidgetRenderer widget={widget} />
            </div>
          ))}
        </GridLayout>
      </div>

      {isEditing && (
        <div className="w-80 border-l border-slate-800 bg-slate-900 p-4">
          <h3 className="text-lg font-semibold text-white mb-4">Add Widget</h3>
          <div className="grid grid-cols-2 gap-2">
            {widgetPalette.map(widget => (
              <button
                key={widget.type}
                onClick={() => addWidget(widget.type)}
                className="flex flex-col items-center gap-2 p-4 rounded-lg bg-slate-800 hover:bg-slate-700"
              >
                <div className="w-8 h-8 text-slate-400">{widget.icon}</div>
                <span className="text-xs text-slate-300">{widget.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

### 21.9 Comprehensive Notification System

A multi-channel notification system with intelligent routing, preferences, and actionable alerts.

#### 21.9.1 Notification Data Model

```typescript
// packages/shared/src/types/notifications.ts

interface Notification {
  id: string;
  type: NotificationType;
  category: 'agents' | 'coordination' | 'tasks' | 'costs' | 'system';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  title: string;
  body: string;
  recipientId: string;
  source: { type: 'agent' | 'system' | 'bead' | 'conflict'; id?: string; name?: string };
  actions?: Array<{ id: string; label: string; style: 'primary' | 'secondary' | 'danger'; action: string }>;
  link?: string;
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'actioned';
  channels: ('in_app' | 'email' | 'slack' | 'webhook')[];
  createdAt: Date;
  readAt?: Date;
}

type NotificationType =
  | 'agent.started' | 'agent.completed' | 'agent.failed' | 'agent.stalled' | 'agent.needs_approval'
  | 'conflict.detected' | 'conflict.resolved' | 'handoff.requested' | 'handoff.accepted'
  | 'bead.assigned' | 'bead.completed' | 'bead.blocked'
  | 'cost.budget_warning' | 'cost.budget_exceeded'
  | 'system.daemon_failed' | 'digest.daily' | 'digest.weekly';

interface NotificationPreferences {
  userId: string;
  enabled: boolean;

  quietHours?: {
    enabled: boolean;
    start: string;          // "22:00"
    end: string;            // "08:00"
    allowUrgent: boolean;
  };

  categories: Record<string, {
    enabled: boolean;
    channels: ('in_app' | 'email' | 'slack' | 'webhook')[];
    minPriority: 'low' | 'normal' | 'high' | 'urgent';
  }>;

  digest: {
    enabled: boolean;
    frequency: 'daily' | 'weekly';
    timeOfDay: string;
  };

  channels: {
    email?: { address: string; verified: boolean };
    slack?: { workspaceId: string; channelId: string };
    webhook?: { url: string; secret: string };
  };
}
```

#### 21.9.2 Notification Service

```typescript
// apps/gateway/src/services/notification.service.ts

export class NotificationService {
  constructor(
    private db: Database,
    private emailService: EmailService,
    private slackService: SlackService,
    private webhookService: WebhookService,
    private wsService: WebSocketService,
  ) {}

  async send(notification: Omit<Notification, 'id' | 'status' | 'channels' | 'createdAt'>): Promise<Notification> {
    const prefs = await this.getPreferences(notification.recipientId);
    if (!this.shouldSend(notification, prefs)) return this.createSuppressed(notification);

    const channels = this.determineChannels(notification, prefs);
    const notif = await this.create({ ...notification, id: crypto.randomUUID(), status: 'pending', channels, createdAt: new Date() });

    await this.dispatch(notif, prefs);
    return notif;
  }

  private shouldSend(notification: any, prefs: NotificationPreferences): boolean {
    if (!prefs.enabled) return false;
    const categoryPrefs = prefs.categories[notification.category];
    if (!categoryPrefs?.enabled) return false;

    const priorities = ['low', 'normal', 'high', 'urgent'];
    if (priorities.indexOf(notification.priority) < priorities.indexOf(categoryPrefs.minPriority)) return false;

    if (prefs.quietHours?.enabled && notification.priority !== 'urgent') {
      if (this.isQuietHours(prefs.quietHours)) return false;
    }

    return true;
  }

  private async dispatch(notification: Notification, prefs: NotificationPreferences): Promise<void> {
    await Promise.allSettled(
      notification.channels.map(channel => this.sendToChannel(notification, channel, prefs))
    );
  }

  private async sendToChannel(notification: Notification, channel: string, prefs: NotificationPreferences): Promise<void> {
    switch (channel) {
      case 'in_app':
        await this.wsService.send(notification.recipientId, { type: 'notification', data: notification });
        break;
      case 'email':
        if (prefs.channels.email?.verified) {
          await this.emailService.send({ to: prefs.channels.email.address, subject: notification.title, text: notification.body });
        }
        break;
      case 'slack':
        if (prefs.channels.slack) {
          await this.slackService.send({ channel: prefs.channels.slack.channelId, text: `*${notification.title}*\n${notification.body}` });
        }
        break;
      case 'webhook':
        if (prefs.channels.webhook) {
          await this.webhookService.send(prefs.channels.webhook.url, { notification });
        }
        break;
    }
  }

  async generateDigest(userId: string, frequency: 'daily' | 'weekly'): Promise<void> {
    const prefs = await this.getPreferences(userId);
    if (!prefs.digest.enabled || prefs.digest.frequency !== frequency) return;

    const since = frequency === 'daily'
      ? new Date(Date.now() - 24 * 60 * 60 * 1000)
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const notifications = await this.getNotificationsSince(userId, since);
    if (notifications.length === 0) return;

    await this.send({
      type: frequency === 'daily' ? 'digest.daily' : 'digest.weekly',
      category: 'system',
      priority: 'low',
      title: `Your ${frequency} Flywheel digest`,
      body: this.compileDigest(notifications),
      recipientId: userId,
      source: { type: 'system', name: 'Digest Generator' },
    });
  }
}
```

#### 21.9.3 Notification Center Component

```tsx
// apps/web/src/components/notifications/NotificationCenter.tsx

export function NotificationCenter() {
  const [isOpen, setIsOpen] = useState(false);
  const { data: notifications, refetch } = useNotifications();
  const markAsRead = useMarkNotificationRead();

  const unreadCount = notifications?.filter(n => n.status !== 'read').length ?? 0;

  useWebSocket('notifications', () => refetch());

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <BellIcon className="w-5 h-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-xs text-white flex items-center justify-center">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-96 p-0" align="end">
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <h3 className="font-semibold text-white">Notifications</h3>
          <Button variant="ghost" size="sm" onClick={() => markAllAsRead()}>Mark all read</Button>
        </div>

        <div className="max-h-96 overflow-auto divide-y divide-slate-800">
          {notifications?.map(n => (
            <div
              key={n.id}
              className={cn("p-4 hover:bg-slate-800/50 cursor-pointer", n.status !== 'read' && "bg-slate-800/30")}
              onClick={() => markAsRead.mutate(n.id)}
            >
              <p className={cn("text-sm", n.status !== 'read' ? "font-medium text-white" : "text-slate-300")}>
                {n.title}
              </p>
              <p className="text-sm text-slate-400 mt-1">{n.body}</p>
              <span className="text-xs text-slate-500">{formatRelativeTime(n.createdAt)}</span>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

#### 21.9.4 Notification Preferences Page

```tsx
// apps/web/src/pages/settings/NotificationPreferences.tsx

export function NotificationPreferences() {
  const { data: prefs } = useNotificationPreferences();
  const updatePrefs = useUpdateNotificationPreferences();

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <h2 className="text-2xl font-bold text-white">Notification Preferences</h2>

      {/* Global Toggle */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-white">Enable notifications</p>
              <p className="text-sm text-slate-400">Receive notifications about your agents and tasks</p>
            </div>
            <Switch checked={prefs?.enabled} onCheckedChange={(enabled) => updatePrefs.mutate({ enabled })} />
          </div>
        </CardContent>
      </Card>

      {/* Quiet Hours */}
      <Card>
        <CardHeader><CardTitle>Quiet Hours</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-white">Enable quiet hours</p>
            <Switch
              checked={prefs?.quietHours?.enabled}
              onCheckedChange={(enabled) => updatePrefs.mutate({ quietHours: { ...prefs?.quietHours, enabled } })}
            />
          </div>
          {prefs?.quietHours?.enabled && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Start</Label>
                <Input type="time" value={prefs.quietHours.start} onChange={(e) => updatePrefs.mutate({ quietHours: { ...prefs.quietHours, start: e.target.value } })} />
              </div>
              <div>
                <Label>End</Label>
                <Input type="time" value={prefs.quietHours.end} onChange={(e) => updatePrefs.mutate({ quietHours: { ...prefs.quietHours, end: e.target.value } })} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Digest Settings */}
      <Card>
        <CardHeader><CardTitle>Email Digest</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-white">Enable digest</p>
            <Switch checked={prefs?.digest.enabled} onCheckedChange={(enabled) => updatePrefs.mutate({ digest: { ...prefs?.digest, enabled } })} />
          </div>
          {prefs?.digest.enabled && (
            <Select value={prefs.digest.frequency} onValueChange={(frequency) => updatePrefs.mutate({ digest: { ...prefs.digest, frequency } })}>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
            </Select>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

#### 21.9.5 Notification REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/notifications` | List notifications for current user |
| `GET` | `/notifications/{id}` | Get notification details |
| `POST` | `/notifications/{id}/read` | Mark as read |
| `POST` | `/notifications/{id}/action` | Execute notification action |
| `POST` | `/notifications/read-all` | Mark all as read |
| `GET` | `/notifications/preferences` | Get notification preferences |
| `PUT` | `/notifications/preferences` | Update notification preferences |
| `POST` | `/notifications/test` | Send test notification |

---

## 22. Web UI Layer

### 22.1 Design System

```typescript
// apps/web/src/lib/design-system.ts

export const colors = {
  // Flywheel brand
  flywheel: {
    50: '#f0f9ff',
    100: '#e0f2fe',
    500: '#0ea5e9',
    600: '#0284c7',
    900: '#0c4a6e',
  },

  // Agent types
  agent: {
    claude: '#d97706',    // Amber
    codex: '#16a34a',     // Green
    gemini: '#2563eb',    // Blue
  },

  // Status colors
  status: {
    idle: '#64748b',
    working: '#22c55e',
    thinking: '#f59e0b',
    error: '#ef4444',
    stalled: '#8b5cf6',
  },

  // Severity
  severity: {
    low: '#3b82f6',
    medium: '#f59e0b',
    high: '#ef4444',
    critical: '#dc2626',
  },
};

export const spacing = {
  xs: '0.25rem',
  sm: '0.5rem',
  md: '1rem',
  lg: '1.5rem',
  xl: '2rem',
  '2xl': '3rem',
};

export const typography = {
  fontFamily: {
    sans: ['Inter var', 'system-ui', 'sans-serif'],
    mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
  },
  fontSize: {
    xs: '0.75rem',
    sm: '0.875rem',
    base: '1rem',
    lg: '1.125rem',
    xl: '1.25rem',
    '2xl': '1.5rem',
  },
};
```

#### CSS Custom Properties

The design system uses CSS custom properties for runtime theming:

```css
/* apps/web/src/styles/theme.css */

:root {
  /* Surface colors (dark theme default) */
  --surface-0: #0f172a;    /* Deepest background (body) */
  --surface-1: #1e293b;    /* Cards, panels */
  --surface-2: #334155;    /* Elevated elements */
  --surface-3: #475569;    /* Borders, dividers */

  /* Text hierarchy */
  --text-primary: #f8fafc;
  --text-secondary: #94a3b8;
  --text-tertiary: #64748b;
  --text-muted: #475569;

  /* Semantic colors */
  --accent: #0ea5e9;
  --accent-hover: #0284c7;
  --success: #22c55e;
  --warning: #f59e0b;
  --error: #ef4444;
  --info: #3b82f6;

  /* Agent identity colors */
  --agent-claude: #d97706;
  --agent-codex: #16a34a;
  --agent-gemini: #2563eb;

  /* Status indicators */
  --status-idle: #64748b;
  --status-working: #22c55e;
  --status-thinking: #f59e0b;
  --status-error: #ef4444;
  --status-stalled: #8b5cf6;

  /* Spacing scale */
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --space-12: 3rem;

  /* Animation */
  --transition-fast: 150ms ease;
  --transition-base: 200ms ease;
  --transition-slow: 300ms ease;

  /* Shadows */
  --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.3);
  --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.4);
  --shadow-glow: 0 0 20px rgb(14 165 233 / 0.3);
}
```

#### Tailwind CSS Configuration

```typescript
// apps/web/tailwind.config.ts

import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: {
          0: 'var(--surface-0)',
          1: 'var(--surface-1)',
          2: 'var(--surface-2)',
          3: 'var(--surface-3)',
        },
        agent: {
          claude: 'var(--agent-claude)',
          codex: 'var(--agent-codex)',
          gemini: 'var(--agent-gemini)',
        },
        status: {
          idle: 'var(--status-idle)',
          working: 'var(--status-working)',
          thinking: 'var(--status-thinking)',
          error: 'var(--status-error)',
          stalled: 'var(--status-stalled)',
        },
      },
      fontFamily: {
        sans: ['Inter var', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'spin-slow': 'spin 2s linear infinite',
        'bounce-subtle': 'bounce 2s ease-in-out infinite',
      },
      boxShadow: {
        'glow': 'var(--shadow-glow)',
        'glow-error': '0 0 20px rgb(239 68 68 / 0.3)',
        'glow-success': '0 0 20px rgb(34 197 94 / 0.3)',
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography'),
  ],
} satisfies Config;
```

#### Design Principles

1. **Dark-first**: Designed for dark environments (developers, ops)
2. **High contrast**: WCAG AA minimum for all text
3. **Semantic colors**: Status and severity encoded in color
4. **Agent identity**: Consistent visual language per agent type
5. **Motion with purpose**: Animations indicate state, not decoration
6. **Information density**: Optimize for at-a-glance comprehension

### 22.2 Core Component Library

```tsx
// apps/web/src/components/ui/Button.tsx

import { cva, type VariantProps } from 'class-variance-authority';

const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-blue-600 text-white hover:bg-blue-700',
        destructive: 'bg-red-600 text-white hover:bg-red-700',
        outline: 'border border-slate-700 bg-transparent hover:bg-slate-800',
        ghost: 'hover:bg-slate-800 text-slate-400 hover:text-white',
        link: 'text-blue-400 underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 px-3 text-sm',
        md: 'h-10 px-4',
        lg: 'h-12 px-6 text-lg',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  loading,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <LoaderIcon className="w-4 h-4 mr-2 animate-spin" />}
      {children}
    </button>
  );
}
```

### 22.3 Application Shell

During Phase 1, the UI should run in a deterministic mock-data mode (fixtures + simulated WS events) so navigation, layouts, and information architecture can ship before all endpoints exist. As registry-backed APIs land, swap mocks to real queries one surface at a time.

```tsx
// apps/web/src/components/layout/AppShell.tsx

export function AppShell({ children }: { children: React.ReactNode }) {
  const isMobile = useMediaQuery('(max-width: 768px)');

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Desktop Sidebar */}
      {!isMobile && <DesktopSidebar />}

      {/* Main Content */}
      <main
        className={cn(
          'min-h-screen',
          !isMobile && 'ml-64'  // Sidebar width
        )}
      >
        {/* Top Bar */}
        <TopBar />

        {/* Page Content */}
        <div className="p-6">
          {children}
        </div>
      </main>

      {/* Mobile Navigation */}
      {isMobile && <MobileNavigation />}

      {/* Global Modals */}
      <ModalProvider />

      {/* Toast Notifications */}
      <Toaster position="bottom-right" />

      {/* Command Palette */}
      <CommandPalette />
    </div>
  );
}

function DesktopSidebar() {
  const location = useLocation();

  return (
    <aside className="fixed left-0 top-0 h-screen w-64 bg-slate-900 border-r border-slate-800 flex flex-col">
      {/* Logo */}
      <div className="h-16 flex items-center px-6 border-b border-slate-800">
        <FlywheelLogo className="h-8" />
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map(item => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm',
                isActive
                  ? 'bg-slate-800 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
              )
            }
          >
            <item.icon className="w-5 h-5" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* User Section */}
      <div className="p-4 border-t border-slate-800">
        <UserMenu />
      </div>
    </aside>
  );
}
```

### 22.4 Real-Time Agent Collaboration Graph

The Agent Collaboration Graph is an interactive, real-time visualization that shows exactly how agents are coordinating—who's talking to whom, which files are reserved by which agent, where dependency bottlenecks exist, and how work flows through the system.

**Why this matters:** The entire value proposition of Flywheel Gateway is multi-agent coordination. Yet coordination is inherently invisible. When three agents are working on a project, users need to answer questions like:
- "Why is BlueLake waiting?"
- "Who has src/api.ts reserved?"
- "Are GreenCastle and RedStone going to conflict?"

The Collaboration Graph makes the invisible visible.

#### 22.4.1 Graph Data Model

```typescript
// packages/shared/src/types/collaboration-graph.ts

interface CollaborationGraph {
  nodes: AgentNode[];
  edges: CollaborationEdge[];
  reservations: ReservationNode[];
  conflicts: ConflictNode[];
  handoffs: HandoffEdge[];
  lastUpdated: Date;
}

interface AgentNode {
  id: string;
  type: 'agent';
  data: {
    agentId: string;
    agentName: string;
    agentType: 'claude' | 'codex' | 'gemini';
    status: 'idle' | 'working' | 'thinking' | 'waiting' | 'error';
    currentTask?: string;
    contextHealth: ContextHealthStatus;
    lastActivity: Date;
  };
  position: { x: number; y: number };
}

interface CollaborationEdge {
  id: string;
  type: 'message' | 'handoff' | 'dependency';
  source: string;  // Agent ID
  target: string;  // Agent ID
  data: {
    messageCount?: number;
    lastMessageAt?: Date;
    handoffStatus?: 'pending' | 'accepted' | 'completed';
    animated: boolean;
  };
}

interface ReservationNode {
  id: string;
  type: 'reservation';
  data: {
    pattern: string;
    holderId: string;
    holderName: string;
    exclusive: boolean;
    expiresAt: Date;
    ttlPercent: number;
  };
  position: { x: number; y: number };
}

interface ConflictNode {
  id: string;
  type: 'conflict';
  data: {
    conflictId: string;
    path: string;
    agents: string[];
    severity: 'low' | 'medium' | 'high';
    suggestedStrategy?: ConflictStrategy;
  };
  position: { x: number; y: number };
}
```

#### 22.4.2 Collaboration Graph Component

```tsx
// apps/web/src/components/collaboration/CollaborationGraph.tsx

import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  ConnectionMode,
  Panel,
} from '@xyflow/react';
import { useWebSocket } from '@/hooks/useWebSocket';

const nodeTypes = {
  agent: AgentGraphNode,
  reservation: ReservationGraphNode,
  conflict: ConflictGraphNode,
};

const edgeTypes = {
  message: MessageEdge,
  handoff: HandoffEdge,
  dependency: DependencyEdge,
};

export function CollaborationGraph({ projectKey }: { projectKey: string }) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [viewMode, setViewMode] = useState<'agents' | 'files' | 'full'>('agents');

  // Real-time updates via WebSocket
  const { subscribe } = useWebSocket();

  useEffect(() => {
    const unsubscribes = [
      subscribe('agents:*', handleAgentUpdate),
      subscribe('reservations', handleReservationUpdate),
      subscribe('conflicts', handleConflictUpdate),
      subscribe('handoffs', handleHandoffUpdate),
      subscribe('mail', handleMessageUpdate),
    ];

    return () => unsubscribes.forEach(u => u());
  }, [projectKey]);

  // Fetch initial graph state
  const { data: graphData } = useQuery({
    queryKey: ['collaboration-graph', projectKey],
    queryFn: () => api.getCollaborationGraph(projectKey),
    refetchInterval: 30000, // Refresh every 30s as baseline
  });

  useEffect(() => {
    if (!graphData) return;

    const { nodes: layoutNodes, edges: layoutEdges } = computeGraphLayout(
      graphData,
      viewMode
    );
    setNodes(layoutNodes);
    setEdges(layoutEdges);
  }, [graphData, viewMode]);

  // Real-time event handlers
  const handleAgentUpdate = (event: AgentEvent) => {
    setNodes(prev => prev.map(node =>
      node.id === event.agentId
        ? { ...node, data: { ...node.data, ...event.data } }
        : node
    ));
  };

  const handleMessageUpdate = (event: MessageEvent) => {
    // Pulse the edge between sender and receiver
    setEdges(prev => prev.map(edge => {
      if (
        (edge.source === event.from && edge.target === event.to) ||
        (edge.source === event.to && edge.target === event.from)
      ) {
        return {
          ...edge,
          data: {
            ...edge.data,
            messageCount: (edge.data.messageCount ?? 0) + 1,
            lastMessageAt: new Date(),
            animated: true,
          },
        };
      }
      return edge;
    }));

    // Stop animation after 2s
    setTimeout(() => {
      setEdges(prev => prev.map(edge => ({
        ...edge,
        data: { ...edge.data, animated: false },
      })));
    }, 2000);
  };

  return (
    <div className="h-[700px] bg-slate-950 rounded-xl border border-slate-800">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        connectionMode={ConnectionMode.Loose}
        fitView
        minZoom={0.5}
        maxZoom={2}
      >
        <Background color="#334155" gap={20} size={1} />
        <Controls className="bg-slate-800 border-slate-700 text-white" />
        <MiniMap
          nodeColor={(node) => {
            switch (node.type) {
              case 'agent': return getAgentColor(node.data.agentType);
              case 'conflict': return '#ef4444';
              case 'reservation': return '#f59e0b';
              default: return '#64748b';
            }
          }}
          className="bg-slate-900 border-slate-700"
        />

        {/* View Mode Switcher */}
        <Panel position="top-left" className="bg-slate-900 p-2 rounded-lg border border-slate-700">
          <div className="flex gap-1">
            <Button
              size="sm"
              variant={viewMode === 'agents' ? 'default' : 'ghost'}
              onClick={() => setViewMode('agents')}
            >
              <UsersIcon className="w-4 h-4 mr-1" />
              Agents
            </Button>
            <Button
              size="sm"
              variant={viewMode === 'files' ? 'default' : 'ghost'}
              onClick={() => setViewMode('files')}
            >
              <FileIcon className="w-4 h-4 mr-1" />
              Files
            </Button>
            <Button
              size="sm"
              variant={viewMode === 'full' ? 'default' : 'ghost'}
              onClick={() => setViewMode('full')}
            >
              <NetworkIcon className="w-4 h-4 mr-1" />
              Full
            </Button>
          </div>
        </Panel>

        {/* Legend */}
        <Panel position="bottom-left" className="bg-slate-900/90 p-3 rounded-lg border border-slate-700">
          <GraphLegend />
        </Panel>

        {/* Stats */}
        <Panel position="top-right" className="bg-slate-900 p-3 rounded-lg border border-slate-700">
          <GraphStats nodes={nodes} edges={edges} />
        </Panel>
      </ReactFlow>
    </div>
  );
}

// Custom Agent Node
function AgentGraphNode({ data }: NodeProps<AgentNode['data']>) {
  return (
    <motion.div
      initial={{ scale: 0 }}
      animate={{ scale: 1 }}
      className={cn(
        'px-4 py-3 rounded-xl border-2 shadow-lg min-w-[140px]',
        getAgentNodeStyles(data.status, data.agentType)
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        <AgentAvatar type={data.agentType} size="sm" />
        <span className="font-medium text-white text-sm">{data.agentName}</span>
      </div>

      <div className="flex items-center gap-2 text-xs">
        <StatusDot status={data.status} />
        <span className="text-slate-400 capitalize">{data.status}</span>
      </div>

      {data.currentTask && (
        <div className="mt-2 text-xs text-slate-400 truncate max-w-[120px]">
          {data.currentTask}
        </div>
      )}

      {/* Context Health Indicator */}
      <div className="mt-2">
        <ContextHealthBar status={data.contextHealth} size="xs" />
      </div>

      {/* Connection handles */}
      <Handle type="target" position={Position.Top} className="!bg-slate-500" />
      <Handle type="source" position={Position.Bottom} className="!bg-slate-500" />
    </motion.div>
  );
}

// Custom Message Edge with animation
function MessageEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
}: EdgeProps<CollaborationEdge['data']>) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
  });

  return (
    <>
      <path
        id={id}
        className={cn(
          'react-flow__edge-path stroke-2',
          data?.animated ? 'stroke-blue-400' : 'stroke-slate-600'
        )}
        d={edgePath}
        strokeDasharray={data?.animated ? '5,5' : undefined}
      />
      {data?.animated && (
        <motion.circle
          r={4}
          fill="#3b82f6"
          initial={{ offsetDistance: '0%' }}
          animate={{ offsetDistance: '100%' }}
          transition={{ duration: 1, repeat: Infinity }}
        >
          <animateMotion dur="1s" repeatCount="indefinite" path={edgePath} />
        </motion.circle>
      )}
      {data?.messageCount && data.messageCount > 0 && (
        <EdgeLabelRenderer>
          <div
            className="absolute bg-slate-800 text-xs px-1.5 py-0.5 rounded text-slate-300"
            style={{
              transform: `translate(-50%, -50%) translate(${(sourceX + targetX) / 2}px, ${(sourceY + targetY) / 2}px)`,
            }}
          >
            {data.messageCount} msgs
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
```

#### 22.4.3 Graph Layout Algorithm

```typescript
// apps/web/src/lib/graph-layout.ts

import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide } from 'd3-force';

interface LayoutConfig {
  width: number;
  height: number;
  agentSpacing: number;
  conflictPull: number;
}

export function computeGraphLayout(
  data: CollaborationGraph,
  viewMode: 'agents' | 'files' | 'full',
  config: LayoutConfig = DEFAULT_CONFIG
): { nodes: Node[]; edges: Edge[] } {
  // Build nodes based on view mode
  let allNodes: LayoutNode[] = [];
  let allEdges: LayoutEdge[] = [];

  // Always include agents
  allNodes.push(...data.nodes.map(toLayoutNode));

  if (viewMode === 'files' || viewMode === 'full') {
    // Add reservation nodes clustered near their holders
    allNodes.push(...data.reservations.map(r => ({
      ...toLayoutNode(r),
      clusterId: r.data.holderId, // Cluster near holder
    })));
  }

  if (viewMode === 'full') {
    // Add conflict nodes between conflicting agents
    allNodes.push(...data.conflicts.map(toLayoutNode));
  }

  // Build edges
  allEdges = [
    ...data.edges.map(toLayoutEdge),
    ...data.handoffs.map(toLayoutEdge),
  ];

  if (viewMode !== 'agents') {
    // Add edges from agents to their reservations
    data.reservations.forEach(r => {
      allEdges.push({
        id: `res-${r.id}`,
        source: r.data.holderId,
        target: r.id,
        type: 'reservation',
      });
    });
  }

  // Run force simulation
  const simulation = forceSimulation(allNodes)
    .force('link', forceLink(allEdges).id(d => d.id).distance(100))
    .force('charge', forceManyBody().strength(-300))
    .force('center', forceCenter(config.width / 2, config.height / 2))
    .force('collision', forceCollide().radius(60))
    .stop();

  // Run simulation synchronously
  for (let i = 0; i < 300; i++) {
    simulation.tick();
  }

  // Extract final positions
  return {
    nodes: allNodes.map(n => ({
      ...n,
      position: { x: n.x, y: n.y },
    })),
    edges: allEdges,
  };
}

// Semantic clustering: agents working on same feature cluster together
export function computeSemanticClusters(
  agents: AgentNode[],
  beads: Bead[]
): Map<string, string[]> {
  const clusters = new Map<string, string[]>();

  // Group agents by their active bead's parent epic
  agents.forEach(agent => {
    const activeBead = beads.find(b =>
      b.assignee === agent.data.agentId && b.status === 'in_progress'
    );

    if (activeBead?.parent) {
      const existing = clusters.get(activeBead.parent) ?? [];
      clusters.set(activeBead.parent, [...existing, agent.id]);
    }
  });

  return clusters;
}
```

#### 22.4.4 REST Endpoints for Collaboration Graph

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/collaboration/graph` | Full graph state |
| `GET` | `/collaboration/graph/agents` | Agent-only view |
| `GET` | `/collaboration/graph/files` | File reservation view |
| `GET` | `/collaboration/graph/stats` | Graph statistics |
| `GET` | `/collaboration/graph/history` | Historical snapshots |

#### 22.4.5 WebSocket Topics

```typescript
// Real-time graph update topics
const GRAPH_TOPICS = [
  'agents:*',          // Agent status changes
  'reservations',      // File reservation changes
  'conflicts',         // Conflict detection/resolution
  'handoffs',          // Handoff initiation/completion
  'mail',              // Message exchanges (for edge animation)
  'context.health',    // Context window health changes
];
```

### 22.5 Performance Budgets

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Agent list interaction** | < 100ms | Time from click to visual feedback |
| **Output stream scroll** | 60fps | Frame rate during scrolling |
| **WebSocket message processing** | < 16ms | Time to process and render |
| **Initial load (desktop)** | < 2s | First Contentful Paint |
| **Initial load (mobile)** | < 3s | First Contentful Paint |
| **Time to Interactive** | < 3.5s | TTI metric |
| **Bundle size (JS)** | < 200kb | Gzipped initial bundle |

---

## 23. Desktop vs Mobile UX Strategy

### 23.1 Responsive Design Principles

```typescript
// apps/web/src/hooks/useResponsive.ts

export const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const;

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(query);
    setMatches(media.matches);

    const listener = (e: MediaQueryListEvent) => setMatches(e.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [query]);

  return matches;
}

export function useResponsive() {
  const isMobile = useMediaQuery(`(max-width: ${BREAKPOINTS.md}px)`);
  const isTablet = useMediaQuery(`(min-width: ${BREAKPOINTS.md}px) and (max-width: ${BREAKPOINTS.lg}px)`);
  const isDesktop = useMediaQuery(`(min-width: ${BREAKPOINTS.lg}px)`);

  return { isMobile, isTablet, isDesktop };
}
```

### 23.2 Mobile Navigation

```tsx
// apps/web/src/components/mobile/MobileNavigation.tsx

const MOBILE_TABS = [
  { id: 'home', icon: HomeIcon, label: 'Home' },
  { id: 'agents', icon: UsersIcon, label: 'Agents' },
  { id: 'mail', icon: MailIcon, label: 'Mail' },
  { id: 'alerts', icon: BellIcon, label: 'Alerts', badge: true },
  { id: 'settings', icon: SettingsIcon, label: 'Settings' },
];

export function MobileNavigation() {
  const location = useLocation();
  const { data: alertCount } = useAlertCount();

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-800 safe-area-pb z-50">
      <div className="flex justify-around items-center h-16">
        {MOBILE_TABS.map(tab => {
          const isActive = location.pathname.startsWith(`/${tab.id}`);

          return (
            <Link
              key={tab.id}
              to={`/${tab.id}`}
              className={cn(
                'flex flex-col items-center justify-center w-16 h-full transition-colors',
                isActive ? 'text-blue-400' : 'text-slate-500'
              )}
            >
              <div className="relative">
                <tab.icon className="w-6 h-6" />
                {tab.badge && alertCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-xs text-white flex items-center justify-center">
                    {alertCount > 9 ? '9+' : alertCount}
                  </span>
                )}
              </div>
              <span className="text-xs mt-1">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
```

### 23.3 Mobile Gesture Support

```tsx
// apps/web/src/hooks/useMobileGestures.ts

interface GestureHandlers {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
  onPullRefresh?: () => void;
}

export function useMobileGestures(handlers: GestureHandlers) {
  const [touchStart, setTouchStart] = useState<{ x: number; y: number } | null>(null);

  const onTouchStart = useCallback((e: TouchEvent) => {
    setTouchStart({
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    });
  }, []);

  const onTouchEnd = useCallback((e: TouchEvent) => {
    if (!touchStart) return;

    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - touchStart.x;
    const deltaY = touch.clientY - touchStart.y;

    const minSwipeDistance = 100;
    const maxVerticalDeviation = 50;

    // Horizontal swipes
    if (Math.abs(deltaX) > minSwipeDistance && Math.abs(deltaY) < maxVerticalDeviation) {
      if (deltaX > 0) {
        handlers.onSwipeRight?.();
      } else {
        handlers.onSwipeLeft?.();
      }
    }

    // Pull to refresh (swipe down from top)
    if (deltaY > minSwipeDistance && touchStart.y < 100) {
      handlers.onPullRefresh?.();
    }

    setTouchStart(null);
  }, [touchStart, handlers]);

  useEffect(() => {
    document.addEventListener('touchstart', onTouchStart);
    document.addEventListener('touchend', onTouchEnd);

    return () => {
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchend', onTouchEnd);
    };
  }, [onTouchStart, onTouchEnd]);
}
```

### 23.4 Mobile-Optimized Agent Card

```tsx
// apps/web/src/components/mobile/MobileAgentCard.tsx

export function MobileAgentCard({ agent }: { agent: Agent }) {
  const { send, interrupt, terminate } = useAgentActions(agent.id);

  return (
    <motion.div
      whileTap={{ scale: 0.98 }}
      className="bg-slate-900 rounded-xl p-4 border border-slate-800"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <AgentAvatar type={agent.model} size="lg" />
          <div>
            <h3 className="text-white font-medium">{agent.name}</h3>
            <p className="text-sm text-slate-400">{agent.model}</p>
          </div>
        </div>
        <ActivityIndicator state={agent.status} size="lg" />
      </div>

      {/* Quick Actions - Large Touch Targets (min 44px) */}
      <div className="flex gap-2 mt-4">
        <button
          onClick={() => send.mutate()}
          className="flex-1 h-12 bg-blue-600 rounded-lg flex items-center justify-center active:bg-blue-700"
        >
          <SendIcon className="w-5 h-5 text-white" />
        </button>
        <button
          onClick={() => interrupt.mutate()}
          className="flex-1 h-12 bg-amber-600 rounded-lg flex items-center justify-center active:bg-amber-700"
        >
          <PauseIcon className="w-5 h-5 text-white" />
        </button>
        <button
          onClick={() => setShowMenu(true)}
          className="flex-1 h-12 bg-slate-700 rounded-lg flex items-center justify-center active:bg-slate-600"
        >
          <MoreHorizontalIcon className="w-5 h-5 text-white" />
        </button>
      </div>
    </motion.div>
  );
}
```

---

## 24. Security & Audit

### 24.1 Audit Log Schema

```typescript
// packages/shared/src/types/audit.ts

interface AuditEntry {
  id: string;
  correlationId: string;
  timestamp: Date;

  // Identity
  userId?: string;
  apiKeyId?: string;
  agentId?: string;
  clientIp: string;
  userAgent: string;

  // Request
  method: string;
  path: string;
  params: Record<string, unknown>;
  body?: unknown;  // Sensitive fields redacted

  // Response
  statusCode: number;
  responseTime: number;
  error?: string;

  // Context
  resourceType?: string;
  resourceId?: string;
  action: AuditAction;
  tags: string[];
}

type AuditAction =
  | 'agent.spawn'
  | 'agent.terminate'
  | 'agent.send'
  | 'agent.interrupt'
  | 'authz.allow'
  | 'authz.deny'
  | 'policy.update'
  | 'role.assign'
  | 'role.revoke'
  | 'checkpoint.create'
  | 'checkpoint.restore'
  | 'account.create'
  | 'account.update'
  | 'account.delete'
  | 'safety.violation'
  | 'safety.approval'
  | 'file.create'
  | 'file.update'
  | 'file.delete'
  | 'git.commit'
  | 'git.push';
```

### 24.2 Audit Service

```typescript
// apps/gateway/src/services/audit.service.ts

export class AuditService {
  private readonly SENSITIVE_FIELDS = [
    'apiKey',
    'password',
    'token',
    'secret',
    'authorization',
  ];

  async log(entry: Omit<AuditEntry, 'id' | 'timestamp'>): Promise<void> {
    const sanitized = this.sanitize(entry);

    await this.db.insert(auditLogs).values({
      ...sanitized,
      id: crypto.randomUUID(),
      timestamp: new Date(),
    });

    // Emit for real-time monitoring
    this.events.emit('audit.entry', sanitized);

    // Forward to ClickHouse for long-term analytics (append-only)
    await this.analytics.writeAudit(sanitized);
  }

  private sanitize(entry: Partial<AuditEntry>): Partial<AuditEntry> {
    const sanitized = { ...entry };

    if (sanitized.body) {
      sanitized.body = this.redactSensitive(sanitized.body);
    }

    if (sanitized.params) {
      sanitized.params = this.redactSensitive(sanitized.params);
    }

    return sanitized;
  }

  private redactSensitive(obj: unknown): unknown {
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.redactSensitive(item));
    }

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (this.SENSITIVE_FIELDS.some(field =>
        key.toLowerCase().includes(field.toLowerCase())
      )) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = this.redactSensitive(value);
      }
    }

    return result;
  }

  async query(filters: AuditQueryFilters): Promise<AuditEntry[]> {
    let query = this.db.select().from(auditLogs);

    if (filters.userId) {
      query = query.where(eq(auditLogs.userId, filters.userId));
    }
    if (filters.action) {
      query = query.where(eq(auditLogs.action, filters.action));
    }
    if (filters.since) {
      query = query.where(gte(auditLogs.timestamp, filters.since));
    }
    if (filters.until) {
      query = query.where(lte(auditLogs.timestamp, filters.until));
    }

    return query
      .orderBy(desc(auditLogs.timestamp))
      .limit(filters.limit ?? 100)
      .offset(filters.offset ?? 0);
  }
}
```

Audit entries are stored in the primary database for operational queries and also forwarded to ClickHouse for long-term analytics. Usage events follow the same analytics sink so cost/usage reporting can run on ClickHouse without impacting the OLTP path.

### 24.3 Audit REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/audit` | Query audit log |
| `GET` | `/audit/{correlationId}` | Get request trace |
| `POST` | `/audit/export` | Export audit data |
| `GET` | `/audit/stats` | Audit statistics |

Authz decisions, policy changes, and role assignments are always audited and exported for long-term retention in ClickHouse.

### 24.4 Security Headers Middleware

```typescript
// apps/gateway/src/middleware/security.ts

export function securityHeaders(): MiddlewareHandler {
  return async (c, next) => {
    await next();

    // Security headers
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('X-XSS-Protection', '1; mode=block');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' wss:"
    );

    // Remove server identification
    c.header('Server', 'Flywheel');
  };
}
```

---

## 25. Testing Strategy

### 25.1 Test Categories

| Category | Description | Tools | Coverage Target |
|----------|-------------|-------|-----------------|
| **Unit** | Individual functions/services | Bun test | 80% |
| **Integration** | API + Database | Bun test | 70% |
| **Contract** | OpenAPI spec compliance | Custom | 100% |
| **E2E** | Full user flows | Playwright | Critical paths |
| **Load** | Concurrency/performance | k6 | WebSocket, API |
| **Visual** | UI regression | Playwright | Key components |

### 25.2 Unit Test Example

```typescript
// apps/gateway/src/services/account.service.test.ts

import { describe, test, expect, beforeEach } from 'bun:test';
import { AccountService } from './account.service';

describe('AccountService', () => {
  let service: AccountService;

  beforeEach(() => {
    service = new AccountService();
  });

  describe('getNextAccount', () => {
    test('round robin rotates through accounts', async () => {
      const accounts = [
        createAccount({ id: '1', status: 'active' }),
        createAccount({ id: '2', status: 'active' }),
        createAccount({ id: '3', status: 'active' }),
      ];
      const pool = createPool({ accounts: accounts.map(a => a.id) });

      service.addAccounts(accounts);
      service.addPool(pool);

      const first = await service.getNextAccount(pool.id);
      const second = await service.getNextAccount(pool.id);
      const third = await service.getNextAccount(pool.id);
      const fourth = await service.getNextAccount(pool.id);

      expect(first.id).not.toBe(second.id);
      expect(second.id).not.toBe(third.id);
      expect(fourth.id).toBe(first.id); // Wrapped around
    });

    test('skips unhealthy accounts', async () => {
      const accounts = [
        createAccount({ id: '1', status: 'quota_exceeded' }),
        createAccount({ id: '2', status: 'active' }),
      ];
      const pool = createPool({ accounts: accounts.map(a => a.id) });

      service.addAccounts(accounts);
      service.addPool(pool);

      const result = await service.getNextAccount(pool.id);

      expect(result.id).toBe('2');
    });

    test('throws when no healthy accounts available', async () => {
      const accounts = [
        createAccount({ id: '1', status: 'quota_exceeded' }),
        createAccount({ id: '2', status: 'disabled' }),
      ];
      const pool = createPool({ accounts: accounts.map(a => a.id) });

      service.addAccounts(accounts);
      service.addPool(pool);

      await expect(service.getNextAccount(pool.id)).rejects.toThrow(
        'No healthy accounts available'
      );
    });
  });
});
```

### 25.3 Contract Test Example

```typescript
// tests/contract/openapi.test.ts

import { describe, test, expect } from 'bun:test';
import { openApiSpec } from '../src/openapi/spec';
import { validateResponse } from 'openapi-response-validator';

describe('OpenAPI Contract Tests', () => {
  test('GET /agents matches spec', async () => {
    const response = await fetch('/api/v1/agents');
    const data = await response.json();

    const errors = validateResponse(
      openApiSpec,
      '/agents',
      'get',
      response.status,
      data
    );

    expect(errors).toEqual([]);
  });

  test('POST /agents/spawn matches spec', async () => {
    const response = await fetch('/api/v1/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude',
        workingDir: '/tmp/test',
      }),
    });
    const data = await response.json();

    const errors = validateResponse(
      openApiSpec,
      '/agents',
      'post',
      response.status,
      data
    );

    expect(errors).toEqual([]);
  });
});
```

### 25.4 E2E Test Example

```typescript
// tests/e2e/agent-workflow.spec.ts

import { test, expect } from '@playwright/test';

test.describe('Agent Workflow', () => {
  test('spawn agent, send prompt, view output', async ({ page }) => {
    // Navigate to agents page
    await page.goto('/agents');

    // Click new agent button
    await page.click('button:has-text("New Agent")');

    // Fill spawn form
    await page.selectOption('select[name="model"]', 'claude');
    await page.fill('input[name="workingDir"]', '/tmp/test');
    await page.click('button:has-text("Spawn")');

    // Wait for agent to appear
    await expect(page.locator('.agent-card')).toBeVisible({ timeout: 10000 });

    // Click agent to view
    await page.click('.agent-card');

    // Send a prompt
    await page.fill('textarea[name="prompt"]', 'What is 2 + 2?');
    await page.click('button:has-text("Send")');

    // Verify output appears
    await expect(page.locator('.output-viewer')).toContainText('4', {
      timeout: 30000,
    });
  });

  test('checkpoint and restore', async ({ page }) => {
    await page.goto('/agents');

    // Assume we have an existing agent
    await page.click('.agent-card');

    // Create checkpoint
    await page.click('button:has-text("Checkpoint")');
    await expect(page.locator('.checkpoint-list')).toContainText('Checkpoint 1');

    // Make some changes
    await page.fill('textarea[name="prompt"]', 'Make a change');
    await page.click('button:has-text("Send")');

    // Restore checkpoint
    await page.click('.checkpoint-list >> text=Checkpoint 1');
    await page.click('button:has-text("Restore")');

    // Confirm restoration
    await expect(page.locator('.toast')).toContainText('Restored');
  });
});
```

### 25.5 Load Test Example

```javascript
// tests/load/websocket.k6.js

import ws from 'k6/ws';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 100 },   // Ramp up
    { duration: '1m', target: 100 },    // Stay at 100
    { duration: '30s', target: 500 },   // Spike
    { duration: '30s', target: 0 },     // Ramp down
  ],
  thresholds: {
    ws_connecting: ['p(95)<1000'],      // 95% connect under 1s
    ws_msgs_received: ['rate>10'],       // Receive at least 10 msgs/s
  },
};

export default function () {
  const url = 'ws://localhost:8080/api/v1/ws';

  const response = ws.connect(url, {}, function (socket) {
    socket.on('open', () => {
      socket.send(JSON.stringify({
        op: 'subscribe',
        topics: ['events'],
      }));
    });

    socket.on('message', (data) => {
      const msg = JSON.parse(data);
      check(msg, {
        'has type': (m) => m.type !== undefined,
        'has timestamp': (m) => m.ts !== undefined,
      });
    });

    socket.setTimeout(() => {
      socket.close();
    }, 60000);
  });

  check(response, { 'status is 101': (r) => r && r.status === 101 });
}
```

### 25.7 Parity Gate Tests

Parity Gate tests ensure the Command Registry (§4.4) stays consistent. These run in CI and fail the build on violations.

```typescript
// scripts/parity-gate.test.ts

import { describe, test, expect } from 'bun:test';
import { commands } from '@flywheel/shared/commands';
import { openApiSpec } from '../apps/gateway/src/openapi/spec';

describe('Parity Gate', () => {
  describe('Command Registry Completeness', () => {
    test('every command has REST binding', () => {
      const missing = commands.filter(cmd => !cmd.rest);
      expect(missing.map(c => c.name)).toEqual([]);
    });

    test('every command has AI hints', () => {
      const missing = commands.filter(cmd => !cmd.aiHints?.whenToUse);
      expect(missing.map(c => c.name)).toEqual([]);
    });

    test('every command has input/output schemas', () => {
      const missing = commands.filter(
        cmd => !cmd.inputSchema || !cmd.outputSchema
      );
      expect(missing.map(c => c.name)).toEqual([]);
    });

    test('DELETE commands are not marked safe', () => {
      const violations = commands.filter(
        cmd => cmd.rest?.method === 'DELETE' && cmd.safetyLevel === 'safe'
      );
      expect(violations.map(c => c.name)).toEqual([]);
    });

    test('long-running commands return job IDs', () => {
      const violations = commands.filter(
        cmd => cmd.longRunning && !cmd.outputSchema.shape?.jobId
      );
      expect(violations.map(c => c.name)).toEqual([]);
    });
  });

  describe('OpenAPI Spec Consistency', () => {
    test('every command appears in OpenAPI spec', () => {
      const specPaths = Object.keys(openApiSpec.paths);

      const missing = commands.filter(cmd => {
        const expectedPath = `/api/v1${cmd.rest.path}`;
        return !specPaths.some(p => pathMatches(p, expectedPath));
      });

      expect(missing.map(c => c.name)).toEqual([]);
    });

    test('OpenAPI examples exist for all endpoints', () => {
      const pathsWithoutExamples: string[] = [];

      for (const [path, methods] of Object.entries(openApiSpec.paths)) {
        for (const [method, spec] of Object.entries(methods)) {
          if (!spec.requestBody?.content?.['application/json']?.examples) {
            if (method !== 'get' && method !== 'delete') {
              pathsWithoutExamples.push(`${method.toUpperCase()} ${path}`);
            }
          }
        }
      }

      expect(pathsWithoutExamples).toEqual([]);
    });

    test('error responses documented for all endpoints', () => {
      const pathsWithoutErrors: string[] = [];

      for (const [path, methods] of Object.entries(openApiSpec.paths)) {
        for (const [method, spec] of Object.entries(methods)) {
          const hasErrorResponses = Object.keys(spec.responses || {})
            .some(code => code.startsWith('4') || code.startsWith('5'));

          if (!hasErrorResponses) {
            pathsWithoutErrors.push(`${method.toUpperCase()} ${path}`);
          }
        }
      }

      expect(pathsWithoutErrors).toEqual([]);
    });
  });

  describe('WebSocket Event Consistency', () => {
    test('all emitted events are documented', () => {
      const documentedEvents = new Set(
        Object.values(openApiSpec.components?.schemas || {})
          .filter(s => s['x-event-type'])
          .map(s => s['x-event-type'])
      );

      const emittedEvents = commands
        .flatMap(cmd => cmd.ws?.emitsEvents || []);

      const undocumented = emittedEvents.filter(e => !documentedEvents.has(e));
      expect(undocumented).toEqual([]);
    });
  });

  describe('Type Safety', () => {
    test('generated TypeScript client compiles', async () => {
      const { exitCode } = await Bun.spawn([
        'bun', 'tsc', '--noEmit',
        'packages/api-client/src/generated.ts'
      ]);
      expect(exitCode).toBe(0);
    });
  });
});

function pathMatches(specPath: string, expectedPath: string): boolean {
  // Convert OpenAPI path params to regex
  const pattern = specPath.replace(/\{[^}]+\}/g, '[^/]+');
  return new RegExp(`^${pattern}$`).test(expectedPath);
}
```

#### CI Integration

```yaml
# .github/workflows/parity-gate.yml

name: Parity Gate

on:
  push:
    paths:
      - 'packages/shared/src/commands/**'
      - 'apps/gateway/src/openapi/**'
      - 'apps/gateway/src/routes/**'

jobs:
  parity-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2

      - name: Install dependencies
        run: bun install

      - name: Run parity gate tests
        run: bun test scripts/parity-gate.test.ts

      - name: Verify OpenAPI spec is up-to-date
        run: |
          bun run generate:openapi
          git diff --exit-code apps/gateway/src/openapi/spec.json
```

This ensures that:
- Every command is API-accessible (no hidden CLI features)
- Every endpoint is documented (no undocumented APIs)
- Every error is documented (no surprise failures)
- Types stay in sync (no runtime type mismatches)

---

## 26. Risk Register & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| **Agent runaway** | Medium | High | Token limits, activity detection, auto-interrupt, checkpoints |
| **Account quota exhaustion** | High | High | CAAM rotation, cooldowns, multi-provider pools |
| **File conflicts** | Medium | Medium | File reservations, conflict detection, Intelligent Conflict Resolution Assistant (§12.6) with AI-powered suggestions |
| **Context overflow** | High | Medium | Auto-Healing Context Windows (§7.6) with graduated thresholds, proactive summarization, and seamless rotation |
| **Work handoff failures** | Medium | Medium | First-Class Session Handoff Protocol (§7.8) with context transfer, resource handover, and acknowledgment |
| **Checkpoint storage explosion** | Medium | Medium | Delta-Based Progressive Checkpointing (§7.3.1) with incremental storage and automatic compaction |
| **Network interruption** | Medium | Medium | WebSocket reconnection, cursor-based resume, offline queue |
| **Daemon failure** | Low | High | Supervisor with auto-restart, health checks, alerts |
| **Data loss** | Low | Critical | Delta checkpoints, Git coordination, WAL for SQLite |
| **Security breach** | Low | Critical | BYOA token isolation, API key encryption, audit logging, safety guardrails |
| **Coordination visibility** | Medium | Medium | Real-Time Agent Collaboration Graph (§22.4) with live visualization of agents, reservations, and conflicts |
| **Performance degradation** | Medium | Medium | Performance budgets, Web Workers, virtualization |
| **Provider outage** | Low | High | Multi-provider support, graceful degradation, queuing |
| **Cost overruns** | Medium | High | Cost Analytics & Optimization (§21.6) with budget tracking, forecasting, and automated optimization recommendations |
| **Notification fatigue** | Medium | Low | Comprehensive Notification System (§21.9) with per-category preferences, quiet hours, and smart routing |
| **Blind spots in agent performance** | Medium | Medium | Agent Performance Analytics (§21.5) with model comparison, trend analysis, and AI recommendations |
| **Lack of flywheel visibility** | Low | Medium | Flywheel Velocity Dashboard (§21.7) measuring ecosystem health and learning rate |

---

## 27. Implementation Phases

### Phase 1: Foundation (Weeks 1-3)

**Goal**: Basic agent spawning and durable output streaming with API parity

- [ ] Project scaffolding (monorepo, packages)
- [ ] Command Registry + codegen (REST/tRPC/OpenAPI/WS)
- [ ] Parity gate tests (registry ↔ OpenAPI ↔ WebSocket events)
- [ ] Shared error taxonomy + AI hints (registry-enforced)
- [ ] Database schema and Drizzle setup
- [ ] Structured logging + correlation IDs + audit event pipeline (initial)
- [ ] SDK Agent Driver implementation
- [ ] Agent lifecycle state model + status endpoints/events
- [ ] WebSocket infrastructure with durable ring buffers + ack/replay
- [ ] Basic REST API (spawn, terminate, list) generated from registry
- [ ] Output streaming
- [ ] Basic web UI shell with mock-data mode
- [ ] **DCG integration** (§17.6) - Pre-execution hook setup, block event capture, basic dashboard
- [ ] **Developer utilities auto-install** (§17.7) - giil, csctf detection and installation

**Deliverable**: Spawn a Claude agent, send prompts, and view durable streaming output through parity-checked APIs and a working UI shell with DCG safety protection enabled

### Phase 2: Core Features (Weeks 4-6)

**Goal**: Multi-agent coordination and state management

- [ ] ACP Agent Driver
- [ ] Agent Mail integration (MCP client)
- [ ] File reservation system + reservation map UI
- [ ] Conflict detection baseline (events + alerts)
- [ ] Checkpoint/restore system with delta-based progressive checkpointing (§7.3.1)
- [ ] Context pack builder with token budgeting
- [ ] Auto-Healing Context Window Management (§7.6) - graduated thresholds, proactive summarization
- [ ] Job orchestration for long-running ops (context build, scans, exports)
- [ ] History tracking
- [ ] Idempotency middleware for all mutating endpoints
- [ ] Account management (CAAM) with BYOA gating + rotation

**Deliverable**: Multiple coordinated agents with reservations, context packs, auto-healing context windows, delta checkpoints, and BYOA-gated execution

### Phase 3: Flywheel Integration (Weeks 7-9)

**Goal**: Full integration with flywheel ecosystem

- [ ] Beads/BV integration
- [ ] CASS search integration
- [ ] CM memory integration
- [ ] UBS scanner integration (auto-bead creation)
- [ ] Intelligent Conflict Resolution Assistant (§12.6) - AI-powered suggestions, auto-resolution rules
- [ ] First-Class Session Handoff Protocol (§7.8) - structured context transfer, resource handover
- [ ] Real-Time Agent Collaboration Graph (§22.4) - live visualization of coordination
- [ ] Safety guardrails (SLB)
- [ ] Git coordination
- [ ] **RU integration** (§17.5) - Fleet management, multi-repo sync status, agent-sweep orchestration
- [ ] **DCG advanced features** - Allowlist management UI, false positive feedback loop, pack configuration

**Deliverable**: Complete flywheel loop operational with AI-assisted conflict resolution, seamless agent handoffs, real-time collaboration visibility, and fleet-wide agent orchestration via RU

### Phase 4: Production Ready (Weeks 10-12)

**Goal**: Polish, performance, reliability, and advanced analytics

- [ ] Metrics and alerts system (OpenTelemetry + dashboards)
- [ ] Agent Performance Analytics (§21.5) - model comparison, productivity trends, AI recommendations
- [ ] Cost Analytics & Optimization (§21.6) - budget tracking, forecasting, optimization suggestions
- [ ] Flywheel Velocity Dashboard (§21.7) - ecosystem health, learning rate metrics
- [ ] Custom Dashboard Builder (§21.8) - drag-and-drop widgets, personalized views
- [ ] Comprehensive Notification System (§21.9) - multi-channel delivery, preferences, digests
- [ ] Audit trail hardening (exports, retention, search)
- [ ] Pipeline engine
- [ ] Mobile optimization
- [ ] Performance optimization (WS backpressure, output virtualization)
- [ ] Comprehensive testing (unit, integration, contract, e2e, load)
- [ ] Documentation

**Deliverable**: Production-ready deployment with full observability, advanced analytics dashboards, intelligent notifications, and performance targets met

---

## 28. File Structure

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
│   │   ├── tests/
│   │   └── package.json
│   │
│   └── web/                     # Frontend React app
│       ├── src/
│       │   ├── components/      # UI components
│       │   ├── hooks/           # React hooks
│       │   ├── lib/             # Utilities
│       │   ├── pages/           # Route pages
│       │   ├── stores/          # Zustand stores
│       │   └── main.tsx
│       ├── tests/
│       └── package.json
│
├── packages/
│   ├── shared/                  # Shared types, utils, schemas
│   │   ├── src/
│   │   │   ├── types/
│   │   │   ├── schemas/
│   │   │   └── utils/
│   │   └── package.json
│   │
│   ├── agent-drivers/           # Agent driver implementations
│   │   ├── src/
│   │   │   ├── sdk/             # SDK driver
│   │   │   ├── acp/             # ACP driver
│   │   │   ├── tmux/            # Tmux driver
│   │   │   └── interface.ts     # AgentDriver interface
│   │   └── package.json
│   │
│   └── flywheel-clients/        # Flywheel tool clients
│       ├── src/
│       │   ├── agentmail/       # Agent Mail MCP client
│       │   ├── bv/              # BV client
│       │   ├── cass/            # CASS client
│       │   └── scanner/         # UBS client
│       └── package.json
│
├── reference/                   # Reference implementations from NTM
│   └── ntm/
│       ├── agentmail/
│       ├── bv/
│       ├── robot/
│       ├── pipeline/
│       └── context/
│
├── tests/
│   ├── e2e/                     # Playwright E2E tests
│   ├── contract/                # OpenAPI contract tests
│   └── load/                    # k6 load tests
│
├── docs/
│   ├── PLAN.md                  # This document
│   └── api/                     # API documentation
│
├── .beads/                      # Issue tracking
├── biome.json                   # Linting/formatting
├── bun.lockb
├── package.json
└── tsconfig.json
```

---

## 29. Technical Specifications

### 29.1 Database Schema

```typescript
// apps/gateway/src/db/schema.ts

import { sqliteTable, text, integer, real, blob } from 'drizzle-orm/sqlite-core';

export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  name: text('name'),
  model: text('model').notNull(),
  driver: text('driver').notNull(),
  status: text('status').notNull(),
  workingDir: text('working_dir').notNull(),
  config: text('config', { mode: 'json' }),
  pid: integer('pid'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  terminatedAt: integer('terminated_at', { mode: 'timestamp' }),
});

export const checkpoints = sqliteTable('checkpoints', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => agents.id),
  name: text('name'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  createdBy: text('created_by').notNull(),
  trigger: text('trigger').notNull(),
  data: blob('data'),  // Compressed checkpoint data
  size: integer('size').notNull(),
  verified: integer('verified', { mode: 'boolean' }).default(false),
});

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  provider: text('provider').notNull(),
  apiKeyEncrypted: blob('api_key_encrypted').notNull(),
  status: text('status').notNull(),
  quotaLimit: integer('quota_limit'),
  quotaUsed: integer('quota_used').default(0),
  quotaResetAt: integer('quota_reset_at', { mode: 'timestamp' }),
  priority: integer('priority').default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const history = sqliteTable('history', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => agents.id),
  prompt: text('prompt').notNull(),
  responseSummary: text('response_summary'),
  promptTokens: integer('prompt_tokens').notNull(),
  responseTokens: integer('response_tokens').notNull(),
  duration: integer('duration').notNull(),
  outcome: text('outcome').notNull(),
  error: text('error'),
  starred: integer('starred', { mode: 'boolean' }).default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const alerts = sqliteTable('alerts', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  severity: text('severity').notNull(),
  title: text('title').notNull(),
  message: text('message').notNull(),
  source: text('source').notNull(),
  acknowledged: integer('acknowledged', { mode: 'boolean' }).default(false),
  acknowledgedAt: integer('acknowledged_at', { mode: 'timestamp' }),
  acknowledgedBy: text('acknowledged_by'),
  metadata: text('metadata', { mode: 'json' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
});

export const auditLogs = sqliteTable('audit_logs', {
  id: text('id').primaryKey(),
  correlationId: text('correlation_id').notNull(),
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull(),
  userId: text('user_id'),
  apiKeyId: text('api_key_id'),
  agentId: text('agent_id'),
  clientIp: text('client_ip').notNull(),
  userAgent: text('user_agent'),
  method: text('method').notNull(),
  path: text('path').notNull(),
  statusCode: integer('status_code').notNull(),
  responseTime: integer('response_time').notNull(),
  action: text('action').notNull(),
  resourceType: text('resource_type'),
  resourceId: text('resource_id'),
});

// DCG (Destructive Command Guard) tables
export const dcgBlocks = sqliteTable('dcg_blocks', {
  id: text('id').primaryKey(),
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull(),
  agentId: text('agent_id').references(() => agents.id),
  command: text('command').notNull(),
  pack: text('pack').notNull(),
  pattern: text('pattern').notNull(),
  ruleId: text('rule_id').notNull(),
  severity: text('severity').notNull(),  // critical, high, medium, low
  reason: text('reason').notNull(),
  contextClassification: text('context_classification'),  // executed, data, ambiguous
  falsePositive: integer('false_positive', { mode: 'boolean' }).default(false),
});

export const dcgAllowlist = sqliteTable('dcg_allowlist', {
  id: text('id').primaryKey(),
  ruleId: text('rule_id').notNull().unique(),
  pattern: text('pattern').notNull(),
  addedAt: integer('added_at', { mode: 'timestamp' }).notNull(),
  addedBy: text('added_by').notNull(),
  reason: text('reason'),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  condition: text('condition'),  // Optional condition like "CI=true"
});

// Fleet/RU tables
export const fleetRepos = sqliteTable('fleet_repos', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  owner: text('owner').notNull(),
  path: text('path').notNull().unique(),
  branch: text('branch').notNull(),
  status: text('status').notNull(),  // current, behind, ahead, diverged, dirty, conflict
  lastSyncAt: integer('last_sync_at', { mode: 'timestamp' }),
  lastAgentSweepAt: integer('last_agent_sweep_at', { mode: 'timestamp' }),
  assignedAgent: text('assigned_agent'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const agentSweeps = sqliteTable('agent_sweeps', {
  id: text('id').primaryKey(),
  repositoryId: text('repository_id').notNull().references(() => fleetRepos.id),
  status: text('status').notNull(),  // pending, phase1, phase2, phase3, completed, failed
  phase1Result: text('phase1_result', { mode: 'json' }),
  phase2Result: text('phase2_result', { mode: 'json' }),
  phase3Result: text('phase3_result', { mode: 'json' }),
  agentId: text('agent_id').references(() => agents.id),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  error: text('error'),
});
```

### 29.2 API Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `AGENT_NOT_FOUND` | 404 | Agent ID does not exist |
| `AGENT_ALREADY_RUNNING` | 409 | Agent is already active |
| `AGENT_TERMINATED` | 410 | Agent has been terminated |
| `INVALID_DRIVER` | 400 | Unsupported driver type |
| `SPAWN_FAILED` | 500 | Failed to spawn agent |
| `CHECKPOINT_NOT_FOUND` | 404 | Checkpoint does not exist |
| `RESTORE_FAILED` | 500 | Failed to restore checkpoint |
| `ACCOUNT_NOT_FOUND` | 404 | Account ID does not exist |
| `QUOTA_EXCEEDED` | 429 | Account quota exceeded |
| `RATE_LIMITED` | 429 | Too many requests |
| `SAFETY_VIOLATION` | 403 | Blocked by safety guardrails |
| `APPROVAL_REQUIRED` | 202 | Operation requires user approval |
| `BYOA_REQUIRED` | 412 | Tenant must link at least one account before assignment |
| `EMAIL_NOT_VERIFIED` | 412 | Email must be verified before provisioning |
| `INVALID_REQUEST` | 400 | Request validation failed |
| `INTERNAL_ERROR` | 500 | Unexpected server error |
| `DCG_BLOCKED` | 403 | Command blocked by Destructive Command Guard |
| `DCG_PACK_NOT_FOUND` | 404 | DCG pack does not exist |
| `FLEET_REPO_NOT_FOUND` | 404 | Repository not in fleet |
| `FLEET_SYNC_IN_PROGRESS` | 409 | Sync already in progress for this repository |
| `SWEEP_NOT_FOUND` | 404 | Agent-sweep run does not exist |
| `SWEEP_APPROVAL_REQUIRED` | 202 | Agent-sweep phase 3 requires approval |
| `UTILITY_NOT_FOUND` | 404 | Developer utility not recognized |
| `UTILITY_INSTALL_FAILED` | 500 | Failed to install developer utility |

---

## 30. Reference Architecture

See `/reference/ntm/` for reference implementations from the NTM project:

- `agentmail/` — MCP client patterns
- `bv/` — BV integration patterns
- `robot/` — JSON schema patterns for structured responses
- `pipeline/` — Pipeline execution model
- `context/` — Context pack building algorithms

When implementing features, consult these references for patterns and data structures, but implement in idiomatic TypeScript/Bun.

## Appendix A: Complete API Parity Matrix

### A.1 Agent Operations

| Operation | REST Endpoint | WebSocket Topic | tRPC Procedure |
|-----------|---------------|-----------------|----------------|
| List agents | `GET /agents` | — | `agents.list` |
| Spawn agent | `POST /agents` | `agents` | `agents.spawn` |
| Get agent | `GET /agents/{id}` | — | `agents.get` |
| Terminate agent | `DELETE /agents/{id}` | `agents` | `agents.terminate` |
| Send prompt | `POST /agents/{id}/send` | `agents:{id}` | `agents.send` |
| Interrupt | `POST /agents/{id}/interrupt` | `agents:{id}` | `agents.interrupt` |
| Get output | `GET /agents/{id}/output` | `output:{id}` | `agents.output` |
| Get status | `GET /agents/{id}/status` | `agents:{id}` | `agents.status` |
| Checkpoint | `POST /agents/{id}/checkpoints` | — | `checkpoints.create` |
| Restore | `POST /agents/{id}/checkpoints/{cpId}/restore` | `agents:{id}` | `checkpoints.restore` |
| Rotate | `POST /agents/{id}/rotate` | `agents:{id}` | `agents.rotate` |
| Context window | `GET /agents/{id}/context-window` | — | `agents.contextWindow` |

### A.2 Agent Mail Operations

| Operation | REST Endpoint | WebSocket Topic |
|-----------|---------------|-----------------|
| Ensure project | `POST /mail/projects` | — |
| Register agent | `POST /mail/agents` | — |
| Send message | `POST /mail/messages` | `mail` |
| Reply | `POST /mail/messages/{id}/reply` | `mail` |
| Fetch inbox | `GET /mail/inbox` | — |
| Search | `GET /mail/search` | — |
| Mark read | `POST /mail/messages/{id}/read` | `mail` |
| Acknowledge | `POST /mail/messages/{id}/ack` | `mail` |
| Reserve files | `POST /reservations` | `reservations` |
| Release | `DELETE /reservations` | `reservations` |
| List reservations | `GET /reservations` | — |
| Conflicts | `GET /reservations/conflicts` | `conflicts` |

### A.3 Beads Operations

| Operation | REST Endpoint | WebSocket Topic |
|-----------|---------------|-----------------|
| List beads | `GET /beads` | — |
| Create bead | `POST /beads` | `beads` |
| Get bead | `GET /beads/{id}` | — |
| Update bead | `PATCH /beads/{id}` | `beads` |
| Close bead | `POST /beads/{id}/close` | `beads` |
| Get ready | `GET /beads/ready` | — |
| Get blocked | `GET /beads/blocked` | — |
| Triage | `GET /beads/triage` | — |
| Insights | `GET /beads/insights` | — |
| Add dependency | `POST /beads/{id}/deps` | `beads` |
| Sync | `POST /beads/sync` | — |

### A.4 Scanner Operations

| Operation | REST Endpoint | WebSocket Topic |
|-----------|---------------|-----------------|
| Run scan | `POST /scanner/run` | `scanner` |
| Get findings | `GET /scanner/findings` | — |
| Dismiss finding | `POST /scanner/findings/{id}/dismiss` | — |
| Create bead | `POST /scanner/findings/{id}/create-bead` | `beads` |
| Scan history | `GET /scanner/history` | — |

### A.5 Memory Operations

| Operation | REST Endpoint | WebSocket Topic |
|-----------|---------------|-----------------|
| CASS search | `GET /cass/search` | — |
| Get context | `POST /memory/context` | — |
| List rules | `GET /memory/rules` | — |
| Record outcome | `POST /memory/outcome` | — |
| Privacy settings | `GET/PUT /memory/privacy` | — |

### A.6 Account Operations

| Operation | REST Endpoint | WebSocket Topic |
|-----------|---------------|-----------------|
| BYOA status | `GET /accounts/byoa-status` | — |
| List profiles | `GET /accounts/profiles` | — |
| Start login | `POST /accounts/providers/{provider}/login/start` | `accounts` |
| Complete login | `POST /accounts/providers/{provider}/login/complete` | `accounts` |
| Activate profile | `POST /accounts/profiles/{id}/activate` | `accounts` |
| Cooldown profile | `POST /accounts/profiles/{id}/cooldown` | `accounts` |
| List pools | `GET /accounts/pools` | — |
| Rotate pool | `POST /accounts/pools/{id}/rotate` | — |

### A.7 Provisioning Operations

| Operation | REST Endpoint | WebSocket Topic |
|-----------|---------------|-----------------|
| List requests | `GET /provisioning/requests` | — |
| Create request | `POST /provisioning/requests` | `provisioning` |
| Get request | `GET /provisioning/requests/{id}` | — |
| Transition | `POST /provisioning/requests/{id}/transition` | `provisioning` |
| Verify | `POST /provisioning/requests/{id}/verify` | `provisioning` |
| Assign | `POST /provisioning/requests/{id}/assign` | `provisioning` |
| Cancel | `POST /provisioning/requests/{id}/cancel` | `provisioning` |

### A.8 Handoff Operations

| Operation | REST Endpoint | WebSocket Topic |
|-----------|---------------|-----------------|
| Initiate handoff | `POST /handoffs` | `handoffs` |
| Get handoff | `GET /handoffs/{id}` | — |
| Accept handoff | `POST /handoffs/{id}/accept` | `handoffs` |
| Reject handoff | `POST /handoffs/{id}/reject` | `handoffs` |
| Complete handoff | `POST /handoffs/{id}/complete` | `handoffs` |
| Pending handoffs | `GET /agents/{id}/handoffs/pending` | — |
| Handoff history | `GET /handoffs/history` | — |

### A.9 Collaboration Graph Operations

| Operation | REST Endpoint | WebSocket Topic |
|-----------|---------------|-----------------|
| Full graph | `GET /collaboration/graph` | `agents:*`, `reservations`, `conflicts`, `handoffs`, `mail` |
| Agents view | `GET /collaboration/graph/agents` | `agents:*` |
| Files view | `GET /collaboration/graph/files` | `reservations` |
| Graph stats | `GET /collaboration/graph/stats` | — |
| Graph history | `GET /collaboration/graph/history` | — |

### A.10 Context Health Operations

| Operation | REST Endpoint | WebSocket Topic |
|-----------|---------------|-----------------|
| Context window status | `GET /agents/{id}/context-window` | `context.health` |
| Context health events | — | `context.health` (events: `context.warning`, `context.compacted`, `context.emergency_rotated`) |

### A.11 Agent Performance Analytics

| Operation | REST Endpoint | WebSocket Topic |
|-----------|---------------|-----------------|
| Get agent performance | `GET /analytics/agents/{id}/performance` | — |
| Compare models | `GET /analytics/models/compare` | — |
| Agent trends | `GET /analytics/agents/{id}/trends` | — |
| Performance recommendations | `GET /analytics/recommendations` | — |

### A.12 Cost Analytics

| Operation | REST Endpoint | WebSocket Topic |
|-----------|---------------|-----------------|
| Cost snapshot | `GET /analytics/costs` | — |
| Cost forecast | `GET /analytics/costs/forecast` | — |
| Cost by model | `GET /analytics/costs/by-model` | — |
| Cost by agent | `GET /analytics/costs/by-agent` | — |
| Budget status | `GET /analytics/budget` | `costs.budget` |
| Cost alerts | — | `costs.alert` |
| Optimization suggestions | `GET /analytics/costs/optimizations` | — |

### A.13 Flywheel Velocity

| Operation | REST Endpoint | WebSocket Topic |
|-----------|---------------|-----------------|
| Velocity snapshot | `GET /analytics/velocity` | — |
| Stage metrics | `GET /analytics/velocity/stages` | — |
| Learning rate | `GET /analytics/velocity/learning` | — |
| Velocity history | `GET /analytics/velocity/history` | — |

### A.14 Custom Dashboards

| Operation | REST Endpoint | WebSocket Topic |
|-----------|---------------|-----------------|
| List dashboards | `GET /dashboards` | — |
| Create dashboard | `POST /dashboards` | — |
| Get dashboard | `GET /dashboards/{id}` | — |
| Update dashboard | `PUT /dashboards/{id}` | — |
| Delete dashboard | `DELETE /dashboards/{id}` | — |
| Dashboard widgets | `GET /dashboards/{id}/widgets` | — |

### A.15 Notifications

| Operation | REST Endpoint | WebSocket Topic |
|-----------|---------------|-----------------|
| List notifications | `GET /notifications` | `notifications` |
| Get notification | `GET /notifications/{id}` | — |
| Mark as read | `POST /notifications/{id}/read` | — |
| Execute action | `POST /notifications/{id}/action` | — |
| Mark all read | `POST /notifications/read-all` | — |
| Get preferences | `GET /notifications/preferences` | — |
| Update preferences | `PUT /notifications/preferences` | — |
| Test notification | `POST /notifications/test` | `notifications` |

### A.16 System Operations

| Operation | REST Endpoint | WebSocket Topic |
|-----------|---------------|-----------------|
| Health check | `GET /health` | — |
| Version | `GET /version` | — |
| Capabilities | `GET /capabilities` | — |
| Doctor | `GET /doctor` | — |
| Supervisor status | `GET /supervisor/status` | `supervisor` |
| Start daemon | `POST /supervisor/{name}/start` | `supervisor` |
| Stop daemon | `POST /supervisor/{name}/stop` | `supervisor` |
| Alerts | `GET /alerts` | `alerts` |
| Acknowledge alert | `POST /alerts/{id}/acknowledge` | `alerts` |
| Metrics | `GET /metrics` | `metrics` |
| Audit log | `GET /audit` | — |

### A.17 Fleet/RU Operations

| Operation | REST Endpoint | WebSocket Topic |
|-----------|---------------|-----------------|
| List repos | `GET /fleet/repos` | — |
| Get repo | `GET /fleet/repos/{id}` | — |
| Fleet sync | `POST /fleet/sync` | `fleet` |
| Repo sync | `POST /fleet/repos/{id}/sync` | `fleet` |
| Fleet status | `GET /fleet/status` | — |
| Start agent-sweep | `POST /fleet/agent-sweep` | `fleet.sweep` |
| Get sweep status | `GET /fleet/agent-sweep/{id}` | — |
| Approve sweep | `POST /fleet/agent-sweep/{id}/approve` | `fleet.sweep` |
| Sweep history | `GET /fleet/agent-sweep/history` | — |

### A.18 DCG Operations

| Operation | REST Endpoint | WebSocket Topic |
|-----------|---------------|-----------------|
| Get config | `GET /dcg/config` | — |
| Update config | `PUT /dcg/config` | — |
| List packs | `GET /dcg/packs` | — |
| Enable pack | `POST /dcg/packs/{pack}/enable` | — |
| Disable pack | `POST /dcg/packs/{pack}/disable` | — |
| List blocks | `GET /dcg/blocks` | `dcg` |
| Mark false positive | `POST /dcg/blocks/{id}/false-positive` | — |
| List allowlist | `GET /dcg/allowlist` | — |
| Add allowlist | `POST /dcg/allowlist` | — |
| Remove allowlist | `DELETE /dcg/allowlist/{ruleId}` | — |
| Get stats | `GET /dcg/stats` | — |

### A.19 Developer Utilities Operations

| Operation | REST Endpoint | WebSocket Topic |
|-----------|---------------|-----------------|
| List utilities | `GET /utilities` | — |
| Install utility | `POST /utilities/{name}/install` | — |
| Update utility | `POST /utilities/{name}/update` | — |
| Utilities doctor | `GET /utilities/doctor` | — |

---

*Plan Version: 3.7.0 — Open Source Focus Edition*
*Last Updated: January 8, 2026*

**Changelog v3.7.0:**
- **Major: Expanded Flywheel Ecosystem Tools**
  - Added §17.5 RU (Repo Updater) Integration
    - Fleet management for multi-repo sync and status
    - Agent-sweep orchestration (three-phase: analyze → plan → execute)
    - REST API endpoints and WebSocket events for fleet operations
    - Integration with SLB for plan approval workflow
  - Added §17.6 DCG (Destructive Command Guard) Integration
    - Pre-execution hook integration for command safety
    - Block event capture and statistics dashboard
    - Allowlist management via UI
    - Integration with SLB and CM for false positive learning
  - Added §17.7 Developer Utilities Integration
    - Auto-install system for giil and csctf
    - giil: Cloud photo download for AI visual analysis
    - csctf: AI chat conversation archival to Markdown/HTML
- Updated §2.2 The Flywheel Tools table (now 10 core tools + 2 utilities)
- Updated preface: Added tools #10 (RU), #11 (DCG), and Developer Utilities section
- Updated §27 Implementation Phases:
  - Phase 1: Added DCG integration and utilities auto-install
  - Phase 3: Added RU integration and DCG advanced features
- Added API Parity Matrix entries (A.17-A.19) for Fleet, DCG, Utilities
- DCG replaces the simpler Python-based approach with sub-millisecond Rust performance

**Changelog v3.5.0:**
- **Major: Advanced Analytics & Notification System**
  - Added §21.5 Agent Performance Analytics
    - Per-agent productivity, quality, and efficiency metrics
    - Model comparison reports with AI recommendations
    - Trend analysis (improving, stable, declining)
    - Radar chart visualization of performance profile
  - Added §21.6 Cost Analytics & Optimization
    - Real-time cost tracking by model, agent, and task type
    - Budget status with visual progress bars
    - 30-day cost forecasting with confidence intervals
    - AI-generated optimization recommendations with estimated savings
  - Added §21.7 Flywheel Velocity Dashboard
    - Velocity score (0-100) measuring ecosystem health
    - Per-stage metrics (Plan, Coordinate, Execute, Scan, Remember)
    - Learning rate tracking (improvement rate, knowledge reuse, error reduction)
    - Trend indicators (accelerating, stable, decelerating)
  - Added §21.8 Custom Dashboard Builder
    - Drag-and-drop widget placement (react-grid-layout)
    - Widget types: metric cards, charts, tables, agent lists, activity feeds
    - Per-user dashboard customization with sharing options
    - Auto-refresh configuration
  - Added §21.9 Comprehensive Notification System
    - Multi-channel delivery: in-app, email, Slack, webhooks
    - Per-category notification preferences
    - Quiet hours with urgent bypass option
    - Daily/weekly digest emails
    - Real-time notification center with unread badge
- Updated §26 Risk Register with new mitigations (cost overruns, notification fatigue, performance blind spots)
- Updated §27 Implementation Phases - analytics and notifications added to Phase 4
- Added API Parity Matrix entries (A.11-A.15) for Analytics, Dashboards, Notifications

**Changelog v3.4.0:**
- **Major: Enhanced Multi-Agent Coordination & Reliability**
  - Added §7.6 Auto-Healing Context Window Management
    - Graduated health thresholds (warning 75%, critical 85%, emergency 95%)
    - Proactive summarization before compaction needed
    - Seamless agent rotation with automatic context transfer
    - WebSocket events for real-time health monitoring
  - Added §7.3.1 Delta-Based Progressive Checkpointing
    - Incremental storage (only what changed since last checkpoint)
    - ~55% storage reduction compared to full checkpoints
    - Automatic compaction of old delta chains
    - Every 5th checkpoint is full (bounded restore time)
  - Added §7.8 First-Class Session Handoff Protocol
    - Structured protocol for agent-to-agent work transfer
    - Context transfer (files, decisions, conversation summary)
    - Resource transfer (file reservations, checkpoints)
    - Integration with Agent Mail for notifications
  - Added §12.6 Intelligent Conflict Resolution Assistant
    - AI-powered resolution suggestions using BV priorities, checkpoint progress, CASS history
    - Strategies: wait, split, transfer, coordinate, escalate
    - Auto-resolution rules for low-risk conflicts
    - Confidence scoring and human-readable rationale
  - Added §22.4 Real-Time Agent Collaboration Graph
    - Interactive visualization using React Flow (@xyflow/react)
    - Shows agents, file reservations, conflicts, and handoffs
    - Real-time updates via WebSocket subscriptions
    - Multiple view modes: Agents only, Files, Full
    - Semantic clustering by active tasks
- Updated §26 Risk Register with new mitigation references
- Updated §27 Implementation Phases to include new features in Phases 2 & 3
- Added API Parity Matrix entries (A.8-A.10) for Handoffs, Collaboration Graph, Context Health

**Changelog v3.6.0:**
- Moved Multi-Tenant Hosted Mode architecture (former §31) to private business documentation
- Removed managed-specific content: workspace models, fleet management, automation ops, ops configs
- This document now focuses purely on Flywheel Gateway as open source software

**Changelog v2.1.0:**
- Added §4.4 API Parity Guarantee with Command Registry pattern
- Enhanced §8.5 with comprehensive Error Taxonomy and HTTP status mappings
- Added §8.10 Golden Path example for AI agent consumers
- Added §9.8 Reliability & Acknowledgment Protocol
- Added §9.9 Scale-Out Architecture with Redis adapter
- Enhanced §22.1 Design System with CSS custom properties and Tailwind config
- Added §25.7 Parity Gate Tests for CI enforcement
