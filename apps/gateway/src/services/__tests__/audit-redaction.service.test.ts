import { describe, expect, it } from "bun:test";
import { AuditRedactionService } from "../audit-redaction.service";

describe("AuditRedactionService", () => {
  const service = new AuditRedactionService();

  it("should redact sensitive fields in objects", () => {
    const input = {
      username: "john_doe",
      password: "secret_password",
      email: "john@example.com",
    };

    const redacted = service.redact(input);

    expect(redacted).toEqual({
      username: "john_doe",
      password: "[REMOVED]",
      email: "j***@example.com",
    });
  });

  it("should redact sensitive patterns in strings", () => {
    const input = "My API key is sk_test_12345678901234567890";
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
    expect(service.containsSensitiveData({ password: "123" })).toBe(true);
    expect(service.containsSensitiveData("sk_test_12345678901234567890")).toBe(
      true,
    );
    expect(service.containsSensitiveData({ name: "safe" })).toBe(false);
  });

  it("should handle circular references in containsSensitiveData", () => {
    const circular: any = { name: "safe" };
    circular.self = circular;

    expect(service.containsSensitiveData(circular)).toBe(false);

    const sensitiveCircular: any = { password: "123" };
    sensitiveCircular.self = sensitiveCircular;

    expect(service.containsSensitiveData(sensitiveCircular)).toBe(true);
  });
});
