import { describe, expect, it } from "bun:test";

describe("logger", () => {
  it("does not recurse when process.versions.bun is absent", async () => {
    const script = `
      (async () => {
        const original = process.versions.bun;
        process.versions.bun = undefined;
        const mod = await import("./apps/gateway/src/services/logger.ts?test=nonbun");
        mod.logger.child({ test: "value" });
        process.versions.bun = original;
        console.log("ok");
      })().catch((error) => {
        console.error(error);
        process.exit(1);
      });
    `;

    const proc = Bun.spawn(["bun", "-e", script], {
      cwd: "/data/projects/flywheel_gateway",
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, NO_COLOR: "1" },
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr.trim()).toBe("");
    expect(stdout.trim()).toBe("ok");
  });
});
