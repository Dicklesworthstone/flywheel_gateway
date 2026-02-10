/**
 * Claude Code websocket driver exports.
 *
 * Runs Claude Code CLI via `--sdk-url` and maps websocket NDJSON events into
 * Flywheel's driver abstraction.
 */

export {
  ClaudeCodeWsDriver,
  type ClaudeCodeWsDriverOptions,
  createClaudeCodeWsDriver,
} from "./claude-code-ws-driver";
