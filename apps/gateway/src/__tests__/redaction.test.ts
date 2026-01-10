import { describe, expect, test } from "bun:test";
import {
  redactApiKey,
  redactEmail,
  redactPassword,
  redactSensitive,
} from "../utils/redaction";

describe("redaction utilities", () => {
  describe("redactApiKey", () => {
    test("redacts full key showing only last 4 chars", () => {
      expect(redactApiKey("sk-12345678901234567890")).toBe("...7890");
    });

    test("redacts short keys completely", () => {
      expect(redactApiKey("abc")).toBe("[REDACTED]");
      expect(redactApiKey("abcd")).toBe("[REDACTED]");
    });

    test("handles undefined", () => {
      expect(redactApiKey(undefined)).toBe("[REDACTED]");
    });
  });

  describe("redactPassword", () => {
    test("always returns [REDACTED]", () => {
      expect(redactPassword("mysecretpassword")).toBe("[REDACTED]");
      expect(redactPassword("")).toBe("[REDACTED]");
      expect(redactPassword(undefined)).toBe("[REDACTED]");
    });
  });

  describe("redactEmail", () => {
    test("shows first char and domain", () => {
      expect(redactEmail("john@example.com")).toBe("j***@example.com");
      expect(redactEmail("alice@test.org")).toBe("a***@test.org");
    });

    test("handles missing @ symbol", () => {
      expect(redactEmail("notanemail")).toBe("[REDACTED]");
    });

    test("handles @ at start", () => {
      expect(redactEmail("@example.com")).toBe("[REDACTED]");
    });

    test("handles undefined", () => {
      expect(redactEmail(undefined)).toBe("[REDACTED]");
    });
  });

  describe("redactSensitive", () => {
    test("redacts known sensitive keys", () => {
      const input = {
        username: "alice",
        password: "secret123",
        token: "abc123",
        apiKey: "sk-12345",
      };
      const result = redactSensitive(input);
      expect(result["username"]).toBe("alice");
      expect(result["password"]).toBe("[REDACTED]");
      expect(result["token"]).toBe("[REDACTED]");
      expect(result["apiKey"]).toBe("[REDACTED]");
    });

    test("redacts camelCase and snake_case variants", () => {
      const input = {
        privateKey: "-----BEGIN PRIVATE KEY-----",
        private_key: "-----BEGIN PRIVATE KEY-----",
        accessToken: "eyJ...",
        access_token: "eyJ...",
        refreshToken: "refresh123",
        refresh_token: "refresh456",
        sessionId: "sess123",
        session_id: "sess456",
        Authorization: "Bearer xyz",
      };
      const result = redactSensitive(input);
      expect(result["privateKey"]).toBe("[REDACTED]");
      expect(result["private_key"]).toBe("[REDACTED]");
      expect(result["accessToken"]).toBe("[REDACTED]");
      expect(result["access_token"]).toBe("[REDACTED]");
      expect(result["refreshToken"]).toBe("[REDACTED]");
      expect(result["refresh_token"]).toBe("[REDACTED]");
      expect(result["sessionId"]).toBe("[REDACTED]");
      expect(result["session_id"]).toBe("[REDACTED]");
      expect(result["Authorization"]).toBe("[REDACTED]");
    });

    test("handles nested objects", () => {
      const input = {
        user: {
          name: "bob",
          secret: "mysecret",
        },
      };
      const result = redactSensitive(input);
      const user = result["user"] as Record<string, unknown>;
      expect(user["name"]).toBe("bob");
      expect(user["secret"]).toBe("[REDACTED]");
    });

    test("handles deeply nested sensitive keys", () => {
      const input = {
        level1: {
          level2: {
            password: "secret",
          },
        },
      };
      const result = redactSensitive(input);
      const l1 = result["level1"] as Record<string, unknown>;
      const l2 = l1["level2"] as Record<string, unknown>;
      expect(l2["password"]).toBe("[REDACTED]");
    });

    test("handles arrays", () => {
      const input = [{ token: "abc" }, { token: "def" }];
      const result = redactSensitive(input);
      expect((result[0] as Record<string, unknown>)["token"]).toBe(
        "[REDACTED]",
      );
      expect((result[1] as Record<string, unknown>)["token"]).toBe(
        "[REDACTED]",
      );
    });

    test("handles null and undefined", () => {
      expect(redactSensitive(null)).toBe(null);
      expect(redactSensitive(undefined)).toBe(undefined);
    });

    test("handles primitives", () => {
      expect(redactSensitive("hello")).toBe("hello");
      expect(redactSensitive(42)).toBe(42);
      expect(redactSensitive(true)).toBe(true);
    });

    test("prevents infinite recursion", () => {
      // Create a deeply nested object
      let obj: Record<string, unknown> = { value: "test" };
      for (let i = 0; i < 15; i++) {
        obj = { nested: obj };
      }
      // Should not throw
      const result = redactSensitive(obj);
      expect(result).toBeDefined();
    });
  });
});
