import { describe, expect, it, vi } from "vitest";
import { createTestPluginApi } from "../../test/helpers/extensions/plugin-api.js";

describe("rog-aura plugin", () => {
  it("registers the /aura command", async () => {
    vi.resetModules();
    const { default: plugin } = await import("./index.js");

    let command: any;
    plugin.register(
      createTestPluginApi({
        id: "rog-aura",
        name: "ROG Aura Sync RGB",
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

    expect(command?.name).toBe("aura");
    expect(command?.acceptsArgs).toBe(true);
  });

  it("returns help with modes and colors", async () => {
    vi.resetModules();
    const { default: plugin } = await import("./index.js");

    let command: any;
    plugin.register(
      createTestPluginApi({
        id: "rog-aura",
        name: "ROG Aura Sync RGB",
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
      commandBody: "/aura help",
      args: "help",
      config: {},
      requestConversationBinding: async () => ({ status: "error" as const }),
      detachConversationBinding: async () => ({ removed: false }),
      getCurrentConversationBinding: async () => null,
    });

    const text = String(result?.text ?? "");
    expect(text).toContain("/aura mode");
    expect(text).toContain("/aura color");
    expect(text).toContain("rog");
  });

  it("NAMED_COLORS has valid hex values", async () => {
    vi.resetModules();
    const { NAMED_COLORS } = await import("./index.js");

    for (const [, hex] of Object.entries(NAMED_COLORS)) {
      expect(hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
    expect(NAMED_COLORS.rog).toBe("#FF4655");
  });

  it("MODE_TO_VALUE covers all modes", async () => {
    vi.resetModules();
    const { MODE_TO_VALUE } = await import("./index.js");

    expect(MODE_TO_VALUE).toHaveProperty("static");
    expect(MODE_TO_VALUE).toHaveProperty("breathing");
    expect(MODE_TO_VALUE).toHaveProperty("off");
    expect(Object.keys(MODE_TO_VALUE).length).toBe(6);
  });
});
