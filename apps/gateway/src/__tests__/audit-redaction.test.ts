/**
 * Tests for audit redaction service.
 */

import { describe, expect, test } from "bun:test";
import {
  AuditRedactionService,
  containsSensitiveData,
  DEFAULT_REDACTION_CONFIG,
  redactSensitiveData,
} from "../services/audit-redaction.service";

describe("AuditRedactionService", () => {
  const service = new AuditRedactionService();

  describe("redact", () => {
    test("returns null/undefined unchanged", () => {
      expect(service.redact(null)).toBeNull();
      expect(service.redact(undefined)).toBeUndefined();
    });

    test("returns numbers unchanged", () => {
      expect(service.redact(42)).toBe(42);
      expect(service.redact(3.14)).toBe(3.14);
    });

    test("returns booleans unchanged", () => {
      expect(service.redact(true)).toBe(true);
      expect(service.redact(false)).toBe(false);
    });

    test("removes password fields", () => {
      const data = { username: "john", password: "secret123" };
      const result = service.redact(data);
      expect(result.username).toBe("john");
      expect(result.password).toBe("[REMOVED]");
    });

    test("removes passwordHash fields", () => {
      const data = { email: "test@example.com", passwordHash: "abc123hash" };
      const result = service.redact(data);
      expect(result.email).toContain("***@");
      expect(result.passwordHash).toBe("[REMOVED]");
    });

    test("removes secret fields", () => {
      const data = { id: "123", secret: "my-secret-value" };
      const result = service.redact(data);
      expect(result.id).toBe("123");
      expect(result.secret).toBe("[REMOVED]");
    });

    test("removes accessToken fields", () => {
      const data = { name: "test", accessToken: "token123" };
      const result = service.redact(data);
      expect(result.accessToken).toBe("[REMOVED]");
    });

    test("removes refreshToken fields", () => {
      const data = { refreshToken: "refresh456" };
      const result = service.redact(data);
      expect(result.refreshToken).toBe("[REMOVED]");
    });

    test("removes creditCard fields", () => {
      const data = { creditCard: "4111111111111111" };
      const result = service.redact(data);
      expect(result.creditCard).toBe("[REMOVED]");
    });

    test("removes ssn fields", () => {
      const data = { ssn: "123-45-6789" };
      const result = service.redact(data);
      expect(result.ssn).toBe("[REMOVED]");
    });

    test("removes privateKey fields", () => {
      const data = { privateKey: "-----BEGIN RSA PRIVATE KEY-----..." };
      const result = service.redact(data);
      expect(result.privateKey).toBe("[REMOVED]");
    });
  });

  describe("email masking", () => {
    test("masks email addresses", () => {
      const data = { email: "john.doe@example.com" };
      const result = service.redact(data);
      expect(result.email).toBe("j***@example.com");
    });

    test("handles short email local parts", () => {
      const data = { email: "j@example.com" };
      const result = service.redact(data);
      expect(result.email).toBe("j***@example.com");
    });

    test("handles email without @ symbol", () => {
      const data = { email: "notanemail" };
      const result = service.redact(data);
      expect(result.email).toBe("***@[REDACTED]");
    });
  });

  describe("phone masking", () => {
    test("masks phone numbers", () => {
      const data = { phone: "555-123-4567" };
      const result = service.redact(data);
      expect(result.phone).toBe("***-***-4567");
    });

    test("masks phoneNumber field", () => {
      const data = { phoneNumber: "5551234567" };
      const result = service.redact(data);
      expect(result.phoneNumber).toBe("***-***-4567");
    });

    test("handles short phone numbers", () => {
      const data = { phone: "123" };
      const result = service.redact(data);
      expect(result.phone).toBe("***");
    });
  });

  describe("API key masking", () => {
    test("masks apiKey field", () => {
      const data = { apiKey: "test_fake_key_abcdef12345" };
      const result = service.redact(data);
      expect(result.apiKey).toBe("test_***345");
    });

    test("masks api_key field", () => {
      const data = { api_key: "fake_key_xyz987654321abc" };
      const result = service.redact(data);
      expect(result.api_key).toBe("fake_***abc");
    });

    test("handles short API keys", () => {
      const data = { apiKey: "short" };
      const result = service.redact(data);
      expect(result.apiKey).toBe("***");
    });
  });

  describe("token masking", () => {
    test("masks authorization header with Bearer token", () => {
      const data = {
        authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
      };
      const result = service.redact(data);
      expect(result.authorization).toBe("Bearer [REDACTED]");
    });

    test("masks bearer field", () => {
      const data = { bearer: "someTokenValue123456789" };
      const result = service.redact(data);
      expect(result.bearer).toBe("some...[REDACTED]");
    });

    test("handles short tokens", () => {
      const data = { bearer: "short" };
      const result = service.redact(data);
      expect(result.bearer).toBe("[REDACTED]");
    });
  });

  describe("hashing", () => {
    test("hashes userId field", () => {
      const data = { userId: "user-123-456" };
      const result = service.redact(data);
      expect(result.userId).toMatch(/^\[HASHED:[a-f0-9]{16}\]$/);
    });

    test("hashes accountId field", () => {
      const data = { accountId: "acc-789" };
      const result = service.redact(data);
      expect(result.accountId).toMatch(/^\[HASHED:[a-f0-9]{16}\]$/);
    });

    test("produces consistent hashes for same value", () => {
      const data1 = { userId: "user-123" };
      const data2 = { userId: "user-123" };
      const result1 = service.redact(data1);
      const result2 = service.redact(data2);
      expect(result1.userId).toBe(result2.userId);
    });

    test("produces different hashes for different values", () => {
      const data1 = { userId: "user-123" };
      const data2 = { userId: "user-456" };
      const result1 = service.redact(data1);
      const result2 = service.redact(data2);
      expect(result1.userId).not.toBe(result2.userId);
    });
  });

  describe("pattern redaction in strings", () => {
    test("redacts Bearer tokens in strings", () => {
      const data =
        "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0=";
      const result = service.redact(data);
      expect(result).toContain("[REDACTED]");
      expect(result).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
    });

    test("redacts sk_ API keys in strings", () => {
      const data = "Using API key sk_abcdefghijklmnopqrstuvwxyz123456";
      const result = service.redact(data);
      expect(result).toBe("Using API key [REDACTED]");
    });

    test("redacts api_key= patterns in strings", () => {
      const data = "Config: api_key=abc123def456ghi789jkl012";
      const result = service.redact(data);
      expect(result).toContain("[REDACTED]");
    });

    test("redacts credit card numbers in strings", () => {
      const data = "Card: 4111-1111-1111-1111";
      const result = service.redact(data);
      expect(result).toBe("Card: [REDACTED]");
    });

    test("redacts SSN patterns in strings", () => {
      const data = "SSN: 123-45-6789";
      const result = service.redact(data);
      expect(result).toBe("SSN: [REDACTED]");
    });

    test("redacts AWS access keys", () => {
      const data = "AWS key: AKIAIOSFODNN7EXAMPLE";
      const result = service.redact(data);
      expect(result).toBe("AWS key: [REDACTED]");
    });
  });

  describe("nested object redaction", () => {
    test("redacts nested objects", () => {
      const data = {
        user: {
          name: "John",
          password: "secret",
        },
      };
      const result = service.redact(data);
      expect(result.user.name).toBe("John");
      expect(result.user.password).toBe("[REMOVED]");
    });

    test("redacts deeply nested objects", () => {
      const data = {
        level1: {
          level2: {
            level3: {
              password: "deep-secret",
            },
          },
        },
      };
      const result = service.redact(data);
      expect(result.level1.level2.level3.password).toBe("[REMOVED]");
    });

    test("redacts arrays of objects", () => {
      const data = {
        users: [
          { name: "Alice", password: "pass1" },
          { name: "Bob", password: "pass2" },
        ],
      };
      const result = service.redact(data);
      expect(result.users[0]!.password).toBe("[REMOVED]");
      expect(result.users[1]!.password).toBe("[REMOVED]");
      expect(result.users[0]!.name).toBe("Alice");
      expect(result.users[1]!.name).toBe("Bob");
    });
  });

  describe("array handling", () => {
    test("processes arrays of strings", () => {
      const data = ["Bearer token123", "normal string"];
      const result = service.redact(data);
      expect(result[0]).toContain("[REDACTED]");
      expect(result[1]).toBe("normal string");
    });

    test("processes arrays of objects", () => {
      const data = [{ password: "secret1" }, { password: "secret2" }];
      const result = service.redact(data);
      expect(result[0]!.password).toBe("[REMOVED]");
      expect(result[1]!.password).toBe("[REMOVED]");
    });
  });

  describe("containsSensitiveData", () => {
    test("detects password fields", () => {
      const data = { password: "secret" };
      expect(service.containsSensitiveData(data)).toBe(true);
    });

    test("detects email fields", () => {
      const data = { email: "test@example.com" };
      expect(service.containsSensitiveData(data)).toBe(true);
    });

    test("detects Bearer tokens in strings", () => {
      const data = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
      expect(service.containsSensitiveData(data)).toBe(true);
    });

    test("returns false for safe data", () => {
      const data = { name: "John", age: 30 };
      expect(service.containsSensitiveData(data)).toBe(false);
    });

    test("detects nested sensitive data", () => {
      const data = {
        user: {
          profile: {
            password: "secret",
          },
        },
      };
      expect(service.containsSensitiveData(data)).toBe(true);
    });

    test("detects sensitive data in arrays", () => {
      const data = [{ safe: "value" }, { password: "secret" }];
      expect(service.containsSensitiveData(data)).toBe(true);
    });
  });

  describe("extend", () => {
    test("creates new service with additional remove fields", () => {
      const extended = service.extend({
        removeFields: ["customSecret"],
      });
      const data = { customSecret: "value", password: "pass" };
      const result = extended.redact(data);
      expect(result.customSecret).toBe("[REMOVED]");
      expect(result.password).toBe("[REMOVED]");
    });

    test("creates new service with additional mask fields", () => {
      const extended = service.extend({
        maskFields: [
          {
            field: "customField",
            pattern: "api_key",
          },
        ],
      });
      const data = { customField: "abc123def456ghi789" };
      const result = extended.redact(data);
      expect(result.customField).toBe("abc12***789");
    });

    test("creates new service with custom mask function", () => {
      const extended = service.extend({
        maskFields: [
          {
            field: "customField",
            pattern: "custom",
            customMask: (value) => `[CUSTOM:${value.length}]`,
          },
        ],
      });
      const data = { customField: "some-value" };
      const result = extended.redact(data);
      expect(result.customField).toBe("[CUSTOM:10]");
    });
  });
});

describe("Convenience functions", () => {
  test("redactSensitiveData works", () => {
    const data = { password: "secret" };
    const result = redactSensitiveData(data);
    expect(result.password).toBe("[REMOVED]");
  });

  test("containsSensitiveData works", () => {
    expect(containsSensitiveData({ password: "secret" })).toBe(true);
    expect(containsSensitiveData({ name: "John" })).toBe(false);
  });
});

describe("DEFAULT_REDACTION_CONFIG", () => {
  test("has expected remove fields", () => {
    expect(DEFAULT_REDACTION_CONFIG.removeFields).toContain("password");
    expect(DEFAULT_REDACTION_CONFIG.removeFields).toContain("secret");
    expect(DEFAULT_REDACTION_CONFIG.removeFields).toContain("accessToken");
  });

  test("has expected mask fields", () => {
    const fieldNames = DEFAULT_REDACTION_CONFIG.maskFields.map((m) => m.field);
    expect(fieldNames).toContain("email");
    expect(fieldNames).toContain("phone");
    expect(fieldNames).toContain("apiKey");
  });

  test("has expected hash fields", () => {
    expect(DEFAULT_REDACTION_CONFIG.hashFields).toContain("userId");
    expect(DEFAULT_REDACTION_CONFIG.hashFields).toContain("accountId");
  });

  test("has expected redact patterns", () => {
    expect(DEFAULT_REDACTION_CONFIG.redactPatterns.length).toBeGreaterThan(0);
  });

  test("has recursive enabled", () => {
    expect(DEFAULT_REDACTION_CONFIG.recursive).toBe(true);
  });
});
