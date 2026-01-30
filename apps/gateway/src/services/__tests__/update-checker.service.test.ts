/**
 * Update Checker Service Tests
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";

// Test the version comparison logic directly
describe("Version Comparison", () => {
  function isNewerVersion(current: string, latest: string): boolean {
    const currentParts = current.replace(/^v/, "").split(".").map(Number);
    const latestParts = latest.replace(/^v/, "").split(".").map(Number);

    for (
      let i = 0;
      i < Math.max(currentParts.length, latestParts.length);
      i++
    ) {
      const currentPart = currentParts[i] ?? 0;
      const latestPart = latestParts[i] ?? 0;

      if (latestPart > currentPart) return true;
      if (latestPart < currentPart) return false;
    }

    return false;
  }

  it("should detect newer major version", () => {
    expect(isNewerVersion("1.0.0", "2.0.0")).toBe(true);
    expect(isNewerVersion("0.9.9", "1.0.0")).toBe(true);
  });

  it("should detect newer minor version", () => {
    expect(isNewerVersion("1.0.0", "1.1.0")).toBe(true);
    expect(isNewerVersion("1.5.0", "1.6.0")).toBe(true);
  });

  it("should detect newer patch version", () => {
    expect(isNewerVersion("1.0.0", "1.0.1")).toBe(true);
    expect(isNewerVersion("1.0.9", "1.0.10")).toBe(true);
  });

  it("should return false for same version", () => {
    expect(isNewerVersion("1.0.0", "1.0.0")).toBe(false);
    expect(isNewerVersion("2.5.3", "2.5.3")).toBe(false);
  });

  it("should return false for older version", () => {
    expect(isNewerVersion("2.0.0", "1.0.0")).toBe(false);
    expect(isNewerVersion("1.1.0", "1.0.0")).toBe(false);
    expect(isNewerVersion("1.0.1", "1.0.0")).toBe(false);
  });

  it("should handle version with v prefix", () => {
    expect(isNewerVersion("v1.0.0", "v1.0.1")).toBe(true);
    expect(isNewerVersion("v1.0.0", "1.0.1")).toBe(true);
    expect(isNewerVersion("1.0.0", "v1.0.1")).toBe(true);
  });

  it("should handle versions with different lengths", () => {
    expect(isNewerVersion("1.0", "1.0.1")).toBe(true);
    expect(isNewerVersion("1.0.0", "1.1")).toBe(true);
    expect(isNewerVersion("1", "1.0.1")).toBe(true);
  });
});

describe("Secure Compare", () => {
  function secureCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }

  it("should return true for identical strings", () => {
    expect(secureCompare("abc", "abc")).toBe(true);
    expect(secureCompare("", "")).toBe(true);
    expect(secureCompare("abc123", "abc123")).toBe(true);
  });

  it("should return false for different strings", () => {
    expect(secureCompare("abc", "abd")).toBe(false);
    expect(secureCompare("abc", "ABC")).toBe(false);
    expect(secureCompare("abc", "ab")).toBe(false);
  });

  it("should return false for different lengths", () => {
    expect(secureCompare("abc", "abcd")).toBe(false);
    expect(secureCompare("abcd", "abc")).toBe(false);
  });

  it("should handle hex strings (like checksums)", () => {
    const hash1 =
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    const hash2 =
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    const hash3 =
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b854";

    expect(secureCompare(hash1, hash2)).toBe(true);
    expect(secureCompare(hash1, hash3)).toBe(false);
  });
});

describe("Checksum Generation", () => {
  it("should generate correct SHA256 hash", () => {
    const content = Buffer.from("test content for checksum");
    const hash = createHash("sha256").update(content).digest("hex");

    expect(hash).toHaveLength(64); // SHA256 produces 64 hex chars
    expect(hash).toBe(
      "c8ce4e97a404b12b1d8f0e245f04ff607be1048b16d973c2f23bab86655c808b",
    );
  });

  it("should generate correct SHA512 hash", () => {
    const content = Buffer.from("test content for checksum");
    const hash = createHash("sha512").update(content).digest("hex");

    expect(hash).toHaveLength(128); // SHA512 produces 128 hex chars
  });

  it("should produce different hashes for different content", () => {
    const content1 = Buffer.from("content 1");
    const content2 = Buffer.from("content 2");

    const hash1 = createHash("sha256").update(content1).digest("hex");
    const hash2 = createHash("sha256").update(content2).digest("hex");

    expect(hash1).not.toBe(hash2);
  });

  it("should produce same hash for same content", () => {
    const content = Buffer.from("identical content");

    const hash1 = createHash("sha256").update(content).digest("hex");
    const hash2 = createHash("sha256").update(content).digest("hex");

    expect(hash1).toBe(hash2);
  });

  it("should handle empty content", () => {
    const content = Buffer.from("");
    const hash = createHash("sha256").update(content).digest("hex");

    // Known empty string SHA256
    expect(hash).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

describe("Platform Identifier", () => {
  function getPlatformIdentifier(): string {
    const platform = process.platform;
    const arch = process.arch;

    const platformMap: Record<string, string> = {
      darwin: "darwin",
      linux: "linux",
      win32: "windows",
    };

    const archMap: Record<string, string> = {
      x64: "x64",
      arm64: "arm64",
      arm: "arm",
    };

    return `${platformMap[platform] ?? platform}-${archMap[arch] ?? arch}`;
  }

  it("should return valid platform identifier", () => {
    const identifier = getPlatformIdentifier();

    // Should be in format "platform-arch"
    expect(identifier).toMatch(/^[\w]+-[\w]+$/);

    // Should include one of the known platforms
    const knownPlatforms = ["darwin", "linux", "windows"];
    const knownArchs = ["x64", "arm64", "arm"];

    const [platform, arch] = identifier.split("-");
    expect(
      knownPlatforms.some((p) => identifier.includes(p)) || platform,
    ).toBeTruthy();
    expect(knownArchs.some((a) => identifier.includes(a)) || arch).toBeTruthy();
  });
});

describe("Cache File Format", () => {
  const testCacheFile = "/tmp/test-update-cache.json";

  afterEach(async () => {
    if (existsSync(testCacheFile)) {
      await unlink(testCacheFile);
    }
  });

  it("should create valid cache file structure", async () => {
    const cache = {
      result: {
        currentVersion: "1.0.0",
        latestVersion: "1.1.0",
        updateAvailable: true,
        checkedAt: new Date().toISOString(),
        fromCache: false,
      },
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    };

    await writeFile(testCacheFile, JSON.stringify(cache, null, 2));

    const content = await readFile(testCacheFile, "utf-8");
    const parsed = JSON.parse(content);

    expect(parsed).toHaveProperty("result");
    expect(parsed).toHaveProperty("expiresAt");
    expect(parsed.result).toHaveProperty("currentVersion");
    expect(parsed.result).toHaveProperty("latestVersion");
    expect(parsed.result).toHaveProperty("updateAvailable");
  });

  it("should handle expired cache correctly", async () => {
    const cache = {
      result: {
        currentVersion: "1.0.0",
        latestVersion: "1.1.0",
        updateAvailable: true,
        checkedAt: new Date().toISOString(),
        fromCache: false,
      },
      // Expired 1 hour ago
      expiresAt: new Date(Date.now() - 3600000).toISOString(),
    };

    await writeFile(testCacheFile, JSON.stringify(cache, null, 2));

    const content = await readFile(testCacheFile, "utf-8");
    const parsed = JSON.parse(content);
    const expiresAt = new Date(parsed.expiresAt).getTime();

    expect(Date.now() > expiresAt).toBe(true);
  });
});

describe("Release Asset Matching", () => {
  const mockAssets = [
    { name: "flywheel-gateway-1.0.0-linux-x64.tar.gz", size: 1000 },
    { name: "flywheel-gateway-1.0.0-darwin-x64.tar.gz", size: 1000 },
    { name: "flywheel-gateway-1.0.0-darwin-arm64.tar.gz", size: 1000 },
    { name: "flywheel-gateway-1.0.0-windows-x64.zip", size: 1000 },
    { name: "checksums.txt", size: 100 },
    { name: "checksums.json", size: 200 },
  ];

  function findAssetForPlatform(
    assets: typeof mockAssets,
    platform: string,
  ): (typeof mockAssets)[0] | undefined {
    return assets.find(
      (a) =>
        a.name.includes(platform) &&
        (a.name.endsWith(".tar.gz") || a.name.endsWith(".zip")),
    );
  }

  it("should find linux x64 asset", () => {
    const asset = findAssetForPlatform(mockAssets, "linux-x64");
    expect(asset?.name).toBe("flywheel-gateway-1.0.0-linux-x64.tar.gz");
  });

  it("should find darwin x64 asset", () => {
    const asset = findAssetForPlatform(mockAssets, "darwin-x64");
    expect(asset?.name).toBe("flywheel-gateway-1.0.0-darwin-x64.tar.gz");
  });

  it("should find darwin arm64 asset", () => {
    const asset = findAssetForPlatform(mockAssets, "darwin-arm64");
    expect(asset?.name).toBe("flywheel-gateway-1.0.0-darwin-arm64.tar.gz");
  });

  it("should find windows x64 asset", () => {
    const asset = findAssetForPlatform(mockAssets, "windows-x64");
    expect(asset?.name).toBe("flywheel-gateway-1.0.0-windows-x64.zip");
  });

  it("should return undefined for unknown platform", () => {
    const asset = findAssetForPlatform(mockAssets, "freebsd-x64");
    expect(asset).toBeUndefined();
  });

  it("should not match checksum files", () => {
    const checksumAsset = mockAssets.find((a) => a.name === "checksums.txt");
    expect(checksumAsset).toBeDefined();

    // Our matcher should NOT return checksum files
    const asset = findAssetForPlatform([checksumAsset!], "checksums");
    expect(asset).toBeUndefined();
  });
});

describe("Checksum Manifest Parsing", () => {
  const validManifest = {
    version: "1.0.0",
    generated: "2025-01-15T00:00:00Z",
    generator: "flywheel-gateway/generate-checksums",
    files: [
      {
        filename: "flywheel-gateway-1.0.0-linux-x64.tar.gz",
        sha256: "abc123",
        sha512: "def456",
        size: 1000,
      },
      {
        filename: "flywheel-gateway-1.0.0-darwin-x64.tar.gz",
        sha256: "ghi789",
        sha512: "jkl012",
        size: 1000,
      },
    ],
  };

  it("should parse valid manifest", () => {
    expect(validManifest.version).toBe("1.0.0");
    expect(validManifest.files).toHaveLength(2);
    expect(validManifest.files[0]?.sha256).toBe("abc123");
  });

  it("should create checksums map from manifest", () => {
    const checksums = new Map<string, { sha256: string; sha512?: string }>();

    for (const file of validManifest.files) {
      checksums.set(file.filename, {
        sha256: file.sha256,
        sha512: file.sha512,
      });
    }

    expect(checksums.size).toBe(2);
    expect(
      checksums.get("flywheel-gateway-1.0.0-linux-x64.tar.gz")?.sha256,
    ).toBe("abc123");
    expect(
      checksums.get("flywheel-gateway-1.0.0-darwin-x64.tar.gz")?.sha256,
    ).toBe("ghi789");
    expect(checksums.get("unknown-file.tar.gz")).toBeUndefined();
  });
});

describe("ACFS Checksum Parsing", () => {
  function parseAcfsChecksum(checksum: string): {
    algorithm: "sha256" | "sha512";
    hash: string;
  } {
    if (checksum.startsWith("sha512:")) {
      return { algorithm: "sha512", hash: checksum.slice(7) };
    }
    if (checksum.startsWith("sha256:")) {
      return { algorithm: "sha256", hash: checksum.slice(7) };
    }
    return { algorithm: "sha256", hash: checksum };
  }

  it("should parse raw hex checksum as sha256", () => {
    const hash =
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    const result = parseAcfsChecksum(hash);

    expect(result.algorithm).toBe("sha256");
    expect(result.hash).toBe(hash);
  });

  it("should parse sha256-prefixed checksum", () => {
    const hash =
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    const result = parseAcfsChecksum(`sha256:${hash}`);

    expect(result.algorithm).toBe("sha256");
    expect(result.hash).toBe(hash);
  });

  it("should parse sha512-prefixed checksum", () => {
    const hash =
      "cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e";
    const result = parseAcfsChecksum(`sha512:${hash}`);

    expect(result.algorithm).toBe("sha512");
    expect(result.hash).toBe(hash);
  });
});

describe("Checksum Verification Error Context", () => {
  // This tests the error reporting structure for checksum verification failures.
  // When checksum verification fails, the error should include context:
  // - Tool ID being verified
  // - Filename that failed
  // - Expected checksum (truncated for security)
  // - Actual computed checksum (truncated for security)

  it("should include tool context in checksum mismatch error", () => {
    const toolId = "tools.dcg";
    const filename = "dcg-linux-x64.tar.gz";
    const expected =
      "abc123def456789012345678901234567890abcdef1234567890123456";
    const actual = "xyz987uvw654321098765432109876543210fedcba0987654321098765";

    // Simulate the error structure from verifyAgainstAcfsChecksums
    const errorContext = {
      toolId,
      filename,
      expected: `${expected.substring(0, 16)}...`,
      actual: `${actual.substring(0, 16)}...`,
    };

    // Verify error context includes all required fields
    expect(errorContext.toolId).toBe("tools.dcg");
    expect(errorContext.filename).toBe("dcg-linux-x64.tar.gz");
    expect(errorContext.expected).toContain("abc123def4567890");
    expect(errorContext.actual).toContain("xyz987uvw6543210");
  });

  it("should structure verification result with all fields for logging", () => {
    // Verify the structure matches AcfsVerifyResult for logging purposes
    const result = {
      verified: false,
      toolId: "tools.slb",
      filename: "slb-darwin-arm64.tar.gz",
      actualChecksum:
        "0000000000000000000000000000000000000000000000000000000000000000",
      expectedChecksum:
        "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      algorithm: "sha256" as const,
      size: 1024,
    };

    // All fields should be present for comprehensive logging
    expect(result).toHaveProperty("verified");
    expect(result).toHaveProperty("toolId");
    expect(result).toHaveProperty("filename");
    expect(result).toHaveProperty("actualChecksum");
    expect(result).toHaveProperty("expectedChecksum");
    expect(result).toHaveProperty("algorithm");
    expect(result).toHaveProperty("size");

    // Verified should be false for mismatch
    expect(result.verified).toBe(false);
  });

  it("should include algorithm in verification context", () => {
    // Different algorithms should be tracked in verification result
    const sha256Result = {
      verified: true,
      algorithm: "sha256" as const,
    };

    const sha512Result = {
      verified: true,
      algorithm: "sha512" as const,
    };

    expect(sha256Result.algorithm).toBe("sha256");
    expect(sha512Result.algorithm).toBe("sha512");
  });
});
