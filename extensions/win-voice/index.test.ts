import { describe, expect, it, vi } from "vitest";
import { createTestPluginApi } from "../../test/helpers/extensions/plugin-api.js";

describe("win-voice plugin", () => {
  it("registers the /voice command", async () => {
    vi.resetModules();
    const { default: plugin } = await import("./index.js");

    let command: any;
    plugin.register(
      createTestPluginApi({
        id: "win-voice",
        name: "Windows Voice I/O",
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

    expect(command?.name).toBe("voice");
    expect(command?.acceptsArgs).toBe(true);
  });

  it("returns help text with all commands", async () => {
    vi.resetModules();
    const { default: plugin } = await import("./index.js");

    let command: any;
    plugin.register(
      createTestPluginApi({
        id: "win-voice",
        name: "Windows Voice I/O",
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
      commandBody: "/voice help",
      args: "help",
      config: {},
      requestConversationBinding: async () => ({ status: "error" as const }),
      detachConversationBinding: async () => ({ removed: false }),
      getCurrentConversationBinding: async () => null,
    });

    const text = String(result?.text ?? "");
    expect(text).toContain("/voice say");
    expect(text).toContain("/voice listen");
    expect(text).toContain("/voice save");
    expect(text).toContain("/voice voices");
  });

  it("formatVoiceList handles empty array", async () => {
    vi.resetModules();
    const { formatVoiceList } = await import("./index.js");

    expect(formatVoiceList([])).toBe("No TTS voices installed.");
  });

  it("formatVoiceList formats voices correctly", async () => {
    vi.resetModules();
    const { formatVoiceList } = await import("./index.js");

    const voices = [
      { name: "Microsoft Zira Desktop", culture: "en-US", gender: "Female" },
      { name: "Microsoft Heami Desktop", culture: "ko-KR", gender: "Female" },
    ];
    const result = formatVoiceList(voices);
    expect(result).toContain("Installed voices (2)");
    expect(result).toContain("Zira");
    expect(result).toContain("ko-KR");
  });
});
