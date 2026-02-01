import { logger } from "./services/logger";

function isLocalHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function enforceStartupSecurity(options: {
  host: string;
  port: number;
}): void {
  const hostIsLocal = isLocalHost(options.host);

  const adminKey = process.env["GATEWAY_ADMIN_KEY"]?.trim();
  const jwtSecret = process.env["JWT_SECRET"]?.trim();
  const authEnabled = Boolean(adminKey || jwtSecret);

  const allowInsecure = process.env["ALLOW_INSECURE_NO_AUTH"] === "true";

  if (!hostIsLocal && !authEnabled && !allowInsecure) {
    // Fail-fast to avoid accidentally exposing a fully unauthenticated gateway
    // on non-local interfaces (e.g. 0.0.0.0 / public IP).
    throw new Error(
      `Refusing to start: auth is disabled (GATEWAY_ADMIN_KEY/JWT_SECRET unset) and host is not local (${options.host}:${options.port}). ` +
        `Set JWT_SECRET or GATEWAY_ADMIN_KEY, or bind to 127.0.0.1. ` +
        `To override (NOT RECOMMENDED), set ALLOW_INSECURE_NO_AUTH=true.`,
    );
  }

  if (
    !hostIsLocal &&
    process.env["ENABLE_SETUP_INSTALL_UNAUTH"] === "true" &&
    !allowInsecure
  ) {
    throw new Error(
      `Refusing to start: ENABLE_SETUP_INSTALL_UNAUTH=true is only allowed on local host (${options.host}:${options.port}). ` +
        `Disable it or bind to 127.0.0.1. ` +
        `To override (NOT RECOMMENDED), set ALLOW_INSECURE_NO_AUTH=true.`,
    );
  }
}

export function logStartupSecurityWarnings(options: {
  host: string;
  port: number;
}): void {
  const hostIsLocal = isLocalHost(options.host);

  if (process.env["ENABLE_SETUP_INSTALL_UNAUTH"] === "true") {
    logger.warn(
      {
        host: options.host,
        port: options.port,
        hostIsLocal,
        enableSetupInstallUnauth: true,
      },
      "SECURITY WARNING: ENABLE_SETUP_INSTALL_UNAUTH=true allows unauthenticated tool installs via /setup/install. Use only for local development.",
    );
  }

  const adminKey = process.env["GATEWAY_ADMIN_KEY"]?.trim();
  const jwtSecret = process.env["JWT_SECRET"]?.trim();
  const authEnabled = Boolean(adminKey || jwtSecret);

  if (!authEnabled) {
    logger.warn(
      { host: options.host, port: options.port, hostIsLocal, authEnabled },
      "SECURITY WARNING: Authentication is disabled (GATEWAY_ADMIN_KEY and JWT_SECRET are unset). All API endpoints are accessible without authentication. Use only for local development.",
    );
  }
}
