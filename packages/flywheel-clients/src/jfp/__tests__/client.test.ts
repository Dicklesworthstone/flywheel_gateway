import { describe, expect, test } from "bun:test";
import { JfpClientError, createJfpClient, type JfpPrompt } from "../index";

function createRunner(stdout: string, exitCode = 0) {
  const calls: { command: string; args: string[] }[] = [];
  return {
    calls,
    run: async (command: string, args: string[]) => {
      calls.push({ command, args });
      return {
        stdout,
        stderr: exitCode === 0 ? "" : "jfp error",
        exitCode,
      };
    },
  };
}

function createPrompt(overrides: Partial<JfpPrompt> = {}): JfpPrompt {
  return { ...fullPrompt(), ...overrides };
}

function fullPrompt(): JfpPrompt {
  return {
    id: "prompt-123",
    title: "Test Prompt",
    description: "A test prompt for unit testing",
    category: "testing",
    tags: ["test", "unit"],
    author: "Test Author",
    version: "1.0.0",
    featured: false,
    difficulty: "intermediate",
    estimatedTokens: 500,
    created: "2026-01-01T00:00:00Z",
    content: "This is the prompt content...",
  };
}

describe("JFP client", () => {
  describe("list command", () => {
    test("parses list output", async () => {
      const payload = {
        prompts: [
          createPrompt({ id: "p1", title: "First" }),
          createPrompt({ id: "p2", title: "Second" }),
        ],
      };
      const runner = createRunner(JSON.stringify(payload));
      const client = createJfpClient({ runner });

      const result = await client.list();

      expect(result.prompts).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.prompts[0]?.id).toBe("p1");
      expect(runner.calls[0]?.args).toContain("list");
      expect(runner.calls[0]?.args).toContain("--json");
    });

    test("applies limit option", async () => {
      const payload = {
        prompts: [
          createPrompt({ id: "p1" }),
          createPrompt({ id: "p2" }),
          createPrompt({ id: "p3" }),
        ],
      };
      const runner = createRunner(JSON.stringify(payload));
      const client = createJfpClient({ runner });

      const result = await client.list({ limit: 2 });

      expect(result.prompts).toHaveLength(2);
      expect(result.total).toBe(3);
    });
  });

  describe("get command", () => {
    test("fetches prompt by ID", async () => {
      const prompt = createPrompt({ id: "target-id", title: "Target Prompt" });
      const runner = createRunner(JSON.stringify(prompt));
      const client = createJfpClient({ runner });

      const result = await client.get("target-id");

      expect(result?.id).toBe("target-id");
      expect(result?.title).toBe("Target Prompt");
      expect(runner.calls[0]?.args).toContain("show");
      expect(runner.calls[0]?.args).toContain("target-id");
    });

    test("returns null when prompt not found", async () => {
      const runner = createRunner("", 1);
      (
        runner as {
          run: (
            cmd: string,
            args: string[],
          ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
        }
      ).run = async () => ({
        stdout: "",
        stderr: "not found",
        exitCode: 1,
      });
      const client = createJfpClient({ runner });

      const result = await client.get("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("listCategories command", () => {
    test("parses categories list", async () => {
      const categories = [
        { name: "coding", count: 50 },
        { name: "writing", count: 30 },
        { name: "analysis", count: 20 },
      ];
      const runner = createRunner(JSON.stringify(categories));
      const client = createJfpClient({ runner });

      const result = await client.listCategories();

      expect(result).toHaveLength(3);
      expect(result[0]?.name).toBe("coding");
      expect(result[0]?.count).toBe(50);
      expect(runner.calls[0]?.args).toContain("categories");
    });
  });

  describe("search command", () => {
    test("parses search results with results array", async () => {
      const payload = {
        results: [
          createPrompt({ id: "s1", title: "Search Result 1" }),
          createPrompt({ id: "s2", title: "Search Result 2" }),
        ],
      };
      const runner = createRunner(JSON.stringify(payload));
      const client = createJfpClient({ runner });

      const result = await client.search("test query");

      expect(result.prompts).toHaveLength(2);
      expect(result.query).toBe("test query");
      expect(runner.calls[0]?.args).toContain("search");
      expect(runner.calls[0]?.args).toContain("test query");
    });

    test("parses search results with prompts array", async () => {
      const payload = {
        prompts: [createPrompt({ id: "s1" })],
      };
      const runner = createRunner(JSON.stringify(payload));
      const client = createJfpClient({ runner });

      const result = await client.search("query");

      expect(result.prompts).toHaveLength(1);
    });

    test("parses search results as direct array", async () => {
      const payload = [createPrompt({ id: "s1" }), createPrompt({ id: "s2" })];
      const runner = createRunner(JSON.stringify(payload));
      const client = createJfpClient({ runner });

      const result = await client.search("query");

      expect(result.prompts).toHaveLength(2);
    });

    test("passes limit option", async () => {
      const runner = createRunner(JSON.stringify({ results: [] }));
      const client = createJfpClient({ runner });

      await client.search("query", { limit: 5 });

      expect(runner.calls[0]?.args).toContain("--limit");
      expect(runner.calls[0]?.args).toContain("5");
    });

    test("filters by category locally", async () => {
      const payload = {
        results: [
          createPrompt({ id: "s1", category: "coding" }),
          createPrompt({ id: "s2", category: "writing" }),
        ],
      };
      const runner = createRunner(JSON.stringify(payload));
      const client = createJfpClient({ runner });

      const result = await client.search("query", { category: "coding" });

      expect(result.prompts).toHaveLength(1);
      expect(result.prompts[0]?.category).toBe("coding");
    });
  });

  describe("suggest command", () => {
    test("parses suggestions with suggestions array", async () => {
      const payload = {
        suggestions: [
          createPrompt({ id: "sug1", title: "Suggested 1" }),
          createPrompt({ id: "sug2", title: "Suggested 2" }),
        ],
      };
      const runner = createRunner(JSON.stringify(payload));
      const client = createJfpClient({ runner });

      const result = await client.suggest("write a blog post");

      expect(result.suggestions).toHaveLength(2);
      expect(result.task).toBe("write a blog post");
      expect(runner.calls[0]?.args).toContain("suggest");
      expect(runner.calls[0]?.args).toContain("write a blog post");
    });

    test("parses suggestions with prompts array", async () => {
      const payload = {
        prompts: [createPrompt({ id: "sug1" })],
      };
      const runner = createRunner(JSON.stringify(payload));
      const client = createJfpClient({ runner });

      const result = await client.suggest("task");

      expect(result.suggestions).toHaveLength(1);
    });

    test("parses suggestions as direct array", async () => {
      const payload = [createPrompt({ id: "sug1" })];
      const runner = createRunner(JSON.stringify(payload));
      const client = createJfpClient({ runner });

      const result = await client.suggest("task");

      expect(result.suggestions).toHaveLength(1);
    });

    test("applies limit option", async () => {
      const payload = {
        suggestions: [
          createPrompt({ id: "sug1" }),
          createPrompt({ id: "sug2" }),
          createPrompt({ id: "sug3" }),
        ],
      };
      const runner = createRunner(JSON.stringify(payload));
      const client = createJfpClient({ runner });

      const result = await client.suggest("task", { limit: 2 });

      expect(result.suggestions).toHaveLength(2);
    });
  });

  describe("getRandom command", () => {
    test("fetches random prompt", async () => {
      const prompt = createPrompt({ id: "random-1", title: "Random Prompt" });
      const runner = createRunner(JSON.stringify(prompt));
      const client = createJfpClient({ runner });

      const result = await client.getRandom();

      expect(result?.id).toBe("random-1");
      expect(runner.calls[0]?.args).toContain("random");
    });

    test("returns null on error", async () => {
      const runner = createRunner("", 1);
      const client = createJfpClient({ runner });

      const result = await client.getRandom();

      expect(result).toBeNull();
    });
  });

  describe("status command", () => {
    test("returns status with version", async () => {
      const runner = {
        calls: [] as { command: string; args: string[] }[],
        run: async (_command: string, args: string[]) => {
          return { stdout: "jfp/1.2.3", stderr: "", exitCode: 0 };
        },
      };
      const client = createJfpClient({ runner });

      const result = await client.status();

      expect(result.available).toBe(true);
      expect(result.version).toBe("1.2.3");
    });

    test("returns available without version when extraction fails", async () => {
      // status() always returns available: true because getVersion()
      // catches all errors internally and returns null
      const runner = createRunner("", 1);
      const client = createJfpClient({ runner });

      const result = await client.status();

      // Available is always true in current implementation
      // Version is undefined since extraction failed
      expect(result.available).toBe(true);
      expect(result.version).toBeUndefined();
    });
  });

  describe("isAvailable", () => {
    test("returns true when version check succeeds", async () => {
      const runner = {
        calls: [] as { command: string; args: string[] }[],
        run: async () => ({ stdout: "jfp v1.0.0", stderr: "", exitCode: 0 }),
      };
      const client = createJfpClient({ runner });

      const available = await client.isAvailable();

      expect(available).toBe(true);
    });

    test("returns false when version check fails", async () => {
      const runner = createRunner("", 127);
      const client = createJfpClient({ runner });

      const available = await client.isAvailable();

      expect(available).toBe(false);
    });
  });

  describe("error handling", () => {
    test("throws JfpClientError on command failure", async () => {
      const runner = createRunner("", 1);
      const client = createJfpClient({ runner });

      let thrown: unknown;
      try {
        await client.list();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(JfpClientError);
      expect((thrown as JfpClientError).kind).toBe("command_failed");
    });

    test("throws parse_error on invalid JSON", async () => {
      const runner = createRunner("not valid json {{");
      const client = createJfpClient({ runner });

      let thrown: unknown;
      try {
        await client.list();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(JfpClientError);
      expect((thrown as JfpClientError).kind).toBe("parse_error");
    });

    test("throws validation_error on schema mismatch", async () => {
      // Missing required 'prompts' array
      const runner = createRunner(JSON.stringify({ total: 5 }));
      const client = createJfpClient({ runner });

      let thrown: unknown;
      try {
        await client.list();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(JfpClientError);
      expect((thrown as JfpClientError).kind).toBe("validation_error");
    });

    test("error includes diagnostic details", async () => {
      const runner = createRunner("", 42);
      const client = createJfpClient({ runner });

      let thrown: unknown;
      try {
        await client.list();
      } catch (error) {
        thrown = error;
      }

      const details = (thrown as JfpClientError).details;
      expect(details?.exitCode).toBe(42);
      expect(details?.args).toBeDefined();
    });
  });

  describe("prompt schema validation", () => {
    test("validates all required prompt fields", async () => {
      const prompt = createPrompt();
      const runner = createRunner(JSON.stringify(prompt));
      const client = createJfpClient({ runner });

      const result = await client.get("test");

      expect(result?.id).toBeDefined();
      expect(result?.title).toBeDefined();
      expect(result?.description).toBeDefined();
      expect(result?.category).toBeDefined();
      expect(result?.tags).toBeDefined();
      expect(result?.author).toBeDefined();
      expect(result?.version).toBeDefined();
      expect(result?.featured).toBeDefined();
      expect(result?.difficulty).toBeDefined();
      expect(result?.estimatedTokens).toBeDefined();
      expect(result?.created).toBeDefined();
      expect(result?.content).toBeDefined();
    });

    test("accepts prompts with optional fields", async () => {
      const prompt = {
        ...createPrompt(),
        twitter: "@testauthor",
        whenToUse: ["When testing", "When debugging"],
        tips: ["Tip 1", "Tip 2"],
      };
      const runner = createRunner(JSON.stringify(prompt));
      const client = createJfpClient({ runner });

      const result = await client.get("test");

      expect(result?.twitter).toBe("@testauthor");
      expect(result?.whenToUse).toHaveLength(2);
      expect(result?.tips).toHaveLength(2);
    });

    test("validates difficulty enum values", async () => {
      const difficulties: Array<JfpPrompt["difficulty"]> = [
        "beginner",
        "intermediate",
        "advanced",
      ];
      for (const difficulty of difficulties) {
        const prompt = createPrompt({
          difficulty,
        });
        const runner = createRunner(JSON.stringify(prompt));
        const client = createJfpClient({ runner });

        const result = await client.get("test");

        expect(result).not.toBeNull();
        expect(result!.difficulty).toBe(difficulty);
      }
    });
  });
});
