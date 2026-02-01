import { describe, expect, test } from "bun:test";
import { calculateCompositeHealthScore } from "../services/agent-health-score.service";

describe("AgentHealthScoreService - composite scoring", () => {
  test("returns 100 when all components are healthy", () => {
    const { score, componentScores } = calculateCompositeHealthScore({
      contextUtilization: 0,
      costBurnRate: 1,
      stateHealth: 100,
      errorRate: 0,
      reservationConflicts: 0,
    });

    expect(score).toBe(100);
    expect(componentScores.contextScore).toBe(100);
    expect(componentScores.costScore).toBe(100);
    expect(componentScores.stateScore).toBe(100);
    expect(componentScores.errorScore).toBe(100);
    expect(componentScores.conflictScore).toBe(100);
  });

  test("penalizes fully utilized context headroom", () => {
    const { score } = calculateCompositeHealthScore({
      contextUtilization: 100,
      costBurnRate: 1,
      stateHealth: 100,
      errorRate: 0,
      reservationConflicts: 0,
    });

    // contextScore=0 contributes 0.25*0, others are 100 → 75 total
    expect(score).toBe(75);
  });

  test("penalizes errors per minute", () => {
    const { score } = calculateCompositeHealthScore({
      contextUtilization: 0,
      costBurnRate: 1,
      stateHealth: 100,
      errorRate: 3,
      reservationConflicts: 0,
    });

    // errorScore = 100 - 3*20 = 40; weighted total = 25+20+25+8+10 = 88
    expect(score).toBe(88);
  });
});
