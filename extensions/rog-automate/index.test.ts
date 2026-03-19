import { describe, expect, it, vi } from "vitest";
import { createTestPluginApi } from "../../test/helpers/extensions/plugin-api.js";

describe("rog-automate plugin", () => {
  it("registers the /auto command", async () => {
    vi.resetModules();
    const { default: plugin } = await import("./index.js");

    let command: any;
    plugin.register(
      createTestPluginApi({
        id: "rog-automate",
        name: "ROG Automation Rules",
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

    expect(command?.name).toBe("auto");
    expect(command?.acceptsArgs).toBe(true);
  });

  it("lists built-in rules", async () => {
    vi.resetModules();
    const { default: plugin } = await import("./index.js");

    let command: any;
    plugin.register(
      createTestPluginApi({
        id: "rog-automate",
        name: "ROG Automation Rules",
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
      commandBody: "/auto rules",
      args: "rules",
      config: {},
      requestConversationBinding: async () => ({ status: "error" as const }),
      detachConversationBinding: async () => ({ removed: false }),
      getCurrentConversationBinding: async () => null,
    });

    const text = String(result?.text ?? "");
    expect(text).toContain("Automation Rules");
    expect(text).toContain("Cyberpunk 2077");
    expect(text).toContain("TURBO");
  });

  it("findMatchingRule prioritizes turbo over performance", async () => {
    vi.resetModules();
    const { findMatchingRule } = await import("./index.js");

    const rules = [
      { id: "perf-app", name: "Perf App", processNames: ["PerfProc"], profile: "performance" as const, enabled: true },
      { id: "turbo-app", name: "Turbo App", processNames: ["TurboProc"], profile: "turbo" as const, enabled: true },
    ];

    const running = new Set(["PerfProc", "TurboProc"]);
    const result = findMatchingRule(running, rules);
    expect(result?.id).toBe("turbo-app");
  });

  it("findMatchingRule skips disabled rules", async () => {
    vi.resetModules();
    const { findMatchingRule } = await import("./index.js");

    const rules = [
      { id: "disabled-app", name: "Disabled", processNames: ["DisabledProc"], profile: "turbo" as const, enabled: false },
      { id: "active-app", name: "Active", processNames: ["ActiveProc"], profile: "performance" as const, enabled: true },
    ];

    const running = new Set(["DisabledProc", "ActiveProc"]);
    const result = findMatchingRule(running, rules);
    expect(result?.id).toBe("active-app");
  });

  it("findMatchingRule returns null when no match", async () => {
    vi.resetModules();
    const { findMatchingRule } = await import("./index.js");

    const rules = [
      { id: "app", name: "App", processNames: ["NotRunning"], profile: "turbo" as const, enabled: true },
    ];

    const running = new Set(["SomeOther"]);
    const result = findMatchingRule(running, rules);
    expect(result).toBeNull();
  });
});
