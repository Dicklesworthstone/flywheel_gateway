/**
 * Tests for audit service.
 */

import { afterAll, describe, expect, mock, test } from "bun:test";
import type { AuditEventOptions } from "../services/audit";
import { audit, auditFailure, auditSuccess } from "../services/audit";
import { restoreRealDb } from "./test-utils/db-mock-restore";

const mockLogger = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
  child: () => mockLogger,
};

// Mock the correlation middleware
mock.module("../middleware/correlation", () => ({
  getCorrelationId: () => "test-correlation-id",
  getLogger: () => mockLogger,
}));

// Mock the database to avoid actual writes during tests
mock.module("../db", () => ({
  db: {
    insert: () => ({
      values: () => ({
        catch: () => Promise.resolve(),
      }),
    }),
  },
}));

afterAll(() => {
  mock.restore();
  // Restore real db module for other test files (mock.restore doesn't restore mock.module)
  restoreRealDb();
});

describe("Audit Service", () => {
  describe("audit", () => {
    test("creates audit event with required fields", () => {
      const options: AuditEventOptions = {
        action: "agent.spawn",
        resource: "agent-123",
        resourceType: "agent",
        outcome: "success",
      };

      const event = audit(options);

      expect(event.id).toBeDefined();
      expect(event.timestamp).toBeDefined();
      expect(event.correlationId).toBe("test-correlation-id");
      expect(event.action).toBe("agent.spawn");
      expect(event.resource).toBe("agent-123");
      expect(event.resourceType).toBe("agent");
      expect(event.outcome).toBe("success");
    });

    test("generates unique event IDs", () => {
      const options: AuditEventOptions = {
        action: "session.create",
        resource: "session-1",
        resourceType: "session",
        outcome: "success",
      };

      const event1 = audit(options);
      const event2 = audit(options);

      expect(event1.id).not.toBe(event2.id);
    });

    test("includes optional workspaceId when provided", () => {
      const event = audit({
        action: "agent.spawn",
        resource: "agent-123",
        resourceType: "agent",
        outcome: "success",
        workspaceId: "workspace-abc",
      });

      expect(event.workspaceId).toBe("workspace-abc");
    });

    test("includes optional userId when provided", () => {
      const event = audit({
        action: "auth.login",
        resource: "user-456",
        resourceType: "user",
        outcome: "success",
        userId: "user-456",
      });

      expect(event.userId).toBe("user-456");
    });

    test("includes optional apiKeyId when provided", () => {
      const event = audit({
        action: "api_key.create",
        resource: "key-789",
        resourceType: "api_key",
        outcome: "success",
        apiKeyId: "key-789",
      });

      expect(event.apiKeyId).toBe("key-789");
    });

    test("includes optional metadata when provided", () => {
      const metadata = { reason: "test", extra: 123 };
      const event = audit({
        action: "agent.terminate",
        resource: "agent-123",
        resourceType: "agent",
        outcome: "success",
        metadata,
      });

      expect(event.metadata).toEqual(metadata);
    });

    test("includes optional ipAddress when provided", () => {
      const event = audit({
        action: "auth.login",
        resource: "user-123",
        resourceType: "user",
        outcome: "success",
        ipAddress: "192.168.1.1",
      });

      expect(event.ipAddress).toBe("192.168.1.1");
    });

    test("includes optional userAgent when provided", () => {
      const event = audit({
        action: "auth.login",
        resource: "user-123",
        resourceType: "user",
        outcome: "success",
        userAgent: "Mozilla/5.0",
      });

      expect(event.userAgent).toBe("Mozilla/5.0");
    });

    test("excludes undefined optional fields", () => {
      const event = audit({
        action: "agent.spawn",
        resource: "agent-123",
        resourceType: "agent",
        outcome: "success",
      });

      expect(event.workspaceId).toBeUndefined();
      expect(event.userId).toBeUndefined();
      expect(event.apiKeyId).toBeUndefined();
      expect(event.metadata).toBeUndefined();
      expect(event.ipAddress).toBeUndefined();
      expect(event.userAgent).toBeUndefined();
    });

    test("creates event with failure outcome", () => {
      const event = audit({
        action: "auth.login",
        resource: "user-123",
        resourceType: "user",
        outcome: "failure",
      });

      expect(event.outcome).toBe("failure");
    });

    test("handles all audit actions", () => {
      const actions = [
        "agent.spawn",
        "agent.terminate",
        "agent.send",
        "session.create",
        "session.restore",
        "auth.login",
        "auth.logout",
        "auth.token_refresh",
        "api_key.create",
        "api_key.revoke",
        "profile.create",
        "profile.update",
        "profile.delete",
        "profile.activate",
        "profile.verify",
        "profile.cooldown",
        "pool.rotate",
      ] as const;

      for (const action of actions) {
        const event = audit({
          action,
          resource: "test-resource",
          resourceType: "agent",
          outcome: "success",
        });
        expect(event.action).toBe(action);
      }
    });

    test("handles all resource types", () => {
      const resourceTypes = [
        "agent",
        "session",
        "checkpoint",
        "api_key",
        "user",
        "account",
        "account_profile",
        "account_pool",
      ] as const;

      for (const resourceType of resourceTypes) {
        const event = audit({
          action: "agent.spawn",
          resource: "test-resource",
          resourceType,
          outcome: "success",
        });
        expect(event.resourceType).toBe(resourceType);
      }
    });
  });

  describe("auditSuccess", () => {
    test("creates event with success outcome", () => {
      const event = auditSuccess({
        action: "agent.spawn",
        resource: "agent-123",
        resourceType: "agent",
      });

      expect(event.outcome).toBe("success");
    });

    test("passes through all other options", () => {
      const event = auditSuccess({
        action: "session.create",
        resource: "session-456",
        resourceType: "session",
        workspaceId: "ws-123",
        userId: "user-789",
        metadata: { foo: "bar" },
      });

      expect(event.action).toBe("session.create");
      expect(event.resource).toBe("session-456");
      expect(event.resourceType).toBe("session");
      expect(event.workspaceId).toBe("ws-123");
      expect(event.userId).toBe("user-789");
      expect(event.metadata).toEqual({ foo: "bar" });
    });
  });

  describe("auditFailure", () => {
    test("creates event with failure outcome", () => {
      const event = auditFailure({
        action: "auth.login",
        resource: "user-123",
        resourceType: "user",
      });

      expect(event.outcome).toBe("failure");
    });

    test("passes through all other options", () => {
      const event = auditFailure({
        action: "api_key.create",
        resource: "key-456",
        resourceType: "api_key",
        metadata: { error: "Invalid credentials" },
        ipAddress: "10.0.0.1",
      });

      expect(event.action).toBe("api_key.create");
      expect(event.resource).toBe("key-456");
      expect(event.resourceType).toBe("api_key");
      expect(event.metadata).toEqual({ error: "Invalid credentials" });
      expect(event.ipAddress).toBe("10.0.0.1");
    });
  });

  describe("timestamp formatting", () => {
    test("timestamp is valid ISO 8601 format", () => {
      const event = audit({
        action: "agent.spawn",
        resource: "agent-123",
        resourceType: "agent",
        outcome: "success",
      });

      // Should be parseable as a date
      const parsed = new Date(event.timestamp);
      expect(parsed.toString()).not.toBe("Invalid Date");

      // Should be ISO format with timezone
      expect(event.timestamp).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/,
      );
    });
  });
});
