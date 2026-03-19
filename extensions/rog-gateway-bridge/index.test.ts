import { describe, expect, it, vi } from "vitest";
import { createTestPluginApi } from "../../test/helpers/extensions/plugin-api.js";

describe("rog-gateway-bridge plugin", () => {
  it("registers the /bridge command", async () => {
    vi.resetModules();
    const { default: plugin } = await import("./index.js");

    let command: any;
    plugin.register(
      createTestPluginApi({
        id: "rog-gateway-bridge",
        name: "ROG Gateway Bridge",
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

    expect(command?.name).toBe("bridge");
    expect(command?.acceptsArgs).toBe(true);
  });

  it("returns help with all commands", async () => {
    vi.resetModules();
    const { default: plugin } = await import("./index.js");

    let command: any;
    plugin.register(
      createTestPluginApi({
        id: "rog-gateway-bridge",
        name: "ROG Gateway Bridge",
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
      commandBody: "/bridge help",
      args: "help",
      config: {},
      requestConversationBinding: async () => ({ status: "error" as const }),
      detachConversationBinding: async () => ({ removed: false }),
      getCurrentConversationBinding: async () => null,
    });

    const text = String(result?.text ?? "");
    expect(text).toContain("/bridge methods");
    expect(text).toContain("/bridge tray");
    expect(text).toContain("/bridge rog");
  });

  it("GATEWAY_METHODS has expected methods", async () => {
    vi.resetModules();
    const { GATEWAY_METHODS } = await import("./index.js");

    expect(GATEWAY_METHODS).toHaveProperty("tray.status");
    expect(GATEWAY_METHODS).toHaveProperty("rog.status");
    expect(GATEWAY_METHODS).toHaveProperty("rog.setProfile");
    expect(GATEWAY_METHODS).toHaveProperty("system.exec");
    expect(Object.keys(GATEWAY_METHODS).length).toBe(4);
  });

  it("rejects non-Get commands for exec", async () => {
    vi.resetModules();
    const { default: plugin } = await import("./index.js");

    let command: any;
    plugin.register(
      createTestPluginApi({
        id: "rog-gateway-bridge",
        name: "ROG Gateway Bridge",
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
      commandBody: "/bridge exec Set-ItemProperty foo",
      args: "exec Set-ItemProperty foo",
      config: {},
      requestConversationBinding: async () => ({ status: "error" as const }),
      detachConversationBinding: async () => ({ removed: false }),
      getCurrentConversationBinding: async () => null,
    });

    expect(String(result?.text ?? "")).toContain("only Get-* commands allowed");
  });
});
