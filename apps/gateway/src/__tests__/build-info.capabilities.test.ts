import { afterEach, describe, expect, it } from "bun:test";
import { getCapabilities } from "../services/build-info";

const savedEnv: Record<string, string | undefined> = {};

function setEnv(key: string, value: string): void {
  if (!(key in savedEnv)) savedEnv[key] = process.env[key];
  process.env[key] = value;
}

function clearEnv(key: string): void {
  if (!(key in savedEnv)) savedEnv[key] = process.env[key];
  delete process.env[key];
}

function restoreEnv(): void {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const key of Object.keys(savedEnv)) {
    delete savedEnv[key];
  }
}

afterEach(() => {
  restoreEnv();
});

describe("build-info capabilities", () => {
  it("reports agentMail=false when no Agent Mail env vars are set", async () => {
    clearEnv("AGENT_MAIL_MCP_ENABLED");
    clearEnv("AGENT_MAIL_MCP_COMMAND");
    clearEnv("AGENTMAIL_URL");

    expect(getCapabilities().agentMail).toBe(false);
  });

  it("reports agentMail=true when AGENT_MAIL_MCP_ENABLED=true", async () => {
    setEnv("AGENT_MAIL_MCP_ENABLED", "true");
    clearEnv("AGENT_MAIL_MCP_COMMAND");
    clearEnv("AGENTMAIL_URL");

    expect(getCapabilities().agentMail).toBe(true);
  });

  it("reports agentMail=true when AGENT_MAIL_MCP_COMMAND is set", async () => {
    clearEnv("AGENT_MAIL_MCP_ENABLED");
    setEnv("AGENT_MAIL_MCP_COMMAND", "mcp-agent-mail");
    clearEnv("AGENTMAIL_URL");

    expect(getCapabilities().agentMail).toBe(true);
  });

  it("reports agentMail=true when legacy AGENTMAIL_URL is set", async () => {
    clearEnv("AGENT_MAIL_MCP_ENABLED");
    clearEnv("AGENT_MAIL_MCP_COMMAND");
    setEnv("AGENTMAIL_URL", "http://127.0.0.1:8765");

    expect(getCapabilities().agentMail).toBe(true);
  });
});
