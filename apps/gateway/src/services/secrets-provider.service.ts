/**
 * Secrets Provider Service (bd-d134v)
 *
 * Provides a pluggable interface for resolving secrets from multiple sources.
 * This does not log or expose secret values outside controlled return paths.
 */

import { kvClearNamespace, kvGetAll, kvSet } from "./kv-persistence.service";
import { resolvePrivateDir } from "./private-overlay.service";
import { loadSecretsFromDir } from "./secret-loader.service";

export type SecretSource = "env" | "file" | "vault" | "composite";

export interface SecretResult {
  name: string;
  value: string;
  source: SecretSource;
}

export interface SecretsProvider {
  readonly name: string;
  get(name: string): Promise<SecretResult | null>;
  list(prefix?: string): Promise<string[]>;
}

export interface SecretNameValidationResult {
  valid: boolean;
  namespace?: string;
  key?: string;
  error?: string;
}

const SAFE_SECRET_NAME_RE = /^[a-zA-Z0-9_.:/-]{1,128}$/;

/**
 * Validate a secret name and extract optional namespace to prevent collisions
 * and path traversal attacks.
 */
export function validateSecretName(name: string): SecretNameValidationResult {
  const trimmed = name.trim();
  if (!trimmed) {
    return { valid: false, error: "Secret name must not be empty" };
  }
  if (
    trimmed.includes("..") ||
    trimmed.startsWith("/") ||
    trimmed.endsWith("/")
  ) {
    return {
      valid: false,
      error:
        "Secret name must not contain path traversal or leading/trailing slashes",
    };
  }
  if (!SAFE_SECRET_NAME_RE.test(trimmed)) {
    return {
      valid: false,
      error:
        "Secret name contains invalid characters (allowed: alphanumeric, _, ., :, /, -)",
    };
  }

  const colonIdx = trimmed.indexOf(":");
  if (colonIdx > 0 && colonIdx < trimmed.length - 1) {
    const namespace = trimmed.slice(0, colonIdx);
    const key = trimmed.slice(colonIdx + 1);
    return { valid: true, namespace, key };
  }

  const slashIdx = trimmed.indexOf("/");
  if (slashIdx > 0 && slashIdx < trimmed.length - 1) {
    const namespace = trimmed.slice(0, slashIdx);
    const key = trimmed.slice(slashIdx + 1);
    return { valid: true, namespace, key };
  }

  return { valid: true, namespace: "default", key: trimmed };
}

export function formatToolSecretName(tool: string, key: string): string {
  return `tool:${tool}:${key}`;
}

export function parseToolSecretName(
  name: string,
): { tool: string; key: string } | null {
  if (!name.startsWith("tool:")) return null;
  const parts = name.split(":");
  if (parts.length !== 3) return null;
  const tool = parts[1];
  const key = parts[2];
  if (!tool || !key) return null;
  return { tool, key };
}

export interface EnvSecretsProviderOptions {
  allowPrefixes?: string[];
  allowNames?: string[];
}

export class EnvSecretsProvider implements SecretsProvider {
  readonly name = "env";
  private allowPrefixes: string[];
  private allowNames: Set<string> | null;

  constructor(options: EnvSecretsProviderOptions = {}) {
    this.allowPrefixes = options.allowPrefixes ?? [];
    this.allowNames = options.allowNames ? new Set(options.allowNames) : null;
  }

  async get(name: string): Promise<SecretResult | null> {
    if (!this.isAllowed(name)) return null;
    const value = process.env[name];
    if (!value) return null;
    return { name, value, source: "env" };
  }

  async list(prefix?: string): Promise<string[]> {
    const keys = Object.keys(process.env);
    const filtered = keys.filter((key) => this.isAllowed(key));
    const withPrefix = prefix
      ? filtered.filter((key) => key.startsWith(prefix))
      : filtered;
    return withPrefix.sort();
  }

  private isAllowed(name: string): boolean {
    if (this.allowNames?.has(name)) return true;
    if (this.allowPrefixes.length === 0) return true;
    return this.allowPrefixes.some((prefix) => name.startsWith(prefix));
  }
}

export interface FileSecretsProviderOptions {
  privateDir?: string;
  refreshIntervalMs?: number;
}

interface FileSecretsCache {
  loadedAt: number;
  values: Map<string, SecretResult>;
  names: string[];
}

export class FileSecretsProvider implements SecretsProvider {
  readonly name = "file";
  private privateDir: string;
  private refreshIntervalMs: number;
  private cache: FileSecretsCache | null = null;

  constructor(options: FileSecretsProviderOptions = {}) {
    this.privateDir = options.privateDir ?? resolvePrivateDir();
    this.refreshIntervalMs = options.refreshIntervalMs ?? 30_000;
  }

  async get(name: string): Promise<SecretResult | null> {
    await this.ensureCache();
    return this.cache?.values.get(name) ?? null;
  }

  async list(prefix?: string): Promise<string[]> {
    await this.ensureCache();
    if (!this.cache) return [];
    if (!prefix) return [...this.cache.names];
    return this.cache.names.filter((name) => name.startsWith(prefix));
  }

  invalidateCache(): void {
    this.cache = null;
  }

  private isCacheFresh(): boolean {
    if (!this.cache) return false;
    if (this.refreshIntervalMs <= 0) return false;
    return Date.now() - this.cache.loadedAt <= this.refreshIntervalMs;
  }

  private async ensureCache(): Promise<void> {
    if (this.isCacheFresh()) return;

    const { entries } = await loadSecretsFromDir(this.privateDir);
    const values = new Map<string, SecretResult>();
    for (const entry of entries) {
      const name = formatToolSecretName(entry.tool, entry.key);
      values.set(name, { name, value: entry.value, source: "file" });
    }
    const names = Array.from(values.keys()).sort();
    this.cache = { loadedAt: Date.now(), values, names };
  }
}

export interface VaultSecretsProviderOptions {
  addr: string;
  token: string;
  mountPath?: string;
  namespace?: string;
  kvVersion?: 1 | 2;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

/**
 * HashiCorp Vault HTTP API SecretsProvider (supports KV v1 and v2 with token auth).
 */
export class VaultSecretsProvider implements SecretsProvider {
  readonly name = "vault";
  private addr: string;
  private token: string;
  private mountPath: string;
  private namespace?: string;
  private kvVersion: 1 | 2;
  private timeoutMs: number;
  private fetchFn: typeof fetch;

  constructor(options: VaultSecretsProviderOptions) {
    this.addr = options.addr.replace(/\/+$/, "");
    this.token = options.token;
    this.mountPath = (options.mountPath ?? "secret").replace(/^\/+|\/+$/g, "");
    if (options.namespace) {
      this.namespace = options.namespace;
    }
    this.kvVersion = options.kvVersion ?? 2;
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async get(name: string): Promise<SecretResult | null> {
    const validation = validateSecretName(name);
    if (!validation.valid) return null;

    // Normalize colon-delimited names (e.g. tool:dcg:apiKey -> tool/dcg#apiKey or path/field)
    const { secretPath, fieldKey } = this.resolvePathAndField(name);
    const apiPath =
      this.kvVersion === 2
        ? `${this.addr}/v1/${this.mountPath}/data/${secretPath}`
        : `${this.addr}/v1/${this.mountPath}/${secretPath}`;

    try {
      const response = await this.fetchFn(apiPath, {
        method: "GET",
        headers: this.buildHeaders(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        return null;
      }

      const body = (await response.json()) as {
        data?: Record<string, unknown> & { data?: Record<string, unknown> };
      };
      const kvData =
        this.kvVersion === 2
          ? (body.data?.data as Record<string, unknown> | undefined)
          : (body.data as Record<string, unknown> | undefined);

      if (!kvData || typeof kvData !== "object") {
        return null;
      }

      const rawValue = kvData[fieldKey] ?? kvData["value"] ?? kvData[name];
      if (typeof rawValue !== "string" || rawValue.length === 0) {
        return null;
      }

      return { name, value: rawValue, source: "vault" };
    } catch {
      return null;
    }
  }

  async list(prefix?: string): Promise<string[]> {
    const subPath = prefix
      ? prefix.replace(/:/g, "/").replace(/^\/+|\/+$/g, "")
      : "";
    const basePath =
      this.kvVersion === 2
        ? `${this.addr}/v1/${this.mountPath}/metadata`
        : `${this.addr}/v1/${this.mountPath}`;
    const apiPath = subPath
      ? `${basePath}/${subPath}?list=true`
      : `${basePath}?list=true`;

    try {
      const response = await this.fetchFn(apiPath, {
        method: "GET",
        headers: this.buildHeaders(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        return [];
      }

      const body = (await response.json()) as {
        data?: { keys?: unknown[] };
      };
      const keys = Array.isArray(body.data?.keys)
        ? body.data.keys.filter((k): k is string => typeof k === "string")
        : [];
      return keys.map((k) => (subPath ? `${subPath}/${k}` : k)).sort();
    } catch {
      return [];
    }
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "X-Vault-Token": this.token,
      Accept: "application/json",
    };
    if (this.namespace) {
      headers["X-Vault-Namespace"] = this.namespace;
    }
    return headers;
  }

  private resolvePathAndField(name: string): {
    secretPath: string;
    fieldKey: string;
  } {
    const parsedTool = parseToolSecretName(name);
    if (parsedTool) {
      return {
        secretPath: `tools/${parsedTool.tool}`,
        fieldKey: parsedTool.key,
      };
    }

    if (name.includes(":")) {
      const parts = name.split(":");
      const fieldKey = parts.pop() ?? "value";
      return {
        secretPath: parts.join("/"),
        fieldKey,
      };
    }

    return {
      secretPath: name,
      fieldKey: "value",
    };
  }
}

export class CompositeSecretsProvider implements SecretsProvider {
  readonly name = "composite";
  private providers: SecretsProvider[];

  constructor(providers: SecretsProvider[]) {
    this.providers = providers;
  }

  getProviders(): ReadonlyArray<SecretsProvider> {
    return this.providers;
  }

  async get(name: string): Promise<SecretResult | null> {
    for (const provider of this.providers) {
      const result = await provider.get(name);
      if (result) return result;
    }
    return null;
  }

  async list(prefix?: string): Promise<string[]> {
    const names = new Set<string>();
    for (const provider of this.providers) {
      const providerNames = await provider.list(prefix);
      for (const name of providerNames) names.add(name);
    }
    return Array.from(names).sort();
  }
}

// ============================================================================
// Secret References & Rotation Metadata (Never Exposes Secret Values)
// ============================================================================

export interface SecretRotationMetadata {
  name: string;
  namespace: string;
  source: SecretSource | "unknown";
  lastRotatedAt: string | null;
  rotationCount: number;
  rotatedBy?: string;
  reason?: string;
}

const rotationMetadataStore = new Map<string, SecretRotationMetadata>();
let rotationMetaHydrated = false;
let defaultProviderInstance: CompositeSecretsProvider | null = null;

function hydrateSecretRotationMetaFromDb(): void {
  if (rotationMetaHydrated) return;
  rotationMetaHydrated = true;
  for (const row of kvGetAll<SecretRotationMetadata>("secret_rotation_meta")) {
    if (!rotationMetadataStore.has(row.key)) {
      rotationMetadataStore.set(row.key, row.value);
    }
  }
}

export function getDefaultSecretsProvider(): CompositeSecretsProvider {
  if (!defaultProviderInstance) {
    const providers: SecretsProvider[] = [];
    const vaultAddr = process.env["VAULT_ADDR"];
    const vaultToken = process.env["VAULT_TOKEN"];
    if (vaultAddr && vaultToken) {
      providers.push(
        new VaultSecretsProvider({
          addr: vaultAddr,
          token: vaultToken,
          ...(process.env["VAULT_MOUNT_PATH"]
            ? { mountPath: process.env["VAULT_MOUNT_PATH"] }
            : {}),
          ...(process.env["VAULT_NAMESPACE"]
            ? { namespace: process.env["VAULT_NAMESPACE"] }
            : {}),
        }),
      );
    }
    providers.push(new FileSecretsProvider({ refreshIntervalMs: 0 }));
    providers.push(
      new EnvSecretsProvider({
        allowPrefixes: [
          "FLYWHEEL_",
          "ANTHROPIC_",
          "OPENAI_",
          "GEMINI_",
          "AGENT_MAIL_",
          "VAULT_",
          "SLACK_",
          "DISCORD_",
        ],
      }),
    );
    defaultProviderInstance = new CompositeSecretsProvider(providers);
  }
  return defaultProviderInstance;
}

export function setDefaultSecretsProvider(
  provider: CompositeSecretsProvider | null,
): void {
  defaultProviderInstance = provider;
}

export async function rotateSecretReference(
  name: string,
  options?: {
    rotatedBy?: string;
    reason?: string;
    provider?: SecretsProvider;
  },
): Promise<SecretRotationMetadata> {
  hydrateSecretRotationMetaFromDb();
  const validation = validateSecretName(name);
  if (!validation.valid) {
    throw new Error(validation.error ?? "Invalid secret name");
  }

  const provider = options?.provider ?? getDefaultSecretsProvider();
  const resolved = await provider.get(name);
  const existing = rotationMetadataStore.get(name);
  const nowIso = new Date().toISOString();

  const updated: SecretRotationMetadata = {
    name,
    namespace: validation.namespace ?? "default",
    source: resolved?.source ?? existing?.source ?? "unknown",
    lastRotatedAt: nowIso,
    rotationCount: (existing?.rotationCount ?? 0) + 1,
    ...(options?.rotatedBy ? { rotatedBy: options.rotatedBy } : {}),
    ...(options?.reason ? { reason: options.reason } : {}),
  };

  rotationMetadataStore.set(name, updated);
  kvSet("secret_rotation_meta", name, updated);
  return updated;
}

export async function listSecretReferences(
  prefix?: string,
  provider?: SecretsProvider,
): Promise<SecretRotationMetadata[]> {
  hydrateSecretRotationMetaFromDb();
  const activeProvider = provider ?? getDefaultSecretsProvider();
  const names = await activeProvider.list(prefix);
  const allNames = new Set<string>(names);
  for (const trackedName of rotationMetadataStore.keys()) {
    if (!prefix || trackedName.startsWith(prefix)) {
      allNames.add(trackedName);
    }
  }

  const results: SecretRotationMetadata[] = [];
  for (const name of Array.from(allNames).sort()) {
    const validation = validateSecretName(name);
    const existing = rotationMetadataStore.get(name);
    const resolved = await activeProvider.get(name);
    results.push({
      name,
      namespace: validation.namespace ?? "default",
      source: resolved?.source ?? existing?.source ?? "unknown",
      lastRotatedAt: existing?.lastRotatedAt ?? null,
      rotationCount: existing?.rotationCount ?? 0,
      ...(existing?.rotatedBy ? { rotatedBy: existing.rotatedBy } : {}),
      ...(existing?.reason ? { reason: existing.reason } : {}),
    });
  }

  return results;
}

export function clearSecretRotationMetadata(): void {
  rotationMetadataStore.clear();
  kvClearNamespace("secret_rotation_meta");
  rotationMetaHydrated = true;
}

export function _evictSecretRotationCacheForTesting(): void {
  rotationMetadataStore.clear();
  rotationMetaHydrated = false;
}
