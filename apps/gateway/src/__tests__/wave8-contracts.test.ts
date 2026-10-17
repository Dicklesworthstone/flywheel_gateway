import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { costAnalytics } from "../routes/cost-analytics";
import { slb } from "../routes/slb";
import { utilities } from "../routes/utilities";

describe("Wave 8 API Contract Alignment Tests", () => {
  const app = new Hono();
  app.route("/utilities", utilities);
  app.route("/cost-analytics", costAnalytics);
  app.route("/slb", slb);

  test("GET /utilities/doctor returns both legacy and Utilities.tsx doctor fields", async () => {
    const res = await app.request("/utilities/doctor");
    expect(res.status).toBe(200);
    const body = await res.json();
    const data = body.data;

    expect(typeof data.healthy).toBe("boolean");
    expect(typeof data.allHealthy).toBe("boolean");
    expect(data.allHealthy).toBe(data.healthy);
    expect(typeof data.installedCount).toBe("number");
    expect(data.totalCount).toBe(7);
    expect(Array.isArray(data.utilities)).toBe(true);

    const first = data.utilities[0];
    expect(typeof first.name).toBe("string");
    expect(typeof first.displayName).toBe("string");
    expect(typeof first.description).toBe("string");
    expect(typeof first.installed).toBe("boolean");
    expect(typeof first.installCommand).toBe("string");
    expect(typeof first.status).toBe("string");
    expect(typeof first.message).toBe("string");
  });

  test("POST /utilities/toon/parse detects and parses TOON box-drawing output", async () => {
    const toonSample =
      "─── Agent Summary ───\n│ status: healthy │\n│ active_beads: 4 │";
    const res = await app.request("/utilities/toon/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: toonSample }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.detectedFormat).toBe("toon");
    expect(body.data.isToon).toBe(true);
    expect(body.data.data["Agent Summary"]).toEqual({
      status: "healthy",
      active_beads: "4",
    });
  });

  test("GET /utilities/jfp/prompts and /utilities/apr/status return structured envelopes", async () => {
    const jfpRes = await app.request("/utilities/jfp/prompts?q=test");
    expect(jfpRes.status).toBe(200);
    const jfpBody = await jfpRes.json();
    expect(typeof jfpBody.data.available).toBe("boolean");
    expect(Array.isArray(jfpBody.data.prompts)).toBe(true);

    const aprRes = await app.request("/utilities/apr/status");
    expect(aprRes.status).toBe(200);
    const aprBody = await aprRes.json();
    expect(typeof aprBody.data.available).toBe("boolean");
    expect(Array.isArray(aprBody.data.workflows)).toBe(true);
  });

  test("POST /slb/requests/:id/approve and /reject accept empty JSON bodies with default operator session", async () => {
    const approveRes = await app.request("/slb/requests/req-test-1/approve", {
      method: "POST",
    });
    // Should not fail with 400 VALIDATION_ERROR for missing sessionId/sessionKey
    expect(approveRes.status).not.toBe(400);

    const rejectRes = await app.request("/slb/requests/req-test-1/reject", {
      method: "POST",
    });
    expect(rejectRes.status).not.toBe(400);
  });
});
