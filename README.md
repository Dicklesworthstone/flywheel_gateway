# Flywheel Gateway

**SDK-first multi-agent orchestration platform** for managing AI coding agents at scale.

[![CI](https://github.com/Dicklesworthstone/flywheel_gateway/actions/workflows/ci.yml/badge.svg)](https://github.com/Dicklesworthstone/flywheel_gateway/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Overview

Flywheel Gateway provides infrastructure for orchestrating multiple AI coding agents (Claude, Codex, Gemini) with:

- **BYOA (Bring Your Own Account)** - Use your own API keys with automatic rotation and failover
- **Real-time Dashboard** - Monitor agent sessions, outputs, and health via WebSocket
- **DCG (Destructive Command Guard)** - Prevent dangerous operations before they execute
- **Fleet Management** - Coordinate agents across multiple repositories
- **Cross-Agent Search** - Learn from past agent sessions via CASS indexing

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) 1.3+
- Node.js 20+ (for some tooling)

### Installation

```bash
# Clone the repository
git clone https://github.com/Dicklesworthstone/flywheel_gateway.git
cd flywheel_gateway

# Install dependencies
bun install

# Initialize the database
bun db:migrate

# Start development servers
bun dev
```

The gateway API will be available at `http://localhost:3000` and the web dashboard at `http://localhost:5173`.

### Environment Variables

Create a `.env` file in the root directory:

```bash
# Database (SQLite for development)
DATABASE_URL="file:./data/gateway.db"

# Authentication
JWT_SECRET="your-secret-key-at-least-32-chars"

# Optional: External services
ANTHROPIC_API_KEY=""
OPENAI_API_KEY=""
GOOGLE_AI_API_KEY=""
```

## Architecture

```
flywheel_gateway/
├── apps/
│   ├── gateway/          # Hono API server + WebSocket
│   └── web/              # React dashboard
├── packages/
│   ├── shared/           # Shared types and utilities
│   ├── flywheel-clients/ # SDK clients (CASS, CM)
│   └── test-utils/       # Testing utilities
├── tests/
│   ├── e2e/              # Playwright E2E tests
│   ├── contract/         # API schema validation
│   └── load/             # k6 load tests
└── docs/                 # Documentation
```

### Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Bun 1.3+ |
| Backend | Hono 4.11+, Drizzle ORM, bun:sqlite |
| Frontend | React 19, Vite 7, TanStack Router/Query |
| Testing | Bun test, Playwright, k6 |
| Tooling | TypeScript 5.9+, Biome 2.0+ |

## Development

```bash
# Run all apps in development mode
bun dev

# Run tests
bun run test

# Run E2E tests
bun test:e2e

# Lint and format
bun lint:fix
bun format

# Type checking
bun typecheck

# Database operations
bun db:generate    # Generate migrations
bun db:migrate     # Apply migrations
bun db:studio      # Open Drizzle Studio
```

## API Overview

The gateway exposes a RESTful API with WebSocket support for real-time updates.

### Key Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check with version and uptime |
| `GET /api/agents` | List all agents |
| `POST /api/agents` | Create a new agent |
| `GET /api/sessions` | List sessions |
| `WS /ws` | WebSocket for real-time updates |

See [API Documentation](docs/api/) for the complete OpenAPI specification.

## Features

### BYOA (Bring Your Own Account)

Link your own AI provider accounts for direct billing and control:

1. Navigate to **Accounts** in the dashboard
2. Click **Add Account** and select a provider
3. Complete OAuth or paste your API key
4. The gateway handles rotation and failover automatically

### DCG (Destructive Command Guard)

DCG is a pre-execution safety layer that blocks dangerous commands:

- Git destructive ops (`reset --hard`, `push --force`)
- Filesystem ops (`rm -rf` outside safe directories)
- Database ops (`DROP`, `TRUNCATE`, `DELETE` without WHERE)

Commands are blocked before execution with clear explanations.

### Fleet Management

Coordinate agents across multiple repositories:

```bash
ru sync              # Sync all repos in fleet
ru status            # View fleet status
ru agent-sweep       # Run automated maintenance
```

## Integration Direction (2026)

- **ACFS manifest registry (in progress)** — Setup/detection will read tool metadata from the ACFS manifest to keep UI, readiness, and CLI inventory in sync.
- **NTM execution plane (in progress)** — NTM driver + ingest/WS bridge for unified agent state, telemetry, and fleet coordination.

## Documentation

- [Getting Started Guide](docs/user-guide/getting-started.md)
- [Architecture Overview](docs/architecture/README.md)
- [Deployment Guide](docs/deployment/README.md)
- [API Reference](docs/api/)
- [Agent Guidelines](AGENTS.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

## License

MIT License - see [LICENSE](LICENSE) for details.
