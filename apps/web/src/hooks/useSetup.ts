/**
 * Setup hooks for API integration with the setup wizard.
 *
 * Provides hooks for checking readiness status, installing tools,
 * and managing the setup flow.
 */

import { useCallback, useEffect, useState } from "react";

// ============================================================================
// Types
// ============================================================================

export type ToolCategory = "agent" | "tool";
export type InstallStatus =
  | "pending"
  | "downloading"
  | "installing"
  | "verifying"
  | "completed"
  | "failed";
export type InstallMode = "interactive" | "easy";

export interface DetectedCapabilities {
  streaming: boolean;
  toolUse: boolean;
  vision: boolean;
  codeExecution: boolean;
  fileAccess: boolean;
}

export interface DetectedCLI {
  name: string;
  available: boolean;
  path?: string;
  version?: string;
  authenticated?: boolean;
  authError?: string;
  capabilities: DetectedCapabilities;
  detectedAt: string;
  durationMs: number;
}

export interface ReadinessSummary {
  agentsAvailable: number;
  agentsTotal: number;
  toolsAvailable: number;
  toolsTotal: number;
  authIssues: string[];
  missingRequired: string[];
}

export interface ReadinessStatus {
  ready: boolean;
  agents: DetectedCLI[];
  tools: DetectedCLI[];
  summary: ReadinessSummary;
  recommendations: string[];
  detectedAt: string;
  durationMs: number;
}

export interface ToolInfo {
  name: string;
  displayName: string;
  description: string;
  category: ToolCategory;
  installCommand?: string;
  installUrl?: string;
  docsUrl?: string;
  status?: DetectedCLI;
}

export interface InstallProgress {
  tool: string;
  status: InstallStatus;
  progress: number;
  message: string;
  timestamp: string;
}

export interface InstallResult {
  tool: string;
  success: boolean;
  version?: string;
  path?: string;
  error?: string;
  durationMs: number;
}

// ============================================================================
// API Functions
// ============================================================================

const API_BASE = "/api";

async function fetchReadiness(bypassCache = false): Promise<ReadinessStatus> {
  const url = bypassCache
    ? `${API_BASE}/setup/readiness?bypass_cache=true`
    : `${API_BASE}/setup/readiness`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch readiness: ${res.statusText}`);
  }

  const json = await res.json();
  return json.data;
}

async function fetchTools(): Promise<ToolInfo[]> {
  const res = await fetch(`${API_BASE}/setup/tools`);
  if (!res.ok) {
    throw new Error(`Failed to fetch tools: ${res.statusText}`);
  }

  const json = await res.json();
  return json.data;
}

async function installToolApi(
  tool: string,
  mode: InstallMode = "easy",
  verify = true,
): Promise<InstallResult> {
  const res = await fetch(`${API_BASE}/setup/install`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool, mode, verify }),
  });

  const json = await res.json();

  if (!res.ok) {
    throw new Error(json.error?.message || `Failed to install ${tool}`);
  }

  return json.data;
}

async function verifyToolApi(tool: string): Promise<DetectedCLI> {
  const res = await fetch(`${API_BASE}/setup/verify/${tool}`, {
    method: "POST",
  });

  if (!res.ok) {
    throw new Error(`Failed to verify ${tool}`);
  }

  const json = await res.json();
  return json.data;
}

async function clearCacheApi(): Promise<void> {
  const res = await fetch(`${API_BASE}/setup/cache`, {
    method: "DELETE",
  });

  if (!res.ok) {
    throw new Error("Failed to clear cache");
  }
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook for fetching and managing readiness status.
 */
export function useReadiness() {
  const [status, setStatus] = useState<ReadinessStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (bypassCache = false) => {
    setLoading(true);
    setError(null);

    try {
      const data = await fetchReadiness(bypassCache);
      setStatus(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to fetch readiness",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    status,
    loading,
    error,
    refresh,
    isReady: status?.ready ?? false,
  };
}

/**
 * Hook for fetching available tools.
 */
export function useTools() {
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = await fetchTools();
      setTools(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch tools");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { tools, loading, error, refresh };
}

/**
 * Hook for installing a single tool.
 */
export function useInstallTool() {
  const [installing, setInstalling] = useState(false);
  const [result, setResult] = useState<InstallResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const install = useCallback(
    async (tool: string, mode: InstallMode = "easy", verify = true) => {
      setInstalling(true);
      setError(null);
      setResult(null);

      try {
        const data = await installToolApi(tool, mode, verify);
        setResult(data);
        return data;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Installation failed";
        setError(message);
        throw err;
      } finally {
        setInstalling(false);
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { install, installing, result, error, reset };
}

/**
 * Hook for batch installing multiple tools.
 */
export function useBatchInstall() {
  const [installing, setInstalling] = useState(false);
  const [progress, setProgress] = useState<{
    current: number;
    total: number;
    currentTool: string | null;
  }>({ current: 0, total: 0, currentTool: null });
  const [results, setResults] = useState<InstallResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const installAll = useCallback(
    async (tools: string[], mode: InstallMode = "easy", verify = true) => {
      setInstalling(true);
      setError(null);
      setResults([]);
      setProgress({ current: 0, total: tools.length, currentTool: null });

      const installResults: InstallResult[] = [];

      try {
        for (let i = 0; i < tools.length; i++) {
          const tool = tools[i]!;
          setProgress({ current: i, total: tools.length, currentTool: tool });

          try {
            const result = await installToolApi(tool, mode, verify);
            installResults.push(result);
          } catch (err) {
            installResults.push({
              tool,
              success: false,
              error: err instanceof Error ? err.message : "Unknown error",
              durationMs: 0,
            });
          }
        }

        setResults(installResults);
        setProgress({
          current: tools.length,
          total: tools.length,
          currentTool: null,
        });
        return installResults;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Batch install failed");
        throw err;
      } finally {
        setInstalling(false);
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setResults([]);
    setError(null);
    setProgress({ current: 0, total: 0, currentTool: null });
  }, []);

  return { installAll, installing, progress, results, error, reset };
}

/**
 * Hook for verifying a tool installation.
 */
export function useVerifyTool() {
  const [verifying, setVerifying] = useState(false);
  const [result, setResult] = useState<DetectedCLI | null>(null);
  const [error, setError] = useState<string | null>(null);

  const verify = useCallback(async (tool: string) => {
    setVerifying(true);
    setError(null);
    setResult(null);

    try {
      const data = await verifyToolApi(tool);
      setResult(data);
      return data;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Verification failed";
      setError(message);
      throw err;
    } finally {
      setVerifying(false);
    }
  }, []);

  return { verify, verifying, result, error };
}

/**
 * Hook for clearing detection cache.
 */
export function useClearCache() {
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clear = useCallback(async () => {
    setClearing(true);
    setError(null);

    try {
      await clearCacheApi();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear cache");
      throw err;
    } finally {
      setClearing(false);
    }
  }, []);

  return { clear, clearing, error };
}

// ============================================================================
// Display Helpers
// ============================================================================

export const TOOL_DISPLAY_INFO: Record<
  string,
  { displayName: string; icon: string; color: string }
> = {
  claude: {
    displayName: "Claude Code",
    icon: "C",
    color: "#CC785C",
  },
  codex: {
    displayName: "Codex CLI",
    icon: "O",
    color: "#74AA9C",
  },
  gemini: {
    displayName: "Gemini CLI",
    icon: "G",
    color: "#4285F4",
  },
  aider: {
    displayName: "Aider",
    icon: "A",
    color: "#14B8A6",
  },
  "gh-copilot": {
    displayName: "GitHub Copilot",
    icon: "GH",
    color: "#6e5494",
  },
  dcg: {
    displayName: "DCG",
    icon: "D",
    color: "#EF4444",
  },
  ubs: {
    displayName: "UBS",
    icon: "U",
    color: "#F59E0B",
  },
  cass: {
    displayName: "CASS",
    icon: "S",
    color: "#8B5CF6",
  },
  cm: {
    displayName: "CM",
    icon: "M",
    color: "#06B6D4",
  },
  bd: {
    displayName: "Beads",
    icon: "B",
    color: "#10B981",
  },
  bv: {
    displayName: "bv",
    icon: "V",
    color: "#84CC16",
  },
  ru: {
    displayName: "RU",
    icon: "R",
    color: "#EC4899",
  },
};

export function getToolDisplayInfo(name: string) {
  return (
    TOOL_DISPLAY_INFO[name] || {
      displayName: name.toUpperCase(),
      icon: name.charAt(0).toUpperCase(),
      color: "#6B7280",
    }
  );
}
