/**
 * Zod Error Transformation Utilities.
 *
 * Transforms technical Zod validation errors into user-friendly messages
 * that developers can understand immediately.
 *
 * @example
 * ```typescript
 * try {
 *   schema.parse(data);
 * } catch (error) {
 *   if (error instanceof z.ZodError) {
 *     return sendValidationError(c, transformZodError(error));
 *   }
 * }
 * ```
 */

import type { ZodError } from "zod";

/**
 * Zod 4 issue interface (simplified for our needs).
 * Zod 4 changed many type names so we use a simplified version.
 */
interface ZodIssue {
  readonly code: string;
  readonly path: PropertyKey[];
  readonly message: string;
  // Optional fields depending on code
  readonly expected?: string;
  readonly origin?: string;
  readonly minimum?: number | bigint;
  readonly maximum?: number | bigint;
  readonly values?: unknown[];
  readonly keys?: string[];
  readonly format?: string;
  readonly divisor?: number;
}

/**
 * A transformed validation error with user-friendly message.
 */
export interface ValidationError {
  /** Dot-notation path to the invalid field */
  path: string;
  /** Human-readable error message */
  message: string;
  /** Original Zod error code for debugging */
  code?: string;
}

/**
 * Convert a Zod path array to dot notation string.
 *
 * @example
 * ```typescript
 * pathToString(["user", "addresses", 0, "city"])
 * // => "user.addresses.0.city"
 * ```
 */
function pathToString(path: PropertyKey[]): string {
  if (path.length === 0) return "(root)";
  return path.map((p) => String(p)).join(".");
}

/**
 * Get a user-friendly field name from a path.
 * Uses the last segment and converts camelCase to readable format.
 *
 * @example
 * ```typescript
 * getFieldName(["user", "workingDirectory"])
 * // => "working directory"
 * ```
 */
function getFieldName(path: PropertyKey[]): string {
  const lastSegment = path[path.length - 1];
  if (lastSegment === undefined) return "value";
  if (typeof lastSegment === "number") return `item ${lastSegment}`;
  if (typeof lastSegment === "symbol") return String(lastSegment);

  // Convert camelCase to readable: workingDirectory -> working directory
  return String(lastSegment)
    .replace(/([A-Z])/g, " $1")
    .toLowerCase()
    .trim();
}

/**
 * Helper to get "a" or "an" based on the word.
 */
function aOrAn(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

/**
 * Transform a single Zod issue into a user-friendly error message.
 */
function transformIssue(issue: ZodIssue): ValidationError {
  const path = pathToString(issue.path);
  const fieldName = getFieldName(issue.path);

  let message: string;

  switch (issue.code) {
    // Required/missing field (Zod 4: "invalid_type")
    case "invalid_type":
      if (issue.expected) {
        message = `${fieldName} must be ${aOrAn(issue.expected)} ${issue.expected}`;
      } else {
        message = `${fieldName} is required`;
      }
      break;

    // Size constraints (Zod 4: uses "origin" instead of "type")
    case "too_small": {
      const origin = issue.origin ?? "value";
      const min = issue.minimum ?? 1;
      if (origin === "string") {
        if (min === 1 || min === BigInt(1)) {
          message = `${fieldName} is required`;
        } else {
          message = `${fieldName} must be at least ${min} character${min === 1 || min === BigInt(1) ? "" : "s"}`;
        }
      } else if (
        origin === "number" ||
        origin === "int" ||
        origin === "bigint"
      ) {
        message = `${fieldName} must be at least ${min}`;
      } else if (origin === "array" || origin === "set") {
        message = `${fieldName} must have at least ${min} item${min === 1 || min === BigInt(1) ? "" : "s"}`;
      } else {
        message = `${fieldName} is too small`;
      }
      break;
    }

    case "too_big": {
      const origin = issue.origin ?? "value";
      const max = issue.maximum ?? 0;
      if (origin === "string") {
        message = `${fieldName} must be at most ${max} character${max === 1 || max === BigInt(1) ? "" : "s"}`;
      } else if (
        origin === "number" ||
        origin === "int" ||
        origin === "bigint"
      ) {
        message = `${fieldName} must be at most ${max}`;
      } else if (origin === "array" || origin === "set") {
        message = `${fieldName} must have at most ${max} item${max === 1 || max === BigInt(1) ? "" : "s"}`;
      } else {
        message = `${fieldName} is too large`;
      }
      break;
    }

    // Enum/literal validation (Zod 4: "invalid_value" for enums/literals)
    case "invalid_value":
      if (issue.values && issue.values.length > 0) {
        const options = issue.values.map((v) => JSON.stringify(v)).join(", ");
        message = `${fieldName} must be one of: ${options}`;
      } else {
        message = `${fieldName} has an invalid value`;
      }
      break;

    // Union validation
    case "invalid_union":
      message = `${fieldName} doesn't match any expected type`;
      break;

    // String format validation (Zod 4: "invalid_format" instead of "invalid_string")
    case "invalid_format": {
      const format = issue.format ?? "unknown";
      if (format === "email") {
        message = `${fieldName} must be a valid email address`;
      } else if (format === "url" || format === "uri") {
        message = `${fieldName} must be a valid URL`;
      } else if (format === "uuid") {
        message = `${fieldName} must be a valid UUID`;
      } else if (format === "datetime" || format === "iso_datetime") {
        message = `${fieldName} must be a valid date/time`;
      } else if (format === "regex") {
        message = `${fieldName} has invalid format`;
      } else {
        message = `${fieldName} must be a valid ${format}`;
      }
      break;
    }

    // Custom validations
    case "custom":
      // Use the custom message if provided, otherwise generic
      message = issue.message || `${fieldName} is invalid`;
      break;

    // Unrecognized keys in strict schemas
    case "unrecognized_keys":
      if (issue.keys && issue.keys.length > 0) {
        message = `Unknown field${issue.keys.length > 1 ? "s" : ""}: ${issue.keys.join(", ")}`;
      } else {
        message = "Unknown fields in request";
      }
      break;

    // Invalid key (for maps/records)
    case "invalid_key":
      message = `${fieldName} contains an invalid key`;
      break;

    // Invalid element (for sets/maps)
    case "invalid_element":
      message = `${fieldName} contains an invalid element`;
      break;

    // Not a multiple of
    case "not_multiple_of":
      message = `${fieldName} must be a multiple of ${issue.divisor ?? "the required value"}`;
      break;

    // Fallback for unknown codes
    default:
      message = issue.message || `${fieldName} is invalid`;
  }

  return {
    path,
    message,
    code: issue.code,
  };
}

/**
 * Transform a ZodError into an array of user-friendly validation errors.
 *
 * @param error - The ZodError from a failed parse
 * @returns Array of user-friendly validation errors
 *
 * @example
 * ```typescript
 * try {
 *   SpawnRequestSchema.parse(body);
 * } catch (error) {
 *   if (error instanceof z.ZodError) {
 *     const errors = transformZodError(error);
 *     // [{ path: "workingDirectory", message: "working directory is required" }]
 *     return sendValidationError(c, errors);
 *   }
 * }
 * ```
 */
export function transformZodError(error: ZodError): ValidationError[] {
  // Cast to our simplified interface
  const issues = error.issues as unknown as ZodIssue[];
  return issues.map(transformIssue);
}

/**
 * Check if an error is a ZodError.
 * Useful for type narrowing in catch blocks.
 */
export function isZodError(error: unknown): error is ZodError {
  return (
    error !== null &&
    typeof error === "object" &&
    "issues" in error &&
    Array.isArray((error as ZodError).issues)
  );
}

/**
 * Strip undefined properties from an object.
 *
 * This is useful when working with `exactOptionalPropertyTypes: true`
 * which doesn't allow `{ foo: undefined }` when the type is `{ foo?: string }`.
 *
 * @example
 * ```typescript
 * const filter = stripUndefined({
 *   organizationId: req.query("org") || undefined,
 *   projectId: req.query("project") || undefined,
 * });
 * // If organizationId is undefined, it won't be included in the result
 * ```
 */
export function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const result: Record<string, unknown> = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key) && obj[key] !== undefined) {
      result[key] = obj[key];
    }
  }
  return result as T;
}
