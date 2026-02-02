/**
 * TextWidget - Markdown content display.
 *
 * Data shape expected:
 * {
 *   content: string, // Markdown content
 * }
 *
 * Supports basic markdown: headers, bold, italic, links, lists, code
 */

import type { Widget, WidgetData } from "@flywheel/shared";
import "./TextWidget.css";

interface TextData {
  content: string;
}

interface TextWidgetProps {
  widget: Widget;
  data: WidgetData;
}

export function TextWidget({ widget: _widget, data }: TextWidgetProps) {
  const textData = data.data as TextData | null;

  if (!textData?.content) {
    return <div className="text-widget text-widget--empty">No content</div>;
  }

  // Simple markdown rendering
  const html = renderMarkdown(textData.content);

  return (
    // biome-ignore lint/security/noDangerouslySetInnerHtml: content is HTML-escaped and link hrefs are protocol-sanitized in renderMarkdown()
    <div className="text-widget" dangerouslySetInnerHTML={{ __html: html }} />
  );
}

function renderMarkdown(markdown: string): string {
  let html = escapeHtml(markdown);

  // Headers
  html = html.replace(/^### (.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^## (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^# (.+)$/gm, "<h2>$1</h2>");

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(/___(.+?)___/g, "<strong><em>$1</em></strong>");
  html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");
  html = html.replace(/_(.+?)_/g, "<em>$1</em>");

  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Links
  html = html.replace(
    /\[([^\]]+)\]\(((?:[^()\n]+|\([^)\n]*\))*)\)/g,
    (_match: string, text: string, href: string): string => {
      const safeHref = sanitizeHref(href);
      if (!safeHref) {
        return text;
      }
      return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
  );

  // Unordered lists
  html = html.replace(/^[*-] (.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>\n?)+/g, "<ul>$&</ul>");

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li data-fw-ol="1">$1</li>');
  html = html.replace(/(<li data-fw-ol="1">.*<\/li>\n?)+/g, "<ol>$&</ol>");
  html = html.replace(/ data-fw-ol="1"/g, "");

  // Horizontal rule
  html = html.replace(/^---$/gm, "<hr />");

  // Paragraphs
  html = html.replace(/\n\n/g, "</p><p>");
  html = `<p>${html}</p>`;

  // Clean up empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, "");
  html = html.replace(/<p>(<h[234]>)/g, "$1");
  html = html.replace(/(<\/h[234]>)<\/p>/g, "$1");
  html = html.replace(/<p>(<ul>)/g, "$1");
  html = html.replace(/(<\/ul>)<\/p>/g, "$1");
  html = html.replace(/<p>(<ol>)/g, "$1");
  html = html.replace(/(<\/ol>)<\/p>/g, "$1");
  html = html.replace(/<p>(<hr \/>)<\/p>/g, "$1");

  // Line breaks within paragraphs
  html = html.replace(/\n/g, "<br />");

  return html;
}

function sanitizeHref(rawHref: string): string | null {
  const href = rawHref.trim();

  // Disallow obvious HTML injection / whitespace tricks.
  if (href === "" || /[\s<>"'`]/.test(href)) {
    return null;
  }

  // Allow relative links and anchors.
  if (
    href.startsWith("#") ||
    (href.startsWith("/") && !href.startsWith("//")) ||
    href.startsWith("./") ||
    href.startsWith("../") ||
    href.startsWith("?")
  ) {
    return href;
  }

  // Allowlist safe protocols only.
  const hrefLower = href.toLowerCase();
  if (
    hrefLower.startsWith("http://") ||
    hrefLower.startsWith("https://") ||
    hrefLower.startsWith("mailto:")
  ) {
    return href;
  }

  return null;
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
