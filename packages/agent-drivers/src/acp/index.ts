/**
 * ACP (Agent Client Protocol) Driver exports.
 *
 * The ACP driver communicates with agent processes using JSON-RPC 2.0
 * over stdio, providing structured events compatible with IDE integrations.
 */

export {
  AcpDriver,
  type AcpDriverOptions,
  createAcpDriver,
} from "./acp-driver";
