/**
 * Cursor utilities for WebSocket ring buffer.
 *
 * Cursors are opaque strings that encode a position in a ring buffer.
 * Format: base64(timestamp:sequence)
 *
 * Properties:
 * - Time-ordered: Cursors can be compared without buffer access
 * - Stateless: Servers can validate cursors without storing them
 * - Compact: Base64 encoding keeps wire size small
 */

/**
 * Decoded cursor data.
 */
export interface CursorData {
  /** Unix timestamp in milliseconds when the message was added */
  timestamp: number;
  /** Monotonic sequence number within the buffer */
  sequence: number;
}

/**
 * Encode cursor data to an opaque string.
 *
 * @param data - The cursor data to encode
 * @returns Base64-encoded cursor string
 */
export function encodeCursor(data: CursorData): string {
  const payload = `${data.timestamp}:${data.sequence}`;
  // Use URL-safe base64 encoding
  return Buffer.from(payload).toString("base64url");
}

/**
 * Decode a cursor string to its components.
 *
 * @param cursor - The cursor string to decode
 * @returns Decoded cursor data or undefined if invalid
 */
export function decodeCursor(cursor: string): CursorData | undefined {
  try {
    const payload = Buffer.from(cursor, "base64url").toString("utf8");
    const parts = payload.split(":");
    if (parts.length !== 2) return undefined;

    const timestamp = parseInt(parts[0]!, 10);
    const sequence = parseInt(parts[1]!, 10);

    if (isNaN(timestamp) || isNaN(sequence)) return undefined;
    if (timestamp < 0 || sequence < 0) return undefined;

    return { timestamp, sequence };
  } catch {
    return undefined;
  }
}

/**
 * Compare two cursors for ordering.
 *
 * @param a - First cursor
 * @param b - Second cursor
 * @returns -1 if a < b, 0 if equal, 1 if a > b, or undefined if either is invalid
 */
export function compareCursors(a: string, b: string): -1 | 0 | 1 | undefined {
  const dataA = decodeCursor(a);
  const dataB = decodeCursor(b);

  if (!dataA || !dataB) return undefined;

  // Compare by timestamp first
  if (dataA.timestamp < dataB.timestamp) return -1;
  if (dataA.timestamp > dataB.timestamp) return 1;

  // Then by sequence
  if (dataA.sequence < dataB.sequence) return -1;
  if (dataA.sequence > dataB.sequence) return 1;

  return 0;
}

/**
 * Check if a cursor is expired (older than TTL).
 *
 * @param cursor - The cursor to check
 * @param ttlMs - Time-to-live in milliseconds
 * @returns true if expired, false if valid, undefined if cursor is invalid
 */
export function isCursorExpired(
  cursor: string,
  ttlMs: number,
): boolean | undefined {
  const data = decodeCursor(cursor);
  if (!data) return undefined;

  const now = Date.now();
  return now - data.timestamp > ttlMs;
}

/**
 * Create a cursor for the current time with given sequence.
 *
 * @param sequence - Sequence number
 * @param timestamp - Optional timestamp (defaults to now)
 * @returns Encoded cursor string
 */
export function createCursor(sequence: number, timestamp?: number): string {
  return encodeCursor({
    timestamp: timestamp ?? Date.now(),
    sequence,
  });
}
