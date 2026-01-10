import type { CommandRegistry, RegisteredCommand } from "../types";

/**
 * Generated WebSocket event type.
 */
export interface GeneratedWsEvent {
  /** Event name */
  name: string;
  /** Source command */
  sourceCommand: string;
  /** Whether this event supports subscription */
  subscribable: boolean;
}

/**
 * Generate WebSocket event definitions from the command registry.
 */
export function generateWsEvents(
  registry: CommandRegistry,
): GeneratedWsEvent[] {
  const events: GeneratedWsEvent[] = [];
  const seenEvents = new Set<string>();

  for (const cmd of registry.all()) {
    if (cmd.ws) {
      for (const eventName of cmd.ws.emitsEvents) {
        if (!seenEvents.has(eventName)) {
          seenEvents.add(eventName);
          events.push({
            name: eventName,
            sourceCommand: cmd.name,
            subscribable: cmd.ws.subscribable ?? false,
          });
        }
      }
    }
  }

  return events;
}

/**
 * Convert event name to TypeScript type name.
 * e.g., "agent:spawning" -> "AgentSpawning"
 */
function eventNameToTypeName(eventName: string): string {
  return eventName
    .split(/[:\-_.]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");
}

/**
 * Generate TypeScript event type definitions for WebSocket.
 */
export function generateWsTypeDefinitions(registry: CommandRegistry): string {
  const events = generateWsEvents(registry);

  if (events.length === 0) {
    return "// No WebSocket events defined\nexport type WsEvent = never;";
  }

  const lines: string[] = [
    "// Generated WebSocket event types",
    "",
    "export type WsEventType =",
  ];

  // Add event type literals
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const suffix = i === events.length - 1 ? ";" : "";
    if (event) {
      lines.push("  | '" + event.name + "'" + suffix);
    }
  }

  lines.push("");
  lines.push("export interface WsEventBase {");
  lines.push("  type: WsEventType;");
  lines.push("  timestamp: string;");
  lines.push("  correlationId?: string;");
  lines.push("}");

  // Generate specific event interfaces
  for (const event of events) {
    const typeName = eventNameToTypeName(event.name);
    lines.push("");
    lines.push("/** Event from " + event.sourceCommand + " */");
    lines.push("export interface " + typeName + "Event extends WsEventBase {");
    lines.push("  type: '" + event.name + "';");
    lines.push("  payload: unknown; // Schema to be defined per event");
    lines.push("}");
  }

  // Union type
  lines.push("");
  lines.push("export type WsEvent =");
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (event) {
      const typeName = eventNameToTypeName(event.name);
      const suffix = i === events.length - 1 ? ";" : "";
      lines.push("  | " + typeName + "Event" + suffix);
    }
  }

  return lines.join("\n");
}

/**
 * Get subscribable events for documentation.
 */
export function getSubscribableEvents(
  registry: CommandRegistry,
): Array<{ name: string; sourceCommand: string }> {
  return generateWsEvents(registry)
    .filter((e) => e.subscribable)
    .map((e) => ({ name: e.name, sourceCommand: e.sourceCommand }));
}
