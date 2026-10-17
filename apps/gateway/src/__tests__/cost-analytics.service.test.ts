/**
 * Unit tests for Cost Analytics Services - Pure function tests.
 *
 * Tests budget period calculations and cost formatting utilities.
 * These tests don't require database access.
 */

import { describe, expect, test } from "bun:test";

import {
  getBudgetPeriodBoundaries,
  getDaysRemainingInPeriod,
} from "../services/budget.service";
import {
  dollarsToUnits,
  formatCostUnits,
  unitsToDollars,
} from "../services/cost-tracker.service";

// ============================================================================
// Cost Formatting Tests
// ============================================================================

describe("Cost Formatting", () => {
  describe("formatCostUnits", () => {
    test("formats zero correctly", () => {
      expect(formatCostUnits(0)).toBe("$0.00");
    });

    test("formats whole dollar amounts", () => {
      expect(formatCostUnits(100000)).toBe("$1.00");
      expect(formatCostUnits(500000)).toBe("$5.00");
      expect(formatCostUnits(10000000)).toBe("$100.00");
    });

    test("formats cents correctly", () => {
      expect(formatCostUnits(50000)).toBe("$0.50");
      expect(formatCostUnits(1000)).toBe("$0.01");
      // Sub-cent amounts show more precision
      expect(formatCostUnits(500)).toBe("$0.005");
    });

    test("formats fractional dollars correctly", () => {
      expect(formatCostUnits(125000)).toBe("$1.25");
      // formatCostUnits preserves sub-cent precision
      expect(formatCostUnits(99999)).toBe("$1.00");
      expect(formatCostUnits(12345)).toBe("$0.1235"); // Shows 4 decimal places
    });

    test("formats large amounts correctly", () => {
      // Large amounts include thousands separator and preserve precision
      expect(formatCostUnits(100000000)).toBe("$1,000.00");
      expect(formatCostUnits(1234567890)).toBe("$12,345.6789");
    });
  });

  describe("dollarsToUnits", () => {
    test("converts dollars to units", () => {
      expect(dollarsToUnits(1)).toBe(100000);
      expect(dollarsToUnits(0.01)).toBe(1000);
      expect(dollarsToUnits(10)).toBe(1000000);
      expect(dollarsToUnits(0)).toBe(0);
    });

    test("handles fractional dollars", () => {
      expect(dollarsToUnits(1.5)).toBe(150000);
      expect(dollarsToUnits(0.001)).toBe(100);
    });
  });

  describe("unitsToDollars", () => {
    test("converts units to dollars", () => {
      expect(unitsToDollars(100000)).toBe(1);
      expect(unitsToDollars(1000)).toBe(0.01);
      expect(unitsToDollars(1000000)).toBe(10);
      expect(unitsToDollars(0)).toBe(0);
    });

    test("handles fractional units", () => {
      expect(unitsToDollars(150000)).toBe(1.5);
      expect(unitsToDollars(12345)).toBeCloseTo(0.12345, 5);
    });
  });

  describe("round-trip conversion", () => {
    test("dollars -> units -> dollars preserves value", () => {
      const testValues = [0, 0.01, 0.5, 1, 1.23, 10, 100.99, 1000];
      for (const dollars of testValues) {
        const units = dollarsToUnits(dollars);
        const backToDollars = unitsToDollars(units);
        expect(backToDollars).toBeCloseTo(dollars, 5);
      }
    });
  });
});

// ============================================================================
// Budget Period Tests
// ============================================================================

describe("Budget Period Calculations", () => {
  describe("getBudgetPeriodBoundaries", () => {
    describe("daily periods", () => {
      test("returns correct boundaries for mid-day", () => {
        const testDate = new Date("2025-06-15T14:30:00Z");
        const { start, end } = getBudgetPeriodBoundaries("daily", testDate);

        // Start should be midnight on the 15th
        expect(start.getDate()).toBe(15);
        expect(start.getMonth()).toBe(5); // June
        expect(start.getHours()).toBe(0);
        expect(start.getMinutes()).toBe(0);

        // End should be midnight on the 16th
        expect(end.getDate()).toBe(16);
      });

      test("handles start of day", () => {
        const testDate = new Date("2025-06-15T00:00:00Z");
        const { start, end } = getBudgetPeriodBoundaries("daily", testDate);

        expect(start.getDate()).toBe(15);
        expect(end.getDate()).toBe(16);
      });

      test("handles end of day", () => {
        const testDate = new Date("2025-06-15T23:59:59Z");
        const { start, end } = getBudgetPeriodBoundaries("daily", testDate);

        expect(start.getDate()).toBe(15);
        expect(end.getDate()).toBe(16);
      });
    });

    describe("weekly periods", () => {
      test("returns correct boundaries for Wednesday", () => {
        const testDate = new Date("2025-06-18T14:30:00Z"); // Wednesday
        const { start, end } = getBudgetPeriodBoundaries("weekly", testDate);

        // Start should be Sunday
        expect(start.getDay()).toBe(0);

        // Duration should be exactly 7 days
        const daysDiff =
          (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
        expect(daysDiff).toBe(7);
      });

      test("returns correct boundaries for Sunday", () => {
        const testDate = new Date("2025-06-15T14:30:00Z"); // Sunday
        const { start, end } = getBudgetPeriodBoundaries("weekly", testDate);

        expect(start.getDay()).toBe(0);
        expect(start.getDate()).toBe(15);
      });

      test("returns correct boundaries for Saturday", () => {
        const testDate = new Date("2025-06-21T14:30:00Z"); // Saturday
        const { start, end } = getBudgetPeriodBoundaries("weekly", testDate);

        expect(start.getDay()).toBe(0);
        // Start should be Sunday the 15th
        expect(start.getDate()).toBe(15);
      });
    });

    describe("monthly periods", () => {
      test("returns correct boundaries for mid-month", () => {
        const testDate = new Date("2025-06-15T14:30:00Z");
        const { start, end } = getBudgetPeriodBoundaries("monthly", testDate);

        // Start should be June 1st
        expect(start.getMonth()).toBe(5);
        expect(start.getDate()).toBe(1);

        // End should be July 1st
        expect(end.getMonth()).toBe(6);
        expect(end.getDate()).toBe(1);
      });

      test("handles first day of month", () => {
        const testDate = new Date("2025-06-01T00:00:00Z");
        const { start, end } = getBudgetPeriodBoundaries("monthly", testDate);

        expect(start.getMonth()).toBe(5);
        expect(start.getDate()).toBe(1);
        expect(end.getMonth()).toBe(6);
      });

      test("handles last day of month", () => {
        const testDate = new Date("2025-06-30T23:59:59Z");
        const { start, end } = getBudgetPeriodBoundaries("monthly", testDate);

        expect(start.getMonth()).toBe(5);
        expect(end.getMonth()).toBe(6);
      });

      test("handles December to January transition", () => {
        const testDate = new Date("2025-12-15T14:30:00Z");
        const { start, end } = getBudgetPeriodBoundaries("monthly", testDate);

        expect(start.getFullYear()).toBe(2025);
        expect(start.getMonth()).toBe(11);
        expect(end.getFullYear()).toBe(2026);
        expect(end.getMonth()).toBe(0);
      });
    });

    describe("yearly periods", () => {
      test("returns correct boundaries for mid-year", () => {
        const testDate = new Date("2025-06-15T14:30:00Z");
        const { start, end } = getBudgetPeriodBoundaries("yearly", testDate);

        expect(start.getFullYear()).toBe(2025);
        expect(start.getMonth()).toBe(0);
        expect(start.getDate()).toBe(1);

        expect(end.getFullYear()).toBe(2026);
        expect(end.getMonth()).toBe(0);
        expect(end.getDate()).toBe(1);
      });

      test("handles January 1st", () => {
        const testDate = new Date("2025-01-01T00:00:00Z");
        const { start, end } = getBudgetPeriodBoundaries("yearly", testDate);

        expect(start.getFullYear()).toBe(2025);
        expect(end.getFullYear()).toBe(2026);
      });

      test("handles December 31st", () => {
        const testDate = new Date("2025-12-31T23:59:59Z");
        const { start, end } = getBudgetPeriodBoundaries("yearly", testDate);

        expect(start.getFullYear()).toBe(2025);
        expect(end.getFullYear()).toBe(2026);
      });
    });
  });

  describe("getDaysRemainingInPeriod", () => {
    test("returns valid range for daily period", () => {
      const days = getDaysRemainingInPeriod("daily");

      // Should be between 0 and 1
      expect(days).toBeGreaterThanOrEqual(0);
      expect(days).toBeLessThanOrEqual(1);
    });

    test("returns valid range for weekly period", () => {
      const days = getDaysRemainingInPeriod("weekly");

      // Should be between 0 and 7
      expect(days).toBeGreaterThanOrEqual(0);
      expect(days).toBeLessThanOrEqual(7);
    });

    test("returns valid range for monthly period", () => {
      const days = getDaysRemainingInPeriod("monthly");

      // Should be between 0 and 31
      expect(days).toBeGreaterThanOrEqual(0);
      expect(days).toBeLessThanOrEqual(31);
    });

    test("returns valid range for yearly period", () => {
      const days = getDaysRemainingInPeriod("yearly");

      // Should be between 0 and 366 (leap year)
      expect(days).toBeGreaterThanOrEqual(0);
      expect(days).toBeLessThanOrEqual(366);
    });
  });
});

// ============================================================================
// Cost Model Validation Tests
// ============================================================================

describe("Cost Models", () => {
  test("DEFAULT_RATE_CARDS has expected providers", async () => {
    const { DEFAULT_RATE_CARDS } = await import("../models/cost");

    const providers = [...new Set(DEFAULT_RATE_CARDS.map((rc) => rc.provider))];
    expect(providers).toContain("anthropic");
    expect(providers).toContain("openai");
    expect(providers).toContain("google");
  });

  test("DEFAULT_RATE_CARDS has valid pricing", async () => {
    const { DEFAULT_RATE_CARDS } = await import("../models/cost");

    for (const card of DEFAULT_RATE_CARDS) {
      expect(card.model).toBeTruthy();
      expect(card.provider).toBeTruthy();
      expect(card.promptCostPer1kTokens).toBeGreaterThanOrEqual(0);
      expect(card.completionCostPer1kTokens).toBeGreaterThanOrEqual(0);
    }
  });

  test("Anthropic models have correct pricing structure", async () => {
    const { DEFAULT_RATE_CARDS } = await import("../models/cost");

    const anthropicCards = DEFAULT_RATE_CARDS.filter(
      (rc) => rc.provider === "anthropic",
    );

    expect(anthropicCards.length).toBeGreaterThan(0);

    // Find Opus (should be most expensive) and Haiku (least expensive)
    const opusCard = anthropicCards.find((rc) => rc.model.includes("opus"));
    const haikuCard = anthropicCards.find((rc) => rc.model.includes("haiku"));

    if (opusCard && haikuCard) {
      // Opus should be more expensive than Haiku
      expect(opusCard.promptCostPer1kTokens).toBeGreaterThan(
        haikuCard.promptCostPer1kTokens,
      );
      expect(opusCard.completionCostPer1kTokens).toBeGreaterThan(
        haikuCard.completionCostPer1kTokens,
      );
    }
  });

  test("Rate cards include caching discounts", async () => {
    const { DEFAULT_RATE_CARDS } = await import("../models/cost");

    const cardsWithCaching = DEFAULT_RATE_CARDS.filter(
      (rc) => rc.cachedPromptCostPer1kTokens !== undefined,
    );

    // Most models should have caching defined
    expect(cardsWithCaching.length).toBeGreaterThan(0);

    // Cached cost should be less than regular prompt cost
    for (const card of cardsWithCaching) {
      if (card.cachedPromptCostPer1kTokens !== undefined) {
        expect(card.cachedPromptCostPer1kTokens).toBeLessThanOrEqual(
          card.promptCostPer1kTokens,
        );
      }
    }
  });
});
