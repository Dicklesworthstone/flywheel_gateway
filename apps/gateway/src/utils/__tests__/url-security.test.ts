/**
 * URL Security Utility Tests
 */

import { describe, expect, test } from "bun:test";
import { assertSafeExternalUrl, isPrivateNetworkUrl } from "../url-security";

describe("isPrivateNetworkUrl", () => {
  describe("localhost variants", () => {
    test("blocks localhost", () => {
      expect(isPrivateNetworkUrl("http://localhost/api")).toBe(true);
      expect(isPrivateNetworkUrl("http://localhost:8080/api")).toBe(true);
      expect(isPrivateNetworkUrl("https://localhost/api")).toBe(true);
    });

    test("blocks 127.0.0.1", () => {
      expect(isPrivateNetworkUrl("http://127.0.0.1/api")).toBe(true);
      expect(isPrivateNetworkUrl("http://127.0.0.1:3000/api")).toBe(true);
    });

    test("blocks IPv6 loopback", () => {
      expect(isPrivateNetworkUrl("http://[::1]/api")).toBe(true);
      expect(isPrivateNetworkUrl("http://[::1]:8080/api")).toBe(true);
    });

    test("blocks .localhost subdomains", () => {
      expect(isPrivateNetworkUrl("http://api.localhost/test")).toBe(true);
      expect(isPrivateNetworkUrl("http://foo.bar.localhost/test")).toBe(true);
    });
  });

  describe("private IPv4 ranges", () => {
    test("blocks 10.x.x.x (10.0.0.0/8)", () => {
      expect(isPrivateNetworkUrl("http://10.0.0.1/api")).toBe(true);
      expect(isPrivateNetworkUrl("http://10.255.255.255/api")).toBe(true);
    });

    test("blocks 172.16-31.x.x (172.16.0.0/12)", () => {
      expect(isPrivateNetworkUrl("http://172.16.0.1/api")).toBe(true);
      expect(isPrivateNetworkUrl("http://172.31.255.255/api")).toBe(true);
      // Should NOT block 172.15.x.x or 172.32.x.x
      expect(isPrivateNetworkUrl("http://172.15.0.1/api")).toBe(false);
      expect(isPrivateNetworkUrl("http://172.32.0.1/api")).toBe(false);
    });

    test("blocks 192.168.x.x (192.168.0.0/16)", () => {
      expect(isPrivateNetworkUrl("http://192.168.0.1/api")).toBe(true);
      expect(isPrivateNetworkUrl("http://192.168.255.255/api")).toBe(true);
    });

    test("blocks 169.254.x.x (link-local)", () => {
      expect(isPrivateNetworkUrl("http://169.254.169.254/latest")).toBe(true);
      expect(isPrivateNetworkUrl("http://169.254.0.1/api")).toBe(true);
    });

    test("blocks 0.0.0.0", () => {
      expect(isPrivateNetworkUrl("http://0.0.0.0/api")).toBe(true);
    });
  });

  describe("cloud metadata endpoints", () => {
    test("blocks metadata.google.internal", () => {
      expect(
        isPrivateNetworkUrl("http://metadata.google.internal/computeMetadata"),
      ).toBe(true);
    });

    test("blocks generic metadata hostname", () => {
      expect(isPrivateNetworkUrl("http://metadata/api")).toBe(true);
    });

    test("blocks .internal hostnames", () => {
      expect(isPrivateNetworkUrl("http://service.internal/api")).toBe(true);
      expect(isPrivateNetworkUrl("http://foo.bar.internal/api")).toBe(true);
    });
  });

  describe("public URLs", () => {
    test("allows external public URLs", () => {
      expect(isPrivateNetworkUrl("https://api.example.com/webhook")).toBe(
        false,
      );
      expect(
        isPrivateNetworkUrl("https://hooks.slack.com/services/T00/B00"),
      ).toBe(false);
      expect(isPrivateNetworkUrl("https://api.github.com/repos")).toBe(false);
      expect(isPrivateNetworkUrl("http://8.8.8.8/api")).toBe(false);
    });

    test("allows public IP addresses", () => {
      expect(isPrivateNetworkUrl("http://1.2.3.4/api")).toBe(false);
      expect(isPrivateNetworkUrl("http://203.0.113.1/api")).toBe(false);
    });
  });

  describe("edge cases", () => {
    test("returns true for invalid URLs", () => {
      expect(isPrivateNetworkUrl("not-a-url")).toBe(true);
      expect(isPrivateNetworkUrl("")).toBe(true);
    });

    test("handles URLs with credentials", () => {
      expect(isPrivateNetworkUrl("http://user:pass@localhost/api")).toBe(true);
      expect(isPrivateNetworkUrl("http://user:pass@example.com/api")).toBe(
        false,
      );
    });

    test("handles URLs with ports", () => {
      expect(isPrivateNetworkUrl("http://192.168.1.1:8080/api")).toBe(true);
      expect(isPrivateNetworkUrl("http://example.com:8080/api")).toBe(false);
    });
  });
});

describe("assertSafeExternalUrl", () => {
  test("throws for private network URLs", () => {
    expect(() =>
      assertSafeExternalUrl("http://localhost/api", "webhook"),
    ).toThrow(/webhook URL blocked/i);
    expect(() =>
      assertSafeExternalUrl("http://10.0.0.1/api", "notification"),
    ).toThrow(/notification URL blocked/i);
  });

  test("does not throw for public URLs", () => {
    expect(() =>
      assertSafeExternalUrl("https://api.example.com/webhook", "webhook"),
    ).not.toThrow();
  });
});
