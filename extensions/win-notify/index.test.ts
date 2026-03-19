import { describe, expect, it, vi } from "vitest";
import { createTestPluginApi } from "../../test/helpers/extensions/plugin-api.js";

describe("win-notify plugin", () => {
  it("registers the /notify command", async () => {
    vi.resetModules();
    const { default: plugin } = await import("./index.js");

    let command: any;
    plugin.register(
      createTestPluginApi({
        id: "win-notify",
        name: "Windows Notifications",
        source: "test",
        config: {},
        pluginConfig: {},
        runtime: {
          state: { resolveStateDir: () => "/tmp" },
          config: { loadConfig: () => ({}), writeConfigFile: async () => {} },
        } as any,
        registerCommand: (cmd: any) => { command = cmd; },
      }),
    );

    expect(command?.name).toBe("notify");
    expect(command?.acceptsArgs).toBe(true);
  });

  it("returns help text with all commands", async () => {
    vi.resetModules();
    const { default: plugin } = await import("./index.js");

    let command: any;
    plugin.register(
      createTestPluginApi({
        id: "win-notify",
        name: "Windows Notifications",
        source: "test",
        config: {},
        pluginConfig: {},
        runtime: {
          state: { resolveStateDir: () => "/tmp" },
          config: { loadConfig: () => ({}), writeConfigFile: async () => {} },
        } as any,
        registerCommand: (cmd: any) => { command = cmd; },
      }),
    );

    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      commandBody: "/notify help",
      args: "help",
      config: {},
      requestConversationBinding: async () => ({ status: "error" as const }),
      detachConversationBinding: async () => ({ removed: false }),
      getCurrentConversationBinding: async () => null,
    });

    const text = String(result?.text ?? "");
    expect(text).toContain("/notify");
    expect(text).toContain("remind");
    expect(text).toContain("history");
  });

  it("parseDuration handles various formats", async () => {
    vi.resetModules();
    const { parseDuration } = await import("./index.js");

    expect(parseDuration("30s")).toBe(30);
    expect(parseDuration("5m")).toBe(300);
    expect(parseDuration("5min")).toBe(300);
    expect(parseDuration("1h")).toBe(3600);
    expect(parseDuration("1hr")).toBe(3600);
    expect(parseDuration("abc")).toBeNull();
    expect(parseDuration("")).toBeNull();
  });

  it("escapeXml escapes special characters", async () => {
    vi.resetModules();
    const { escapeXml } = await import("./index.js");

    expect(escapeXml("<test>")).toBe("&lt;test&gt;");
    expect(escapeXml('a&b"c')).toContain("&amp;");
    expect(escapeXml('a&b"c')).toContain("&quot;");
  });
});
