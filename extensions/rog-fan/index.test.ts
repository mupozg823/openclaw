import { describe, expect, it, vi } from "vitest";
import { createTestPluginApi } from "../../test/helpers/extensions/plugin-api.js";

// ── Pure logic tests (no PowerShell, no OS dependency) ──────

describe("rog-fan pure functions", () => {
  it("FAN_MODE_MAP maps 0/1/2 correctly", async () => {
    vi.resetModules();
    const { FAN_MODE_MAP } = await import("./index.js");
    expect(FAN_MODE_MAP["0"]).toBe("silent");
    expect(FAN_MODE_MAP["1"]).toBe("auto");
    expect(FAN_MODE_MAP["2"]).toBe("turbo");
  });

  it("FAN_MODE_TO_REG is inverse of FAN_MODE_MAP", async () => {
    vi.resetModules();
    const { FAN_MODE_MAP, FAN_MODE_TO_REG } = await import("./index.js");
    for (const [reg, mode] of Object.entries(FAN_MODE_MAP)) {
      expect(FAN_MODE_TO_REG[mode]).toBe(reg);
    }
  });

  it("formatHelp includes all commands", async () => {
    vi.resetModules();
    const { formatHelp } = await import("./index.js");
    const text = formatHelp();
    expect(text).toContain("/fan");
    expect(text).toContain("/fan status");
    expect(text).toContain("/fan temp");
    expect(text).toContain("/fan mode");
    expect(text).toContain("/fan profile");
    expect(text).toContain("/fan help");
  });

  it("formatHelp includes auto/silent/turbo mode options", async () => {
    vi.resetModules();
    const { formatHelp } = await import("./index.js");
    const text = formatHelp();
    expect(text).toContain("auto");
    expect(text).toContain("silent");
    expect(text).toContain("turbo");
  });

  it("parseNumber returns number for valid input", async () => {
    vi.resetModules();
    const { parseNumber } = await import("./index.js");
    expect(parseNumber("42")).toBe(42);
    expect(parseNumber("75.5")).toBeCloseTo(75.5);
    expect(parseNumber("0")).toBe(0);
  });

  it("parseNumber returns null for invalid input", async () => {
    vi.resetModules();
    const { parseNumber } = await import("./index.js");
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("abc")).toBeNull();
    expect(parseNumber("NaN")).toBeNull();
    expect(parseNumber("Infinity")).toBeNull();
  });

  it("formatSnapshot renders all fields", async () => {
    vi.resetModules();
    const { formatSnapshot } = await import("./index.js");
    const snapshot = {
      cpuTempC: 68.3,
      gpuTempC: 72.0,
      fanMode: "turbo" as const,
      fanSpeedPct: 85,
      fanControlEnabled: true,
    };
    const text = formatSnapshot(snapshot);
    expect(text).toContain("Fan Mode: TURBO");
    expect(text).toContain("Fan Control: Enabled");
    expect(text).toContain("Fan Speed: 85%");
    expect(text).toContain("CPU Temp: 68°C");
    expect(text).toContain("GPU Temp: 72°C");
  });

  it("formatSnapshot handles null values with N/A", async () => {
    vi.resetModules();
    const { formatSnapshot } = await import("./index.js");
    const snapshot = {
      cpuTempC: null,
      gpuTempC: null,
      fanMode: "auto" as const,
      fanSpeedPct: null,
      fanControlEnabled: false,
    };
    const text = formatSnapshot(snapshot);
    expect(text).toContain("CPU Temp: N/A");
    expect(text).toContain("Fan Speed: N/A");
    expect(text).toContain("Fan Control: Disabled");
  });

  it("FAN_PROFILES has quiet/balanced/aggressive entries", async () => {
    vi.resetModules();
    const { FAN_PROFILES } = await import("./index.js");
    const names = FAN_PROFILES.map((p) => p.name);
    expect(names).toContain("quiet");
    expect(names).toContain("balanced");
    expect(names).toContain("aggressive");
  });

  it("formatProfiles lists all three profiles with mode labels", async () => {
    vi.resetModules();
    const { formatProfiles } = await import("./index.js");
    const text = formatProfiles();
    expect(text).toContain("quiet");
    expect(text).toContain("balanced");
    expect(text).toContain("aggressive");
    expect(text).toContain("SILENT");
    expect(text).toContain("AUTO");
    expect(text).toContain("TURBO");
  });
});

// ── Plugin registration tests ────────────────────────────────

describe("rog-fan plugin", () => {
  it("registers the /fan command", async () => {
    vi.resetModules();
    const { default: plugin } = await import("./index.js");

    let command: any;
    plugin.register(
      createTestPluginApi({
        id: "rog-fan",
        name: "ROG Fan Control",
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

    expect(command?.name).toBe("fan");
    expect(command?.acceptsArgs).toBe(true);
  });

  it("returns help text when no args provided", async () => {
    vi.resetModules();
    const { default: plugin } = await import("./index.js");

    let command: any;
    plugin.register(
      createTestPluginApi({
        id: "rog-fan",
        name: "ROG Fan Control",
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
      commandBody: "/fan",
      args: "",
      config: {},
      requestConversationBinding: async () => ({ status: "error" as const }),
      detachConversationBinding: async () => ({ removed: false }),
      getCurrentConversationBinding: async () => null,
    });

    const text = String(result?.text ?? "");
    expect(text).toContain("ROG Fan Control commands");
    expect(text).toContain("/fan temp");
    expect(text).toContain("/fan mode");
  });

  it("returns help text for /fan help", async () => {
    vi.resetModules();
    const { default: plugin } = await import("./index.js");

    let command: any;
    plugin.register(
      createTestPluginApi({
        id: "rog-fan",
        name: "ROG Fan Control",
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
      commandBody: "/fan help",
      args: "help",
      config: {},
      requestConversationBinding: async () => ({ status: "error" as const }),
      detachConversationBinding: async () => ({ removed: false }),
      getCurrentConversationBinding: async () => null,
    });

    const text = String(result?.text ?? "");
    expect(text).toContain("ROG Fan Control commands");
    expect(text).toContain("/fan mode <auto|silent|turbo>");
  });

  it("rejects invalid fan mode with usage hint", async () => {
    vi.resetModules();
    const { default: plugin } = await import("./index.js");

    let command: any;
    plugin.register(
      createTestPluginApi({
        id: "rog-fan",
        name: "ROG Fan Control",
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
      commandBody: "/fan mode extreme",
      args: "mode extreme",
      config: {},
      requestConversationBinding: async () => ({ status: "error" as const }),
      detachConversationBinding: async () => ({ removed: false }),
      getCurrentConversationBinding: async () => null,
    });

    const text = String(result?.text ?? "");
    expect(text).toContain("Usage:");
    expect(text).toContain("auto|silent|turbo");
  });
});
