/**
 * k6 load test for Flywheel Gateway HTTP Rate Limiting.
 *
 * Verifies that:
 * 1. Concurrent bursts exhaust the per-window budget and receive HTTP 429
 * 2. 429 responses include deterministic X-RateLimit-* and Retry-After headers
 * 3. Exempt endpoints (/health) continue returning HTTP 200 under load
 * 4. Machine-readable JSON summary is emitted for CI artifacts
 *
 * Run with: k6 run tests/load/rate-limit.k6.js
 */

import { check, group } from "k6";
import http from "k6/http";
import { Counter, Rate } from "k6/metrics";

const rateLimitedResponses = new Counter("rate_limited_responses");
const allowedResponses = new Counter("allowed_responses");
const headerCompliance = new Rate("rate_limit_header_compliance");

export const options = {
  scenarios: {
    burst: {
      executor: "shared-iterations",
      vus: 20,
      iterations: 120,
      maxDuration: "30s",
    },
  },
  thresholds: {
    rate_limited_responses: ["count>0"],
    rate_limit_header_compliance: ["rate==1.0"],
  },
};

const BASE_URL = __ENV.TARGET_URL || "http://localhost:3000";

export default function () {
  group("Rate-Limited Mutating Endpoint Burst", () => {
    const res = http.post(
      `${BASE_URL}/secrets/redact`,
      JSON.stringify({ input: "safe text", shadowMode: false }),
      {
        headers: {
          "Content-Type": "application/json",
          "X-Real-IP": "198.51.100.42",
        },
      },
    );

    if (res.status === 429) {
      rateLimitedResponses.add(1);
      const ok = check(res, {
        "429 has Retry-After header": (r) =>
          r.headers["Retry-After"] !== undefined,
        "429 has X-RateLimit-Remaining=0": (r) =>
          r.headers["X-RateLimit-Remaining"] === "0",
        "429 has X-RateLimit-Limit": (r) =>
          r.headers["X-RateLimit-Limit"] !== undefined,
      });
      headerCompliance.add(ok ? 1 : 0);
    } else if (res.status === 200) {
      allowedResponses.add(1);
      const ok = check(res, {
        "200 has X-RateLimit-Limit": (r) =>
          r.headers["X-RateLimit-Limit"] !== undefined,
        "200 has X-RateLimit-Remaining": (r) =>
          r.headers["X-RateLimit-Remaining"] !== undefined,
      });
      headerCompliance.add(ok ? 1 : 0);
    }
  });

  group("Exempt Health Endpoint", () => {
    const healthRes = http.get(`${BASE_URL}/health`, {
      headers: { "X-Real-IP": "198.51.100.42" },
    });
    check(healthRes, {
      "health stays 200 even when client is rate-limited": (r) =>
        r.status === 200,
    });
  });
}

export function handleSummary(data) {
  const summary = {
    timestamp: new Date().toISOString(),
    targetUrl: BASE_URL,
    allowedCount: data.metrics.allowed_responses
      ? data.metrics.allowed_responses.values.count
      : 0,
    rateLimitedCount: data.metrics.rate_limited_responses
      ? data.metrics.rate_limited_responses.values.count
      : 0,
    headerComplianceRate: data.metrics.rate_limit_header_compliance
      ? data.metrics.rate_limit_header_compliance.values.rate
      : 0,
  };

  return {
    stdout: `${JSON.stringify(summary, null, 2)}\n`,
  };
}
