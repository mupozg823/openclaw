import { describe, expect, it, vi } from "vitest";
import { createTestPluginApi } from "../../test/helpers/extensions/plugin-api.js";

describe("rog-hardware plugin", () => {
  it("registers the /rog command", async () => {
    vi.resetModules();

    const { default: plugin } = await import("./index.js");

    let command: any;
    const testApi = createTestPluginApi({
      id: "rog-hardware",
      name: "ROG Hardware Control",
      source: "test",
      config: {},
      pluginConfig: {},
      runtime: {
        state: { resolveStateDir: () => "/tmp" },
        config: {
          loadConfig: () => ({}),
          writeConfigFile: async () => {},
        },
      } as any,
      registerCommand: (cmd: any) => {
        command = cmd;
      },
    });

    plugin.register(testApi);

    expect(command?.name).toBe("rog");
    expect(command?.acceptsArgs).toBe(true);
  });

  it("returns help text when no args provided", async () => {
    vi.resetModules();

    const { default: plugin } = await import("./index.js");

    let command: any;
    const testApi = createTestPluginApi({
      id: "rog-hardware",
      name: "ROG Hardware Control",
      source: "test",
      config: {},
      pluginConfig: {},
      runtime: {
        state: { resolveStateDir: () => "/tmp" },
        config: {
          loadConfig: () => ({}),
          writeConfigFile: async () => {},
        },
      } as any,
      registerCommand: (cmd: any) => {
        command = cmd;
      },
    });

    plugin.register(testApi);

    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      commandBody: "/rog",
      args: "",
      config: {},
      requestConversationBinding: async () => ({ status: "error" as const }),
      detachConversationBinding: async () => ({ removed: false }),
      getCurrentConversationBinding: async () => null,
    });

    const text = String(result?.text ?? "");
    expect(text).toContain("ROG Hardware commands");
    expect(text).toContain("/rog status");
    expect(text).toContain("/rog profile");
  });

  it("shows help for help subcommand", async () => {
    vi.resetModules();

    const { default: plugin } = await import("./index.js");

    let command: any;
    const testApi = createTestPluginApi({
      id: "rog-hardware",
      name: "ROG Hardware Control",
      source: "test",
      config: {},
      pluginConfig: {},
      runtime: {
        state: { resolveStateDir: () => "/tmp" },
        config: {
          loadConfig: () => ({}),
          writeConfigFile: async () => {},
        },
      } as any,
      registerCommand: (cmd: any) => {
        command = cmd;
      },
    });

    plugin.register(testApi);

    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      commandBody: "/rog help",
      args: "help",
      config: {},
      requestConversationBinding: async () => ({ status: "error" as const }),
      detachConversationBinding: async () => ({ removed: false }),
      getCurrentConversationBinding: async () => null,
    });

    const text = String(result?.text ?? "");
    expect(text).toContain("/rog battery");
  });
});
