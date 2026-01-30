/**
 * URL Security Utilities
 *
 * Provides functions for validating URLs to prevent SSRF (Server-Side Request Forgery)
 * and other URL-based attacks.
 */

/**
 * Check if a URL points to a private/internal network address.
 * Used to prevent SSRF attacks via webhook URLs or other external requests.
 *
 * Blocks:
 * - localhost and loopback addresses (127.0.0.0/8, ::1)
 * - Private IPv4 ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
 * - Link-local addresses (169.254.0.0/16) including cloud metadata endpoints
 * - Common internal/metadata hostnames
 *
 * @param url - The URL to check
 * @returns true if the URL points to a private/internal address
 */
export function isPrivateNetworkUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    // Check for localhost variants
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]" ||
      hostname.endsWith(".localhost")
    ) {
      return true;
    }

    // Check for private IPv4 ranges
    const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipv4Match) {
      const [, a, b] = ipv4Match.map(Number);
      // 127.0.0.0/8 (loopback range - all of 127.x.x.x)
      if (a === 127) return true;
      // 10.0.0.0/8
      if (a === 10) return true;
      // 172.16.0.0/12
      if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
      // 192.168.0.0/16
      if (a === 192 && b === 168) return true;
      // 169.254.0.0/16 (link-local, including AWS metadata)
      if (a === 169 && b === 254) return true;
      // 0.0.0.0
      if (a === 0) return true;
    }

    // Block common cloud metadata endpoints
    if (
      hostname === "metadata.google.internal" ||
      hostname === "metadata" ||
      hostname.endsWith(".internal")
    ) {
      return true;
    }

    return false;
  } catch {
    // If URL parsing fails, consider it unsafe
    return true;
  }
}

/**
 * Validate that a URL is safe for server-side requests.
 * Throws an error if the URL points to a private/internal network.
 *
 * @param url - The URL to validate
 * @param context - Context for the error message (e.g., "webhook", "notification")
 * @throws Error if the URL is not safe
 */
export function assertSafeExternalUrl(url: string, context: string): void {
  if (isPrivateNetworkUrl(url)) {
    throw new Error(
      `${context} URL blocked: Cannot make requests to private/internal network addresses`,
    );
  }
}
