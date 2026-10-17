/**
 * URL Security Utilities
 *
 * Provides functions for validating URLs to prevent SSRF (Server-Side Request Forgery)
 * and other URL-based attacks.
 */

/**
 * Check if an IPv4 address (as 4 octets) is private/internal.
 */
function isPrivateIPv4(a: number, b: number, c: number, d: number): boolean {
  // Validate octets are in valid range
  if (
    a < 0 ||
    a > 255 ||
    b < 0 ||
    b > 255 ||
    c < 0 ||
    c > 255 ||
    d < 0 ||
    d > 255
  ) {
    return true; // Invalid = unsafe
  }
  // 127.0.0.0/8 (loopback range)
  if (a === 127) return true;
  // 10.0.0.0/8
  if (a === 10) return true;
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  // 169.254.0.0/16 (link-local, including AWS metadata)
  if (a === 169 && b === 254) return true;
  // 0.0.0.0/8 (current network)
  if (a === 0) return true;
  // 100.64.0.0/10 (carrier-grade NAT)
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 192.0.0.0/24 (IETF protocol assignments)
  if (a === 192 && b === 0 && c === 0) return true;
  // 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24 (documentation/test)
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  // 224.0.0.0/4 (multicast)
  if (a >= 224 && a <= 239) return true;
  // 240.0.0.0/4 (reserved)
  if (a >= 240) return true;
  return false;
}

/**
 * Check if an IPv6 address is private/internal.
 * Handles various IPv6 formats including IPv4-mapped addresses.
 */
function isPrivateIPv6(hostname: string): boolean {
  // Remove brackets if present
  const addr =
    hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1).toLowerCase()
      : hostname.toLowerCase();

  // Loopback ::1
  if (addr === "::1" || addr === "0:0:0:0:0:0:0:1") return true;

  // Unspecified ::
  if (addr === "::" || addr === "0:0:0:0:0:0:0:0") return true;

  // IPv4-mapped IPv6 (::ffff:x.x.x.x) - CRITICAL for SSRF bypass prevention
  const ipv4MappedMatch = addr.match(/^::ffff:(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4MappedMatch) {
    const [, a, b, c, d] = ipv4MappedMatch.map(Number);
    return isPrivateIPv4(a!, b!, c!, d!);
  }

  // IPv4-compatible IPv6 (deprecated but check anyway: ::x.x.x.x)
  const ipv4CompatMatch = addr.match(/^::(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4CompatMatch) {
    const [, a, b, c, d] = ipv4CompatMatch.map(Number);
    return isPrivateIPv4(a!, b!, c!, d!);
  }

  // Link-local fe80::/10
  if (
    addr.startsWith("fe8") ||
    addr.startsWith("fe9") ||
    addr.startsWith("fea") ||
    addr.startsWith("feb")
  )
    return true;

  // Unique local fc00::/7 (includes fd00::/8)
  if (addr.startsWith("fc") || addr.startsWith("fd")) return true;

  // Site-local (deprecated) fec0::/10
  if (
    addr.startsWith("fec") ||
    addr.startsWith("fed") ||
    addr.startsWith("fee") ||
    addr.startsWith("fef")
  )
    return true;

  // Multicast ff00::/8
  if (addr.startsWith("ff")) return true;

  // Loopback in full form
  if (addr.startsWith("0000:0000:0000:0000:0000:0000:0000:0001")) return true;

  return false;
}

/**
 * Parse decimal IP notation (e.g., 2130706433 = 127.0.0.1).
 * Returns [a, b, c, d] octets or null if not a valid decimal IP.
 */
function parseDecimalIP(
  hostname: string,
): [number, number, number, number] | null {
  // Must be all digits and within valid range for 32-bit unsigned int
  if (!/^\d+$/.test(hostname)) return null;
  const num = Number(hostname);
  if (!Number.isFinite(num) || num < 0 || num > 0xffffffff) return null;
  return [
    (num >>> 24) & 0xff,
    (num >>> 16) & 0xff,
    (num >>> 8) & 0xff,
    num & 0xff,
  ];
}

/**
 * Check if a URL points to a private/internal network address.
 * Used to prevent SSRF attacks via webhook URLs or other external requests.
 *
 * Blocks:
 * - localhost and loopback addresses (127.0.0.0/8, ::1)
 * - Private IPv4 ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
 * - Link-local addresses (169.254.0.0/16, fe80::/10) including cloud metadata endpoints
 * - IPv4-mapped IPv6 addresses (::ffff:x.x.x.x) pointing to private ranges
 * - Unique local IPv6 (fc00::/7)
 * - Decimal/numeric IP representations
 * - Common internal/metadata hostnames
 *
 * @param url - The URL to check
 * @returns true if the URL points to a private/internal address
 */
export function isPrivateNetworkUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Normalize hostname: lowercase and strip trailing dots (FQDNs like "localhost." are equivalent to "localhost")
    const hostname = parsed.hostname.toLowerCase().replace(/\.+$/, "");

    // Check for localhost variants
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname === "localhost.localdomain"
    ) {
      return true;
    }

    // Check for private IPv4 ranges (standard dotted decimal notation)
    const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipv4Match) {
      const [, a, b, c, d] = ipv4Match.map(Number);
      return isPrivateIPv4(a!, b!, c!, d!);
    }

    // Check for decimal IP notation (e.g., 2130706433 = 127.0.0.1)
    const decimalIP = parseDecimalIP(hostname);
    if (decimalIP) {
      return isPrivateIPv4(...decimalIP);
    }

    // Check for IPv6 addresses (including IPv4-mapped)
    if (
      hostname.includes(":") ||
      (hostname.startsWith("[") && hostname.endsWith("]"))
    ) {
      return isPrivateIPv6(hostname);
    }

    // Block common cloud metadata endpoints
    if (
      hostname === "metadata.google.internal" ||
      hostname === "metadata" ||
      hostname === "instance-data" ||
      hostname.endsWith(".internal") ||
      hostname.endsWith(".local") ||
      // AWS metadata
      hostname === "169.254.169.254" ||
      // Azure metadata
      hostname === "169.254.169.253" ||
      // GCP metadata alternate
      hostname === "metadata.google.com"
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
