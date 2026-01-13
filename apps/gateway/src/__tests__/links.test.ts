import { describe, expect, test } from "bun:test";
import {
  agentLinks,
  agentListLinks,
  allowlistLinks,
  beadLinks,
  checkpointLinks,
  checkpointListLinks,
  conflictLinks,
  daemonLinks,
  getLinkContext,
  type LinkGeneratorContext,
  messageLinks,
  pendingExceptionLinks,
  reservationLinks,
  threadLinks,
  toWebSocketUrl,
} from "../utils/links";

describe("links utilities", () => {
  const ctx: LinkGeneratorContext = {
    baseUrl: "https://api.example.com",
  };

  describe("toWebSocketUrl", () => {
    test("converts http to ws", () => {
      expect(toWebSocketUrl("http://localhost:3000")).toBe(
        "ws://localhost:3000",
      );
    });

    test("converts https to wss", () => {
      expect(toWebSocketUrl("https://api.example.com")).toBe(
        "wss://api.example.com",
      );
    });

    test("preserves port", () => {
      expect(toWebSocketUrl("https://api.example.com:8080")).toBe(
        "wss://api.example.com:8080",
      );
    });
  });

  describe("agentLinks", () => {
    test("generates full agent links", () => {
      const links = agentLinks({ agentId: "agent_123" }, ctx);

      expect(links.self).toBe("https://api.example.com/agents/agent_123");
      expect(links["output"]).toBe(
        "https://api.example.com/agents/agent_123/output",
      );
      expect(links["status"]).toBe(
        "https://api.example.com/agents/agent_123/status",
      );
      expect(links["terminate"]).toBe("https://api.example.com/agents/agent_123");
      expect(links["send"]).toBe("https://api.example.com/agents/agent_123/send");
      expect(links["interrupt"]).toBe(
        "https://api.example.com/agents/agent_123/interrupt",
      );
      expect(links["ws"]).toBe("wss://api.example.com/ws");
    });

    test("agentListLinks generates minimal self link", () => {
      const links = agentListLinks({ agentId: "agent_456" }, ctx);

      expect(links.self).toBe("https://api.example.com/agents/agent_456");
      expect(Object.keys(links)).toEqual(["self"]);
    });
  });

  describe("reservationLinks", () => {
    test("generates reservation links", () => {
      const links = reservationLinks({ id: "rsv_123" }, ctx);

      expect(links.self).toBe("https://api.example.com/reservations/rsv_123");
      expect(links["release"]).toBe(
        "https://api.example.com/reservations/rsv_123",
      );
      expect(links["renew"]).toBe(
        "https://api.example.com/reservations/rsv_123/renew",
      );
    });
  });

  describe("checkpointLinks", () => {
    test("generates full checkpoint links", () => {
      const links = checkpointLinks(
        { id: "chk_123", sessionId: "sess_456" },
        ctx,
      );

      expect(links.self).toBe(
        "https://api.example.com/sessions/sess_456/checkpoints/chk_123",
      );
      expect(links["restore"]).toBe(
        "https://api.example.com/sessions/sess_456/checkpoints/chk_123/restore",
      );
      expect(links["export"]).toBe(
        "https://api.example.com/sessions/sess_456/checkpoints/chk_123/export",
      );
      expect(links["delete"]).toBe(
        "https://api.example.com/sessions/sess_456/checkpoints/chk_123",
      );
    });

    test("checkpointListLinks generates minimal self link", () => {
      const links = checkpointListLinks(
        { id: "chk_789", sessionId: "sess_012" },
        ctx,
      );

      expect(links.self).toBe(
        "https://api.example.com/sessions/sess_012/checkpoints/chk_789",
      );
      expect(Object.keys(links)).toEqual(["self"]);
    });
  });

  describe("conflictLinks", () => {
    test("generates conflict links", () => {
      const links = conflictLinks({ id: "conf_123" }, ctx);

      expect(links.self).toBe("https://api.example.com/conflicts/conf_123");
      expect(links["resolve"]).toBe(
        "https://api.example.com/conflicts/conf_123/resolve",
      );
    });
  });

  describe("beadLinks", () => {
    test("generates bead links", () => {
      const links = beadLinks({ id: "bead_123" }, ctx);

      expect(links.self).toBe("https://api.example.com/beads/bead_123");
      expect(links["update"]).toBe("https://api.example.com/beads/bead_123");
      expect(links["close"]).toBe("https://api.example.com/beads/bead_123/close");
    });
  });

  describe("messageLinks", () => {
    test("generates message links", () => {
      const links = messageLinks({ id: "msg_123" }, ctx);

      expect(links.self).toBe("https://api.example.com/mail/messages/msg_123");
      expect(links["reply"]).toBe(
        "https://api.example.com/mail/messages/msg_123/reply",
      );
    });
  });

  describe("threadLinks", () => {
    test("generates thread links", () => {
      const links = threadLinks({ threadId: "thread_123" }, ctx);

      expect(links.self).toBe(
        "https://api.example.com/mail/threads/thread_123",
      );
      expect(links["messages"]).toBe(
        "https://api.example.com/mail/threads/thread_123/messages",
      );
    });
  });

  describe("allowlistLinks", () => {
    test("generates allowlist links", () => {
      const links = allowlistLinks({ ruleId: "rule_123" }, ctx);

      expect(links.self).toBe("https://api.example.com/dcg/allowlist/rule_123");
      expect(links["delete"]).toBe(
        "https://api.example.com/dcg/allowlist/rule_123",
      );
    });
  });

  describe("pendingExceptionLinks", () => {
    test("generates pending exception links", () => {
      const links = pendingExceptionLinks({ shortCode: "ABC123" }, ctx);

      expect(links.self).toBe("https://api.example.com/dcg/pending/ABC123");
      expect(links["approve"]).toBe(
        "https://api.example.com/dcg/pending/ABC123/approve",
      );
      expect(links["deny"]).toBe(
        "https://api.example.com/dcg/pending/ABC123/deny",
      );
    });
  });

  describe("daemonLinks", () => {
    test("generates daemon links", () => {
      const links = daemonLinks({ name: "ru-sync" }, ctx);

      expect(links.self).toBe(
        "https://api.example.com/supervisor/ru-sync/status",
      );
      expect(links["start"]).toBe(
        "https://api.example.com/supervisor/ru-sync/start",
      );
      expect(links["stop"]).toBe(
        "https://api.example.com/supervisor/ru-sync/stop",
      );
      expect(links["restart"]).toBe(
        "https://api.example.com/supervisor/ru-sync/restart",
      );
      expect(links["logs"]).toBe(
        "https://api.example.com/supervisor/ru-sync/logs",
      );
    });
  });

  describe("getLinkContext", () => {
    test("extracts base URL from Hono-like context", () => {
      // Mock a minimal Hono-like context
      const mockContext = {
        req: {
          url: "https://api.example.com/agents/123?foo=bar",
        },
      } as unknown as import("hono").Context;

      const linkCtx = getLinkContext(mockContext);

      expect(linkCtx.baseUrl).toBe("https://api.example.com");
    });

    test("handles HTTP correctly", () => {
      const mockContext = {
        req: {
          url: "http://localhost:3000/test",
        },
      } as unknown as import("hono").Context;

      const linkCtx = getLinkContext(mockContext);

      expect(linkCtx.baseUrl).toBe("http://localhost:3000");
    });
  });
});
