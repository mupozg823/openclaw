import { describe, expect, it, vi } from "vitest";
import { createTestPluginApi } from "../../test/helpers/extensions/plugin-api.js";

describe("win-desktop plugin", () => {
  it("registers the /desktop command", async () => {
    vi.resetModules();
    const { default: plugin } = await import("./index.js");

    let command: any;
    plugin.register(
      createTestPluginApi({
        id: "win-desktop",
        name: "Windows Desktop Control",
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

    expect(command?.name).toBe("desktop");
    expect(command?.acceptsArgs).toBe(true);
  });

  it("returns help text with all sections", async () => {
    vi.resetModules();
    const { default: plugin } = await import("./index.js");

    let command: any;
    plugin.register(
      createTestPluginApi({
        id: "win-desktop",
        name: "Windows Desktop Control",
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
      commandBody: "/desktop help",
      args: "help",
      config: {},
      requestConversationBinding: async () => ({ status: "error" as const }),
      detachConversationBinding: async () => ({ removed: false }),
      getCurrentConversationBinding: async () => null,
    });

    const text = String(result?.text ?? "");
    expect(text).toContain("Virtual Desktops");
    expect(text).toContain("Monitors");
    expect(text).toContain("snap");
    expect(text).toContain("cascade");
  });

  it("formatDesktopList handles current desktop marker", async () => {
    vi.resetModules();
    const { formatDesktopList } = await import("./index.js");

    const desktops = [
      { index: 1, name: "Work", isCurrent: false },
      { index: 2, name: "Gaming", isCurrent: true },
    ];
    const result = formatDesktopList(desktops);
    expect(result).toContain("→");
    expect(result).toContain("Gaming");
    expect(result).toContain("(current)");
    expect(result).toContain("Virtual Desktops (2)");
  });

  it("formatMonitorList shows primary marker", async () => {
    vi.resetModules();
    const { formatMonitorList } = await import("./index.js");

    const monitors = [
      { name: "DISPLAY1", resolution: "1920x1080", primary: true, position: "0,0" },
    ];
    const result = formatMonitorList(monitors);
    expect(result).toContain("★");
    expect(result).toContain("[primary]");
    expect(result).toContain("1920x1080");
  });

  it("formatWindowList truncates long titles", async () => {
    vi.resetModules();
    const { formatWindowList } = await import("./index.js");

    const windows = [
      { title: "A".repeat(60), pid: 1234, processName: "test" },
    ];
    const result = formatWindowList(windows);
    expect(result).toContain("...");
    expect(result).toContain("PID 1234");
  });
});
