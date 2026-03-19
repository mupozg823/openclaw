import { describe, expect, it, vi } from "vitest";
import { createTestPluginApi } from "../../test/helpers/extensions/plugin-api.js";

// ── PRESETS tests ─────────────────────────────────────────────

describe("rog-control-center PRESETS", () => {
  it("has exactly 4 presets", async () => {
    vi.resetModules();
    const { PRESETS } = await import("./index.js");
    expect(Object.keys(PRESETS)).toHaveLength(4);
  });

  it("contains gaming, battery, quiet, presentation presets", async () => {
    vi.resetModules();
    const { PRESETS } = await import("./index.js");
    expect(PRESETS).toHaveProperty("gaming");
    expect(PRESETS).toHaveProperty("battery");
    expect(PRESETS).toHaveProperty("quiet");
    expect(PRESETS).toHaveProperty("presentation");
  });

  it("every preset has a powerProfile field", async () => {
    vi.resetModules();
    const { PRESETS } = await import("./index.js");
    for (const [key, cfg] of Object.entries(PRESETS)) {
      expect(cfg, `preset "${key}" missing powerProfile`).toHaveProperty("powerProfile");
      expect(typeof cfg.powerProfile).toBe("string");
      expect(cfg.powerProfile.length).toBeGreaterThan(0);
    }
  });

  it("gaming preset uses turbo power profile", async () => {
    vi.resetModules();
    const { PRESETS } = await import("./index.js");
    expect(PRESETS.gaming.powerProfile).toBe("turbo");
  });

  it("battery preset uses silent power profile", async () => {
    vi.resetModules();
    const { PRESETS } = await import("./index.js");
    expect(PRESETS.battery.powerProfile).toBe("silent");
  });

  it("quiet preset uses silent power profile", async () => {
    vi.resetModules();
    const { PRESETS } = await import("./index.js");
    expect(PRESETS.quiet.powerProfile).toBe("silent");
  });

  it("presentation preset uses performance power profile", async () => {
    vi.resetModules();
    const { PRESETS } = await import("./index.js");
    expect(PRESETS.presentation.powerProfile).toBe("performance");
  });
});

// ── formatHelp tests ──────────────────────────────────────────

describe("rog-control-center formatHelp", () => {
  it("contains all command names", async () => {
    vi.resetModules();
    const { formatHelp } = await import("./index.js");
    const text = formatHelp();
    expect(text).toContain("/cc");
    expect(text).toContain("preset");
    expect(text).toContain("presets");
    expect(text).toContain("health");
    expect(text).toContain("plugins");
    expect(text).toContain("help");
  });

  it("lists all four preset names in help text", async () => {
    vi.resetModules();
    const { formatHelp } = await import("./index.js");
    const text = formatHelp();
    expect(text).toContain("gaming");
    expect(text).toContain("battery");
    expect(text).toContain("quiet");
    expect(text).toContain("presentation");
  });
});

// ── Command registration tests ────────────────────────────────

describe("rog-control-center plugin", () => {
  it("registers the /cc command", async () => {
    vi.resetModules();
    const { default: plugin } = await import("./index.js");

    let command: any;
    plugin.register(
      createTestPluginApi({
        id: "rog-control-center",
        name: "ROG Control Center",
        source: "test",
        config: {},
        pluginConfig: {},
        runtime: {
          state: { resolveStateDir: () => "/tmp" },
          config: { loadConfig: () => ({}), writeConfigFile: async () => {} },
        } as any,
        registerCommand: (cmd: any) => {
          command = cmd;
        },
      }),
    );

    expect(command?.name).toBe("cc");
    expect(command?.acceptsArgs).toBe(true);
  });

  it("returns help text for /cc help", async () => {
    vi.resetModules();
    const { default: plugin } = await import("./index.js");

    let command: any;
    plugin.register(
      createTestPluginApi({
        id: "rog-control-center",
        name: "ROG Control Center",
        source: "test",
        config: {},
        pluginConfig: {},
        runtime: {
          state: { resolveStateDir: () => "/tmp" },
          config: { loadConfig: () => ({}), writeConfigFile: async () => {} },
        } as any,
        registerCommand: (cmd: any) => {
          command = cmd;
        },
      }),
    );

    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      commandBody: "/cc help",
      args: "help",
      config: {},
      requestConversationBinding: async () => ({ status: "error" as const }),
      detachConversationBinding: async () => ({ removed: false }),
      getCurrentConversationBinding: async () => null,
    });

    const text = String(result?.text ?? "");
    expect(text).toContain("ROG Control Center commands");
    expect(text).toContain("/cc");
    expect(text).toContain("preset");
    expect(text).toContain("health");
    expect(text).toContain("plugins");
  });

  it("returns preset info for /cc presets", async () => {
    vi.resetModules();
    const { default: plugin } = await import("./index.js");

    let command: any;
    plugin.register(
      createTestPluginApi({
        id: "rog-control-center",
        name: "ROG Control Center",
        source: "test",
        config: {},
        pluginConfig: {},
        runtime: {
          state: { resolveStateDir: () => "/tmp" },
          config: { loadConfig: () => ({}), writeConfigFile: async () => {} },
        } as any,
        registerCommand: (cmd: any) => {
          command = cmd;
        },
      }),
    );

    const result = await command.handler({
      channel: "test",
      isAuthorizedSender: true,
      commandBody: "/cc presets",
      args: "presets",
      config: {},
      requestConversationBinding: async () => ({ status: "error" as const }),
      detachConversationBinding: async () => ({ removed: false }),
      getCurrentConversationBinding: async () => null,
    });

    const text = String(result?.text ?? "");
    expect(text).toContain("gaming");
    expect(text).toContain("battery");
    expect(text).toContain("quiet");
    expect(text).toContain("presentation");
  });
});
