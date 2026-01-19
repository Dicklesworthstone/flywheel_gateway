/**
 * Sensitive data redaction utilities.
 *
 * Used to prevent leaking API keys, tokens, passwords, and PII in logs.
 */

const REDACTED = "[REDACTED]";

/**
 * Redact an API key, showing only the last 4 characters.
 */
export function redactApiKey(key: string | undefined): string {
  if (!key) return REDACTED;
  if (key.length <= 4) return REDACTED;
  return `...${key.slice(-4)}`;
}

/**
 * Redact a password completely.
 */
export function redactPassword(_password: string | undefined): string {
  return REDACTED;
}

/**
 * Redact an email address, showing first char and domain.
 * Example: "john@example.com" -> "j***@example.com"
 */
export function redactEmail(email: string | undefined): string {
  if (!email) return REDACTED;
  const atIndex = email.indexOf("@");
  if (atIndex <= 0) return REDACTED;
  return `${email[0]}***${email.slice(atIndex)}`;
}

/**
 * Redact potentially sensitive information from a command string.
 * Handles CLI flags, environment variables, and auth headers.
 */
export function redactCommand(command: string): string {
  // Regex to match sensitive keys and their values
  // \b: Word boundary
  // Keys: password, secret, token, api-key, access-key, etc.
  // Separator: = or : or whitespace
  // Value: Quoted string OR non-whitespace chars
  return (
    command
      .replace(
        /(\b(?:password|secret|token|api[_-]?key|access[_-]?key|auth[_-]?token|client[_-]?secret)[=:\s]+)(["'](?:[^"'\\]|\\.)*["']|[^\s]+)/gi,
        "$1[REDACTED]",
      )
      // Handle "Authorization: Bearer <token>" pattern - redact everything after "Authorization:"
      .replace(
        /(\bauthorization[=:\s]+)(bearer\s+)?([^\s'"]+|["'](?:[^"'\\]|\\.)*["'])/gi,
        "$1[REDACTED]",
      )
      // Handle standalone "Bearer <token>" pattern
      .replace(/(\bbearer\s+)([^\s'"]+)/gi, "$1[REDACTED]")
  );
}

/**
 * Keys that should be redacted when logging objects.
 * All keys MUST be lowercase since we compare with key.toLowerCase().
 */
const SENSITIVE_KEYS = new Set([
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "api_key",
  "authorization",
  "auth",
  "credentials",
  "private_key",
  "privatekey",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "x-api-key",
  "x-auth-token",
  "bearer",
  "session",
  "sessionid",
  "session_id",
  "cookie",
]);

/**
 * Recursively redact sensitive fields from an object.
 * Returns a new object with sensitive values replaced.
 */
export function redactSensitive<T>(obj: T, depth = 0): T {
  if (depth > 10) return REDACTED as T; // Prevent infinite recursion and avoid leaking data
  if (obj === null || obj === undefined) return obj;

  // Handle Buffer/Uint8Array explicitly to avoid iterating over bytes or infinite recursion
  if (obj instanceof Buffer || obj instanceof Uint8Array) {
    return "[Buffer]" as unknown as T;
  }

  if (typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => redactSensitive(item, depth + 1)) as T;
  }

  // Only process plain objects to avoid messing with class instances (like Date, etc)
  // Date objects are objects but not plain objects usually
  if (obj instanceof Date) return obj;
  if (obj instanceof Error) return obj; // Errors are special

  if (!isPlainObject(obj)) {
    return obj;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lowerKey)) {
      result[key] = REDACTED;
    } else if (typeof value === "object" && value !== null) {
      result[key] = redactSensitive(value, depth + 1);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
