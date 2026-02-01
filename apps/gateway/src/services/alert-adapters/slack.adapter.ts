/**
 * Slack Webhook Adapter
 *
 * Sends alert notifications to Slack via incoming webhooks.
 * Supports Block Kit formatting for rich messages.
 *
 * @see https://api.slack.com/messaging/webhooks
 * @see https://api.slack.com/block-kit
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

/** Slack header block max text length */
const SLACK_HEADER_MAX_LENGTH = 150;

/** Slack section text max length */
const SLACK_SECTION_TEXT_MAX_LENGTH = 3000;

/** Default fetch timeout (10 seconds) */
const WEBHOOK_TIMEOUT_MS = 10_000;

export interface SlackConfig extends ChannelConfig {
  webhookUrl: string;
  channel?: string;
  username?: string;
  iconEmoji?: string;
  iconUrl?: string;
}

/**
 * Escape special characters for Slack mrkdwn format.
 * @see https://api.slack.com/reference/surfaces/formatting#escaping
 */
function escapeSlackMrkdwn(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Escape a URL for use in Slack mrkdwn link format.
 */
function escapeSlackUrl(url: string): string {
  return escapeSlackMrkdwn(url).replace(/\|/g, "%7C");
}

/**
 * Truncate text to max length with ellipsis.
 */
function truncateText(text: string, maxLength: number): string {
  if (maxLength <= 0) return "";
  const chars = Array.from(text);
  if (chars.length <= maxLength) return text;
  return `${chars.slice(0, Math.max(0, maxLength - 1)).join("")}…`;
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
 * Build Slack message payload with Block Kit formatting.
 */
function buildSlackPayload(
  alert: AlertPayload,
  config: SlackConfig,
): {
  text: string;
  channel?: string;
  username?: string;
  icon_emoji?: string;
  icon_url?: string;
  blocks: Array<Record<string, unknown>>;
} {
  const severityEmoji: Record<string, string> = {
    critical: ":rotating_light:",
    error: ":x:",
    warning: ":warning:",
    info: ":information_source:",
    low: ":grey_question:",
  };

  const emoji = severityEmoji[alert.severity] ?? ":bell:";
  const headerText = truncateText(
    `${emoji} ${alert.title}`,
    SLACK_HEADER_MAX_LENGTH,
  );
  const fallbackText = `${emoji} ${alert.title}: ${alert.body}`;

  // Escape user-provided text for Slack mrkdwn
  const escapedBody = escapeSlackMrkdwn(alert.body);
  const bodyText = truncateText(escapedBody, SLACK_SECTION_TEXT_MAX_LENGTH);

  const sourceLabel = alert.source
    ? escapeSlackMrkdwn(
        alert.source.name ?? alert.source.id ?? alert.source.type,
      )
    : "unknown";
  const escapedCategory = escapeSlackMrkdwn(alert.category ?? "general");
  const escapedSeverity = escapeSlackMrkdwn(alert.severity);

  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: headerText,
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: bodyText,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `*Category:* ${escapedCategory} | *Severity:* ${escapedSeverity} | *Source:* ${sourceLabel}`,
        },
      ],
    },
  ];

  // Add link if present
  if (alert.link) {
    const escapedLink = escapeSlackUrl(alert.link);
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `<${escapedLink}|View details →>`,
      },
    });
  }

  // Add divider at the end
  blocks.push({ type: "divider" });

  const payload: ReturnType<typeof buildSlackPayload> = {
    text: fallbackText,
    blocks,
  };

  // Add optional channel/username/icon overrides
  if (config.channel) {
    payload.channel = config.channel;
  }
  if (config.username) {
    payload.username = config.username;
  }
  if (config.iconEmoji) {
    payload.icon_emoji = config.iconEmoji;
  }
  if (config.iconUrl) {
    payload.icon_url = config.iconUrl;
  }

  return payload;
}

/**
 * Slack webhook adapter.
 */
export const slackAdapter: ChannelAdapter<SlackConfig> = {
  type: "slack",

  async send(
    alert: AlertPayload,
    config: SlackConfig,
  ): Promise<DeliveryResult> {
    const log = getLogger();
    const startTime = Date.now();

    if (!config.webhookUrl) {
      return {
        success: false,
        error: "Slack webhook URL not configured",
        errorCode: "MISSING_CONFIG",
        durationMs: Date.now() - startTime,
      };
    }

    // SECURITY: Prevent SSRF
    if (isPrivateNetworkUrl(config.webhookUrl)) {
      log.warn(
        { alertId: alert.id },
        "[SLACK] Webhook blocked: URL points to private/internal network",
      );
      return {
        success: false,
        error: "Webhook URL points to private network",
        errorCode: "SSRF_BLOCKED",
        durationMs: Date.now() - startTime,
      };
    }

    const maskedUrl = maskUrlForLogging(config.webhookUrl);

    try {
      const payload = buildSlackPayload(alert, config);

      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        WEBHOOK_TIMEOUT_MS,
      );

      try {
        const response = await fetch(config.webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
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
              error: errorText,
            },
            "[SLACK] Webhook request failed",
          );
          return {
            success: false,
            error: errorText,
            errorCode: `HTTP_${response.status}`,
            responseStatus: response.status,
            durationMs,
          };
        }

        log.info(
          { alertId: alert.id, title: alert.title, durationMs },
          "[SLACK] Alert sent successfully",
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
        "[SLACK] Webhook request error",
      );

      return {
        success: false,
        error: isTimeout ? "Request timed out" : String(error),
        errorCode: isTimeout ? "TIMEOUT" : "REQUEST_ERROR",
        durationMs,
      };
    }
  },

  validateConfig(config: unknown): config is SlackConfig {
    if (typeof config !== "object" || config === null) return false;
    const c = config as Record<string, unknown>;

    if (typeof c["webhookUrl"] !== "string" || !c["webhookUrl"]) return false;

    // Validate URL format
    try {
      const url = new URL(c["webhookUrl"]);
      // Slack webhooks should be on slack.com or hooks.slack.com
      if (!url.hostname.endsWith("slack.com")) {
        return false;
      }
    } catch {
      return false;
    }

    if (c["channel"] !== undefined && typeof c["channel"] !== "string")
      return false;
    if (c["username"] !== undefined && typeof c["username"] !== "string")
      return false;
    if (c["iconEmoji"] !== undefined && typeof c["iconEmoji"] !== "string")
      return false;
    if (c["iconUrl"] !== undefined && typeof c["iconUrl"] !== "string")
      return false;

    return true;
  },

  async testConnection(config: SlackConfig): Promise<DeliveryResult> {
    return this.send(
      {
        id: `test_${Date.now()}`,
        type: "test",
        title: "Test Alert",
        body: "This is a test alert from Flywheel Gateway to verify your Slack webhook configuration.",
        severity: "info",
        category: "system",
        timestamp: new Date().toISOString(),
      },
      config,
    );
  },
};
