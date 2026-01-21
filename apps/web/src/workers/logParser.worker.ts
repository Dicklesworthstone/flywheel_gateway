/**
 * Log Parser Web Worker
 *
 * Offloads heavy log parsing and processing to a background thread
 * to keep the main UI thread responsive.
 */

export interface RawLogLine {
  id: string;
  content: string;
  timestamp: number;
  type: "stdout" | "stderr" | "system" | "tool" | "thinking";
  metadata?: Record<string, unknown>;
}

export interface ParsedLogLine extends RawLogLine {
  /** Content with ANSI codes parsed to segments */
  segments: ParsedSegment[];
  /** Plain text for searching */
  searchableText: string;
  /** Detected log level */
  level: LogLevel;
  /** Whether line contains a stack trace */
  hasStackTrace: boolean;
  /** Extracted URLs */
  urls: string[];
  /** Extracted file paths */
  filePaths: string[];
}

export interface ParsedSegment {
  text: string;
  style: SegmentStyle;
}

export interface SegmentStyle {
  color?: string;
  backgroundColor?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
}

export type LogLevel =
  | "debug"
  | "info"
  | "warn"
  | "error"
  | "fatal"
  | "unknown";

export type WorkerMessage =
  | { type: "parse"; logs: RawLogLine[]; requestId: number }
  | { type: "search"; query: string; logs: ParsedLogLine[]; requestId: number }
  | { type: "filter"; filter: LogFilter; logs: ParsedLogLine[]; requestId: number };

export interface LogFilter {
  levels?: LogLevel[];
  types?: RawLogLine["type"][];
  search?: string;
  startTime?: number;
  endTime?: number;
}

// ANSI escape code regex (uses \u001b for ESC character to satisfy linter)
const ANSI_REGEX = /\u001b\[([0-9;]*)m/g;

// URL regex
const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;

// File path regex (Unix and Windows)
const FILE_PATH_REGEX =
  /(?:\/[\w.-]+)+(?::\d+)?|[A-Z]:\\(?:[\w.-]+\\)*[\w.-]+/g;

// Stack trace patterns
const STACK_TRACE_PATTERNS = [
  /at\s+[\w.]+\s+\(/,
  /^\s+at\s+/m,
  /Error:\s+/,
  /Traceback\s+\(most recent call last\)/,
  /^\s+File\s+"[^"]+",\s+line\s+\d+/m,
];

// Log level patterns
const LOG_LEVEL_PATTERNS: [RegExp, LogLevel][] = [
  [/\b(fatal|critical|panic)\b/i, "fatal"],
  [/\b(error|err|exception|fail)\b/i, "error"],
  [/\b(warn|warning)\b/i, "warn"],
  [/\b(info|information)\b/i, "info"],
  [/\b(debug|trace|verbose)\b/i, "debug"],
];

// ANSI color code to CSS color mapping
const ANSI_COLORS: Record<number, string> = {
  30: "#000000", // Black
  31: "#ef4444", // Red
  32: "#22c55e", // Green
  33: "#eab308", // Yellow
  34: "#3b82f6", // Blue
  35: "#a855f7", // Magenta
  36: "#06b6d4", // Cyan
  37: "#f3f4f6", // White
  90: "#6b7280", // Bright black (gray)
  91: "#fca5a5", // Bright red
  92: "#86efac", // Bright green
  93: "#fde047", // Bright yellow
  94: "#93c5fd", // Bright blue
  95: "#d8b4fe", // Bright magenta
  96: "#67e8f9", // Bright cyan
  97: "#ffffff", // Bright white
};

const ANSI_BG_COLORS: Record<number, string> = {
  40: "#000000",
  41: "#ef4444",
  42: "#22c55e",
  43: "#eab308",
  44: "#3b82f6",
  45: "#a855f7",
  46: "#06b6d4",
  47: "#f3f4f6",
};

/**
 * Parse ANSI escape codes into styled segments
 */
function parseAnsiCodes(text: string): ParsedSegment[] {
  const segments: ParsedSegment[] = [];
  let lastIndex = 0;
  let currentStyle: SegmentStyle = {};

  for (const match of text.matchAll(ANSI_REGEX)) {
    // Add text before this escape code
    if (match.index! > lastIndex) {
      const textBefore = text.slice(lastIndex, match.index);
      if (textBefore) {
        segments.push({ text: textBefore, style: { ...currentStyle } });
      }
    }

    // Parse escape code
    const codes = (match[1] ?? "0").split(";").map(Number);
    for (const code of codes) {
      if (code === 0) {
        currentStyle = {}; // Reset
      } else if (code === 1) {
        currentStyle.bold = true;
      } else if (code === 3) {
        currentStyle.italic = true;
      } else if (code === 4) {
        currentStyle.underline = true;
      } else if (code === 9) {
        currentStyle.strikethrough = true;
      } else if (ANSI_COLORS[code]) {
        currentStyle.color = ANSI_COLORS[code];
      } else if (ANSI_BG_COLORS[code]) {
        currentStyle.backgroundColor = ANSI_BG_COLORS[code];
      }
    }

    lastIndex = match.index! + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), style: { ...currentStyle } });
  }

  // If no segments, return the whole text
  if (segments.length === 0) {
    segments.push({ text, style: {} });
  }

  return segments;
}

/**
 * Strip ANSI codes and return plain text
 */
function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, "");
}

/**
 * Detect log level from content
 */
function detectLogLevel(content: string): LogLevel {
  const lower = content.toLowerCase();
  for (const [pattern, level] of LOG_LEVEL_PATTERNS) {
    if (pattern.test(lower)) {
      return level;
    }
  }
  return "unknown";
}

/**
 * Check if line contains stack trace
 */
function hasStackTrace(content: string): boolean {
  return STACK_TRACE_PATTERNS.some((pattern) => pattern.test(content));
}

/**
 * Extract URLs from content
 */
function extractUrls(content: string): string[] {
  const matches = content.match(URL_REGEX);
  return matches ? [...new Set(matches)] : [];
}

/**
 * Extract file paths from content
 */
function extractFilePaths(content: string): string[] {
  const matches = content.match(FILE_PATH_REGEX);
  return matches ? [...new Set(matches)] : [];
}

/**
 * Parse a single raw log line
 */
function parseLogLine(raw: RawLogLine): ParsedLogLine {
  const strippedContent = stripAnsi(raw.content);

  return {
    ...raw,
    segments: parseAnsiCodes(raw.content),
    searchableText: strippedContent.toLowerCase(),
    level: detectLogLevel(strippedContent),
    hasStackTrace: hasStackTrace(strippedContent),
    urls: extractUrls(strippedContent),
    filePaths: extractFilePaths(strippedContent),
  };
}

/**
 * Search logs by query
 */
function searchLogs(query: string, logs: ParsedLogLine[]): ParsedLogLine[] {
  const lowerQuery = query.toLowerCase();
  return logs.filter((log) => log.searchableText.includes(lowerQuery));
}

/**
 * Filter logs by criteria
 */
function filterLogs(filter: LogFilter, logs: ParsedLogLine[]): ParsedLogLine[] {
  return logs.filter((log) => {
    if (filter.levels && !filter.levels.includes(log.level)) {
      return false;
    }
    if (filter.types && !filter.types.includes(log.type)) {
      return false;
    }
    if (
      filter.search &&
      !log.searchableText.includes(filter.search.toLowerCase())
    ) {
      return false;
    }
    if (filter.startTime && log.timestamp < filter.startTime) {
      return false;
    }
    if (filter.endTime && log.timestamp > filter.endTime) {
      return false;
    }
    return true;
  });
}

// Worker message handler
self.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const { type, requestId } = event.data;

  switch (type) {
    case "parse": {
      const { logs } = event.data;
      const parsed = logs.map(parseLogLine);
      self.postMessage({ type: "parsed", logs: parsed, requestId });
      break;
    }
    case "search": {
      const { query, logs } = event.data;
      const results = searchLogs(query, logs);
      self.postMessage({ type: "searchResults", results, requestId });
      break;
    }
    case "filter": {
      const { filter, logs } = event.data;
      const filtered = filterLogs(filter, logs);
      self.postMessage({ type: "filterResults", filtered, requestId });
      break;
    }
  }
};
