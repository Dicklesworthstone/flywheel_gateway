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

/** Singleton cleanup interval handle */
let cleanupIntervalHandle: ReturnType<typeof setInterval> | null = null;

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
  stopIdempotencyCleanup();
  idempotencyStore.clear();
  pendingRequests.clear();
}

/**
 * Enforce maximum number of records in the store.
 * Removes oldest records (based on insertion order) until size <= max.
 */
export function enforceMaxRecords(max: number): number {
  if (idempotencyStore.size <= max) {
    return 0;
  }

  let count = 0;
  // Map iterates in insertion order. Since we only append new records,
  // the first items are the oldest.
  const iterator = idempotencyStore.keys();
  while (idempotencyStore.size > max) {
    const result = iterator.next();
    if (result.done) break;
    idempotencyStore.delete(result.value);
    count++;
  }
  return count;
}

/**
 * Stop the cleanup interval (for graceful shutdown or testing).
 */
export function stopIdempotencyCleanup(): void {
  if (cleanupIntervalHandle !== null) {
    clearInterval(cleanupIntervalHandle);
    cleanupIntervalHandle = null;
  }
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
  body: ArrayBuffer | null,
): Promise<string> {
  const meta = `${method}:${path}:`;
  const encoder = new TextEncoder();
  const metaBuffer = encoder.encode(meta);

  let dataBuffer: Uint8Array;
  if (body) {
    const bodyArray = new Uint8Array(body);
    dataBuffer = new Uint8Array(metaBuffer.length + bodyArray.length);
    dataBuffer.set(metaBuffer);
    dataBuffer.set(bodyArray, metaBuffer.length);
  } else {
    dataBuffer = metaBuffer;
  }

  // Create a fresh ArrayBuffer from the Uint8Array to satisfy TypeScript's strict typing
  const digestInput = new ArrayBuffer(dataBuffer.byteLength);
  new Uint8Array(digestInput).set(dataBuffer);
  const hashBuffer = await crypto.subtle.digest("SHA-256", digestInput);
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

  // Start periodic cleanup (singleton - only creates one interval regardless of how many times middleware is mounted)
  if (cleanupIntervalHandle === null) {
    cleanupIntervalHandle = setInterval(() => {
      pruneExpiredRecords();
      enforceMaxRecords(settings.maxRecords);
    }, 60000); // Every minute

    // Don't keep the process alive just for cleanup
    if (cleanupIntervalHandle.unref) {
      cleanupIntervalHandle.unref();
    }
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
    let bodyBuffer: ArrayBuffer | null = null;
    try {
      bodyBuffer = await c.req.arrayBuffer();
      // Re-create the request with the body so downstream handlers can read it
      const originalRequest = c.req.raw;

      // Prepare headers for the new request:
      // 1. Clone original headers
      // 2. Remove Content-Encoding (body is already decoded)
      // 3. Remove Transfer-Encoding (body is fixed, not chunked)
      // 4. Update Content-Length to match the byte length
      const newHeaders = new Headers(originalRequest.headers);
      newHeaders.delete("content-encoding");
      newHeaders.delete("transfer-encoding");
      if (bodyBuffer) {
        newHeaders.set("content-length", String(bodyBuffer.byteLength));
      }

      const newRequest = new Request(originalRequest.url, {
        method: originalRequest.method,
        headers: newHeaders,
        body: bodyBuffer,
      });
      // Note: Mutating c.req.raw to allow body re-reading downstream
      (c.req as { raw: Request }).raw = newRequest;
    } catch {
      // No body or already consumed
    }

    const fingerprint = await generateFingerprint(method, path, bodyBuffer);

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

      // Build headers for the cached response
      const responseHeaders = new Headers();
      responseHeaders.set("X-Idempotent-Replayed", "true");
      for (const [key, value] of Object.entries(existingRecord.headers)) {
        if (!key.toLowerCase().startsWith("x-idempotent")) {
          responseHeaders.set(key, value);
        }
      }

      return new Response(existingRecord.body, {
        status: existingRecord.status,
        headers: responseHeaders,
      });
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

        // Build headers for the pending response
        const pendingHeaders = new Headers();
        pendingHeaders.set("X-Idempotent-Replayed", "true");
        for (const [key, value] of Object.entries(record.headers)) {
          if (!key.toLowerCase().startsWith("x-idempotent")) {
            pendingHeaders.set(key, value);
          }
        }

        return new Response(record.body, {
          status: record.status,
          headers: pendingHeaders,
        });
      } catch (_error) {
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
