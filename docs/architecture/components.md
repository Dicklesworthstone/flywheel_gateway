# Component Architecture

Detailed documentation of Flywheel Gateway's component architecture.

## Gateway Server Components

### Directory Structure

```
apps/gateway/src/
├── index.ts              # Entry point (Hono + Bun.serve)
├── startup-warnings.ts   # Startup security warnings
├── api/                  # OpenAPI + schema helpers
├── caam/                 # BYOA / CAAM helpers
├── config/               # Driver + app configuration
├── jobs/                 # Background jobs
├── routes/               # HTTP route handlers
│   ├── index.ts          # Route aggregation
│   ├── agents.ts         # Agent CRUD
│   └── ...
├── services/             # Business logic
│   ├── agent.ts
│   ├── context.service.ts
│   ├── dcg.service.ts
│   └── ...
├── middleware/           # HTTP middleware
│   ├── auth.ts           # Authentication
│   ├── rate-limit.ts     # Rate limiting
│   └── security-headers.ts
├── ws/                   # WebSocket handling
│   ├── hub.ts            # Connection hub
│   ├── handlers.ts       # Message handlers
│   └── messages.ts       # Message types
├── db/                   # Database
│   ├── schema.ts         # Drizzle schema
│   ├── migrations/       # SQL migrations
│   └── index.ts          # DB connection
├── models/               # Type definitions
├── types/                # Internal types
└── utils/                # Utilities
```

### Route Handlers

Route handlers are thin wrappers that:
1. Parse and validate input
2. Call service methods
3. Format responses

```typescript
// Example: apps/gateway/src/routes/agents.ts
export const agentsRoutes = new Hono()
  .get('/', async (c) => {
    const agents = await agentService.list();
    return c.json({ agents });
  })
  .get('/:id', async (c) => {
    const agent = await agentService.getById(c.req.param('id'));
    if (!agent) return c.notFound();
    return c.json(agent);
  })
  .post('/', zValidator('json', CreateAgentSchema), async (c) => {
    const data = c.req.valid('json');
    const agent = await agentService.create(data);
    return c.json(agent, 201);
  });
```

### Service Layer

Services contain business logic and are provider-agnostic:

```typescript
// Example: apps/gateway/src/services/agent.ts
//
// The gateway's agent lifecycle service is implemented as module-level functions
// with an in-memory registry and a driver abstraction (SDK/ACP/Tmux/etc).
//
// See: spawnAgent(), sendMessage(), terminateAgent(), listAgents()
export async function spawnAgent(config: {
  workingDirectory: string;
  systemPrompt?: string;
}): Promise<{
  agentId: string;
  state: "spawning" | "ready";
  createdAt: string;
  driver: string;
}> {
  // 1) Select an AgentDriver (defaults to SDK)
  // 2) Initialize lifecycle state
  // 3) Persist agent row to DB (status=spawning)
  // 4) driver.spawn(...) + start event monitoring
  // 5) Transition to READY

  // ...implementation omitted (see source)
  return {
    agentId: "agent_...",
    state: "ready",
    createdAt: new Date().toISOString(),
    driver: "sdk",
  };
}
```

### WebSocket Hub

Manages real-time connections:

```typescript
// apps/gateway/src/ws/hub.ts
export class WebSocketHub {
  private connections = new Map<string, Set<WebSocket>>();

  join(sessionId: string, ws: WebSocket): void {
    const room = this.connections.get(sessionId) ?? new Set();
    room.add(ws);
    this.connections.set(sessionId, room);
  }

  broadcast(sessionId: string, message: Message): void {
    const room = this.connections.get(sessionId);
    if (!room) return;

    const data = JSON.stringify(message);
    for (const ws of room) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    }
  }
}
```

### Middleware Stack

Middleware processes requests in order:

```
Request → Auth → RateLimit → SecurityHeaders → Handler → Response
```

```typescript
// apps/gateway/src/middleware/auth.ts
export const authMiddleware = async (c: Context, next: Next) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');

  if (!token) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const payload = await verifyToken(token);
    c.set('user', payload);
    await next();
  } catch {
    return c.json({ error: 'Invalid token' }, 401);
  }
};
```

## Web Dashboard Components

### Directory Structure

```
apps/web/src/
├── main.tsx              # Entry point
├── router.tsx            # TanStack Router config
├── App.tsx               # Root component
├── pages/                # Page components
│   ├── Fleet.tsx
│   ├── Sessions.tsx
│   ├── Accounts.tsx
│   └── ...
├── components/           # Reusable components
│   ├── ui/               # Base UI components
│   │   ├── Button.tsx
│   │   ├── Modal.tsx
│   │   └── ...
│   ├── layout/           # Layout components
│   │   ├── Sidebar.tsx
│   │   └── Header.tsx
│   ├── caam/             # CAAM-specific
│   │   ├── DeviceCodeFlow.tsx
│   │   ├── ProfileList.tsx
│   │   └── OnboardingWizard.tsx
│   └── ...
├── hooks/                # Custom hooks
│   ├── useDCG.ts
│   ├── useCAAM.ts
│   └── useFleet.ts
├── lib/                  # Utilities
│   ├── api.ts            # API client
│   └── websocket/        # WebSocket utilities
└── styles/               # CSS/styling
```

### Page Components

Pages are route-level components:

```typescript
// apps/web/src/pages/Fleet.tsx
export function FleetPage() {
  const { data: agents, isLoading } = useAgents();

  if (isLoading) return <Spinner />;

  return (
    <div className="page">
      <h1>Fleet</h1>
      <AgentGrid agents={agents} />
    </div>
  );
}
```

### Custom Hooks

Hooks encapsulate data fetching and state:

```typescript
// apps/web/src/hooks/useAgents.ts
export function useAgents() {
  return useQuery({
    queryKey: ['agents'],
    queryFn: async () => {
      const response = await api.get('/api/agents');
      return response.data.agents;
    },
  });
}
```

### WebSocket Integration

Real-time updates via WebSocket:

```typescript
// apps/web/src/lib/websocket/connection.ts
export function useWebSocket(sessionId: string) {
  const [output, setOutput] = useState<string[]>([]);

  useEffect(() => {
    const ws = new WebSocket(`${WS_URL}/ws`);

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'subscribe', sessionId }));
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'output') {
        setOutput(prev => [...prev, message.data]);
      }
    };

    return () => ws.close();
  }, [sessionId]);

  return { output };
}
```

## Shared Packages

### `packages/shared`

Common types and utilities:

```
packages/shared/src/
├── index.ts              # Exports
├── types/                # Type definitions
│   ├── agent.ts
│   ├── session.ts
│   └── ...
├── schemas/              # Zod schemas
│   ├── agent.schema.ts
│   └── ...
├── api/                  # API utilities
│   ├── envelope.ts       # Response wrapper
│   └── pagination.ts
└── utils/                # Shared utilities
```

### `packages/flywheel-clients`

SDK clients for external services:

```
packages/flywheel-clients/src/
├── cass/                 # CASS client
│   ├── index.ts
│   └── types.ts
└── cm/                   # Context Manager client
    ├── index.ts
    └── types.ts
```

## Component Interactions

### Session Creation Flow

```
FleetPage                 API Client              Gateway Server
    │                         │                         │
    │── createSession() ─────▶│                         │
    │                         │── POST /sessions ──────▶│
    │                         │                         │── SessionService.create()
    │                         │                         │── AgentDriver.execute()
    │                         │◀─── 201 Created ───────│
    │◀─── session ───────────│                         │
    │                         │                         │
    │── subscribe(ws) ───────────────────────────────▶│
    │◀─── output events ─────────────────────────────│
```

### Account Linking Flow

```
AccountsPage           OnboardingWizard        CAAM Service
    │                         │                      │
    │── open wizard ─────────▶│                      │
    │                         │── selectProvider ───▶│
    │                         │                      │
    │                         │── startDeviceCode ──▶│
    │                         │◀─── userCode ────────│
    │                         │                      │
    │                         │   (user visits URL)  │
    │                         │                      │
    │                         │── poll() ───────────▶│
    │                         │◀─── verified ────────│
    │◀─── account linked ────│                      │
```
