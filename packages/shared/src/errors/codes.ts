/**
 * Canonical error codes for Flywheel Gateway.
 * Each entry defines the default HTTP status and message.
 */
export const ErrorCodes = {
  // Agent lifecycle
  AGENT_NOT_FOUND: { httpStatus: 404, message: "Agent not found" },
  AGENT_ALREADY_EXISTS: {
    httpStatus: 409,
    message: "Agent with this ID already exists",
  },
  AGENT_ALREADY_RUNNING: {
    httpStatus: 409,
    message: "Agent is already running",
  },
  AGENT_NOT_READY: { httpStatus: 503, message: "Agent is still starting" },
  AGENT_TERMINATED: { httpStatus: 410, message: "Agent has been terminated" },
  AGENT_BUSY: {
    httpStatus: 409,
    message: "Agent is processing another request",
  },
  AGENT_TIMEOUT: { httpStatus: 408, message: "Agent response timed out" },
  AGENT_ERROR_STATE: { httpStatus: 409, message: "Agent is in error state" },

  // Spawn
  SPAWN_FAILED: { httpStatus: 500, message: "Failed to spawn agent" },
  SPAWN_QUOTA_EXCEEDED: { httpStatus: 429, message: "Spawn quota exceeded" },
  SPAWN_INVALID_CONFIG: {
    httpStatus: 400,
    message: "Invalid spawn configuration",
  },
  SPAWN_DRIVER_UNAVAILABLE: {
    httpStatus: 503,
    message: "Requested driver unavailable",
  },

  // Driver
  DRIVER_NOT_FOUND: { httpStatus: 400, message: "Unknown driver type" },
  DRIVER_INIT_FAILED: {
    httpStatus: 500,
    message: "Driver failed to initialize",
  },
  DRIVER_COMMUNICATION_ERROR: {
    httpStatus: 502,
    message: "Driver communication error",
  },
  DRIVER_PROTOCOL_ERROR: { httpStatus: 502, message: "Driver protocol error" },

  // WebSocket
  WS_CONNECTION_FAILED: {
    httpStatus: 502,
    message: "WebSocket connection failed",
  },
  WS_AUTHENTICATION_REQUIRED: {
    httpStatus: 401,
    message: "WebSocket authentication required",
  },
  WS_SUBSCRIPTION_DENIED: {
    httpStatus: 403,
    message: "WebSocket subscription denied",
  },
  WS_CURSOR_EXPIRED: { httpStatus: 410, message: "WebSocket cursor expired" },
  WS_RATE_LIMITED: {
    httpStatus: 429,
    message: "WebSocket rate limit exceeded",
  },

  // Authentication / authorization
  AUTH_TOKEN_INVALID: {
    httpStatus: 401,
    message: "Authentication token invalid",
  },
  AUTH_TOKEN_EXPIRED: {
    httpStatus: 401,
    message: "Authentication token expired",
  },
  AUTH_INSUFFICIENT_SCOPE: {
    httpStatus: 403,
    message: "Insufficient authorization scope",
  },
  AUTH_TENANT_SUSPENDED: { httpStatus: 403, message: "Tenant is suspended" },

  // Rate limiting / quota
  RATE_LIMIT_EXCEEDED: { httpStatus: 429, message: "Rate limit exceeded" },
  RATE_CONCURRENT_LIMIT: {
    httpStatus: 429,
    message: "Concurrent operation limit exceeded",
  },
  RATE_LIMITED: { httpStatus: 429, message: "Too many requests" },
  QUOTA_EXCEEDED: { httpStatus: 429, message: "Quota exceeded" },

  // Accounts / BYOA
  ACCOUNT_NOT_FOUND: { httpStatus: 404, message: "Account not found" },
  ACCOUNT_DISABLED: { httpStatus: 403, message: "Account is disabled" },
  NO_HEALTHY_ACCOUNTS: {
    httpStatus: 503,
    message: "No healthy accounts available",
  },
  BYOA_REQUIRED: {
    httpStatus: 412,
    message: "BYOA required before assignment",
  },
  EMAIL_NOT_VERIFIED: {
    httpStatus: 412,
    message: "Email verification required",
  },

  // Provisioning
  PROVISIONING_NOT_FOUND: {
    httpStatus: 404,
    message: "Provisioning request not found",
  },
  PROVISIONING_INVALID_TRANSITION: {
    httpStatus: 409,
    message: "Invalid provisioning state transition",
  },
  PROVISIONING_NOT_VERIFIED: {
    httpStatus: 412,
    message: "Provisioning not verified",
  },
  PROVISIONING_ASSIGN_BLOCKED: {
    httpStatus: 409,
    message: "Provisioning assignment blocked",
  },

  // Reservations
  RESERVATION_CONFLICT: { httpStatus: 409, message: "Reservation conflict" },
  RESERVATION_EXPIRED: { httpStatus: 410, message: "Reservation expired" },
  RESERVATION_NOT_FOUND: { httpStatus: 404, message: "Reservation not found" },

  // Checkpoints
  CHECKPOINT_NOT_FOUND: { httpStatus: 404, message: "Checkpoint not found" },
  CHECKPOINT_CORRUPTED: {
    httpStatus: 422,
    message: "Checkpoint data corrupted",
  },
  RESTORE_IN_PROGRESS: {
    httpStatus: 409,
    message: "Restore already in progress",
  },
  RESTORE_FAILED: { httpStatus: 500, message: "Restore failed" },

  // Mail
  RECIPIENT_NOT_FOUND: { httpStatus: 404, message: "Recipient not found" },
  CONTACT_NOT_APPROVED: { httpStatus: 403, message: "Contact not approved" },
  MESSAGE_NOT_FOUND: { httpStatus: 404, message: "Message not found" },

  // Beads
  BEAD_NOT_FOUND: { httpStatus: 404, message: "Bead not found" },
  BEAD_ALREADY_CLOSED: { httpStatus: 409, message: "Bead already closed" },
  CIRCULAR_DEPENDENCY: {
    httpStatus: 422,
    message: "Circular dependency detected",
  },

  // Scanner
  SCAN_IN_PROGRESS: { httpStatus: 409, message: "Scan already in progress" },
  SCANNER_UNAVAILABLE: { httpStatus: 503, message: "Scanner unavailable" },

  // Daemon
  DAEMON_NOT_RUNNING: {
    httpStatus: 503,
    message: "Required daemon not running",
  },
  DAEMON_START_FAILED: { httpStatus: 500, message: "Failed to start daemon" },

  // Validation
  INVALID_REQUEST: { httpStatus: 400, message: "Request validation failed" },
  INVALID_MODEL: { httpStatus: 400, message: "Invalid model type" },
  INVALID_DRIVER: { httpStatus: 400, message: "Invalid driver type" },
  MISSING_REQUIRED_FIELD: {
    httpStatus: 400,
    message: "Required field missing",
  },

  // Safety / approvals
  APPROVAL_REQUIRED: { httpStatus: 202, message: "Approval required" },
  SAFETY_VIOLATION: { httpStatus: 403, message: "Safety rules violation" },
  DCG_BLOCKED: { httpStatus: 403, message: "Command blocked by DCG" },
  DCG_PACK_NOT_FOUND: { httpStatus: 404, message: "DCG pack not found" },

  // Fleet / utilities
  FLEET_REPO_NOT_FOUND: {
    httpStatus: 404,
    message: "Fleet repository not found",
  },
  FLEET_SYNC_IN_PROGRESS: {
    httpStatus: 409,
    message: "Fleet sync already in progress",
  },
  SWEEP_NOT_FOUND: { httpStatus: 404, message: "Agent sweep not found" },
  SWEEP_APPROVAL_REQUIRED: {
    httpStatus: 202,
    message: "Sweep approval required",
  },
  UTILITY_NOT_FOUND: { httpStatus: 404, message: "Utility not found" },
  UTILITY_INSTALL_FAILED: {
    httpStatus: 500,
    message: "Utility install failed",
  },

  // System
  SYSTEM_UNAVAILABLE: { httpStatus: 503, message: "System unavailable" },
  SYSTEM_INTERNAL_ERROR: { httpStatus: 500, message: "System internal error" },
  SYSTEM_RESOURCE_EXHAUSTED: {
    httpStatus: 503,
    message: "System resources exhausted",
  },
  INTERNAL_ERROR: { httpStatus: 500, message: "Internal server error" },
  NOT_IMPLEMENTED: { httpStatus: 501, message: "Feature not implemented" },
} as const;

export type ErrorCode = keyof typeof ErrorCodes;

export const ERROR_CODE_LIST = Object.keys(ErrorCodes) as ErrorCode[];

export const HTTP_STATUS_MAP: Record<ErrorCode, number> =
  ERROR_CODE_LIST.reduce(
    (acc, code) => {
      acc[code] = ErrorCodes[code].httpStatus;
      return acc;
    },
    {} as Record<ErrorCode, number>,
  );

export const DEFAULT_ERROR_MESSAGES: Record<ErrorCode, string> =
  ERROR_CODE_LIST.reduce(
    (acc, code) => {
      acc[code] = ErrorCodes[code].message;
      return acc;
    },
    {} as Record<ErrorCode, string>,
  );

/** Returns the HTTP status code for the given error code. */
export function getHttpStatus(code: ErrorCode): number {
  return ErrorCodes[code].httpStatus;
}

/** Returns the default message for the given error code. */
export function getDefaultMessage(code: ErrorCode): string {
  return ErrorCodes[code].message;
}
