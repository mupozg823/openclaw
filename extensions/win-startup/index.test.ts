import { describe, expect, it, vi } from "vitest";
import { createTestPluginApi } from "../../test/helpers/extensions/plugin-api.js";

describe("win-startup plugin", () => {
  it("registers the /system command", async () => {
    vi.resetModules();
    const { default: plugin } = await import("./index.js");

    let command: any;
    plugin.register(
      createTestPluginApi({
        id: "win-startup",
        name: "Windows OS Integration",
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

    expect(command?.name).toBe("system");
    expect(command?.acceptsArgs).toBe(true);
  });

  it("returns help text containing autostart, services, and diag sections", async () => {
    vi.resetModules();
    const { formatHelp } = await import("./index.js");

    const text = formatHelp();
    expect(text).toContain("Windows OS Integration commands");
    expect(text).toContain("/system autostart");
    expect(text).toContain("/system services");
    expect(text).toContain("/system diag");
    expect(text).toContain("/system uptime");
  });

  it("returns help text when /system help is invoked", async () => {
    vi.resetModules();
    const { default: plugin } = await import("./index.js");

    let command: any;
    plugin.register(
      createTestPluginApi({
        id: "win-startup",
        name: "Windows OS Integration",
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
      commandBody: "/system help",
      args: "help",
      config: {},
      requestConversationBinding: async () => ({ status: "error" as const }),
      detachConversationBinding: async () => ({ removed: false }),
      getCurrentConversationBinding: async () => null,
    });

    const text = String(result?.text ?? "");
    expect(text).toContain("Windows OS Integration commands");
    expect(text).toContain("/system autostart on");
    expect(text).toContain("/system autostart off");
    expect(text).toContain("/system services");
    expect(text).toContain("/system diag");
  });
});
