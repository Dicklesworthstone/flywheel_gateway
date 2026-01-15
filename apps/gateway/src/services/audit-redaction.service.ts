/**
 * Audit Redaction Service
 *
 * Provides sensitive data redaction for audit logs to ensure
 * compliance with privacy regulations and security best practices.
 */

import { createHash } from "node:crypto";

/**
 * Mask patterns for different data types.
 */
export type MaskPattern =
  | "email"
  | "phone"
  | "card"
  | "ssn"
  | "api_key"
  | "token"
  | "custom";

/**
 * Field mask configuration.
 */
export interface FieldMaskConfig {
  field: string;
  pattern: MaskPattern;
  customMask?: (value: string) => string;
}

/**
 * Redaction configuration.
 */
export interface RedactionConfig {
  // Fields to completely remove
  removeFields: string[];

  // Fields to mask (show partial)
  maskFields: FieldMaskConfig[];

  // Fields to hash (for later matching without exposing)
  hashFields: string[];

  // Regex patterns to redact in any string field
  redactPatterns: RegExp[];

  // Whether to redact recursively in nested objects
  recursive: boolean;
}

/**
 * Default redaction configuration.
 */
export const DEFAULT_REDACTION_CONFIG: RedactionConfig = {
  removeFields: [
    "password",
    "passwordHash",
    "secret",
    "privateKey",
    "accessToken",
    "refreshToken",
    "sessionToken",
    "creditCard",
    "cvv",
    "ssn",
    "encryptionKey",
    "signingKey",
    "clientSecret",
    "webhookSecret",
  ],

  maskFields: [
    { field: "email", pattern: "email" },
    { field: "phone", pattern: "phone" },
    { field: "phoneNumber", pattern: "phone" },
    { field: "apiKey", pattern: "api_key" },
    { field: "api_key", pattern: "api_key" },
    { field: "authorization", pattern: "token" },
    { field: "bearer", pattern: "token" },
  ],

  hashFields: [
    "userId", // Can verify matches without exposing
    "accountId",
  ],

  redactPatterns: [
    // JWT tokens
    /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g,
    // API keys (sk_live_, sk_test_, etc.)
    /sk_[a-zA-Z0-9_]{20,}/g,
    // Generic API key patterns
    /api[_-]?key[_-]?[=:]\s*["']?[A-Za-z0-9\-._]{16,}["']?/gi,
    // AWS access keys
    /AKIA[0-9A-Z]{16}/g,
    // Credit card numbers (basic pattern)
    /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
    // SSN pattern
    /\b\d{3}[\s-]?\d{2}[\s-]?\d{4}\b/g,
  ],

  recursive: true,
};

/**
 * Audit redaction service for sanitizing sensitive data.
 */
export class AuditRedactionService {
  private config: RedactionConfig;

  constructor(config: Partial<RedactionConfig> = {}) {
    this.config = {
      ...DEFAULT_REDACTION_CONFIG,
      ...config,
      removeFields: [
        ...DEFAULT_REDACTION_CONFIG.removeFields,
        ...(config.removeFields ?? []),
      ],
      maskFields: [
        ...DEFAULT_REDACTION_CONFIG.maskFields,
        ...(config.maskFields ?? []),
      ],
      hashFields: [
        ...DEFAULT_REDACTION_CONFIG.hashFields,
        ...(config.hashFields ?? []),
      ],
      redactPatterns: [
        ...DEFAULT_REDACTION_CONFIG.redactPatterns,
        ...(config.redactPatterns ?? []),
      ],
    };
  }

  /**
   * Redact sensitive data from any value.
   */
  redact<T>(data: T): T {
    if (data === null || data === undefined) {
      return data;
    }

    if (typeof data === "string") {
      return this.redactString(data) as T;
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.redact(item)) as T;
    }

    if (typeof data === "object") {
      return this.redactObject(data as Record<string, unknown>) as T;
    }

    return data;
  }

  /**
   * Redact sensitive patterns from a string.
   */
  private redactString(value: string): string {
    let result = value;

    for (const pattern of this.config.redactPatterns) {
      // Reset regex lastIndex for global patterns
      pattern.lastIndex = 0;
      result = result.replace(pattern, "[REDACTED]");
    }

    return result;
  }

  /**
   * Redact sensitive fields from an object.
   */
  private redactObject(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();

      // Check if field should be removed entirely
      if (this.shouldRemoveField(lowerKey)) {
        result[key] = "[REMOVED]";
        continue;
      }

      // Check if field should be masked
      const maskConfig = this.getMaskConfig(lowerKey);
      if (
        maskConfig &&
        (typeof value === "string" || typeof value === "number")
      ) {
        result[key] = this.applyMask(
          String(value),
          maskConfig.pattern,
          maskConfig.customMask,
        );
        continue;
      }

      // Check if field should be hashed
      if (
        this.shouldHashField(lowerKey) &&
        (typeof value === "string" || typeof value === "number")
      ) {
        result[key] = this.hashValue(String(value));
        continue;
      }

      // Recursively process nested objects/arrays
      if (
        this.config.recursive &&
        value !== null &&
        typeof value === "object"
      ) {
        result[key] = this.redact(value);
        continue;
      }

      // For string values, apply pattern redaction
      if (typeof value === "string") {
        result[key] = this.redactString(value);
        continue;
      }

      // For number values, apply pattern redaction (e.g. credit cards as numbers)
      if (typeof value === "number") {
        // Only convert if it matches a pattern, otherwise leave as number
        const stringVal = String(value);
        let hasMatch = false;
        for (const pattern of this.config.redactPatterns) {
          pattern.lastIndex = 0;
          if (pattern.test(stringVal)) {
            hasMatch = true;
            break;
          }
        }
        if (hasMatch) {
          result[key] = this.redactString(stringVal);
          continue;
        }
      }

      result[key] = value;
    }

    return result;
  }

  /**
   * Check if a field should be removed entirely.
   */
  private shouldRemoveField(fieldName: string): boolean {
    return this.config.removeFields.some((f) => f.toLowerCase() === fieldName);
  }

  /**
   * Get mask configuration for a field.
   */
  private getMaskConfig(fieldName: string): FieldMaskConfig | undefined {
    return this.config.maskFields.find(
      (m) => m.field.toLowerCase() === fieldName,
    );
  }

  /**
   * Check if a field should be hashed.
   */
  private shouldHashField(fieldName: string): boolean {
    return this.config.hashFields.some((f) => f.toLowerCase() === fieldName);
  }

  /**
   * Apply a mask pattern to a value.
   */
  private applyMask(
    value: string,
    pattern: MaskPattern,
    customMask?: (value: string) => string,
  ): string {
    if (customMask) {
      return customMask(value);
    }

    switch (pattern) {
      case "email": {
        const atIndex = value.indexOf("@");
        if (atIndex <= 0) return "***@[REDACTED]";
        const domain = value.slice(atIndex);
        return `${value[0]}***${domain}`;
      }

      case "phone": {
        // Keep last 4 digits
        const digits = value.replace(/\D/g, "");
        if (digits.length < 4) return "***";
        return `***-***-${digits.slice(-4)}`;
      }

      case "card": {
        // Keep last 4 digits
        const cardDigits = value.replace(/\D/g, "");
        if (cardDigits.length < 4) return "****";
        return `****-****-****-${cardDigits.slice(-4)}`;
      }

      case "ssn": {
        // Keep last 4 digits
        const ssnDigits = value.replace(/\D/g, "");
        if (ssnDigits.length < 4) return "***-**-****";
        return `***-**-${ssnDigits.slice(-4)}`;
      }

      case "api_key": {
        // Show prefix and last 3 characters
        if (value.length < 8) return "***";
        return `${value.slice(0, 5)}***${value.slice(-3)}`;
      }

      case "token": {
        // Show only type indicator
        if (value.toLowerCase().startsWith("bearer ")) {
          return "Bearer [REDACTED]";
        }
        if (value.length < 8) return "[REDACTED]";
        return `${value.slice(0, 4)}...[REDACTED]`;
      }

      default:
        return "[REDACTED]";
    }
  }

  /**
   * Hash a value for later comparison without exposing the original.
   */
  private hashValue(value: string): string {
    const hash = createHash("sha256").update(value).digest("hex").slice(0, 16);
    return `[HASHED:${hash}]`;
  }

  /**
   * Check if a value contains any sensitive patterns.
   */
  containsSensitiveData(value: unknown): boolean {
    if (typeof value === "string") {
      for (const pattern of this.config.redactPatterns) {
        pattern.lastIndex = 0;
        if (pattern.test(value)) {
          return true;
        }
      }
      return false;
    }

    if (Array.isArray(value)) {
      return value.some((item) => this.containsSensitiveData(item));
    }

    if (value !== null && typeof value === "object") {
      for (const [key, val] of Object.entries(
        value as Record<string, unknown>,
      )) {
        const lowerKey = key.toLowerCase();
        if (
          this.shouldRemoveField(lowerKey) ||
          this.getMaskConfig(lowerKey) ||
          this.containsSensitiveData(val)
        ) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Create a new service instance with additional configuration.
   */
  extend(config: Partial<RedactionConfig>): AuditRedactionService {
    return new AuditRedactionService({
      ...this.config,
      ...config,
      removeFields: [
        ...this.config.removeFields,
        ...(config.removeFields ?? []),
      ],
      maskFields: [...this.config.maskFields, ...(config.maskFields ?? [])],
      hashFields: [...this.config.hashFields, ...(config.hashFields ?? [])],
      redactPatterns: [
        ...this.config.redactPatterns,
        ...(config.redactPatterns ?? []),
      ],
    });
  }
}

/**
 * Default redaction service instance.
 */
export const auditRedaction = new AuditRedactionService();

/**
 * Convenience function to redact data using the default service.
 */
export function redactSensitiveData<T>(data: T): T {
  return auditRedaction.redact(data);
}

/**
 * Convenience function to check for sensitive data.
 */
export function containsSensitiveData(data: unknown): boolean {
  return auditRedaction.containsSensitiveData(data);
}
