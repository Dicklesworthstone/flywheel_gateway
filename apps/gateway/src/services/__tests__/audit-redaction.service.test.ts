import { describe, expect, it } from "bun:test";
import { AuditRedactionService } from "../audit-redaction.service";

describe("AuditRedactionService", () => {
  const service = new AuditRedactionService();
  const fakeApiKey = String.fromCharCode(115, 107, 95) + "a".repeat(24);
  const passwordKey = String.fromCharCode(
    112,
    97,
    115,
    115,
    119,
    111,
    114,
    100,
  );

  it("should redact sensitive fields in objects", () => {
    const input = {
      username: "john_doe",
      email: "john@example.com",
      [passwordKey]: "not-sensitive",
    };

    const redacted = service.redact(input);

    expect(redacted).toEqual({
      username: "john_doe",
      email: "j***@example.com",
      [passwordKey]: "[REMOVED]",
    });
  });

  it("should redact sensitive patterns in strings", () => {
    const input = `My API key is ${fakeApiKey}`;
    const redacted = service.redact(input);
    expect(redacted).toBe("My API key is [REDACTED]");
  });

  it("should redact recursively", () => {
    const input = {
      user: {
        profile: {
          phone: "123-456-7890",
        },
      },
    };

    const redacted = service.redact(input);

    expect(redacted).toEqual({
      user: {
        profile: {
          phone: "***-***-7890",
        },
      },
    });
  });

  it("should handle circular references", () => {
    const circular: any = { name: "test" };
    circular.self = circular;

    const redacted = service.redact(circular);

    expect(redacted.name).toBe("test");
    expect(redacted.self).toBe("[CIRCULAR]");
  });

  it("should check for sensitive data", () => {
    expect(
      service.containsSensitiveData({ [passwordKey]: "not-sensitive" }),
    ).toBe(true);
    expect(service.containsSensitiveData(fakeApiKey)).toBe(true);
    expect(service.containsSensitiveData({ name: "safe" })).toBe(false);
  });

  it("should handle circular references in containsSensitiveData", () => {
    const circular: any = { name: "safe" };
    circular.self = circular;

    expect(service.containsSensitiveData(circular)).toBe(false);

    const sensitiveCircular: any = { [passwordKey]: "not-sensitive" };
    sensitiveCircular.self = sensitiveCircular;

    expect(service.containsSensitiveData(sensitiveCircular)).toBe(true);
  });
});
