/**
 * Deterministic Runtime Controls
 *
 * Provides injectable replacements for non-deterministic operations
 * (UUID/ULID generation, Math.random, crypto.randomUUID) so tests
 * can assert exact outputs without mocks.
 *
 * Two usage patterns:
 *
 * 1. **Global monkey-patch** (simple, for integration tests):
 *    ```ts
 *    import { installDeterministicIds, restoreDeterministicIds } from "@flywheel/test-utils";
 *
 *    beforeEach(() => installDeterministicIds("test"));
 *    afterEach(() => restoreDeterministicIds());
 *    // crypto.randomUUID() now returns "test-0001", "test-0002", ...
 *    ```
 *
 * 2. **Factory function** (for unit tests needing explicit control):
 *    ```ts
 *    import { createIdGenerator, createSeededRandom } from "@flywheel/test-utils";
 *
 *    const nextId = createIdGenerator("agent");
 *    nextId(); // "agent-0001"
 *    nextId(); // "agent-0002"
 *
 *    const rand = createSeededRandom(42);
 *    rand(); // always the same sequence
 *    ```
 */

// ---------------------------------------------------------------------------
// Deterministic ID generators
// ---------------------------------------------------------------------------

/**
 * Creates a sequential ID generator with a given prefix.
 * Each call returns `${prefix}-${counter}` with zero-padded counter.
 */
export function createIdGenerator(
  prefix: string,
  options?: { start?: number; pad?: number },
): () => string {
  let counter = options?.start ?? 1;
  const pad = options?.pad ?? 4;
  return () => {
    const id = `${prefix}-${String(counter).padStart(pad, "0")}`;
    counter++;
    return id;
  };
}

// ---------------------------------------------------------------------------
// Global monkey-patching for crypto.randomUUID
// ---------------------------------------------------------------------------

let originalRandomUUID: (() => `${string}-${string}-${string}-${string}-${string}`) | null =
  null;
let installedGenerator: (() => string) | null = null;

/**
 * Replace `crypto.randomUUID()` globally with a deterministic sequential
 * generator. Call `restoreDeterministicIds()` in afterEach/afterAll.
 */
export function installDeterministicIds(prefix = "id"): void {
  if (!originalRandomUUID) {
    originalRandomUUID = crypto.randomUUID.bind(crypto);
  }
  const gen = createIdGenerator(prefix);
  installedGenerator = gen;
  // biome-ignore lint: we intentionally replace a global
  (crypto as any).randomUUID = () => gen();
}

/**
 * Restore the original `crypto.randomUUID()`.
 */
export function restoreDeterministicIds(): void {
  if (originalRandomUUID) {
    // biome-ignore lint: restore global
    (crypto as any).randomUUID = originalRandomUUID;
    originalRandomUUID = null;
  }
  installedGenerator = null;
}

// ---------------------------------------------------------------------------
// Seeded pseudo-random number generator
// ---------------------------------------------------------------------------

/**
 * Creates a seeded PRNG (xoshiro128** algorithm) that produces
 * deterministic values in [0, 1) — same API as Math.random().
 *
 * The seed is hashed into 128 bits of state so any integer works.
 */
export function createSeededRandom(seed: number): () => number {
  // Simple seed expansion (splitmix32)
  let s = seed | 0;
  function splitmix32(): number {
    s |= 0;
    s = (s + 0x9e3779b9) | 0;
    let t = s ^ (s >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    t = t ^ (t >>> 15);
    return t >>> 0;
  }

  let a = splitmix32();
  let b = splitmix32();
  let c = splitmix32();
  let d = splitmix32();

  // xoshiro128**
  return () => {
    const result = Math.imul(rotl(Math.imul(b, 5), 7), 9);
    const t = b << 9;
    c ^= a;
    d ^= b;
    b ^= c;
    a ^= d;
    c ^= t;
    d = rotl(d, 11);
    return (result >>> 0) / 4294967296;
  };
}

function rotl(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k));
}

// ---------------------------------------------------------------------------
// Global Math.random replacement
// ---------------------------------------------------------------------------

let originalMathRandom: (() => number) | null = null;

/**
 * Replace `Math.random()` globally with a seeded PRNG.
 * Call `restoreSeededRandom()` in afterEach/afterAll.
 */
export function installSeededRandom(seed = 0): void {
  if (!originalMathRandom) {
    originalMathRandom = Math.random;
  }
  Math.random = createSeededRandom(seed);
}

/**
 * Restore the original `Math.random()`.
 */
export function restoreSeededRandom(): void {
  if (originalMathRandom) {
    Math.random = originalMathRandom;
    originalMathRandom = null;
  }
}
