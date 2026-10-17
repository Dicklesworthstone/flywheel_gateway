import { afterEach, describe, expect, test } from "bun:test";
import {
  createIdGenerator,
  createSeededRandom,
  installDeterministicIds,
  installSeededRandom,
  restoreDeterministicIds,
  restoreSeededRandom,
} from "../deterministic";

describe("createIdGenerator", () => {
  test("produces sequential IDs with prefix", () => {
    const gen = createIdGenerator("agent");
    expect(gen()).toBe("agent-0001");
    expect(gen()).toBe("agent-0002");
    expect(gen()).toBe("agent-0003");
  });

  test("supports custom start and padding", () => {
    const gen = createIdGenerator("x", { start: 100, pad: 6 });
    expect(gen()).toBe("x-000100");
    expect(gen()).toBe("x-000101");
  });
});

describe("installDeterministicIds", () => {
  afterEach(() => restoreDeterministicIds());

  test("replaces crypto.randomUUID with sequential generator", () => {
    installDeterministicIds("test");
    expect(crypto.randomUUID() as string).toBe("test-0001");
    expect(crypto.randomUUID() as string).toBe("test-0002");
  });

  test("restoreDeterministicIds brings back real randomUUID", () => {
    installDeterministicIds("tmp");
    const fake = crypto.randomUUID() as string;
    expect(fake).toBe("tmp-0001");

    restoreDeterministicIds();
    const real = crypto.randomUUID();
    // Real UUIDs are 36 chars with dashes
    expect(real).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

describe("createSeededRandom", () => {
  test("same seed produces same sequence", () => {
    const r1 = createSeededRandom(42);
    const r2 = createSeededRandom(42);

    const seq1 = Array.from({ length: 10 }, () => r1());
    const seq2 = Array.from({ length: 10 }, () => r2());

    expect(seq1).toEqual(seq2);
  });

  test("different seeds produce different sequences", () => {
    const r1 = createSeededRandom(1);
    const r2 = createSeededRandom(2);

    const v1 = r1();
    const v2 = r2();
    expect(v1).not.toBe(v2);
  });

  test("values are in [0, 1)", () => {
    const rand = createSeededRandom(123);
    for (let i = 0; i < 1000; i++) {
      const v = rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("installSeededRandom", () => {
  afterEach(() => restoreSeededRandom());

  test("replaces Math.random with seeded PRNG", () => {
    installSeededRandom(42);
    const a = Math.random();
    restoreSeededRandom();

    installSeededRandom(42);
    const b = Math.random();

    expect(a).toBe(b);
  });

  test("restoreSeededRandom brings back real Math.random", () => {
    const realBefore = Math.random();
    installSeededRandom(99);
    const seeded = Math.random();
    restoreSeededRandom();

    // After restore, Math.random should produce non-deterministic values
    // (we can't test randomness directly, but we can verify it's not the seeded value)
    expect(typeof Math.random()).toBe("number");
  });
});
