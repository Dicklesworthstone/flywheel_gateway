/**
 * Idempotency Middleware - Ensures safe request retries.
 *
 * Clients include an `Idempotency-Key` header with a unique identifier.
 * The middleware:
 * 1. On first request: Execute handler, cache response with key
 * 2. On duplicate request: Return cached response without re-execution
 * 3. On concurrent duplicate: Block until first completes, return same result
 */

import type { Context, Next } from "hono";
import { getCorrelationId, getLogger } from "./correlation";

// ============================================================================
// Types
// ============================================================================

export interface IdempotencyRecord {
  key: string;
  method: string;
  path: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  createdAt: Date;
  expiresAt: Date;
  fingerprint: string;
}

export interface IdempotencyConfig {
  /** Header name for the idempotency key (default: "Idempotency-Key") */
  headerName?: string;
  /** TTL for cached responses in milliseconds (default: 24 hours) */
  ttlMs?: number;
  /** Methods that require idempotency (default: ["POST", "PUT", "PATCH"]) */
  methods?: string[];
  /** Maximum number of cached records (default: 10000) */
  maxRecords?: number;
  /** Paths to exclude from idempotency checks (default: []) */
  excludePaths?: string[];
}

type PendingRequest = {
  promise: Promise<IdempotencyRecord>;
  resolve: (record: IdempotencyRecord) => void;
  reject: (error: Error) => void;
};

// ============================================================================
// In-Memory Store
// ============================================================================

const idempotencyStore = new Map<string, IdempotencyRecord>();
const pendingRequests = new Map<string, PendingRequest>();

/**
 * Get a cached idempotency record.
 */
export function getIdempotencyRecord(
  key: string,
): IdempotencyRecord | undefined {
  const record = idempotencyStore.get(key);
  if (!record) {
    return undefined;
  }
  // Check expiration
  if (record.expiresAt <= new Date()) {
    idempotencyStore.delete(key);
    return undefined;
  }
  return record;
}

/**
 * Store an idempotency record.
 */
export function setIdempotencyRecord(record: IdempotencyRecord): void {
  idempotencyStore.set(record.key, record);
}

/**
 * Delete an idempotency record.
 */
export function deleteIdempotencyRecord(key: string): boolean {
  return idempotencyStore.delete(key);
}

/**
 * Clear expired records from the store.
 */
export function pruneExpiredRecords(): number {
  const now = new Date();
  let count = 0;
  for (const [key, record] of idempotencyStore) {
    if (record.expiresAt < now) {
      idempotencyStore.delete(key);
      count++;
    }
  }
  return count;
}

/**
 * Clear all records from the store (for testing).
 */
export function clearIdempotencyStore(): void {
  idempotencyStore.clear();
  pendingRequests.clear();
}

/**
 * Get store statistics.
 */
export function getIdempotencyStats(): {
  totalRecords: number;
  pendingRequests: number;
  oldestRecord: Date | null;
  newestRecord: Date | null;
} {
  let oldest: Date | null = null;
  let newest: Date | null = null;

  for (const record of idempotencyStore.values()) {
    if (!oldest || record.createdAt < oldest) {
      oldest = record.createdAt;
    }
    if (!newest || record.createdAt > newest) {
      newest = record.createdAt;
    }
  }

  return {
    totalRecords: idempotencyStore.size,
    pendingRequests: pendingRequests.size,
    oldestRecord: oldest,
    newestRecord: newest,
  };
}

// ============================================================================
// Request Fingerprinting
// ============================================================================

/**
 * Generate a fingerprint for a request to detect mismatched replay attempts.
 */
async function generateFingerprint(
  method: string,
  path: string,
  body: string | null,
): Promise<string> {
  const data = `${method}:${path}:${body ?? ""}`;
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest("SHA-256", dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ============================================================================
// Middleware
// ============================================================================

const DEFAULT_CONFIG: Required<IdempotencyConfig> = {
  headerName: "Idempotency-Key",
  ttlMs: 24 * 60 * 60 * 1000, // 24 hours
  methods: ["POST", "PUT", "PATCH"],
  maxRecords: 10000,
  excludePaths: [],
};

/**
 * Idempotency middleware for Hono.
 *
 * Usage:
 * ```typescript
 * app.use("/api/*", idempotencyMiddleware());
 * ```
 */
export function idempotencyMiddleware(config: IdempotencyConfig = {}) {
  const settings = { ...DEFAULT_CONFIG, ...config };

  // Start periodic cleanup
  const cleanupInterval = setInterval(() => {
    pruneExpiredRecords();
    // Enforce max records if needed
    if (idempotencyStore.size > settings.maxRecords) {
      const records = Array.from(idempotencyStore.entries()).sort(
        (a, b) => a[1].createdAt.getTime() - b[1].createdAt.getTime(),
      );
      const toDelete = records.slice(
        0,
        idempotencyStore.size - settings.maxRecords,
      );
      for (const [key] of toDelete) {
        idempotencyStore.delete(key);
      }
    }
  }, 60000); // Every minute

  // Don't keep the process alive just for cleanup
  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  return async (c: Context, next: Next) => {
    const log = getLogger();
    const method = c.req.method;
    const path = c.req.path;

    // Skip if method doesn't require idempotency
    if (!settings.methods.includes(method)) {
      await next();
      return;
    }

    // Skip excluded paths
    if (settings.excludePaths.some((p) => path.startsWith(p))) {
      await next();
      return;
    }

    // Get idempotency key from header
    const idempotencyKey = c.req.header(settings.headerName);
    if (!idempotencyKey) {
      // No key provided, proceed normally
      await next();
      return;
    }

    // Validate key format (should be UUID-like or reasonable string)
    if (idempotencyKey.length < 8 || idempotencyKey.length > 256) {
      return c.json(
        {
          error: {
            code: "INVALID_IDEMPOTENCY_KEY",
            message: "Idempotency-Key must be between 8 and 256 characters",
            correlationId: getCorrelationId(),
            timestamp: new Date().toISOString(),
          },
        },
        400,
      );
    }

    // Get request body for fingerprinting
    let bodyText: string | null = null;
    try {
      bodyText = await c.req.text();
      // Re-create the request with the body so downstream handlers can read it
      const originalRequest = c.req.raw;
      const newRequest = new Request(originalRequest.url, {
        method: originalRequest.method,
        headers: originalRequest.headers,
        body: bodyText,
      });
      // Note: Mutating c.req.raw to allow body re-reading downstream
      (c.req as { raw: Request }).raw = newRequest;
    } catch {
      // No body or already consumed
    }

    const fingerprint = await generateFingerprint(method, path, bodyText);

    // Check for existing record
    const existingRecord = getIdempotencyRecord(idempotencyKey);
    if (existingRecord) {
      // Verify the request matches
      if (existingRecord.fingerprint !== fingerprint) {
        log.warn(
          {
            idempotencyKey,
            expectedFingerprint: existingRecord.fingerprint,
            actualFingerprint: fingerprint,
          },
          "Idempotency key reused with different request",
        );
        return c.json(
          {
            error: {
              code: "IDEMPOTENCY_KEY_MISMATCH",
              message: "Idempotency key was used with a different request",
              correlationId: getCorrelationId(),
              timestamp: new Date().toISOString(),
            },
          },
          422,
        );
      }

      // Return cached response
      log.debug({ idempotencyKey }, "Returning cached idempotent response");
      c.header("X-Idempotent-Replayed", "true");

      // Set cached headers
      for (const [key, value] of Object.entries(existingRecord.headers)) {
        if (!key.toLowerCase().startsWith("x-idempotent")) {
          c.header(key, value);
        }
      }

      return c.body(existingRecord.body, existingRecord.status as any);
    }

    // Check for pending request with same key
    const pending = pendingRequests.get(idempotencyKey);
    if (pending) {
      log.debug(
        { idempotencyKey },
        "Waiting for concurrent request to complete",
      );
      try {
        const record = await pending.promise;
        c.header("X-Idempotent-Replayed", "true");
        for (const [key, value] of Object.entries(record.headers)) {
          if (!key.toLowerCase().startsWith("x-idempotent")) {
            c.header(key, value);
          }
        }
        return c.body(record.body, record.status as any);
      } catch (error) {
        // Original request failed, let this one try
        log.debug(
          { idempotencyKey },
          "Concurrent request failed, proceeding with new attempt",
        );
      }
    }

    // Create pending request tracker
    let resolvePromise: (record: IdempotencyRecord) => void;
    let rejectPromise: (error: Error) => void;
    const promise = new Promise<IdempotencyRecord>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    pendingRequests.set(idempotencyKey, {
      promise,
      resolve: resolvePromise!,
      reject: rejectPromise!,
    });

    try {
      // Execute the actual request
      await next();

      // Capture the response
      const response = c.res;
      const status = response.status;
      const responseBody = await response.clone().text();

      // Capture relevant headers
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        // Only cache content-related headers
        if (
          key.toLowerCase() === "content-type" ||
          key.toLowerCase().startsWith("x-")
        ) {
          headers[key] = value;
        }
      });

      // Only cache successful responses (2xx and 4xx client errors that should be stable)
      const shouldCache =
        (status >= 200 && status < 300) || (status >= 400 && status < 500);
      if (shouldCache) {
        const record: IdempotencyRecord = {
          key: idempotencyKey,
          method,
          path,
          status,
          headers,
          body: responseBody,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + settings.ttlMs),
          fingerprint,
        };

        setIdempotencyRecord(record);
        pendingRequests.get(idempotencyKey)?.resolve(record);
        log.debug({ idempotencyKey, status }, "Cached idempotent response");
      }
    } catch (error) {
      pendingRequests.get(idempotencyKey)?.reject(error as Error);
      throw error;
    } finally {
      pendingRequests.delete(idempotencyKey);
    }
  };
}
