import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { logger } from "../services/logger";
import {
  enforceStartupSecurity,
  logStartupSecurityWarnings,
} from "../startup-warnings";

describe("logStartupSecurityWarnings", () => {
  afterEach(() => {
    delete process.env["ALLOW_INSECURE_NO_AUTH"];
    delete process.env["ENABLE_SETUP_INSTALL_UNAUTH"];
    delete process.env["GATEWAY_ADMIN_KEY"];
    delete process.env["JWT_SECRET"];
  });

  it("warns when ENABLE_SETUP_INSTALL_UNAUTH=true", () => {
    process.env["ENABLE_SETUP_INSTALL_UNAUTH"] = "true";
    process.env["JWT_SECRET"] = "test-secret";

    const warnSpy = spyOn(logger, "warn").mockImplementation(() => undefined);
    try {
      logStartupSecurityWarnings({ host: "127.0.0.1", port: 3000 });

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0]?.[1])).toContain(
        "ENABLE_SETUP_INSTALL_UNAUTH",
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("warns when auth is disabled (no JWT_SECRET or GATEWAY_ADMIN_KEY)", () => {
    const warnSpy = spyOn(logger, "warn").mockImplementation(() => undefined);
    try {
      logStartupSecurityWarnings({ host: "0.0.0.0", port: 3000 });

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0]?.[1])).toContain(
        "Authentication is disabled",
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("does not warn when auth is enabled and setup unauth installs are disabled", () => {
    process.env["JWT_SECRET"] = "test-secret";

    const warnSpy = spyOn(logger, "warn").mockImplementation(() => undefined);
    try {
      logStartupSecurityWarnings({ host: "127.0.0.1", port: 3000 });
      expect(warnSpy).toHaveBeenCalledTimes(0);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe("enforceStartupSecurity", () => {
  afterEach(() => {
    delete process.env["ALLOW_INSECURE_NO_AUTH"];
    delete process.env["ENABLE_SETUP_INSTALL_UNAUTH"];
    delete process.env["GATEWAY_ADMIN_KEY"];
    delete process.env["JWT_SECRET"];
  });

  it("throws when auth is disabled on a non-local host", () => {
    expect(() =>
      enforceStartupSecurity({ host: "0.0.0.0", port: 3000 }),
    ).toThrow(/Refusing to start/);
  });

  it("does not throw when auth is disabled on localhost", () => {
    expect(() =>
      enforceStartupSecurity({ host: "127.0.0.1", port: 3000 }),
    ).not.toThrow();
  });

  it("does not throw when override is set", () => {
    process.env["ALLOW_INSECURE_NO_AUTH"] = "true";
    expect(() =>
      enforceStartupSecurity({ host: "0.0.0.0", port: 3000 }),
    ).not.toThrow();
  });

  it("throws when ENABLE_SETUP_INSTALL_UNAUTH=true on a non-local host", () => {
    process.env["ENABLE_SETUP_INSTALL_UNAUTH"] = "true";
    process.env["JWT_SECRET"] = "test-secret";

    expect(() =>
      enforceStartupSecurity({ host: "0.0.0.0", port: 3000 }),
    ).toThrow(/ENABLE_SETUP_INSTALL_UNAUTH/);
  });
});
