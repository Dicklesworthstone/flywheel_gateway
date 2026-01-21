# Context Reference

Context pack building patterns from NTM.

## Context Packs

A context pack is a structured collection of information to bootstrap an agent:

```typescript
interface ContextPack {
  // Identity
  session_id: string;
  agent_type: string;

  // Project info
  project: {
    path: string;
    name: string;
    description?: string;
  };

  // Instructions
  agents_md?: string; // Contents of AGENTS.md
  readme_md?: string; // Contents of README.md

  // Current state
  beads: {
    ready: BeadSummary[];
    in_progress: BeadSummary[];
    recently_closed: BeadSummary[];
  };

  // Coordination
  mail: {
    inbox_count: number;
    unread_count: number;
    recent_threads: ThreadSummary[];
  };

  // File context
  files: {
    recently_modified: string[];
    reservations: ReservationInfo[];
  };

  // History
  recent_commits: CommitSummary[];
  recent_sessions?: SessionSummary[];
}
```

## Building Context

Priority order for context inclusion:

1. **Critical** - AGENTS.md, active beads, urgent mail
2. **Important** - Recent commits, file reservations
3. **Helpful** - README, session history
4. **Optional** - Extended project docs

## Token Budget

Estimate token usage and trim to fit context window:

```typescript
function buildContextPack(budget: number): ContextPack {
  let remaining = budget;
  const pack: ContextPack = { ... };

  // Add critical items first
  remaining -= estimateTokens(pack.agents_md);
  if (remaining < 0) truncate(pack.agents_md);

  // Continue with less critical items
  // ...
}
```

## Gateway Integration

See `apps/gateway/src/services/context.service.ts` for implementation.
