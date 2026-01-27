/**
 * Unit tests for the Alert Service.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import type { AlertContext, AlertRule } from "../models/alert";
import {
  acknowledgeAlert,
  clearAlertRules,
  clearAlerts,
  dismissAlert,
  fireAlert,
  getActiveAlerts,
  getAlert,
  getAlertHistory,
  getAlertRule,
  getAlertRules,
  initializeDefaultAlertRules,
  registerAlertRule,
  updateAlertRule,
} from "../services/alerts";

describe("Alert Service", () => {
  beforeEach(() => {
    clearAlerts();
    clearAlertRules();
  });

  describe("Alert Rules", () => {
    test("registerAlertRule adds rule to registry", () => {
      const rule: AlertRule = {
        id: "test_rule",
        name: "Test Rule",
        enabled: true,
        type: "custom",
        severity: "warning",
        condition: () => false,
        title: "Test Alert",
        message: "This is a test",
      };

      registerAlertRule(rule);
      expect(getAlertRule("test_rule")).toBeDefined();
    });

    test("getAlertRules returns all registered rules", () => {
      registerAlertRule({
        id: "rule1",
        name: "Rule 1",
        enabled: true,
        type: "custom",
        severity: "info",
        condition: () => false,
        title: "Rule 1",
        message: "Message 1",
      });
      registerAlertRule({
        id: "rule2",
        name: "Rule 2",
        enabled: true,
        type: "custom",
        severity: "warning",
        condition: () => false,
        title: "Rule 2",
        message: "Message 2",
      });

      const rules = getAlertRules();
      expect(rules.length).toBe(2);
    });

    test("updateAlertRule modifies existing rule", () => {
      registerAlertRule({
        id: "test_rule",
        name: "Test Rule",
        enabled: true,
        type: "custom",
        severity: "warning",
        condition: () => false,
        title: "Test",
        message: "Test",
      });

      const updated = updateAlertRule("test_rule", { enabled: false });
      expect(updated?.enabled).toBe(false);
    });

    test("updateAlertRule returns undefined for unknown rule", () => {
      expect(updateAlertRule("unknown", { enabled: false })).toBeUndefined();
    });
  });

  describe("Firing Alerts", () => {
    test("fireAlert creates alert with correct properties", () => {
      const rule: AlertRule = {
        id: "test_rule",
        name: "Test Rule",
        enabled: true,
        type: "system_health",
        severity: "error",
        condition: () => true,
        title: "Test Alert",
        message: "Test message",
        source: "test_source",
      };

      const context: AlertContext = {
        metrics: {
          agents: { total: 0, byStatus: {} },
          tokens: { last24h: 0, quotaUsedPercent: 0 },
          performance: { avgResponseMs: 0, successRate: 100, errorCount: 0 },
          system: { memoryUsageMb: 0, cpuPercent: 0, wsConnections: 0 },
        },
        correlationId: "test-correlation-id",
        timestamp: new Date(),
      };

      const alert = fireAlert(rule, context);

      expect(alert.id).toMatch(/^alert_/);
      expect(alert.type).toBe("system_health");
      expect(alert.severity).toBe("error");
      expect(alert.title).toBe("Test Alert");
      expect(alert.message).toBe("Test message");
      expect(alert.source).toBe("test_source");
      expect(alert.acknowledged).toBe(false);
      expect(alert.correlationId).toBe("test-correlation-id");
    });

    test("fireAlert supports dynamic title and message", () => {
      const rule: AlertRule = {
        id: "dynamic_rule",
        name: "Dynamic Rule",
        enabled: true,
        type: "custom",
        severity: "warning",
        condition: () => true,
        title: (ctx) => `Alert at ${ctx.metrics.agents.total} agents`,
        message: (ctx) => `Memory: ${ctx.metrics.system.memoryUsageMb}MB`,
      };

      const context: AlertContext = {
        metrics: {
          agents: { total: 5, byStatus: {} },
          tokens: { last24h: 0, quotaUsedPercent: 0 },
          performance: { avgResponseMs: 0, successRate: 100, errorCount: 0 },
          system: { memoryUsageMb: 512, cpuPercent: 0, wsConnections: 0 },
        },
        correlationId: "test",
        timestamp: new Date(),
      };

      const alert = fireAlert(rule, context);

      expect(alert.title).toBe("Alert at 5 agents");
      expect(alert.message).toBe("Memory: 512MB");
    });
  });

  describe("Alert Management", () => {
    test("getActiveAlerts returns fired alerts", () => {
      const rule: AlertRule = {
        id: "test",
        name: "Test",
        enabled: true,
        type: "custom",
        severity: "info",
        condition: () => true,
        title: "Test",
        message: "Test",
      };

      const context: AlertContext = {
        metrics: {
          agents: { total: 0, byStatus: {} },
          tokens: { last24h: 0, quotaUsedPercent: 0 },
          performance: { avgResponseMs: 0, successRate: 100, errorCount: 0 },
          system: { memoryUsageMb: 0, cpuPercent: 0, wsConnections: 0 },
        },
        correlationId: "test",
        timestamp: new Date(),
      };

      fireAlert(rule, context);
      const result = getActiveAlerts();

      expect(result.alerts.length).toBe(1);
    });

    test("acknowledgeAlert sets acknowledged flag", () => {
      const rule: AlertRule = {
        id: "test",
        name: "Test",
        enabled: true,
        type: "custom",
        severity: "info",
        condition: () => true,
        title: "Test",
        message: "Test",
      };

      const context: AlertContext = {
        metrics: {
          agents: { total: 0, byStatus: {} },
          tokens: { last24h: 0, quotaUsedPercent: 0 },
          performance: { avgResponseMs: 0, successRate: 100, errorCount: 0 },
          system: { memoryUsageMb: 0, cpuPercent: 0, wsConnections: 0 },
        },
        correlationId: "test",
        timestamp: new Date(),
      };

      const alert = fireAlert(rule, context);
      const acked = acknowledgeAlert(alert.id, "test-user");

      expect(acked?.acknowledged).toBe(true);
      expect(acked?.acknowledgedBy).toBe("test-user");
      expect(acked?.acknowledgedAt).toBeInstanceOf(Date);
    });

    test("dismissAlert removes from active alerts", () => {
      const rule: AlertRule = {
        id: "test",
        name: "Test",
        enabled: true,
        type: "custom",
        severity: "info",
        condition: () => true,
        title: "Test",
        message: "Test",
      };

      const context: AlertContext = {
        metrics: {
          agents: { total: 0, byStatus: {} },
          tokens: { last24h: 0, quotaUsedPercent: 0 },
          performance: { avgResponseMs: 0, successRate: 100, errorCount: 0 },
          system: { memoryUsageMb: 0, cpuPercent: 0, wsConnections: 0 },
        },
        correlationId: "test",
        timestamp: new Date(),
      };

      const alert = fireAlert(rule, context);
      expect(getActiveAlerts().alerts.length).toBe(1);

      dismissAlert(alert.id);
      expect(getActiveAlerts().alerts.length).toBe(0);
    });

    test("getAlert retrieves alert by ID", () => {
      const rule: AlertRule = {
        id: "test",
        name: "Test",
        enabled: true,
        type: "custom",
        severity: "info",
        condition: () => true,
        title: "Test",
        message: "Test",
      };

      const context: AlertContext = {
        metrics: {
          agents: { total: 0, byStatus: {} },
          tokens: { last24h: 0, quotaUsedPercent: 0 },
          performance: { avgResponseMs: 0, successRate: 100, errorCount: 0 },
          system: { memoryUsageMb: 0, cpuPercent: 0, wsConnections: 0 },
        },
        correlationId: "test",
        timestamp: new Date(),
      };

      const fired = fireAlert(rule, context);
      const retrieved = getAlert(fired.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(fired.id);
    });
  });

  describe("Alert Filtering", () => {
    test("getActiveAlerts filters by severity", () => {
      const infoRule: AlertRule = {
        id: "info",
        name: "Info",
        enabled: true,
        type: "custom",
        severity: "info",
        condition: () => true,
        title: "Info",
        message: "Info",
      };
      const errorRule: AlertRule = {
        id: "error",
        name: "Error",
        enabled: true,
        type: "custom",
        severity: "error",
        condition: () => true,
        title: "Error",
        message: "Error",
      };

      const context: AlertContext = {
        metrics: {
          agents: { total: 0, byStatus: {} },
          tokens: { last24h: 0, quotaUsedPercent: 0 },
          performance: { avgResponseMs: 0, successRate: 100, errorCount: 0 },
          system: { memoryUsageMb: 0, cpuPercent: 0, wsConnections: 0 },
        },
        correlationId: "test",
        timestamp: new Date(),
      };

      fireAlert(infoRule, context);
      fireAlert(errorRule, context);

      const errorAlerts = getActiveAlerts({ severity: ["error"] });
      expect(errorAlerts.alerts.length).toBe(1);
      expect(errorAlerts.alerts[0]?.severity).toBe("error");
    });

    test("getActiveAlerts sorts by severity then time", () => {
      const rules: AlertRule[] = [
        {
          id: "1",
          name: "1",
          enabled: true,
          type: "custom",
          severity: "info",
          condition: () => true,
          title: "1",
          message: "1",
        },
        {
          id: "2",
          name: "2",
          enabled: true,
          type: "custom",
          severity: "critical",
          condition: () => true,
          title: "2",
          message: "2",
        },
        {
          id: "3",
          name: "3",
          enabled: true,
          type: "custom",
          severity: "warning",
          condition: () => true,
          title: "3",
          message: "3",
        },
      ];

      const context: AlertContext = {
        metrics: {
          agents: { total: 0, byStatus: {} },
          tokens: { last24h: 0, quotaUsedPercent: 0 },
          performance: { avgResponseMs: 0, successRate: 100, errorCount: 0 },
          system: { memoryUsageMb: 0, cpuPercent: 0, wsConnections: 0 },
        },
        correlationId: "test",
        timestamp: new Date(),
      };

      for (const rule of rules) {
        fireAlert(rule, context);
      }

      const alerts = getActiveAlerts().alerts;
      expect(alerts[0]?.severity).toBe("critical");
      expect(alerts[1]?.severity).toBe("warning");
      expect(alerts[2]?.severity).toBe("info");
    });
  });

  describe("Default Alert Rules", () => {
    test("initializeDefaultAlertRules registers default rules", () => {
      initializeDefaultAlertRules();
      const rules = getAlertRules();

      expect(rules.length).toBeGreaterThan(0);
      expect(rules.some((r) => r.id === "quota_warning")).toBe(true);
      expect(rules.some((r) => r.id === "high_error_rate")).toBe(true);
    });
  });

  describe("Safety Posture Alerting Rules (bd-3lki)", () => {
    /**
     * Helper to create base alert context
     */
    function createBaseContext(): AlertContext {
      return {
        metrics: {
          agents: { total: 0, byStatus: {} },
          tokens: { last24h: 0, quotaUsedPercent: 0 },
          performance: { avgResponseMs: 0, successRate: 100, errorCount: 0 },
          system: { memoryUsageMb: 0, cpuPercent: 0, wsConnections: 0 },
        },
        correlationId: "test-safety-correlation",
        timestamp: new Date(),
      };
    }

    /**
     * Helper to create safety posture context
     */
    function createSafetyContext(overrides: {
      dcgInstalled?: boolean;
      slbInstalled?: boolean;
      ubsInstalled?: boolean;
      checksumsStale?: boolean;
      registryAgeMs?: number | null;
    }): AlertContext["safety"] {
      const dcgInstalled = overrides.dcgInstalled ?? true;
      const slbInstalled = overrides.slbInstalled ?? true;
      const ubsInstalled = overrides.ubsInstalled ?? true;
      const checksumsStale = overrides.checksumsStale ?? false;

      const issues: string[] = [];
      if (!dcgInstalled) issues.push("DCG not installed");
      if (!slbInstalled) issues.push("SLB not installed");
      if (!ubsInstalled) issues.push("UBS not installed");
      if (checksumsStale) issues.push("Checksums are stale");

      const allToolsInstalled = dcgInstalled && slbInstalled && ubsInstalled;

      return {
        status: allToolsInstalled && !checksumsStale ? "healthy" : "unhealthy",
        tools: {
          dcg: { installed: dcgInstalled, version: dcgInstalled ? "1.0.0" : null, healthy: dcgInstalled },
          slb: { installed: slbInstalled, version: slbInstalled ? "0.9.0" : null, healthy: slbInstalled },
          ubs: { installed: ubsInstalled, version: ubsInstalled ? "2.0.0" : null, healthy: ubsInstalled },
        },
        checksums: {
          registryGeneratedAt: checksumsStale ? "2025-01-01T00:00:00Z" : new Date().toISOString(),
          registryAgeMs: overrides.registryAgeMs ?? (checksumsStale ? 30 * 24 * 60 * 60 * 1000 : 1000),
          isStale: checksumsStale,
          staleThresholdMs: 7 * 24 * 60 * 60 * 1000,
        },
        summary: {
          allToolsInstalled,
          allToolsHealthy: allToolsInstalled,
          checksumsAvailable: true,
          checksumsStale,
          overallHealthy: allToolsInstalled && !checksumsStale,
          issues,
        },
      };
    }

    beforeEach(() => {
      initializeDefaultAlertRules();
    });

    describe("DCG Missing Rule (safety_dcg_missing)", () => {
      test("rule is registered after initialization", () => {
        const rule = getAlertRule("safety_dcg_missing");
        expect(rule).toBeDefined();
        expect(rule?.severity).toBe("error"); // DCG is critical
        expect(rule?.type).toBe("safety_dcg_missing");
      });

      test("condition returns true when DCG is not installed", () => {
        const rule = getAlertRule("safety_dcg_missing");
        const context: AlertContext = {
          ...createBaseContext(),
          safety: createSafetyContext({ dcgInstalled: false }),
        };

        expect(rule?.condition(context)).toBe(true);
      });

      test("condition returns false when DCG is installed", () => {
        const rule = getAlertRule("safety_dcg_missing");
        const context: AlertContext = {
          ...createBaseContext(),
          safety: createSafetyContext({ dcgInstalled: true }),
        };

        expect(rule?.condition(context)).toBe(false);
      });

      test("condition returns false when safety context is missing", () => {
        const rule = getAlertRule("safety_dcg_missing");
        const context = createBaseContext();

        expect(rule?.condition(context)).toBe(false);
      });

      test("alert metadata includes tool and safety status", () => {
        const rule = getAlertRule("safety_dcg_missing");
        const context: AlertContext = {
          ...createBaseContext(),
          safety: createSafetyContext({ dcgInstalled: false }),
        };

        const alert = fireAlert(rule!, context);

        expect(alert.metadata?.tool).toBe("dcg");
        expect(alert.metadata?.safetyStatus).toBe("unhealthy");
        expect(alert.metadata?.issues).toContain("DCG not installed");
      });
    });

    describe("SLB Missing Rule (safety_slb_missing)", () => {
      test("rule is registered after initialization", () => {
        const rule = getAlertRule("safety_slb_missing");
        expect(rule).toBeDefined();
        expect(rule?.severity).toBe("warning"); // SLB is important but not critical
        expect(rule?.type).toBe("safety_slb_missing");
      });

      test("condition returns true when SLB is not installed", () => {
        const rule = getAlertRule("safety_slb_missing");
        const context: AlertContext = {
          ...createBaseContext(),
          safety: createSafetyContext({ slbInstalled: false }),
        };

        expect(rule?.condition(context)).toBe(true);
      });

      test("condition returns false when SLB is installed", () => {
        const rule = getAlertRule("safety_slb_missing");
        const context: AlertContext = {
          ...createBaseContext(),
          safety: createSafetyContext({ slbInstalled: true }),
        };

        expect(rule?.condition(context)).toBe(false);
      });

      test("alert metadata includes tool and safety status", () => {
        const rule = getAlertRule("safety_slb_missing");
        const context: AlertContext = {
          ...createBaseContext(),
          safety: createSafetyContext({ slbInstalled: false }),
        };

        const alert = fireAlert(rule!, context);

        expect(alert.metadata?.tool).toBe("slb");
        expect(alert.metadata?.safetyStatus).toBe("unhealthy");
      });
    });

    describe("UBS Missing Rule (safety_ubs_missing)", () => {
      test("rule is registered after initialization", () => {
        const rule = getAlertRule("safety_ubs_missing");
        expect(rule).toBeDefined();
        expect(rule?.severity).toBe("warning");
        expect(rule?.type).toBe("safety_ubs_missing");
      });

      test("condition returns true when UBS is not installed", () => {
        const rule = getAlertRule("safety_ubs_missing");
        const context: AlertContext = {
          ...createBaseContext(),
          safety: createSafetyContext({ ubsInstalled: false }),
        };

        expect(rule?.condition(context)).toBe(true);
      });

      test("condition returns false when UBS is installed", () => {
        const rule = getAlertRule("safety_ubs_missing");
        const context: AlertContext = {
          ...createBaseContext(),
          safety: createSafetyContext({ ubsInstalled: true }),
        };

        expect(rule?.condition(context)).toBe(false);
      });

      test("alert metadata includes tool and safety status", () => {
        const rule = getAlertRule("safety_ubs_missing");
        const context: AlertContext = {
          ...createBaseContext(),
          safety: createSafetyContext({ ubsInstalled: false }),
        };

        const alert = fireAlert(rule!, context);

        expect(alert.metadata?.tool).toBe("ubs");
        expect(alert.metadata?.safetyStatus).toBe("unhealthy");
      });
    });

    describe("Checksums Stale Rule (safety_checksums_stale)", () => {
      test("rule is registered after initialization", () => {
        const rule = getAlertRule("safety_checksums_stale");
        expect(rule).toBeDefined();
        expect(rule?.severity).toBe("warning");
        expect(rule?.type).toBe("safety_checksums_stale");
      });

      test("condition returns true when checksums are stale", () => {
        const rule = getAlertRule("safety_checksums_stale");
        const context: AlertContext = {
          ...createBaseContext(),
          safety: createSafetyContext({ checksumsStale: true }),
        };

        expect(rule?.condition(context)).toBe(true);
      });

      test("condition returns false when checksums are fresh", () => {
        const rule = getAlertRule("safety_checksums_stale");
        const context: AlertContext = {
          ...createBaseContext(),
          safety: createSafetyContext({ checksumsStale: false }),
        };

        expect(rule?.condition(context)).toBe(false);
      });

      test("alert message includes age in days", () => {
        const rule = getAlertRule("safety_checksums_stale");
        const ageMs = 10 * 24 * 60 * 60 * 1000; // 10 days
        const context: AlertContext = {
          ...createBaseContext(),
          safety: createSafetyContext({ checksumsStale: true, registryAgeMs: ageMs }),
        };

        const alert = fireAlert(rule!, context);

        expect(alert.message).toContain("10 days old");
        expect(alert.message).toContain("threshold: 7 days");
      });

      test("alert metadata includes registry age and threshold", () => {
        const rule = getAlertRule("safety_checksums_stale");
        const ageMs = 14 * 24 * 60 * 60 * 1000; // 14 days
        const context: AlertContext = {
          ...createBaseContext(),
          safety: createSafetyContext({ checksumsStale: true, registryAgeMs: ageMs }),
        };

        const alert = fireAlert(rule!, context);

        expect(alert.metadata?.registryAgeMs).toBe(ageMs);
        expect(alert.metadata?.staleThresholdMs).toBe(7 * 24 * 60 * 60 * 1000);
        expect(alert.metadata?.safetyStatus).toBe("unhealthy");
      });
    });

    describe("Multiple Safety Issues", () => {
      test("multiple rules fire when multiple tools are missing", () => {
        const context: AlertContext = {
          ...createBaseContext(),
          safety: createSafetyContext({
            dcgInstalled: false,
            slbInstalled: false,
            ubsInstalled: true,
          }),
        };

        const dcgRule = getAlertRule("safety_dcg_missing");
        const slbRule = getAlertRule("safety_slb_missing");
        const ubsRule = getAlertRule("safety_ubs_missing");

        expect(dcgRule?.condition(context)).toBe(true);
        expect(slbRule?.condition(context)).toBe(true);
        expect(ubsRule?.condition(context)).toBe(false);
      });

      test("all healthy returns no alerts", () => {
        const context: AlertContext = {
          ...createBaseContext(),
          safety: createSafetyContext({
            dcgInstalled: true,
            slbInstalled: true,
            ubsInstalled: true,
            checksumsStale: false,
          }),
        };

        const dcgRule = getAlertRule("safety_dcg_missing");
        const slbRule = getAlertRule("safety_slb_missing");
        const ubsRule = getAlertRule("safety_ubs_missing");
        const checksumRule = getAlertRule("safety_checksums_stale");

        expect(dcgRule?.condition(context)).toBe(false);
        expect(slbRule?.condition(context)).toBe(false);
        expect(ubsRule?.condition(context)).toBe(false);
        expect(checksumRule?.condition(context)).toBe(false);
      });
    });
  });

  describe("Alert History", () => {
    test("getAlertHistory includes all fired alerts", () => {
      const rule: AlertRule = {
        id: "test",
        name: "Test",
        enabled: true,
        type: "custom",
        severity: "info",
        condition: () => true,
        title: "Test",
        message: "Test",
      };

      const context: AlertContext = {
        metrics: {
          agents: { total: 0, byStatus: {} },
          tokens: { last24h: 0, quotaUsedPercent: 0 },
          performance: { avgResponseMs: 0, successRate: 100, errorCount: 0 },
          system: { memoryUsageMb: 0, cpuPercent: 0, wsConnections: 0 },
        },
        correlationId: "test",
        timestamp: new Date(),
      };

      fireAlert(rule, context);
      fireAlert(rule, context);

      const history = getAlertHistory();
      expect(history.alerts.length).toBe(2);
    });

    test("getAlertHistory includes dismissed alerts", () => {
      const rule: AlertRule = {
        id: "test",
        name: "Test",
        enabled: true,
        type: "custom",
        severity: "info",
        condition: () => true,
        title: "Test",
        message: "Test",
      };

      const context: AlertContext = {
        metrics: {
          agents: { total: 0, byStatus: {} },
          tokens: { last24h: 0, quotaUsedPercent: 0 },
          performance: { avgResponseMs: 0, successRate: 100, errorCount: 0 },
          system: { memoryUsageMb: 0, cpuPercent: 0, wsConnections: 0 },
        },
        correlationId: "test",
        timestamp: new Date(),
      };

      const alert = fireAlert(rule, context);
      dismissAlert(alert.id);

      // Active should be empty
      expect(getActiveAlerts().alerts.length).toBe(0);
      // History should still have it
      expect(getAlertHistory().alerts.length).toBe(1);
    });
  });
});
