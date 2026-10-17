/**
 * k6 load test for Flywheel Gateway WebSocket connections.
 *
 * Run with: k6 run tests/load/websocket.k6.js
 * Or with environment: k6 run -e TARGET_HOST=localhost:3000 tests/load/websocket.k6.js
 */

import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import ws from "k6/ws";

// Custom metrics
const wsErrors = new Rate("ws_errors");
const messageLatency = new Trend("ws_message_latency");
const connectionTime = new Trend("ws_connection_time");
const messagesReceived = new Counter("ws_messages_received");
const messagesSent = new Counter("ws_messages_sent");

export const options = {
  scenarios: {
    // Concurrent connections test
    connections: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 50 }, // Ramp up to 50 connections
        { duration: "2m", target: 50 }, // Hold 50 connections
        { duration: "30s", target: 100 }, // Ramp to 100 connections
        { duration: "2m", target: 100 }, // Hold 100 connections
        { duration: "30s", target: 200 }, // Ramp to 200 connections
        { duration: "2m", target: 200 }, // Hold 200 connections
        { duration: "30s", target: 500 }, // Spike to 500 connections
        { duration: "1m", target: 500 }, // Hold 500 connections
        { duration: "30s", target: 0 }, // Ramp down
      ],
    },
  },
  thresholds: {
    ws_errors: ["rate<0.01"], // Less than 1% error rate
    ws_message_latency: ["p(95)<200"], // 95th percentile under 200ms
    ws_connection_time: ["p(95)<1000"], // Connection under 1s
  },
};

const TARGET_HOST = __ENV.TARGET_HOST || "localhost:3000";
const WS_PROTOCOL = __ENV.WS_PROTOCOL || "ws";

export default function () {
  const url = `${WS_PROTOCOL}://${TARGET_HOST}/ws`;
  const sessionId = `test-session-${__VU}-${__ITER}`;

  const connectStart = Date.now();

  const res = ws.connect(url, {}, (socket) => {
    connectionTime.add(Date.now() - connectStart);

    socket.on("open", () => {
      // Subscribe to a test session
      const subscribeMsg = JSON.stringify({
        type: "subscribe",
        sessionId: sessionId,
      });
      socket.send(subscribeMsg);
      messagesSent.add(1);
    });

    socket.on("message", (data) => {
      messagesReceived.add(1);

      try {
        const msg = JSON.parse(data);

        // Calculate latency if message has timestamp
        if (msg.timestamp) {
          const latency = Date.now() - new Date(msg.timestamp).getTime();
          messageLatency.add(latency);
        }

        // Handle ping/pong for keepalive
        if (msg.type === "ping") {
          socket.send(JSON.stringify({ type: "pong" }));
          messagesSent.add(1);
        }
      } catch (_e) {
        // Message might not be JSON
      }
    });

    socket.on("error", (e) => {
      wsErrors.add(1);
      console.error(`WebSocket error: ${e.message || e}`);
    });

    socket.on("close", () => {
      // Connection closed
    });

    // Keep connection alive for a period
    socket.setTimeout(() => {
      // Send periodic heartbeat
      socket.send(JSON.stringify({ type: "ping" }));
      messagesSent.add(1);
    }, 5000);

    // Hold connection for test duration
    socket.setTimeout(() => {
      socket.close();
    }, 30000);
  });

  check(res, {
    "WebSocket connected successfully": (r) => r && r.status === 101,
  });

  if (!res || res.status !== 101) {
    wsErrors.add(1);
  }

  // Small sleep before next iteration
  sleep(1);
}

export function setup() {
  console.log(
    `Starting WebSocket load test against ${WS_PROTOCOL}://${TARGET_HOST}`,
  );
  return { startTime: Date.now() };
}

export function teardown(data) {
  const duration = (Date.now() - data.startTime) / 1000;
  console.log(`WebSocket load test completed in ${duration.toFixed(2)}s`);
}
