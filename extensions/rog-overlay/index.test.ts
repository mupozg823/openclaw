import { describe, expect, it, vi } from "vitest";
import { createTestPluginApi } from "../../test/helpers/extensions/plugin-api.js";

describe("rog-overlay plugin", () => {
  it("registers the /overlay command", async () => {
    vi.resetModules();
    const { default: plugin } = await import("./index.js");

    let command: any;
    plugin.register(
      createTestPluginApi({
        id: "rog-overlay",
        name: "ROG Game Overlay",
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

    expect(command?.name).toBe("overlay");
    expect(command?.acceptsArgs).toBe(true);
  });

  it("returns help with all commands", async () => {
    vi.resetModules();
    const { default: plugin } = await import("./index.js");

    let command: any;
    plugin.register(
      createTestPluginApi({
        id: "rog-overlay",
        name: "ROG Game Overlay",
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
      commandBody: "/overlay help",
      args: "help",
      config: {},
      requestConversationBinding: async () => ({ status: "error" as const }),
      detachConversationBinding: async () => ({ removed: false }),
      getCurrentConversationBinding: async () => null,
    });

    const text = String(result?.text ?? "");
    expect(text).toContain("/overlay start");
    expect(text).toContain("/overlay stop");
    expect(text).toContain("/overlay stats");
  });

  it("miniBar renders correctly", async () => {
    vi.resetModules();
    const { miniBar } = await import("./index.js");

    expect(miniBar(0, 8)).toBe("░░░░░░░░");
    expect(miniBar(100, 8)).toBe("████████");
    expect(miniBar(50, 4)).toBe("██░░");
  });

  it("formatCompactHud includes CPU and GPU", async () => {
    vi.resetModules();
    const { formatCompactHud } = await import("./index.js");

    const frame = {
      timestamp: Date.now(),
      cpuPct: 42,
      cpuTempC: 65,
      gpuPct: 80,
      gpuTempC: 72,
      vramUsedMB: 4096,
      ramPct: 55,
      fps: 60,
      batteryPct: 75,
      powerMode: "Turbo",
      activeGame: "Cyberpunk2077",
    };

    const text = formatCompactHud(frame);
    expect(text).toContain("CPU");
    expect(text).toContain("42%");
    expect(text).toContain("GPU");
    expect(text).toContain("80%");
    expect(text).toContain("FPS: 60");
    expect(text).toContain("Turbo");
    expect(text).toContain("Cyberpunk2077");
  });

  it("getAvgStats computes averages", async () => {
    vi.resetModules();
    const { getAvgStats } = await import("./index.js");

    // Fresh module — no frames recorded
    const stats = getAvgStats();
    expect(stats.avgCpu).toBe(0);
    expect(stats.avgGpu).toBe(0);
    expect(stats.avgFps).toBeNull();
  });
});
