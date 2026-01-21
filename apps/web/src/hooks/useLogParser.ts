/**
 * useLogParser Hook
 *
 * Provides a React-friendly interface to the log parser web worker.
 * Falls back to main thread processing if workers are unavailable.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  LogFilter,
  ParsedLogLine,
  RawLogLine,
} from "../workers/logParser.worker";

export type { LogFilter, ParsedLogLine, RawLogLine };

interface UseLogParserOptions {
  /** Maximum logs to keep in memory */
  maxLogs?: number;
  /** Auto-parse incoming logs */
  autoParse?: boolean;
}

interface UseLogParserResult {
  /** Parsed log lines */
  logs: ParsedLogLine[];
  /** Whether currently parsing */
  parsing: boolean;
  /** Parse raw logs */
  parse: (rawLogs: RawLogLine[]) => Promise<ParsedLogLine[]>;
  /** Search logs */
  search: (query: string) => Promise<ParsedLogLine[]>;
  /** Filter logs */
  filter: (filter: LogFilter) => Promise<ParsedLogLine[]>;
  /** Clear all logs */
  clear: () => void;
  /** Whether worker is available */
  workerAvailable: boolean;
}

const DEFAULT_MAX_LOGS = 50000;

/**
 * Main thread fallback implementations
 */
function parseLogsSync(logs: RawLogLine[]): ParsedLogLine[] {
  // Simple fallback - just add required fields
  return logs.map((log) => ({
    ...log,
    segments: [{ text: log.content, style: {} }],
    searchableText: log.content.toLowerCase(),
    level: "unknown" as const,
    hasStackTrace: false,
    urls: [],
    filePaths: [],
  }));
}

function searchLogsSync(query: string, logs: ParsedLogLine[]): ParsedLogLine[] {
  const lowerQuery = query.toLowerCase();
  return logs.filter((log) => log.searchableText.includes(lowerQuery));
}

function filterLogsSync(
  filter: LogFilter,
  logs: ParsedLogLine[],
): ParsedLogLine[] {
  return logs.filter((log) => {
    if (filter.levels && !filter.levels.includes(log.level)) return false;
    if (filter.types && !filter.types.includes(log.type)) return false;
    if (
      filter.search &&
      !log.searchableText.includes(filter.search.toLowerCase())
    )
      return false;
    if (filter.startTime && log.timestamp < filter.startTime) return false;
    if (filter.endTime && log.timestamp > filter.endTime) return false;
    return true;
  });
}

export function useLogParser(
  options: UseLogParserOptions = {},
): UseLogParserResult {
  const { maxLogs = DEFAULT_MAX_LOGS, autoParse = true } = options;

  const workerRef = useRef<Worker | null>(null);
  const [logs, setLogs] = useState<ParsedLogLine[]>([]);
  const [parsing, setParsing] = useState(false);
  const [workerAvailable, setWorkerAvailable] = useState(false);

  // Pending promises for worker responses (store both resolve and reject)
  const pendingRef = useRef<
    Map<string, { resolve: (value: unknown) => void; reject: (err: Error) => void }>
  >(new Map());
  const requestIdRef = useRef(0);

  // Helper to reject all pending promises
  const rejectAllPending = useCallback((reason: string) => {
    const error = new Error(reason);
    for (const [key, { reject }] of pendingRef.current) {
      reject(error);
    }
    pendingRef.current.clear();
  }, []);

  // Initialize worker
  useEffect(() => {
    try {
      workerRef.current = new Worker(
        new URL("../workers/logParser.worker.ts", import.meta.url),
        { type: "module" },
      );

      workerRef.current.onmessage = (event) => {
        const { type, ...data } = event.data;
        const requestId = data.requestId;

        // Handle responses
        if (type === "parsed") {
          const pending = pendingRef.current.get(`parse-${requestId}`);
          if (pending) {
            pending.resolve(data.logs);
            pendingRef.current.delete(`parse-${requestId}`);
          }
        } else if (type === "searchResults") {
          const pending = pendingRef.current.get(`search-${requestId}`);
          if (pending) {
            pending.resolve(data.results);
            pendingRef.current.delete(`search-${requestId}`);
          }
        } else if (type === "filterResults") {
          const pending = pendingRef.current.get(`filter-${requestId}`);
          if (pending) {
            pending.resolve(data.filtered);
            pendingRef.current.delete(`filter-${requestId}`);
          }
        }
      };

      workerRef.current.onerror = (error) => {
        console.error("[useLogParser] Worker error:", error);
        rejectAllPending("Worker error occurred");
        setWorkerAvailable(false);
      };

      setWorkerAvailable(true);
    } catch (error) {
      console.warn(
        "[useLogParser] Worker initialization failed, using fallback:",
        error,
      );
      setWorkerAvailable(false);
    }

    return () => {
      rejectAllPending("Component unmounted");
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [rejectAllPending]);

  // Parse raw logs
  const parse = useCallback(
    async (rawLogs: RawLogLine[]): Promise<ParsedLogLine[]> => {
      if (rawLogs.length === 0) return [];

      setParsing(true);

      try {
        let parsed: ParsedLogLine[];

        if (workerRef.current && workerAvailable) {
          const requestId = ++requestIdRef.current;

          parsed = await new Promise<ParsedLogLine[]>((resolve, reject) => {
            pendingRef.current.set(`parse-${requestId}`, {
              resolve: resolve as (v: unknown) => void,
              reject,
            });
            workerRef.current?.postMessage({
              type: "parse",
              logs: rawLogs,
              requestId,
            });
          });
        } else {
          // Fallback to main thread
          parsed = parseLogsSync(rawLogs);
        }

        if (autoParse) {
          setLogs((prev) => {
            const combined = [...prev, ...parsed];
            // Trim to max size
            if (combined.length > maxLogs) {
              return combined.slice(-maxLogs);
            }
            return combined;
          });
        }

        return parsed;
      } finally {
        setParsing(false);
      }
    },
    [workerAvailable, autoParse, maxLogs],
  );

  // Search logs
  const search = useCallback(
    async (query: string): Promise<ParsedLogLine[]> => {
      if (!query.trim()) return logs;

      if (workerRef.current && workerAvailable) {
        const requestId = ++requestIdRef.current;

        return new Promise<ParsedLogLine[]>((resolve, reject) => {
          pendingRef.current.set(`search-${requestId}`, {
            resolve: resolve as (v: unknown) => void,
            reject,
          });
          workerRef.current?.postMessage({
            type: "search",
            query,
            logs,
            requestId,
          });
        });
      }

      // Fallback
      return searchLogsSync(query, logs);
    },
    [logs, workerAvailable],
  );

  // Filter logs
  const filter = useCallback(
    async (filterOptions: LogFilter): Promise<ParsedLogLine[]> => {
      if (workerRef.current && workerAvailable) {
        const requestId = ++requestIdRef.current;

        return new Promise<ParsedLogLine[]>((resolve, reject) => {
          pendingRef.current.set(`filter-${requestId}`, {
            resolve: resolve as (v: unknown) => void,
            reject,
          });
          workerRef.current?.postMessage({
            type: "filter",
            filter: filterOptions,
            logs,
            requestId,
          });
        });
      }

      // Fallback
      return filterLogsSync(filterOptions, logs);
    },
    [logs, workerAvailable],
  );

  // Clear all logs
  const clear = useCallback(() => {
    setLogs([]);
  }, []);

  return {
    logs,
    parsing,
    parse,
    search,
    filter,
    clear,
    workerAvailable,
  };
}

export default useLogParser;
