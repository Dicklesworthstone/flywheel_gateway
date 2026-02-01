/**
 * Generic Webhook Adapter
 *
 * Sends alert notifications to any HTTP endpoint via configurable webhooks.
 * Supports HMAC signature verification and custom payload templates.
 *
 * @see bd-3c0o3 Real-time Alert Channels bead
 */

import { getLogger } from "../../middleware/correlation";
import { isPrivateNetworkUrl } from "../../utils/url-security";
import type {
  AlertPayload,
  ChannelAdapter,
  ChannelConfig,
  DeliveryResult,
} from "./types";

/** Default fetch timeout (10 seconds) */
const WEBHOOK_TIMEOUT_MS = 10_000;

export interface WebhookConfig extends ChannelConfig {
  url: string;
  method?: "POST" | "PUT";
  /** Custom headers (for auth tokens, etc.) */
  headers?: Record<string, string>;
  /** HMAC secret for signature verification */
  secret?: string;
  /** Custom payload template (JSON string with {{variable}} placeholders) */
  payloadTemplate?: string;
}

/**
 * Compute HMAC-SHA256 signature for webhook payload.
 */
async function computeHmacSignature(
  payload: string,
  secret: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(payload),
  );
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Mask a URL for safe logging.
 */
function maskUrlForLogging(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}/***`;
  } catch {
    return "***invalid-url***";
  }
}

/**
 * Build the webhook payload from an alert.
 */
function buildPayload(alert: AlertPayload, config: WebhookConfig): string {
  // If custom template provided, use it with variable substitution
  if (config.payloadTemplate) {
    let payload = config.payloadTemplate;
    payload = payload.replace(/\{\{id\}\}/g, alert.id);
    payload = payload.replace(/\{\{type\}\}/g, alert.type);
    payload = payload.replace(/\{\{title\}\}/g, alert.title);
    payload = payload.replace(/\{\{body\}\}/g, alert.body);
    payload = payload.replace(/\{\{severity\}\}/g, alert.severity);
    payload = payload.replace(/\{\{category\}\}/g, alert.category ?? "");
    payload = payload.replace(
      /\{\{timestamp\}\}/g,
      alert.timestamp ?? new Date().toISOString(),
    );
    payload = payload.replace(
      /\{\{correlationId\}\}/g,
      alert.correlationId ?? "",
    );
    return payload;
  }

  // Default payload structure
  return JSON.stringify({
    id: alert.id,
    type: alert.type,
    title: alert.title,
    body: alert.body,
    severity: alert.severity,
    category: alert.category,
    source: alert.source,
    link: alert.link,
    metadata: alert.metadata,
    timestamp: alert.timestamp ?? new Date().toISOString(),
    correlationId: alert.correlationId,
  });
}

/**
 * Generic webhook adapter.
 */
export const webhookAdapter: ChannelAdapter<WebhookConfig> = {
  type: "webhook",

  async send(
    alert: AlertPayload,
    config: WebhookConfig,
  ): Promise<DeliveryResult> {
    const log = getLogger();
    const startTime = Date.now();

    if (!config.url) {
      return {
        success: false,
        error: "Webhook URL not configured",
        errorCode: "MISSING_CONFIG",
        durationMs: Date.now() - startTime,
      };
    }

    // SECURITY: Prevent SSRF
    if (isPrivateNetworkUrl(config.url)) {
      log.warn(
        { alertId: alert.id },
        "[WEBHOOK] Request blocked: URL points to private/internal network",
      );
      return {
        success: false,
        error: "Webhook URL points to private network",
        errorCode: "SSRF_BLOCKED",
        durationMs: Date.now() - startTime,
      };
    }

    const maskedUrl = maskUrlForLogging(config.url);

    try {
      const payloadJson = buildPayload(alert, config);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-Flywheel-Alert-Id": alert.id,
        "X-Flywheel-Event": "alert.fired",
        ...(config.headers ?? {}),
      };

      // Add HMAC signature if secret is configured
      if (config.secret) {
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const signaturePayload = `${timestamp}.${payloadJson}`;
        const signature = await computeHmacSignature(
          signaturePayload,
          config.secret,
        );
        headers["X-Flywheel-Timestamp"] = timestamp;
        headers["X-Flywheel-Signature"] = `sha256=${signature}`;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        WEBHOOK_TIMEOUT_MS,
      );

      try {
        const response = await fetch(config.url, {
          method: config.method ?? "POST",
          headers,
          body: payloadJson,
          signal: controller.signal,
        });

        const durationMs = Date.now() - startTime;

        if (!response.ok) {
          const errorText = await response.text();
          log.error(
            {
              alertId: alert.id,
              url: maskedUrl,
              status: response.status,
              error: errorText.slice(0, 200),
            },
            "[WEBHOOK] Request failed",
          );
          return {
            success: false,
            error: errorText.slice(0, 500),
            errorCode: `HTTP_${response.status}`,
            responseStatus: response.status,
            durationMs,
          };
        }

        log.info(
          { alertId: alert.id, url: maskedUrl, durationMs },
          "[WEBHOOK] Alert sent successfully",
        );

        return {
          success: true,
          responseStatus: response.status,
          durationMs,
        };
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const isTimeout = error instanceof Error && error.name === "AbortError";

      log.error(
        {
          alertId: alert.id,
          url: maskedUrl,
          error: isTimeout ? "Request timed out" : String(error),
        },
        "[WEBHOOK] Request error",
      );

      return {
        success: false,
        error: isTimeout ? "Request timed out" : String(error),
        errorCode: isTimeout ? "TIMEOUT" : "REQUEST_ERROR",
        durationMs,
      };
    }
  },

  validateConfig(config: unknown): config is WebhookConfig {
    if (typeof config !== "object" || config === null) return false;
    const c = config as Record<string, unknown>;

    if (typeof c["url"] !== "string" || !c["url"]) return false;

    // Validate URL format
    try {
      new URL(c["url"]);
    } catch {
      return false;
    }

    if (
      c["method"] !== undefined &&
      c["method"] !== "POST" &&
      c["method"] !== "PUT"
    )
      return false;
    if (c["headers"] !== undefined && typeof c["headers"] !== "object")
      return false;
    if (c["secret"] !== undefined && typeof c["secret"] !== "string")
      return false;
    if (
      c["payloadTemplate"] !== undefined &&
      typeof c["payloadTemplate"] !== "string"
    )
      return false;

    return true;
  },

  async testConnection(config: WebhookConfig): Promise<DeliveryResult> {
    return this.send(
      {
        id: `test_${Date.now()}`,
        type: "test",
        title: "Test Alert",
        body: "This is a test alert from Flywheel Gateway to verify your webhook configuration.",
        severity: "info",
        category: "system",
        timestamp: new Date().toISOString(),
      },
      config,
    );
  },
};
