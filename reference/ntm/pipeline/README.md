# Pipeline Reference

Pipeline execution patterns from NTM.

## Concepts

### Pipeline Definition

A pipeline is a directed acyclic graph (DAG) of stages:

```typescript
interface Pipeline {
  id: string;
  name: string;
  stages: Stage[];
  edges: Edge[];
}

interface Stage {
  id: string;
  type: "agent" | "gate" | "parallel" | "checkpoint";
  config: StageConfig;
}

interface Edge {
  from: string;
  to: string;
  condition?: string; // Optional condition for branching
}
```

### Stage Types

1. **Agent Stage** - Spawns an agent to do work
2. **Gate Stage** - Approval checkpoint (SLB, human review)
3. **Parallel Stage** - Fan-out to multiple parallel tracks
4. **Checkpoint Stage** - Save state for recovery

### Execution Model

```typescript
interface PipelineExecution {
  pipeline_id: string;
  status: "pending" | "running" | "paused" | "completed" | "failed";
  current_stage: string;
  stage_results: Record<string, StageResult>;
  started_at: string;
  completed_at?: string;
}
```

### Recovery

Pipelines support resume from checkpoint:

1. Serialize execution state
2. Store checkpoint with stage results
3. On resume, skip completed stages
4. Re-run only pending/failed stages

## Gateway Integration

See `apps/gateway/src/routes/pipelines.ts` for the REST API.
