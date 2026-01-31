/**
 * Security Headers Middleware.
 *
 * Applies security headers to all responses following OWASP recommendations.
 * Headers include CSP, X-Frame-Options, X-Content-Type-Options, and more.
 *
 * @see https://owasp.org/www-project-secure-headers/
 */

import type { Context, Next } from "hono";

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for security headers.
 */
export interface SecurityHeadersConfig {
  /** Content Security Policy directives */
  csp?: ContentSecurityPolicy;
  /** Whether to enable HSTS (default: true in production) */
  hsts?: boolean;
  /** HSTS max-age in seconds (default: 1 year) */
  hstsMaxAge?: number;
  /** Include subdomains in HSTS (default: true) */
  hstsIncludeSubdomains?: boolean;
  /** Preload HSTS (default: false, requires careful consideration) */
  hstsPreload?: boolean;
  /** X-Frame-Options value (default: 'DENY') */
  frameOptions?: "DENY" | "SAMEORIGIN";
  /** Whether to enable XSS protection header (default: true) */
  xssProtection?: boolean;
  /** Whether to enable nosniff (default: true) */
  noSniff?: boolean;
  /** Referrer policy (default: 'strict-origin-when-cross-origin') */
  referrerPolicy?: ReferrerPolicy;
  /** Permissions policy directives */
  permissionsPolicy?: PermissionsPolicy;
  /** Cross-Origin-Opener-Policy (default: 'same-origin') */
  coop?: "same-origin" | "same-origin-allow-popups" | "unsafe-none";
  /** Cross-Origin-Embedder-Policy (default: none for API) */
  coep?: "require-corp" | "credentialless" | "unsafe-none";
  /** Cross-Origin-Resource-Policy (default: 'same-origin') */
  corp?: "same-origin" | "same-site" | "cross-origin";
}

/**
 * Content Security Policy directives.
 */
export interface ContentSecurityPolicy {
  defaultSrc?: string[];
  scriptSrc?: string[];
  styleSrc?: string[];
  imgSrc?: string[];
  fontSrc?: string[];
  connectSrc?: string[];
  frameSrc?: string[];
  objectSrc?: string[];
  mediaSrc?: string[];
  workerSrc?: string[];
  childSrc?: string[];
  formAction?: string[];
  frameAncestors?: string[];
  baseUri?: string[];
  upgradeInsecureRequests?: boolean;
  blockAllMixedContent?: boolean;
  reportUri?: string;
  reportTo?: string;
}

/**
 * Permissions Policy directives.
 */
export interface PermissionsPolicy {
  accelerometer?: string[];
  camera?: string[];
  geolocation?: string[];
  gyroscope?: string[];
  magnetometer?: string[];
  microphone?: string[];
  payment?: string[];
  usb?: string[];
  fullscreen?: string[];
}

type ReferrerPolicy =
  | "no-referrer"
  | "no-referrer-when-downgrade"
  | "origin"
  | "origin-when-cross-origin"
  | "same-origin"
  | "strict-origin"
  | "strict-origin-when-cross-origin"
  | "unsafe-url";

// ============================================================================
// Default Configuration
// ============================================================================

const defaultConfig: SecurityHeadersConfig = {
  csp: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"], // Allow inline styles for API docs
    imgSrc: ["'self'", "data:", "blob:"],
    fontSrc: ["'self'"],
    connectSrc: ["'self'", "ws:", "wss:"],
    frameSrc: ["'none'"],
    objectSrc: ["'none'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"],
    baseUri: ["'self'"],
    // Only enable this in production; it breaks local HTTP docs (e.g. `/docs` fetching `/openapi.json`)
    // by upgrading same-origin requests to https:// when the gateway isn't serving TLS.
    upgradeInsecureRequests: process.env.NODE_ENV === "production",
  },
  hsts: process.env.NODE_ENV === "production",
  hstsMaxAge: 31536000, // 1 year
  hstsIncludeSubdomains: true,
  hstsPreload: false,
  frameOptions: "DENY",
  xssProtection: true,
  noSniff: true,
  referrerPolicy: "strict-origin-when-cross-origin",
  permissionsPolicy: {
    accelerometer: [],
    camera: [],
    geolocation: [],
    gyroscope: [],
    magnetometer: [],
    microphone: [],
    payment: [],
    usb: [],
  },
  coop: "same-origin",
  coep: "unsafe-none", // 'unsafe-none' for API servers
  corp: "same-origin",
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Build CSP header value from directives.
 */
function buildCspHeader(csp: ContentSecurityPolicy): string {
  const directives: string[] = [];

  const directiveMap: Record<keyof ContentSecurityPolicy, string> = {
    defaultSrc: "default-src",
    scriptSrc: "script-src",
    styleSrc: "style-src",
    imgSrc: "img-src",
    fontSrc: "font-src",
    connectSrc: "connect-src",
    frameSrc: "frame-src",
    objectSrc: "object-src",
    mediaSrc: "media-src",
    workerSrc: "worker-src",
    childSrc: "child-src",
    formAction: "form-action",
    frameAncestors: "frame-ancestors",
    baseUri: "base-uri",
    upgradeInsecureRequests: "upgrade-insecure-requests",
    blockAllMixedContent: "block-all-mixed-content",
    reportUri: "report-uri",
    reportTo: "report-to",
  };

  for (const [key, value] of Object.entries(csp)) {
    if (value === undefined) continue;

    const directiveName = directiveMap[key as keyof ContentSecurityPolicy];
    if (!directiveName) continue;

    if (typeof value === "boolean") {
      if (value) {
        directives.push(directiveName);
      }
    } else if (Array.isArray(value)) {
      if (value.length > 0) {
        directives.push(`${directiveName} ${value.join(" ")}`);
      }
    } else if (typeof value === "string") {
      directives.push(`${directiveName} ${value}`);
    }
  }

  return directives.join("; ");
}

/**
 * Build Permissions-Policy header value from directives.
 */
function buildPermissionsPolicy(policy: PermissionsPolicy): string {
  const directives: string[] = [];

  for (const [feature, allowlist] of Object.entries(policy)) {
    if (allowlist === undefined) continue;

    if (allowlist.length === 0) {
      directives.push(`${feature}=()`);
    } else {
      const origins = allowlist.map((o: string) =>
        o === "self" ? "self" : `"${o}"`,
      );
      directives.push(`${feature}=(${origins.join(" ")})`);
    }
  }

  return directives.join(", ");
}

// ============================================================================
// Middleware Factory
// ============================================================================

/**
 * Create security headers middleware.
 *
 * @example
 * ```typescript
 * // Use default configuration
 * app.use('*', securityHeaders());
 *
 * // With custom configuration
 * app.use('*', securityHeaders({
 *   frameOptions: 'SAMEORIGIN',
 *   csp: {
 *     defaultSrc: ["'self'"],
 *     scriptSrc: ["'self'", "'unsafe-inline'"],
 *   },
 * }));
 * ```
 */
export function securityHeaders(
  config: SecurityHeadersConfig = {},
): (c: Context, next: Next) => Promise<Response | undefined> {
  const mergedConfig = {
    ...defaultConfig,
    ...config,
    csp: config.csp
      ? { ...defaultConfig.csp, ...config.csp }
      : defaultConfig.csp,
    permissionsPolicy: config.permissionsPolicy
      ? { ...defaultConfig.permissionsPolicy, ...config.permissionsPolicy }
      : defaultConfig.permissionsPolicy,
  };

  return async (c: Context, next: Next): Promise<Response | undefined> => {
    await next();

    // X-Content-Type-Options
    if (mergedConfig.noSniff) {
      c.header("X-Content-Type-Options", "nosniff");
    }

    // X-Frame-Options
    if (mergedConfig.frameOptions) {
      c.header("X-Frame-Options", mergedConfig.frameOptions);
    }

    // X-XSS-Protection (legacy but still useful)
    if (mergedConfig.xssProtection) {
      c.header("X-XSS-Protection", "1; mode=block");
    }

    // Referrer-Policy
    if (mergedConfig.referrerPolicy) {
      c.header("Referrer-Policy", mergedConfig.referrerPolicy);
    }

    // Content-Security-Policy
    if (mergedConfig.csp) {
      c.header("Content-Security-Policy", buildCspHeader(mergedConfig.csp));
    }

    // Strict-Transport-Security (HSTS)
    if (mergedConfig.hsts) {
      let hstsValue = `max-age=${mergedConfig.hstsMaxAge}`;
      if (mergedConfig.hstsIncludeSubdomains) {
        hstsValue += "; includeSubDomains";
      }
      if (mergedConfig.hstsPreload) {
        hstsValue += "; preload";
      }
      c.header("Strict-Transport-Security", hstsValue);
    }

    // Permissions-Policy
    if (mergedConfig.permissionsPolicy) {
      c.header(
        "Permissions-Policy",
        buildPermissionsPolicy(mergedConfig.permissionsPolicy),
      );
    }

    // Cross-Origin-Opener-Policy
    if (mergedConfig.coop) {
      c.header("Cross-Origin-Opener-Policy", mergedConfig.coop);
    }

    // Cross-Origin-Embedder-Policy
    if (mergedConfig.coep) {
      c.header("Cross-Origin-Embedder-Policy", mergedConfig.coep);
    }

    // Cross-Origin-Resource-Policy
    if (mergedConfig.corp) {
      c.header("Cross-Origin-Resource-Policy", mergedConfig.corp);
    }

    // Additional security headers
    c.header("X-DNS-Prefetch-Control", "off");
    c.header("X-Download-Options", "noopen");
    c.header("X-Permitted-Cross-Domain-Policies", "none");
    return undefined;
  };
}

/**
 * API-optimized security headers preset.
 * Less restrictive CSP for API servers that don't serve HTML.
 */
export function apiSecurityHeaders(): (
  c: Context,
  next: Next,
) => Promise<Response | undefined> {
  const apiPreset = securityHeaders({
    csp: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
    frameOptions: "DENY",
    referrerPolicy: "no-referrer",
    coop: "same-origin",
    coep: "unsafe-none",
    corp: "same-origin",
  });

  // `/docs` and `/redoc` serve HTML that pulls assets from CDNs; use a separate CSP allowlist
  // so the interactive documentation works while keeping the API CSP strict.
  const swaggerDocsPreset = securityHeaders({
    csp: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://unpkg.com"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      fontSrc: ["'self'", "data:", "https://unpkg.com"],
      connectSrc: ["'self'", "ws:", "wss:"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      objectSrc: ["'none'"],
      frameSrc: ["'none'"],
      // Never force HTTPS upgrades for docs pages; local gateway commonly runs over HTTP.
      upgradeInsecureRequests: false,
    },
    frameOptions: "DENY",
    referrerPolicy: "no-referrer",
    coop: "same-origin",
    coep: "unsafe-none",
    corp: "same-origin",
  });

  const redocPreset = securityHeaders({
    csp: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://cdn.redoc.ly"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      objectSrc: ["'none'"],
      frameSrc: ["'none'"],
      upgradeInsecureRequests: false,
    },
    frameOptions: "DENY",
    referrerPolicy: "no-referrer",
    coop: "same-origin",
    coep: "unsafe-none",
    corp: "same-origin",
  });

  return async (c: Context, next: Next): Promise<Response | undefined> => {
    const path = c.req.path;
    if (path === "/docs" || path.startsWith("/docs/"))
      return swaggerDocsPreset(c, next);
    if (path === "/redoc" || path.startsWith("/redoc/"))
      return redocPreset(c, next);
    return apiPreset(c, next);
  };
}
