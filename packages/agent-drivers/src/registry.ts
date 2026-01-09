/**
 * Driver Registry - Manages agent driver instances and selection.
 *
 * The registry provides:
 * - Registration of driver factories
 * - Driver selection based on requirements
 * - Automatic driver detection and fallback
 * - Health monitoring for active drivers
 */

import type {
  AgentDriver,
  AgentDriverType,
  DriverCapabilities,
  DriverFactory,
  DriverOptions,
  DriverRegistryEntry,
} from "./interface";

/**
 * Requirements for selecting a driver.
 */
export interface DriverRequirements {
  /** Preferred driver type (if available) */
  preferredType?: AgentDriverType;
  /** Required capabilities that the driver must support */
  requiredCapabilities?: (keyof DriverCapabilities)[];
  /** Model provider (may influence driver selection) */
  provider?: string;
}

/**
 * Result of driver selection.
 */
export interface DriverSelectionResult {
  driver: AgentDriver;
  type: AgentDriverType;
  reason: string;
  warnings: string[] | undefined;
}

/**
 * Logger interface for driver operations.
 */
export interface DriverLogger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

/**
 * Default console logger.
 */
const defaultLogger: DriverLogger = {
  debug: (msg, ctx) => console.debug(`[DRIVER] ${msg}`, ctx),
  info: (msg, ctx) => console.info(`[DRIVER] ${msg}`, ctx),
  warn: (msg, ctx) => console.warn(`[DRIVER] ${msg}`, ctx),
  error: (msg, ctx) => console.error(`[DRIVER] ${msg}`, ctx),
};

/**
 * Registry for managing agent drivers.
 */
export class DriverRegistry {
  private entries = new Map<AgentDriverType, DriverRegistryEntry>();
  private instances = new Map<string, AgentDriver>();
  private logger: DriverLogger;

  constructor(logger: DriverLogger = defaultLogger) {
    this.logger = logger;
  }

  /**
   * Register a driver factory.
   *
   * @param entry - Driver registry entry with factory and capabilities
   */
  register(entry: DriverRegistryEntry): void {
    this.entries.set(entry.type, entry);
    this.logger.info(`Registered driver: ${entry.type}`, {
      description: entry.description,
      capabilities: entry.defaultCapabilities,
    });
  }

  /**
   * Unregister a driver.
   *
   * @param type - Driver type to unregister
   */
  unregister(type: AgentDriverType): void {
    this.entries.delete(type);
    this.logger.info(`Unregistered driver: ${type}`);
  }

  /**
   * Check if a driver type is registered.
   */
  has(type: AgentDriverType): boolean {
    return this.entries.has(type);
  }

  /**
   * Get a driver instance by ID.
   */
  getInstance(driverId: string): AgentDriver | undefined {
    return this.instances.get(driverId);
  }

  /**
   * Get or create a driver of the specified type.
   *
   * @param type - Driver type to get/create
   * @param options - Options for driver creation
   * @returns The driver instance
   */
  async getDriver(
    type: AgentDriverType,
    options?: DriverOptions
  ): Promise<AgentDriver> {
    const entry = this.entries.get(type);
    if (!entry) {
      throw new Error(`Driver type not registered: ${type}`);
    }

    // Check if we have a cached instance
    const driverId = options?.driverId ?? `${type}-default`;
    const existing = this.instances.get(driverId);
    if (existing) {
      return existing;
    }

    // Create new instance
    this.logger.info(`Creating driver instance: ${driverId}`, { type, options });
    const driver = await entry.factory({ ...options, driverId });
    this.instances.set(driverId, driver);
    return driver;
  }

  /**
   * Select the best available driver based on requirements.
   *
   * Selection priority:
   * 1. Preferred type if specified and available
   * 2. SDK driver if capabilities match
   * 3. ACP driver if capabilities match
   * 4. Tmux driver as fallback
   *
   * @param requirements - Driver requirements
   * @param options - Driver options
   * @returns Selection result with driver and reasoning
   */
  async selectDriver(
    requirements: DriverRequirements = {},
    options?: DriverOptions
  ): Promise<DriverSelectionResult> {
    const { preferredType, requiredCapabilities = [], provider } = requirements;
    const warnings: string[] = [];

    // Helper to check if driver meets capability requirements
    const meetsCapabilities = (caps: DriverCapabilities): boolean => {
      return requiredCapabilities.every((cap) => caps[cap]);
    };

    // Try preferred type first
    if (preferredType && this.entries.has(preferredType)) {
      const entry = this.entries.get(preferredType)!;
      if (meetsCapabilities(entry.defaultCapabilities)) {
        const driver = await this.getDriver(preferredType, options);
        if (await driver.isHealthy()) {
          this.logger.info(`Selected preferred driver: ${preferredType}`, {
            provider,
            requiredCapabilities,
          });
          return {
            driver,
            type: preferredType,
            reason: "Preferred driver type selected",
            warnings: undefined,
          };
        }
        warnings.push(`Preferred driver ${preferredType} is unhealthy`);
      } else {
        warnings.push(
          `Preferred driver ${preferredType} lacks required capabilities`
        );
      }
    }

    // Selection order: sdk > acp > tmux
    const selectionOrder: AgentDriverType[] = ["sdk", "acp", "tmux"];

    for (const type of selectionOrder) {
      if (!this.entries.has(type)) continue;

      const entry = this.entries.get(type)!;
      if (!meetsCapabilities(entry.defaultCapabilities)) continue;

      try {
        const driver = await this.getDriver(type, options);
        if (await driver.isHealthy()) {
          this.logger.info(`Selected driver: ${type}`, {
            action: "select",
            model: provider ?? "unknown",
            result: type,
            reason: `${type.toUpperCase()} available and healthy`,
          });
          return {
            driver,
            type,
            reason: `${type.toUpperCase()} driver selected (healthy, meets capabilities)`,
            warnings: warnings.length > 0 ? warnings : undefined,
          };
        }
        warnings.push(`Driver ${type} is unhealthy`);
      } catch (err) {
        warnings.push(`Failed to initialize ${type} driver: ${err}`);
      }
    }

    throw new Error(
      `No suitable driver found. Requirements: ${JSON.stringify(requirements)}. Warnings: ${warnings.join("; ")}`
    );
  }

  /**
   * Get all registered driver types.
   */
  getRegisteredTypes(): AgentDriverType[] {
    return Array.from(this.entries.keys());
  }

  /**
   * Get capabilities for a driver type.
   */
  getCapabilities(type: AgentDriverType): DriverCapabilities | undefined {
    return this.entries.get(type)?.defaultCapabilities;
  }

  /**
   * Check health of all active driver instances.
   */
  async checkHealth(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    for (const [id, driver] of this.instances) {
      try {
        results.set(id, await driver.isHealthy());
      } catch {
        results.set(id, false);
      }
    }
    return results;
  }

  /**
   * Cleanup all driver instances.
   */
  async cleanup(): Promise<void> {
    this.logger.info("Cleaning up all driver instances");
    this.instances.clear();
  }
}

// Default singleton registry
let defaultRegistry: DriverRegistry | null = null;

/**
 * Get the default driver registry (singleton).
 */
export function getDriverRegistry(): DriverRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new DriverRegistry();
  }
  return defaultRegistry;
}

/**
 * Set the default driver registry (for testing).
 */
export function setDriverRegistry(registry: DriverRegistry): void {
  defaultRegistry = registry;
}

/**
 * Convenience function to select a driver from the default registry.
 */
export async function selectDriver(
  requirements?: DriverRequirements,
  options?: DriverOptions
): Promise<DriverSelectionResult> {
  return getDriverRegistry().selectDriver(requirements, options);
}
