# NTM Reference Implementations

Reference implementations from the [NTM](https://github.com/Dicklesworthstone/ntm) project that inform Flywheel Gateway's design.

These patterns are adapted from NTM's Go implementation for use in TypeScript. They serve as architectural references, not direct ports.

## Directory Structure

```
reference/ntm/
├── agentmail/    # MCP client patterns (protocol is language-agnostic)
├── bv/           # BV integration patterns
├── robot/        # JSON schema patterns for structured API responses
├── pipeline/     # Pipeline execution model
└── context/      # Context pack building algorithms
```

## Usage

When implementing features in Flywheel Gateway, consult these references for:

1. **Data structures** - Type definitions and schema patterns
2. **API contracts** - Request/response shapes for robot-mode outputs
3. **Algorithms** - Logic patterns for agent health, work detection, etc.

Implement in idiomatic TypeScript; these are references, not copy-paste templates.

## Key Patterns

### Agent Health (robot/agent-health.ts)
Combines local agent state with provider usage data for comprehensive health assessment.

### Is-Working Detection (robot/is-working.ts)
Pattern-based detection of whether an agent is actively working, idle, or rate-limited.

### Smart Restart (robot/smart-restart.ts)
Safe restart mechanism that respects "NEVER interrupt agents doing useful work!!!"

### Robot Response Envelope (robot/types.ts)
Standard envelope for all robot-mode JSON output.
