# Getting Started with Flywheel Gateway

This guide walks you through setting up Flywheel Gateway from scratch in under 15 minutes.

## Prerequisites

Before starting, ensure you have:

- **Bun 1.3+** - Install from [bun.sh](https://bun.sh): `curl -fsSL https://bun.sh/install | bash`
- **Git** - For version control
- **8GB+ RAM** - Recommended for running multiple agents

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/Dicklesworthstone/flywheel_gateway.git
cd flywheel_gateway
```

### 2. Install Dependencies

```bash
bun install
```

This installs all workspace dependencies for the gateway, web UI, and packages.

### 3. Initialize the Database

```bash
# Generate migrations from schema
bun run db:generate

# Apply migrations to create database
bun run db:push
```

The database file will be created at `data/gateway.db` (SQLite).

### 4. Configure Environment

Create a `.env` file in the project root:

```bash
# Server configuration
PORT=3000
NODE_ENV=development

# Database
DATABASE_URL=file:./data/gateway.db

# Logging
LOG_LEVEL=info

# Optional: AI Provider Keys (for direct API access)
# ANTHROPIC_API_KEY=sk-ant-...
# OPENAI_API_KEY=sk-...
# GOOGLE_AI_API_KEY=...
```

### 5. Start Development Servers

```bash
bun run dev
```

This starts:
- **Gateway API** at http://localhost:3000
- **Web Dashboard** at http://localhost:5173

## Verify Installation

### Check Health Endpoint

```bash
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "ok",
  "version": "1.0.0",
  "uptime": "..."
}
```

### Access the Dashboard

Open http://localhost:5173 in your browser. You should see the Flywheel Gateway dashboard.

### View API Documentation

- **Swagger UI**: http://localhost:3000/docs
- **ReDoc**: http://localhost:3000/redoc
- **OpenAPI JSON**: http://localhost:3000/openapi.json

## First Steps

### 1. Create an Account

The gateway uses accounts to manage API credentials. Create your first account:

```bash
curl -X POST http://localhost:3000/accounts \
  -H "Content-Type: application/json" \
  -d '{"name": "my-account", "email": "user@example.com"}'
```

### 2. Spawn an Agent

Spawn your first AI agent:

```bash
curl -X POST http://localhost:3000/agents/spawn \
  -H "Content-Type: application/json" \
  -d '{
    "workingDirectory": "/path/to/your/project",
    "systemPrompt": "You are a helpful coding assistant."
  }'
```

### 3. Send a Message

Once the agent is ready, send it a message:

```bash
curl -X POST http://localhost:3000/agents/{agentId}/send \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello! Can you help me understand this codebase?"}'
```

### 4. Monitor via WebSocket

Connect to the WebSocket for real-time updates:

```javascript
const ws = new WebSocket('ws://localhost:3000/ws');

ws.onopen = () => {
  // Subscribe to agent output
  ws.send(JSON.stringify({
    type: 'subscribe',
    channel: 'agent:output:*'
  }));
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Agent output:', data);
};
```

## Project Structure

```
flywheel_gateway/
├── apps/
│   ├── gateway/          # Backend API (Hono + WebSocket)
│   │   ├── src/
│   │   │   ├── routes/   # REST API endpoints (30+)
│   │   │   ├── services/ # Business logic (60+ services)
│   │   │   ├── db/       # Drizzle ORM schema
│   │   │   ├── ws/       # WebSocket hub
│   │   │   └── middleware/
│   │   └── tests/
│   └── web/              # Frontend (React 19 + Vite)
│       └── src/
│           ├── components/
│           ├── pages/
│           └── stores/
├── packages/
│   ├── shared/           # Shared types and schemas
│   ├── agent-drivers/    # Agent execution drivers
│   └── flywheel-clients/ # Client SDKs
├── tests/                # Integration & E2E tests
└── docs/                 # Documentation
```

## Key Concepts

### Agents

Agents are AI coding assistants that execute tasks in a working directory. Each agent has:
- **State**: idle, executing, ready, terminated
- **Output**: Streamed via WebSocket
- **Checkpoints**: Automatic state snapshots

### BYOA (Bring Your Own Account)

Link your own AI provider accounts for direct billing:
1. Navigate to **Accounts** in the dashboard
2. Click **Add Account** and complete the provider flow
3. The gateway handles rate-limit rotation automatically

### DCG (Destructive Command Guard)

DCG prevents dangerous operations before execution:
- **Git destructive ops**: `reset --hard`, `push --force`
- **Filesystem ops**: `rm -rf` outside safe directories
- **Database ops**: `DROP`, `DELETE` without WHERE

Review blocked commands in the DCG dashboard.

### Cost Analytics

Track AI usage costs at `/cost-analytics`:
- **Budget management**: Set limits per project/org
- **Forecasting**: 30-day cost predictions
- **Optimization**: AI-powered recommendations

## Development Workflow

### Run Tests

```bash
# All tests
bun run test

# Specific test file
bun test apps/gateway/src/__tests__/agent.service.test.ts

# With coverage
bun run test -- --coverage
```

### Lint and Format

```bash
# Check and fix
bun run lint:fix

# Check only
bun run lint
```

### Database Operations

```bash
# Generate migration from schema changes
bun run db:generate

# Apply migrations
bun run db:push

# Open Drizzle Studio (visual DB editor)
bun run db:studio
```

### Build for Production

```bash
bun run build
```

## Troubleshooting

### Port Already in Use

```bash
# Find and kill process on port 3000
lsof -ti:3000 | xargs kill -9
```

### Database Errors

```bash
# Reset database (development only)
rm -f data/gateway.db
bun run db:push
```

### WebSocket Connection Issues

Ensure the gateway is running and check browser console for CORS errors.

## Next Steps

- [Architecture Overview](architecture.md) - Understand system design
- [API Guide](api-guide.md) - Learn API patterns
- [Deployment Guide](deployment.md) - Production setup
- [AGENTS.md](../AGENTS.md) - Codebase conventions

## Getting Help

- **Issues**: Report bugs on GitHub Issues
- **Discussions**: Ask questions in GitHub Discussions
- **Docs**: Check the `/docs` directory
