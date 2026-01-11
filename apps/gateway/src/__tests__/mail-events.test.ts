/**
 * Tests for mail-events service.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import {
  type ConflictDetectedPayload,
  type ConflictResolvedPayload,
  createMailEventsService,
  MailEventsService,
  type MailReceivedPayload,
  type ReservationAcquiredPayload,
  type ReservationReleasedPayload,
} from "../services/mail-events";
import type { WebSocketHub } from "../ws/hub";

describe("Mail Events Service", () => {
  let mockHub: WebSocketHub;
  let publishCalls: Array<{
    channel: unknown;
    type: string;
    payload: unknown;
    metadata: unknown;
  }>;

  beforeEach(() => {
    publishCalls = [];
    mockHub = {
      publish: (
        channel: unknown,
        type: string,
        payload: unknown,
        metadata: unknown,
      ) => {
        publishCalls.push({ channel, type, payload, metadata });
      },
    } as unknown as WebSocketHub;
  });

  describe("createMailEventsService", () => {
    test("creates service instance", () => {
      const service = createMailEventsService(mockHub);
      expect(service).toBeInstanceOf(MailEventsService);
    });
  });

  describe("MailEventsService", () => {
    test("can be instantiated with hub", () => {
      const service = new MailEventsService(mockHub);
      expect(service).toBeDefined();
    });
  });

  describe("publishMailReceived", () => {
    test("publishes to correct channel", () => {
      const service = new MailEventsService(mockHub);
      const payload: MailReceivedPayload = {
        messageId: "msg-123",
        projectId: "proj-456",
        from: { agentId: "agent-sender" },
        to: { agentId: "agent-receiver" },
        subject: "Test message",
        priority: "normal",
        receivedAt: new Date().toISOString(),
      };

      service.publishMailReceived("user-789", payload);

      expect(publishCalls).toHaveLength(1);
      expect(publishCalls[0]!.channel).toEqual({
        type: "user:mail",
        userId: "user-789",
      });
      expect(publishCalls[0]!.type).toBe("mail.received");
      expect(publishCalls[0]!.payload).toEqual(payload);
    });

    test("includes userId in metadata", () => {
      const service = new MailEventsService(mockHub);
      const payload: MailReceivedPayload = {
        messageId: "msg-123",
        projectId: "proj-456",
        from: { agentId: "agent-sender" },
        to: { agentId: "agent-receiver" },
        subject: "Test",
        priority: "high",
        receivedAt: new Date().toISOString(),
      };

      service.publishMailReceived("user-789", payload);

      expect(publishCalls[0]!.metadata).toMatchObject({
        userId: "user-789",
      });
    });

    test("merges additional metadata", () => {
      const service = new MailEventsService(mockHub);
      const payload: MailReceivedPayload = {
        messageId: "msg-123",
        projectId: "proj-456",
        from: { agentId: "agent-sender" },
        to: { agentId: "agent-receiver" },
        subject: "Test",
        priority: "urgent",
        threadId: "thread-123",
        receivedAt: new Date().toISOString(),
      };

      service.publishMailReceived("user-789", payload, {
        correlationId: "corr-123",
      });

      expect(publishCalls[0]!.metadata).toMatchObject({
        userId: "user-789",
        correlationId: "corr-123",
      });
    });

    test("handles all priority levels", () => {
      const service = new MailEventsService(mockHub);
      const priorities: Array<"low" | "normal" | "high" | "urgent"> = [
        "low",
        "normal",
        "high",
        "urgent",
      ];

      for (const priority of priorities) {
        const payload: MailReceivedPayload = {
          messageId: `msg-${priority}`,
          projectId: "proj-456",
          from: { agentId: "agent-sender" },
          to: { agentId: "agent-receiver" },
          subject: "Test",
          priority,
          receivedAt: new Date().toISOString(),
        };

        service.publishMailReceived("user-789", payload);
      }

      expect(publishCalls).toHaveLength(4);
    });
  });

  describe("publishReservationAcquired", () => {
    test("publishes to correct channel", () => {
      const service = new MailEventsService(mockHub);
      const payload: ReservationAcquiredPayload = {
        reservationId: "res-123",
        projectId: "proj-456",
        requesterId: "agent-789",
        patterns: ["src/**/*.ts", "tests/**/*.ts"],
        exclusive: true,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        acquiredAt: new Date().toISOString(),
      };

      service.publishReservationAcquired("workspace-abc", payload);

      expect(publishCalls).toHaveLength(1);
      expect(publishCalls[0]!.channel).toEqual({
        type: "workspace:reservations",
        workspaceId: "workspace-abc",
      });
      expect(publishCalls[0]!.type).toBe("reservation.acquired");
      expect(publishCalls[0]!.payload).toEqual(payload);
    });

    test("includes workspaceId in metadata", () => {
      const service = new MailEventsService(mockHub);
      const payload: ReservationAcquiredPayload = {
        reservationId: "res-123",
        projectId: "proj-456",
        requesterId: "agent-789",
        patterns: ["**/*.ts"],
        exclusive: false,
        expiresAt: new Date().toISOString(),
        acquiredAt: new Date().toISOString(),
      };

      service.publishReservationAcquired("workspace-abc", payload);

      expect(publishCalls[0]!.metadata).toMatchObject({
        workspaceId: "workspace-abc",
      });
    });
  });

  describe("publishReservationReleased", () => {
    test("publishes to correct channel", () => {
      const service = new MailEventsService(mockHub);
      const payload: ReservationReleasedPayload = {
        reservationId: "res-123",
        projectId: "proj-456",
        requesterId: "agent-789",
        patterns: ["src/**/*.ts"],
        releasedAt: new Date().toISOString(),
      };

      service.publishReservationReleased("workspace-abc", payload);

      expect(publishCalls).toHaveLength(1);
      expect(publishCalls[0]!.channel).toEqual({
        type: "workspace:reservations",
        workspaceId: "workspace-abc",
      });
      expect(publishCalls[0]!.type).toBe("reservation.released");
    });

    test("includes metadata", () => {
      const service = new MailEventsService(mockHub);
      const payload: ReservationReleasedPayload = {
        reservationId: "res-123",
        projectId: "proj-456",
        requesterId: "agent-789",
        patterns: ["**/*"],
        releasedAt: new Date().toISOString(),
      };

      service.publishReservationReleased("workspace-abc", payload, {
        correlationId: "corr-456",
      });

      expect(publishCalls[0]!.metadata).toMatchObject({
        workspaceId: "workspace-abc",
        correlationId: "corr-456",
      });
    });
  });

  describe("publishConflictDetected", () => {
    test("publishes to correct channel", () => {
      const service = new MailEventsService(mockHub);
      const payload: ConflictDetectedPayload = {
        conflictId: "conflict-123",
        projectId: "proj-456",
        pattern: "src/index.ts",
        existingReservation: {
          reservationId: "res-existing",
          requesterId: "agent-holder",
          expiresAt: new Date(Date.now() + 1800000).toISOString(),
        },
        requestingAgent: "agent-requester",
        detectedAt: new Date().toISOString(),
      };

      service.publishConflictDetected("workspace-abc", payload);

      expect(publishCalls).toHaveLength(1);
      expect(publishCalls[0]!.channel).toEqual({
        type: "workspace:conflicts",
        workspaceId: "workspace-abc",
      });
      expect(publishCalls[0]!.type).toBe("conflict.detected");
      expect(publishCalls[0]!.payload).toEqual(payload);
    });

    test("includes workspaceId in metadata", () => {
      const service = new MailEventsService(mockHub);
      const payload: ConflictDetectedPayload = {
        conflictId: "conflict-123",
        projectId: "proj-456",
        pattern: "**/*.ts",
        existingReservation: {
          reservationId: "res-existing",
          requesterId: "agent-holder",
          expiresAt: new Date().toISOString(),
        },
        requestingAgent: "agent-requester",
        detectedAt: new Date().toISOString(),
      };

      service.publishConflictDetected("workspace-abc", payload);

      expect(publishCalls[0]!.metadata).toMatchObject({
        workspaceId: "workspace-abc",
      });
    });
  });

  describe("publishConflictResolved", () => {
    test("publishes to correct channel", () => {
      const service = new MailEventsService(mockHub);
      const payload: ConflictResolvedPayload = {
        conflictId: "conflict-123",
        projectId: "proj-456",
        resolution: "released",
        resolvedAt: new Date().toISOString(),
      };

      service.publishConflictResolved("workspace-abc", payload);

      expect(publishCalls).toHaveLength(1);
      expect(publishCalls[0]!.channel).toEqual({
        type: "workspace:conflicts",
        workspaceId: "workspace-abc",
      });
      expect(publishCalls[0]!.type).toBe("conflict.resolved");
    });

    test("handles all resolution types", () => {
      const service = new MailEventsService(mockHub);
      const resolutions: Array<"expired" | "released" | "overridden"> = [
        "expired",
        "released",
        "overridden",
      ];

      for (const resolution of resolutions) {
        const payload: ConflictResolvedPayload = {
          conflictId: `conflict-${resolution}`,
          projectId: "proj-456",
          resolution,
          resolvedAt: new Date().toISOString(),
        };

        service.publishConflictResolved("workspace-abc", payload);
      }

      expect(publishCalls).toHaveLength(3);
      expect(
        (publishCalls[0]!.payload as ConflictResolvedPayload).resolution,
      ).toBe("expired");
      expect(
        (publishCalls[1]!.payload as ConflictResolvedPayload).resolution,
      ).toBe("released");
      expect(
        (publishCalls[2]!.payload as ConflictResolvedPayload).resolution,
      ).toBe("overridden");
    });

    test("includes metadata", () => {
      const service = new MailEventsService(mockHub);
      const payload: ConflictResolvedPayload = {
        conflictId: "conflict-123",
        projectId: "proj-456",
        resolution: "expired",
        resolvedAt: new Date().toISOString(),
      };

      service.publishConflictResolved("workspace-abc", payload, {
        correlationId: "corr-789",
      });

      expect(publishCalls[0]!.metadata).toMatchObject({
        workspaceId: "workspace-abc",
        correlationId: "corr-789",
      });
    });
  });
});
