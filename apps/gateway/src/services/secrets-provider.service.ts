/**
 * Secrets Provider Service (bd-d134v)
 *
 * Provides a pluggable interface for resolving secrets from multiple sources.
 * This does not log or expose secret values outside controlled return paths.
 */

import { resolvePrivateDir } from "./private-overlay.service";
import { loadSecretsFromDir } from "./secret-loader.service";

export type SecretSource = "env" | "file" | "composite";

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

export class CompositeSecretsProvider implements SecretsProvider {
  readonly name = "composite";
  private providers: SecretsProvider[];

  constructor(providers: SecretsProvider[]) {
    this.providers = providers;
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
