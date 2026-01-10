export interface MockAgentEvent {
  type: string;
  payload?: Record<string, unknown>;
  timestamp: string;
}

export interface MockAgentDriver {
  driverId: string;
  driverType: "mock";
  events: MockAgentEvent[];
  pushEvent: (event: Omit<MockAgentEvent, "timestamp">) => MockAgentEvent;
}

export function mockAgentDriver(driverId = "mock-driver"): MockAgentDriver {
  const events: MockAgentEvent[] = [];
  return {
    driverId,
    driverType: "mock",
    events,
    pushEvent: (event) => {
      const entry: MockAgentEvent = {
        ...event,
        timestamp: new Date().toISOString(),
      };
      events.push(entry);
      return entry;
    },
  };
}

export function createTestAgent(agentId = "agent-test-1") {
  return {
    id: agentId,
    status: "ready" as const,
    model: "test-model",
    createdAt: new Date().toISOString(),
  };
}

export function simulateAgentOutput(output: string) {
  return {
    output,
    timestamp: new Date().toISOString(),
  };
}
