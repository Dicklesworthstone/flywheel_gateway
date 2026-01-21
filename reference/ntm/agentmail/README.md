# Agent Mail Reference

MCP client patterns for agent coordination.

The protocol is language-agnostic - see the [MCP Agent Mail](https://github.com/Dicklesworthstone/mcp_agent_mail) project for the canonical implementation.

## Key Patterns

### File Reservations

Glob-based advisory locks for multi-agent coordination:

```typescript
// Reserve before editing
file_reservation_paths({
  project_key: "/abs/path",
  agent_name: "MyAgent",
  paths: ["src/components/**/*.tsx"],
  ttl_seconds: 3600,
  exclusive: true,
  reason: "Implementing feature X",
});
```

### Messaging

Thread-based communication with receipts:

```typescript
// Send message with thread ID for correlation
send_message({
  project_key: "/abs/path",
  sender_name: "MyAgent",
  to: ["OtherAgent"],
  subject: "[bd-123] Implementation update",
  body_md: "Completed step 1...",
  thread_id: "bd-123",
  ack_required: true,
});
```

### Contact Handshake

Cross-project coordination:

```typescript
// Request contact with agent in another project
macro_contact_handshake({
  project_key: "/abs/path",
  to_project: "/other/project",
  to_agent: "TargetAgent",
  reason: "Need to coordinate on shared API",
});
```

## Resources

- `resource://inbox/{agent}?project={path}` - Agent's inbox
- `resource://thread/{id}?project={path}` - Thread messages
- `resource://agents/{project}` - List agents in project
