import { describe, expect, it, vi } from "vitest";
import { createTestPluginApi } from "../../test/helpers/extensions/plugin-api.js";

// ── Pure logic tests (no PowerShell, no OS dependency) ──────

describe("rog-hardware pure functions", () => {
  it("parseNumber returns number for valid input", async () => {
    vi.resetModules();
    const { parseNumber } = await import("./index.js");
    expect(parseNumber("42")).toBe(42);
    expect(parseNumber("3.14")).toBeCloseTo(3.14);
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

  it("POWER_MODE_MAP maps 0/1/2 correctly", async () => {
    vi.resetModules();
    const { POWER_MODE_MAP } = await import("./index.js");
    expect(POWER_MODE_MAP["0"]).toBe("silent");
    expect(POWER_MODE_MAP["1"]).toBe("performance");
    expect(POWER_MODE_MAP["2"]).toBe("turbo");
  });

  it("formatHelp includes all commands", async () => {
    vi.resetModules();
    const { formatHelp } = await import("./index.js");
    const text = formatHelp();
    expect(text).toContain("/rog status");
    expect(text).toContain("/rog profile");
    expect(text).toContain("/rog temp");
    expect(text).toContain("/rog battery");
  });

  it("formatTelemetry formats full telemetry correctly", async () => {
    vi.resetModules();
    const { formatTelemetry } = await import("./index.js");
    const t = {
      cpu: { tempC: 72.5 },
      gpu: { usagePct: 85, vramMB: 3200 },
      battery: { pct: 67, voltageMV: 7800, watts: 35, healthPct: 94, isCharging: false },
      powerMode: "turbo" as const,
      displayHz: 120,
    };
    const text = formatTelemetry(t);
    expect(text).toContain("Power Mode: TURBO");
    expect(text).toContain("CPU Temp: 73C"); // rounded
    expect(text).toContain("GPU Usage: 85%");
    expect(text).toContain("GPU VRAM: 3200MB");
    expect(text).toContain("Display: 120Hz");
    expect(text).toContain("Battery: 67%");
    expect(text).not.toContain("(charging)");
    expect(text).toContain("Power Draw: 35W");
    expect(text).toContain("Battery Health: 94%");
    expect(text).toContain("Voltage: 7800mV");
  });

  it("formatTelemetry handles null values with N/A", async () => {
    vi.resetModules();
    const { formatTelemetry } = await import("./index.js");
    const t = {
      cpu: { tempC: null },
      gpu: { usagePct: null, vramMB: null },
      battery: { pct: null, voltageMV: null, watts: null, healthPct: null, isCharging: false },
      powerMode: "unknown" as const,
      displayHz: null,
    };
    const text = formatTelemetry(t);
    expect(text).toContain("CPU Temp: N/A");
    expect(text).toContain("GPU Usage: N/A");
    expect(text).toContain("Display: N/A");
    expect(text).toContain("Battery: N/A");
    expect(text).not.toContain("Power Draw");
    expect(text).not.toContain("Battery Health");
  });

  it("formatTelemetry shows charging indicator", async () => {
    vi.resetModules();
    const { formatTelemetry } = await import("./index.js");
    const t = {
      cpu: { tempC: 50 },
      gpu: { usagePct: 10, vramMB: 500 },
      battery: { pct: 80, voltageMV: null, watts: null, healthPct: null, isCharging: true },
      powerMode: "silent" as const,
      displayHz: 60,
    };
    const text = formatTelemetry(t);
    expect(text).toContain("80% (charging)");
  });

  it("formatStatus shows non-ROG message", async () => {
    vi.resetModules();
    const { formatStatus } = await import("./index.js");
    const text = formatStatus({ isRogDevice: false, model: null, telemetry: null });
    expect(text).toContain("not an ASUS ROG device");
  });

  it("formatStatus shows ROG device with model and telemetry", async () => {
    vi.resetModules();
    const { formatStatus } = await import("./index.js");
    const text = formatStatus({
      isRogDevice: true,
      model: "ROG Ally RC71L",
      telemetry: {
        cpu: { tempC: 65 },
        gpu: { usagePct: 50, vramMB: 2048 },
        battery: { pct: 90, voltageMV: null, watts: null, healthPct: null, isCharging: true },
        powerMode: "performance",
        displayHz: 120,
      },
    });
    expect(text).toContain("ROG Device: ROG Ally RC71L");
    expect(text).toContain("PERFORMANCE");
    expect(text).toContain("120Hz");
  });
});

// ── Plugin registration tests ───────────────────────────────

describe("rog-hardware plugin", () => {
  it("registers the /rog command", async () => {
    vi.resetModules();
    const { default: plugin } = await import("./index.js");

    let command: any;
    plugin.register(
      createTestPluginApi({
        id: "rog-hardware",
        name: "ROG Hardware Control",
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

    expect(command?.name).toBe("rog");
    expect(command?.acceptsArgs).toBe(true);
  });

  it("returns help text when no args provided", async () => {
    vi.resetModules();
    const { default: plugin } = await import("./index.js");

    let command: any;
    plugin.register(
      createTestPluginApi({
        id: "rog-hardware",
        name: "ROG Hardware Control",
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
});
