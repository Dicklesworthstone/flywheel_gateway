/**
 * Setup hooks for API integration with the setup wizard.
 *
 * Provides hooks for checking readiness status, installing tools,
 * and managing the setup flow.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

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

export interface RobotModeInfo {
  /** Whether robot/machine-readable mode is supported */
  supported: boolean;
  /** Primary flag to enable robot output (e.g., "--json", "--robot") */
  flag?: string;
  /** Output formats this mode can produce */
  outputFormats?: string[];
  /** Whether output conforms to the standard JSON envelope */
  envelopeCompliant?: boolean;
}

export interface McpInfo {
  /** Whether the tool exposes an MCP server */
  available: boolean;
  /** Capability level (tools, resources, or full) */
  capabilities?: string;
  /** Estimated count of available MCP tools */
  toolCount?: number;
}

export interface DetectedCapabilities {
  streaming: boolean;
  toolUse: boolean;
  vision: boolean;
  codeExecution: boolean;
  fileAccess: boolean;
  /** Robot/machine-readable output mode info */
  robotMode?: RobotModeInfo;
  /** MCP server info */
  mcp?: McpInfo;
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

export interface ToolCategories {
  required: string[];
  recommended: string[];
  optional: string[];
}

export interface PhaseOrderEntry {
  phase: number;
  tools: string[];
}

export interface ReadinessStatus {
  ready: boolean;
  agents: DetectedCLI[];
  tools: DetectedCLI[];
  manifest?: {
    schemaVersion: string;
    source?: string;
    generatedAt?: string;
  };
  summary: ReadinessSummary;
  /** Tool categorization: required, recommended, optional */
  toolCategories?: ToolCategories;
  /** Install order by phase (lower phase = install first) */
  installOrder?: PhaseOrderEntry[];
  recommendations: string[];
  detectedAt: string;
  durationMs: number;
}

export interface ToolInfo {
  name: string;
  displayName: string;
  description: string;
  category: ToolCategory;
  tags?: string[];
  optional?: boolean;
  enabledByDefault?: boolean;
  phase?: number;
  manifestVersion?: string;
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
  br: {
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

export type ToolPriority = "required" | "recommended" | "optional";

/**
 * Get the priority of a tool based on the tool categories.
 */
export function getToolPriority(
  toolName: string,
  categories?: ToolCategories,
): ToolPriority {
  if (!categories) return "optional";
  if (categories.required.includes(toolName)) return "required";
  if (categories.recommended.includes(toolName)) return "recommended";
  return "optional";
}

/**
 * Get the phase for a tool based on install order.
 */
export function getToolPhase(
  toolName: string,
  installOrder?: PhaseOrderEntry[],
): number | undefined {
  if (!installOrder) return undefined;
  for (const entry of installOrder) {
    if (entry.tools.includes(toolName)) return entry.phase;
  }
  return undefined;
}

// ============================================================================
// Tool Registry Types
// ============================================================================

export interface RobotModeSpec {
  flag: string;
  altFlags?: string[];
  outputFormats: string[];
  subcommands?: string[];
  envelopeCompliant: boolean;
  notes?: string;
}

export interface McpSpec {
  available: boolean;
  capabilities?: string;
  toolCount?: number;
  notes?: string;
}

export interface ToolRegistryDefinition {
  id: string;
  name: string;
  displayName?: string;
  description?: string;
  category: "agent" | "tool";
  tags?: string[];
  optional?: boolean;
  enabledByDefault?: boolean;
  phase?: number;
  docsUrl?: string;
  installCommand?: string;
  verify?: {
    command: string[];
    expectedExitCodes?: number[];
  };
  installedCheck?: {
    command: string[];
    run_as?: string;
    timeoutMs?: number;
  };
  robotMode?: RobotModeSpec;
  mcp?: McpSpec;
}

export interface ToolRegistryResponse {
  schemaVersion: string;
  source: string | null;
  generatedAt: string | null;
  tools: ToolRegistryDefinition[];
  metadata: {
    manifestPath: string | null;
    manifestHash: string | null;
    registrySource: string | null;
    loadedAt: number | null;
    errorCategory: string | null;
    userMessage: string | null;
  };
}

// ============================================================================
// Tool Registry Hook
// ============================================================================

async function fetchToolRegistry(
  bypassCache = false,
): Promise<ToolRegistryResponse> {
  const url = bypassCache
    ? `${API_BASE}/setup/registry?bypass_cache=true`
    : `${API_BASE}/setup/registry`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch registry: ${res.statusText}`);
  }

  const json = await res.json();
  return json.data;
}

/**
 * Hook for fetching the tool registry.
 *
 * Provides access to the full ACFS manifest data including:
 * - Tool definitions with display info
 * - Robot mode and MCP capabilities
 * - Install commands and documentation URLs
 */
export function useToolRegistry() {
  const [registry, setRegistry] = useState<ToolRegistryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (bypassCache = false) => {
    setLoading(true);
    setError(null);

    try {
      const data = await fetchToolRegistry(bypassCache);
      setRegistry(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to fetch tool registry",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Build a lookup map for quick access
  const toolMap = useMemo(() => {
    if (!registry?.tools) return new Map<string, ToolRegistryDefinition>();
    return new Map(registry.tools.map((tool) => [tool.name, tool]));
  }, [registry?.tools]);

  return {
    registry,
    tools: registry?.tools ?? [],
    toolMap,
    loading,
    error,
    refresh,
    /** Check if using fallback registry */
    isFallback: registry?.metadata?.registrySource === "fallback",
  };
}

/**
 * Get tool display info from registry definition.
 */
export function getToolDisplayInfoFromRegistry(
  tool: ToolRegistryDefinition,
): { displayName: string; icon: string; color: string } {
  // Default colors by category
  const categoryColors: Record<string, string> = {
    agent: "#CC785C", // Warm brown
    tool: "#6B7280", // Gray
  };

  // Priority colors for known tools
  const priorityColors: Record<string, string> = {
    // Safety tools - red/amber
    dcg: "#EF4444",
    slb: "#DC2626",
    ubs: "#F59E0B",
    // Session tools - purple/cyan
    cass: "#8B5CF6",
    cm: "#06B6D4",
    // Issue tracking - green
    br: "#10B981",
    bv: "#84CC16",
    // Agents
    claude: "#CC785C",
    codex: "#74AA9C",
    gemini: "#4285F4",
    aider: "#14B8A6",
    "gh-copilot": "#6e5494",
  };

  const displayName = tool.displayName ?? tool.name.toUpperCase();
  const icon = tool.displayName?.charAt(0) ?? tool.name.charAt(0).toUpperCase();
  const color =
    priorityColors[tool.name] ?? categoryColors[tool.category] ?? "#6B7280";

  return { displayName, icon, color };
}
