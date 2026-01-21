# BV Reference

Graph-aware triage patterns from [beads_viewer](https://github.com/Dicklesworthstone/beads_viewer).

## Key Patterns

### Robot Commands

Always use `--robot-*` flags for machine-readable output:

```bash
# Primary entry point - comprehensive triage
bv --robot-triage

# Single top pick
bv --robot-next

# Parallel execution tracks
bv --robot-plan

# Graph metrics
bv --robot-insights
```

### Triage Output Structure

```typescript
interface TriageOutput {
  quick_ref: {
    open_count: number;
    actionable_count: number;
    blocked_count: number;
    in_progress_count: number;
    top_picks: TopPick[];
  };
  recommendations: Recommendation[];
  quick_wins: QuickWin[];
  blockers_to_clear: Blocker[];
  project_health: ProjectHealth;
  commands: CommandHints;
}
```

### Metrics Computed

- PageRank - Influence/importance
- Betweenness - Bridge nodes
- Critical path - Longest dependency chain
- Cycles - Must fix!
- HITS - Hub/authority scores
- K-core - Dense subgraph membership
- Eigenvector - Connected to important nodes

### Integration with Gateway

The gateway's `bv.service.ts` wraps these patterns for the dashboard.
