import { describe, expect, it, vi } from "vitest";
import { createTestPluginApi } from "../../test/helpers/extensions/plugin-api.js";

// ── Command registration ─────────────────────────────────────

describe("win-gamepad plugin", () => {
  it("registers the /gamepad command", async () => {
    vi.resetModules();
    const { default: plugin } = await import("./index.js");

    let command: any;
    plugin.register(
      createTestPluginApi({
        id: "win-gamepad",
        name: "Gamepad Commander",
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

    expect(command?.name).toBe("gamepad");
    expect(command?.acceptsArgs).toBe(true);
  });

  it("returns help text for /gamepad help", async () => {
    vi.resetModules();
    const { default: plugin } = await import("./index.js");

    let command: any;
    plugin.register(
      createTestPluginApi({
        id: "win-gamepad",
        name: "Gamepad Commander",
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
      commandBody: "/gamepad help",
      args: "help",
      config: {},
      requestConversationBinding: async () => ({ status: "error" as const }),
      detachConversationBinding: async () => ({ removed: false }),
      getCurrentConversationBinding: async () => null,
    });

    const text = String(result?.text ?? "");
    expect(text).toContain("/gamepad status");
    expect(text).toContain("/gamepad bindings");
    expect(text).toContain("/gamepad bind");
    expect(text).toContain("/gamepad unbind");
    expect(text).toContain("/gamepad reset");
    expect(text).toContain("/gamepad poll");
  });
});

// ── formatHelp ───────────────────────────────────────────────

describe("win-gamepad formatHelp", () => {
  it("includes all subcommands and button list", async () => {
    vi.resetModules();
    const { formatHelp } = await import("./index.js");
    const text = formatHelp();
    expect(text).toContain("Gamepad Commander commands");
    expect(text).toContain("/gamepad status");
    expect(text).toContain("/gamepad bindings");
    expect(text).toContain("/gamepad bind");
    expect(text).toContain("/gamepad unbind");
    expect(text).toContain("/gamepad reset");
    expect(text).toContain("/gamepad poll");
    expect(text).toContain("DpadUp");
    expect(text).toContain("DpadDown");
  });
});

// ── DEFAULT_BINDINGS ─────────────────────────────────────────

describe("win-gamepad DEFAULT_BINDINGS", () => {
  it("every binding has button, command, and description fields", async () => {
    vi.resetModules();
    const { DEFAULT_BINDINGS } = await import("./index.js");
    expect(DEFAULT_BINDINGS.length).toBeGreaterThan(0);
    for (const binding of DEFAULT_BINDINGS) {
      expect(typeof binding.button).toBe("string");
      expect(binding.button.length).toBeGreaterThan(0);
      expect(typeof binding.command).toBe("string");
      expect(binding.command.startsWith("/")).toBe(true);
      expect(typeof binding.description).toBe("string");
      expect(binding.description.length).toBeGreaterThan(0);
    }
  });

  it("contains expected ROG Ally X default mappings", async () => {
    vi.resetModules();
    const { DEFAULT_BINDINGS } = await import("./index.js");
    const byButton = Object.fromEntries(DEFAULT_BINDINGS.map((b) => [b.button, b.command]));
    expect(byButton["Y"]).toBe("/overlay");
    expect(byButton["X"]).toBe("/rog status");
    expect(byButton["LB"]).toBe("/desktop left");
    expect(byButton["RB"]).toBe("/desktop right");
    expect(byButton["Back"]).toBe("/fan status");
    expect(byButton["Start"]).toBe("/auto scan");
    expect(byButton["DpadUp"]).toBe("/aura bright 3");
    expect(byButton["DpadDown"]).toBe("/aura bright 0");
  });
});

// ── BUTTON_MAP ───────────────────────────────────────────────

describe("win-gamepad BUTTON_MAP", () => {
  it("contains all 14 standard XInput buttons (no triggers)", async () => {
    vi.resetModules();
    const { BUTTON_MAP } = await import("./index.js");
    const names = Object.values(BUTTON_MAP);
    // 14 bitmask-based buttons (LT/RT are analog, not in wButtons)
    expect(names).toHaveLength(14);
  });

  it("maps correct bitmasks for face buttons", async () => {
    vi.resetModules();
    const { BUTTON_MAP } = await import("./index.js");
    expect(BUTTON_MAP[0x1000]).toBe("A");
    expect(BUTTON_MAP[0x2000]).toBe("B");
    expect(BUTTON_MAP[0x4000]).toBe("X");
    expect(BUTTON_MAP[0x8000]).toBe("Y");
  });

  it("maps correct bitmasks for shoulder and stick buttons", async () => {
    vi.resetModules();
    const { BUTTON_MAP } = await import("./index.js");
    expect(BUTTON_MAP[0x0100]).toBe("LB");
    expect(BUTTON_MAP[0x0200]).toBe("RB");
    expect(BUTTON_MAP[0x0040]).toBe("LSB");
    expect(BUTTON_MAP[0x0080]).toBe("RSB");
  });

  it("maps correct bitmasks for D-pad", async () => {
    vi.resetModules();
    const { BUTTON_MAP } = await import("./index.js");
    expect(BUTTON_MAP[0x0001]).toBe("DpadUp");
    expect(BUTTON_MAP[0x0002]).toBe("DpadDown");
    expect(BUTTON_MAP[0x0004]).toBe("DpadLeft");
    expect(BUTTON_MAP[0x0008]).toBe("DpadRight");
  });

  it("maps correct bitmasks for Start and Back", async () => {
    vi.resetModules();
    const { BUTTON_MAP } = await import("./index.js");
    expect(BUTTON_MAP[0x0010]).toBe("Start");
    expect(BUTTON_MAP[0x0020]).toBe("Back");
  });

  it("covers all 16 GamepadButton variants when combined with LT/RT", async () => {
    vi.resetModules();
    const { BUTTON_MAP } = await import("./index.js");
    // 14 from BUTTON_MAP + LT + RT = 16 total
    const fromMap = Object.values(BUTTON_MAP) as string[];
    const allButtons = [...fromMap, "LT", "RT"];
    const expected = [
      "A", "B", "X", "Y",
      "LB", "RB", "LT", "RT",
      "Back", "Start", "LSB", "RSB",
      "DpadUp", "DpadDown", "DpadLeft", "DpadRight",
    ];
    expect(allButtons.sort()).toEqual(expected.sort());
  });
});
